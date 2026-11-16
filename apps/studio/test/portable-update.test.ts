// Atualização do ZIP portátil (Windows): extração do pacote e troca dos arquivos com rollback. Usa o tar.exe e o
// PowerShell reais do sistema, por isso só roda no Windows.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { SWAP_SCRIPT, prepareStage, startPortableSwap } from '../src/entrypoints/installer';

const win = process.platform === 'win32';
const tmp = () => mkdtempSync(join(tmpdir(), 'gn-ptl-'));

/** ZIP mínimo (entradas sem compressão), suficiente para o tar.exe extrair. */
function makeZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // sem compressão
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12); // data: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** "App" falso: o executável é um .cmd que grava `started.txt` ao lado de si (é o que prova a reabertura). */
const EXE = 'GitNexus.cmd';
const exeBody = (version: string) => `@echo ${version}> "%~dp0started.txt"\r\n`;

function fakeApp(version: string): string {
  const app = tmp();
  writeFileSync(join(app, EXE), exeBody(version));
  mkdirSync(join(app, 'resources'));
  writeFileSync(join(app, 'resources', 'app.asar'), version);
  mkdirSync(join(app, 'GitNexusData'));
  writeFileSync(join(app, 'GitNexusData', 'hosting.json'), 'segredo-do-usuario');
  writeFileSync(join(app, 'minha-nota.txt'), 'arquivo que não é do pacote');
  return app;
}

async function waitFor(cond: () => boolean, ms = 20000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 100));
  }
}
const startedBy = (app: string) => (existsSync(join(app, 'started.txt')) ? readFileSync(join(app, 'started.txt'), 'utf8').trim() : '');
const exited = (c: ReturnType<typeof spawn>) => new Promise<number | null>((res) => c.once('exit', res));
const GONE_PID = 2147483000; // não existe: o script não espera ninguém

describe.runIf(win)('ZIP portátil: preparo e troca', () => {
  it('extrai o ZIP (inclusive com pasta-raiz) e confere que contém o executável', async () => {
    const dir = tmp();
    const flat = join(dir, 'flat.zip');
    writeFileSync(flat, makeZip({ [EXE]: exeBody('2.0.0'), 'resources/app.asar': '2.0.0' }));
    const root = await prepareStage(flat, dir, EXE);
    expect(readFileSync(join(root, 'resources', 'app.asar'), 'utf8')).toBe('2.0.0');
    expect(root.startsWith(dir)).toBe(true);

    const nested = join(dir, 'nested.zip');
    writeFileSync(nested, makeZip({ [`GitNexus/${EXE}`]: exeBody('2.0.0') }));
    expect(existsSync(join(await prepareStage(nested, dir, EXE), EXE))).toBe(true);
  });

  it('recusa um ZIP que não é o app (sem o executável)', async () => {
    const dir = tmp();
    const zip = join(dir, 'x.zip');
    writeFileSync(zip, makeZip({ 'qualquer.txt': 'x' }));
    await expect(prepareStage(zip, dir, EXE)).rejects.toThrow(/não contém/);
    expect(readdirSync(dir).filter((n) => n.includes('stage'))).toEqual([]);
  });

  it('troca os arquivos, preserva GitNexusData e o que não é do pacote, reabre o app e apaga o pacote', async () => {
    const app = fakeApp('1.0.0');
    const zip = join(app, 'gnupdate-GitNexus-2.0.0-win-x64.zip');
    writeFileSync(zip, makeZip({ [EXE]: exeBody('2.0.0'), 'resources/app.asar': '2.0.0', 'resources/novo.bin': 'n' }));
    const stage = await prepareStage(zip, app, EXE);

    const child = await startPortableSwap({ pid: GONE_PID, stageDir: stage, zip, appDir: app, exe: EXE, workDir: app });
    expect(await exited(child)).toBe(0);
    await waitFor(() => startedBy(app) !== '');

    expect(readFileSync(join(app, 'resources', 'app.asar'), 'utf8')).toBe('2.0.0');
    expect(existsSync(join(app, 'resources', 'novo.bin'))).toBe(true);
    expect(startedBy(app)).toBe('2.0.0'); // abriu a versão NOVA
    expect(readFileSync(join(app, 'GitNexusData', 'hosting.json'), 'utf8')).toBe('segredo-do-usuario');
    expect(readFileSync(join(app, 'minha-nota.txt'), 'utf8')).toBe('arquivo que não é do pacote');
    // o pacote e os restos da troca foram removidos
    await waitFor(() => !readdirSync(app).some((n) => n.startsWith('.gnupdate-') || n.endsWith('.zip')));
  });

  it('se a troca falhar no meio, desfaz tudo e reabre a versão anterior', async () => {
    const app = fakeApp('1.0.0');
    const zip = join(app, 'gnupdate-x.zip');
    writeFileSync(zip, makeZip({ [EXE]: exeBody('2.0.0'), 'resources/app.asar': '2.0.0' }));
    const stage = await prepareStage(zip, app, EXE);

    // Um processo com a pasta `resources` como diretório atual impede que ela seja renomeada: a troca falha depois de já ter trocado o .cmd.
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: join(app, 'resources'), stdio: 'ignore' });
    try {
      const script = join(dirname(zip), 'swap.ps1');
      writeFileSync(script, SWAP_SCRIPT);
      const ps = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const child = spawn(
        ps,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ProcId', String(GONE_PID), '-Stage', stage, '-AppDir', app, '-Exe', EXE, '-Zip', zip, '-Retries', '2'],
        { stdio: 'ignore', windowsHide: true },
      );
      expect(await exited(child)).toBe(1);
      await waitFor(() => startedBy(app) !== '');
      expect(startedBy(app)).toBe('1.0.0'); // reabriu a versão ANTERIOR
      expect(readFileSync(join(app, EXE), 'utf8')).toBe(exeBody('1.0.0'));
      expect(readFileSync(join(app, 'resources', 'app.asar'), 'utf8')).toBe('1.0.0');
      expect(readFileSync(join(app, 'GitNexusData', 'hosting.json'), 'utf8')).toBe('segredo-do-usuario');
    } finally {
      holder.kill();
    }
  }, 60000);

  it('o script é só ASCII (o PowerShell 5.1 lê arquivos sem BOM como ANSI)', () => {
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(SWAP_SCRIPT)).toBe(true);
  });
});
