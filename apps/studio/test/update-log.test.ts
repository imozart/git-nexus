import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_LOG_BYTES, UPDATE_LOG_NAME, createUpdateLog, describeError, noLog } from '../src/entrypoints/update-log';
import { downloadVerified, replaceAppImage } from '../src/entrypoints/installer';
import { createHash } from 'node:crypto';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'gn-ulog-'));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('log da atualização', () => {
  it('cria a pasta, grava uma linha por mensagem com data e hora e acumula', () => {
    const file = join(tmp(), 'logs', UPDATE_LOG_NAME);
    const log = createUpdateLog(file);
    log('primeira');
    log('segunda');
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z primeira$/);
    expect(lines[1]).toMatch(/ segunda$/);
    expect(log.file).toBe(file);
  });

  it('o nome do arquivo é gitnexus-update.log', () => {
    expect(UPDATE_LOG_NAME).toBe('gitnexus-update.log');
  });

  it('não cresce sem limite: passou do teto, o atual vira .old e começa outro', () => {
    const dir = tmp();
    const file = join(dir, UPDATE_LOG_NAME);
    writeFileSync(file, 'x'.repeat(MAX_LOG_BYTES + 10));
    createUpdateLog(file)('nova atualização');
    expect(readFileSync(`${file}.old`, 'utf8')).toHaveLength(MAX_LOG_BYTES + 10);
    expect(readFileSync(file, 'utf8')).toMatch(/nova atualização\n$/);
    expect(readdirSync(dir).sort()).toEqual([`${UPDATE_LOG_NAME}`, `${UPDATE_LOG_NAME}.old`]);
  });

  it('nunca lança, mesmo sem poder gravar (a atualização segue sem log)', () => {
    const dir = tmp();
    const blocker = join(dir, 'arquivo');
    writeFileSync(blocker, 'x'); // "pasta" que na verdade é um arquivo: mkdir/append falham
    expect(() => createUpdateLog(join(blocker, 'logs', UPDATE_LOG_NAME))('x')).not.toThrow();
    expect(() => noLog('x')).not.toThrow();
  });

  it('describeError mostra o código do sistema (EBUSY, EPERM…) quando existe', () => {
    const e = Object.assign(new Error('resource busy'), { code: 'EBUSY' });
    expect(describeError(e)).toBe('[EBUSY] resource busy');
    expect(describeError(new Error('simples'))).toBe('simples');
    expect(describeError('texto')).toBe('texto');
  });
});

describe('o download e a troca escrevem no log', () => {
  const NAME = 'GitNexus-9.9.9-win-x64-portable.zip';
  const body = Buffer.from('conteudo do pacote');
  const sha = createHash('sha256').update(body).digest('hex');
  const fakeFetch = (okBody = body): typeof fetch =>
    (async (url: string) =>
      String(url).endsWith('SHA256SUMS.txt')
        ? new Response(`${sha}  ${NAME}\n`)
        : new Response(okBody, { headers: { 'content-length': String(okBody.length) } })) as unknown as typeof fetch;
  const base = (dir: string, f: typeof fetch) => ({
    url: `https://github.com/imozart/git-nexus/releases/download/v9.9.9/${NAME}`,
    name: NAME,
    sumsUrl: 'https://github.com/imozart/git-nexus/releases/download/v9.9.9/SHA256SUMS.txt',
    destDir: dir,
    fetchImpl: f,
  });

  it('download concluído: pacote, tamanho, SHA-256 esperado e conferido', async () => {
    const dir = tmp();
    const log = createUpdateLog(join(dir, 'logs', UPDATE_LOG_NAME));
    await downloadVerified({ ...base(dir, fakeFetch()), log });
    const text = readFileSync(log.file, 'utf8');
    expect(text).toContain(`download: pacote ${NAME}`);
    expect(text).toContain(`SHA-256 esperado ${sha}`);
    expect(text).toContain(`tamanho informado ${body.length} bytes`);
    expect(text).toContain('SHA-256 conferido');
  });

  it('download com hash diferente: o log diz FALHOU e o motivo', async () => {
    const dir = tmp();
    const log = createUpdateLog(join(dir, 'logs', UPDATE_LOG_NAME));
    await expect(downloadVerified({ ...base(dir, fakeFetch(Buffer.from('adulterado'))), log })).rejects.toThrow(/SHA-256/);
    expect(readFileSync(log.file, 'utf8')).toMatch(/download: FALHOU: .*SHA-256/);
  });

  it('AppImage: registra a substituição e a falha', async () => {
    const dir = tmp();
    const log = createUpdateLog(join(dir, 'logs', UPDATE_LOG_NAME));
    const pkg = join(dir, 'novo.AppImage');
    const target = join(dir, 'app.AppImage');
    writeFileSync(pkg, 'novo');
    writeFileSync(target, 'velho');
    await replaceAppImage(pkg, target, log);
    expect(readFileSync(log.file, 'utf8')).toContain('substituído');
    mkdirSync(join(dir, 'pasta'));
    await expect(replaceAppImage(join(dir, 'nao-existe'), join(dir, 'pasta', 'x'), log)).rejects.toThrow();
    expect(readFileSync(log.file, 'utf8')).toMatch(/appimage: FALHOU/);
  });
});
