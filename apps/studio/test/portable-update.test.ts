// Atualização do ZIP portátil (Windows): extração do pacote e troca dos arquivos com rollback. Usa o tar.exe do
// sistema e executáveis de verdade (cópias do node.exe), por isso só roda no Windows.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { SWAP_SCRIPT, cleanupUpdateFiles, prepareStage, startPortableSwap } from '../src/entrypoints/installer';

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

/**
 * "App" falso: o executável é um CÓPIA (hard link) do node.exe, então roda de verdade e, como o Electron em
 * `ELECTRON_RUN_AS_NODE`, executa o script de troca. `launch.js` faz o papel da abertura do app: grava `started.txt`
 * com a versão que está em `version.txt` ao lado dele.
 */
const EXE = 'GitNexus.exe';
const LAUNCH = "const fs = require('fs'); fs.writeFileSync('started.txt', fs.readFileSync('version.txt', 'utf8'));";

function putExe(dir: string): void {
  try {
    linkSync(process.execPath, join(dir, EXE)); // hard link: instantâneo e sem ocupar espaço
  } catch {
    copyFileSync(process.execPath, join(dir, EXE));
  }
}

/** Preenche uma pasta com os arquivos de uma "versão". */
function fillVersion(dir: string, version: string): void {
  putExe(dir);
  writeFileSync(join(dir, 'launch.js'), LAUNCH);
  writeFileSync(join(dir, 'version.txt'), version);
  mkdirSync(join(dir, 'resources'), { recursive: true });
  writeFileSync(join(dir, 'resources', 'app.asar'), version);
}

function fakeApp(version: string): string {
  const app = tmp();
  fillVersion(app, version);
  mkdirSync(join(app, 'GitNexusData'));
  writeFileSync(join(app, 'GitNexusData', 'hosting.json'), 'segredo-do-usuario');
  writeFileSync(join(app, 'minha-nota.txt'), 'arquivo que não é do pacote');
  return app;
}

/** Pacote já extraído em `<app>/.gnupdate-stage`, mais o ZIP baixado ao lado (o que o app deixa antes de reiniciar). */
function stageFor(app: string, version: string): { stage: string; zip: string } {
  const stage = join(app, '.gnupdate-stage');
  mkdirSync(stage);
  fillVersion(stage, version);
  writeFileSync(join(stage, 'resources', 'novo.bin'), 'n');
  const zip = join(app, 'gnupdate-GitNexus-2.0.0-win-x64.zip');
  writeFileSync(zip, 'zip-baixado');
  return { stage, zip };
}

const startedBy = (app: string) => (existsSync(join(app, 'started.txt')) ? readFileSync(join(app, 'started.txt'), 'utf8').trim() : '');
async function waitFor(cond: () => boolean, ms = 20000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 100));
  }
}
const exited = (c: ReturnType<typeof spawn>) => new Promise<number | null>((res) => (c.exitCode !== null ? res(c.exitCode) : c.once('exit', res)));
const GONE_PID = 2147483000; // não existe: o script não espera ninguém

describe.runIf(win)('ZIP portátil: preparo', () => {
  it('extrai o ZIP (inclusive com pasta-raiz) e confere que contém o executável', async () => {
    const dir = tmp();
    const flat = join(dir, 'flat.zip');
    writeFileSync(flat, makeZip({ [EXE]: 'exe', 'resources/app.asar': '2.0.0' }));
    const root = await prepareStage(flat, dir, EXE);
    expect(readFileSync(join(root, 'resources', 'app.asar'), 'utf8')).toBe('2.0.0');
    expect(root.startsWith(dir)).toBe(true);

    const nested = join(dir, 'nested.zip');
    writeFileSync(nested, makeZip({ [`GitNexus/${EXE}`]: 'exe' }));
    expect(existsSync(join(await prepareStage(nested, dir, EXE), EXE))).toBe(true);
  });

  it('recusa um ZIP que não é o app (sem o executável)', async () => {
    const dir = tmp();
    const zip = join(dir, 'x.zip');
    writeFileSync(zip, makeZip({ 'qualquer.txt': 'x' }));
    await expect(prepareStage(zip, dir, EXE)).rejects.toThrow(/não contém/);
    expect(readdirSync(dir).filter((n) => n.includes('stage'))).toEqual([]);
  });
});

