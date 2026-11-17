import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EncodingError, getFileDiff, getFileEncoding, getFileSides, resolveConflictFile, runGit, writeIndexContent, writeWorkingFile } from '../src/index.js';

let root: string;
let repo: string;
const git = (...a: string[]) => runGit(repo, a);
const file = (n: string) => join(repo, n);
const bytesOf = (n: string) => readFileSync(file(n));

/** "ação\nsegunda\n" em Windows-1252: os acentos são os bytes E7 E3 (inválidos em UTF-8). */
const LATIN = Buffer.from([0x61, 0xe7, 0xe3, 0x6f, 0x0a, 0x73, 0x65, 0x67, 0x75, 0x6e, 0x64, 0x61, 0x0a]);

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-enc-'));
  repo = join(root, 'repo');
  await runGit(root, ['init', '-b', 'main', repo]);
  await git('config', 'user.name', 'Teste');
  await git('config', 'user.email', 't@e.com');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.autocrlf', 'false');
  writeFileSync(file('latin.txt'), LATIN);
  writeFileSync(file('utf8.txt'), 'ação\nsegunda\n');
  writeFileSync(file('bom.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('olá\nx\n')]));
  await git('add', '.');
  await git('commit', '-m', 'init');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('diff: lê na codificação certa', () => {
  it('arquivo Windows-1252 aparece com os acentos (antes: "�") e diz que é Windows-1252', async () => {
    writeFileSync(file('latin.txt'), Buffer.concat([LATIN, Buffer.from('nova linha\n')]));
    const s = await getFileSides(repo, 'latin.txt', 'head');
    expect(s.encoding).toBe('windows-1252');
    expect(s.detectedEncoding).toBe('windows-1252');
    expect(s.invalid).toBe(false);
    expect(s.oldText).toBe('ação\nsegunda\n');
    expect(s.newText).toBe('ação\nsegunda\nnova linha\n');
    expect(s.newText).not.toContain('�');
    expect((await getFileEncoding(repo, 'latin.txt', 'head')).encoding).toBe('windows-1252');
    expect(await getFileDiff(repo, 'latin.txt', 'head')).toContain('+nova linha');
    await git('checkout', '--', 'latin.txt');
  });

  it('UTF-8 e UTF-8 com BOM são reconhecidos', async () => {
    expect((await getFileSides(repo, 'utf8.txt', 'head')).encoding).toBe('utf-8');
    const bom = await getFileSides(repo, 'bom.txt', 'head');
    expect(bom.encoding).toBe('utf-8-bom');
    expect(bom.oldText).toBe('olá\nx\n'); // o BOM não aparece como caractere
  });

  it('escolher outra codificação relê o arquivo: UTF-8 num arquivo Windows-1252 é inválido (e mostra "�")', async () => {
    const s = await getFileSides(repo, 'latin.txt', 'head', 'utf-8');
    expect(s.encoding).toBe('utf-8');
    expect(s.detectedEncoding).toBe('windows-1252');
    expect(s.invalid).toBe(true);
    expect(s.newText).toContain('�');
    const iso = await getFileSides(repo, 'latin.txt', 'head', 'iso-8859-1');
    expect(iso.invalid).toBe(false);
    expect(iso.newText).toBe('ação\nsegunda\n'); // ISO-8859-1 e Windows-1252 coincidem nos acentos
  });
});

describe('gravações: o arquivo mantém a codificação (nunca regrava como UTF-8)', () => {
  it('writeWorkingFile em arquivo Windows-1252 grava os MESMOS bytes dos acentos', async () => {
    await writeWorkingFile(repo, 'latin.txt', 'ação\nterceira\n');
    expect(bytesOf('latin.txt').equals(Buffer.from([0x61, 0xe7, 0xe3, 0x6f, 0x0a, ...Buffer.from('terceira\n')]))).toBe(true);
    await git('checkout', '--', 'latin.txt');
    expect(bytesOf('latin.txt').equals(LATIN)).toBe(true);
  });

  it('writeWorkingFile em UTF-8 com BOM preserva o BOM', async () => {
    await writeWorkingFile(repo, 'bom.txt', 'olá\ny\n');
    expect([...bytesOf('bom.txt').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytesOf('bom.txt').subarray(3).toString('utf8')).toBe('olá\ny\n');
    await git('checkout', '--', 'bom.txt');
  });

  it('com a codificação explícita, grava nela', async () => {
    await writeWorkingFile(repo, 'latin.txt', 'ação\n', 'windows-1252');
    expect(bytesOf('latin.txt').equals(Buffer.from([0x61, 0xe7, 0xe3, 0x6f, 0x0a]))).toBe(true);
    await git('checkout', '--', 'latin.txt');
  });

  it('caractere que a codificação não tem: recusa e o arquivo fica EXATAMENTE como estava', async () => {
    const before = bytesOf('latin.txt');
    await expect(writeWorkingFile(repo, 'latin.txt', 'preço 日本\n')).rejects.toThrow(EncodingError);
    expect(bytesOf('latin.txt').equals(before)).toBe(true);
    await expect(writeIndexContent(repo, 'latin.txt', 'preço 日本\n')).rejects.toThrow(/não existe/);
    expect((await git('diff', '--cached', '--stat')).stdout.trim()).toBe(''); // nada foi para o índice
  });

  it('stage por linha (writeIndexContent) em arquivo Windows-1252 guarda os bytes certos no índice', async () => {
    await writeIndexContent(repo, 'latin.txt', 'ação\nsegunda\nnova ação\n');
    const staged = (await git('show', ':latin.txt')).bytes;
    expect(staged.equals(Buffer.from([...LATIN, ...Buffer.from([0x6e, 0x6f, 0x76, 0x61, 0x20, 0x61, 0xe7, 0xe3, 0x6f, 0x0a])]))).toBe(true);
    await git('reset', '-q', 'latin.txt');
  });
});

describe('conflitos: resolver não corrompe', () => {
  it('resolveConflictFile regrava na codificação do arquivo em conflito', async () => {
    // cria um conflito real entre dois ramos, num arquivo Windows-1252
    writeFileSync(file('c.txt'), Buffer.from([0x61, 0xe7, 0x0a, 0x6d, 0x65, 0x69, 0x6f, 0x0a, 0x7a, 0x0a]));
    await git('add', 'c.txt');
    await git('commit', '-m', 'c');
    await git('checkout', '-q', '-b', 'outro');
    writeFileSync(file('c.txt'), Buffer.from([0x61, 0xe7, 0x0a, 0x6f, 0x75, 0x74, 0x72, 0x6f, 0xe3, 0x0a, 0x7a, 0x0a]));
    await git('commit', '-qam', 'outro');
    await git('checkout', '-q', 'main');
    writeFileSync(file('c.txt'), Buffer.from([0x61, 0xe7, 0x0a, 0x6e, 0x6f, 0x73, 0x73, 0x6f, 0xf5, 0x0a, 0x7a, 0x0a]));
    await git('commit', '-qam', 'main');
    await runGit(repo, ['merge', 'outro'], { check: false });

    const ok = await resolveConflictFile(repo, 'c.txt', 'aç\nresolvido ão\nz\n');
    expect(ok).toBe(true);
    expect(bytesOf('c.txt').equals(Buffer.from([0x61, 0xe7, 0x0a, ...Buffer.from('resolvido '), 0xe3, 0x6f, 0x0a, 0x7a, 0x0a]))).toBe(true);
    await runGit(repo, ['merge', '--abort'], { check: false });
  });
});