describe.runIf(win)('ZIP portátil: troca dos arquivos (script rodado pelo próprio executável antigo)', () => {
  it('troca tudo, inclusive o executável em uso, preserva GitNexusData, reabre a versão NOVA e apaga o pacote', async () => {
    const app = fakeApp('1.0.0');
    const { stage, zip } = stageFor(app, '2.0.0');

    const child = await startPortableSwap({
      pid: GONE_PID, stageDir: stage, cleanup: [stage, zip], appDir: app, exe: EXE, workDir: app,
      runner: join(app, EXE), // como no app real: o executável ATUAL roda o script e é renomeado por ele mesmo
      relaunchArgs: ['launch.js'],
    });
    expect(await exited(child)).toBe(0);
    await waitFor(() => startedBy(app) !== '');

    expect(startedBy(app)).toBe('2.0.0'); // abriu a versão NOVA
    expect(readFileSync(join(app, 'resources', 'app.asar'), 'utf8')).toBe('2.0.0');
    expect(existsSync(join(app, 'resources', 'novo.bin'))).toBe(true);
    expect(readFileSync(join(app, 'GitNexusData', 'hosting.json'), 'utf8')).toBe('segredo-do-usuario');
    expect(readFileSync(join(app, 'minha-nota.txt'), 'utf8')).toBe('arquivo que não é do pacote');
    expect(existsSync(zip)).toBe(false); // o pacote baixado foi removido
    expect(existsSync(stage)).toBe(false);
    // o executável antigo estava em uso, então o backup pode sobrar até a próxima abertura, que o limpa
    await cleanupUpdateFiles(app);
    expect(readdirSync(app).filter((n) => /gnupdate/.test(n))).toEqual([]);
    expect(readFileSync(join(app, 'update.log'), 'utf8')).toMatch(/troca concluída/);
  }, 60000);

  it('se a troca falhar no meio, desfaz tudo e reabre a versão anterior', async () => {
    const app = fakeApp('1.0.0');
    const { stage, zip } = stageFor(app, '2.0.0');

    // Um processo com `resources` como diretório atual impede que a pasta seja renomeada: a troca falha depois de já ter trocado o executável.
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: join(app, 'resources'), stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 400));
      const child = await startPortableSwap({
        pid: GONE_PID, stageDir: stage, cleanup: [stage, zip], appDir: app, exe: EXE, workDir: app,
        runner: join(app, EXE), relaunchArgs: ['launch.js'], retries: 2,
      });
      expect(await exited(child)).toBe(1);
      await waitFor(() => startedBy(app) !== '');
      expect(startedBy(app)).toBe('1.0.0'); // reabriu a versão ANTERIOR
      expect(readFileSync(join(app, 'version.txt'), 'utf8')).toBe('1.0.0');
      expect(readFileSync(join(app, 'resources', 'app.asar'), 'utf8')).toBe('1.0.0');
      expect(existsSync(join(app, 'resources', 'novo.bin'))).toBe(false);
      expect(readFileSync(join(app, 'GitNexusData', 'hosting.json'), 'utf8')).toBe('segredo-do-usuario');
      expect(readFileSync(join(app, 'update.log'), 'utf8')).toMatch(/troca falhou/);
    } finally {
      holder.kill();
    }
  }, 60000);

  it('se o atualizador não iniciar, avisa (o app não deve fechar à toa)', async () => {
    const app = fakeApp('1.0.0');
    const { stage, zip } = stageFor(app, '2.0.0');
    await expect(
      startPortableSwap({ pid: GONE_PID, stageDir: stage, cleanup: [zip], appDir: app, exe: EXE, workDir: app, runner: join(app, 'nao-existe.exe'), startTimeoutMs: 3000 }),
    ).rejects.toThrow(/não iniciou/);
    // nada foi mexido
    expect(readFileSync(join(app, 'version.txt'), 'utf8')).toBe('1.0.0');
    expect(existsSync(zip)).toBe(true);
  });

  it('o script é um JavaScript válido', () => {
    expect(() => new Function(SWAP_SCRIPT.replace(/^'use strict';/, ''))).not.toThrow();
  });
});
