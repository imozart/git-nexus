import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_EDIT_BYTES, eolOf, pruneBackups, readWorkingFile, restoreWorkingFile, saveWorkingFile, stampWorkingFile, writeWorkingFile } from '../src/index.js';
import { runGit } from '../src/runner.js';

let root: string;
const put = (name: string, data: string | Buffer) => {
  mkdirSync(join(root, name, '..'), { recursive: true });
  writeFileSync(join(root, name), data);
};
const raw = (name: string) => readFileSync(join(root, name));

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gn-wf-'));
  await runGit(root, ['init', '-q', '-b', 'main']);
  await runGit(root, ['config', 'core.fsmonitor', 'false']);
});
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

describe('fim de linha', () => {
  it('só LF, só CRLF, misto (inclui CR solto) e nenhum', () => {
    expect(eolOf('a\nb\n')).toBe('lf');
    expect(eolOf('a\r\nb\r\n')).toBe('crlf');
    expect(eolOf('a\r\nb\n')).toBe('mixed');
    expect(eolOf('a\rb')).toBe('mixed');
    expect(eolOf('sem quebra')).toBe('none');
    expect(eolOf('')).toBe('none');
  });
});

describe('readWorkingFile', () => {
  it('UTF-8 com acento: texto, codificação, fim de linha e a impressão do disco', async () => {
    put('a.txt', 'olá\r\nmundo\r\n');
    const r = await readWorkingFile(root, 'a.txt');
    expect(r).toMatchObject({ exists: true, binary: false, tooLarge: false, text: 'olá\r\nmundo\r\n', encoding: 'utf-8', eol: 'crlf', invalid: false });
    expect(r.size).toBe(raw('a.txt').length);
    expect(r.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(await stampWorkingFile(root, 'a.txt')).toEqual({ size: r.size, mtimeMs: r.mtimeMs, hash: r.hash });
  });

  it('Latin-1 e UTF-16 são lidos na codificação deles', async () => {
    put('l1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a, 0x61, 0xe7, 0xe3, 0x6f, 0x0a])); // café / ação em windows-1252
    const l1 = await readWorkingFile(root, 'l1.txt');
    expect(l1.text).toBe('café\naçao\n'.replace('açao', 'açã' + 'o'));
    expect(l1.encoding).not.toBe('utf-8');
    put('u16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('oi\r\nvc\r\n', 'utf16le')]));
    const u16 = await readWorkingFile(root, 'u16.txt');
    expect(u16).toMatchObject({ text: 'oi\r\nvc\r\n', encoding: expect.stringContaining('utf-16'), binary: false });
  });

  it('arquivo só ASCII abre como UTF-8, mesmo que o HEAD tenha uma codificação legada (não consulta o git: abrir fica rápido)', async () => {
    put('asc.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])); // café em windows-1252
    await runGit(root, ['add', 'asc.txt']);
    await runGit(root, ['-c', 'user.name=t', '-c', 'user.email=t@e.com', 'commit', '-qm', 'legado']);
    put('asc.txt', 'cafe\n'); // agora só ASCII no disco
    const r = await readWorkingFile(root, 'asc.txt');
    expect(r).toMatchObject({ text: 'cafe\n', encoding: 'utf-8', detectedEncoding: 'utf-8' });
  });

  it('binário, grande demais e inexistente: sem texto, e dizem o motivo', async () => {
    put('b.bin', Buffer.from([1, 2, 0, 3]));
    expect(await readWorkingFile(root, 'b.bin')).toMatchObject({ exists: true, binary: true, text: '' });
    put('big.txt', Buffer.alloc(MAX_EDIT_BYTES + 10, 0x61));
    expect(await readWorkingFile(root, 'big.txt')).toMatchObject({ exists: true, tooLarge: true, text: '' });
    expect(await readWorkingFile(root, 'nao-existe.txt')).toMatchObject({ exists: false, text: '' });
    expect(await stampWorkingFile(root, 'nao-existe.txt')).toBeNull();
  });

  it('recusa caminho fora do repositório', async () => {
    await expect(readWorkingFile(root, '../fora.txt')).rejects.toThrow();
  });
});

describe('saveWorkingFile', () => {
  it('grava, mantém UTF-8 e CRLF, devolve a impressão nova e não deixa temporário', async () => {
    put('s1.txt', 'um\r\ndois\r\n');
    const before = await readWorkingFile(root, 's1.txt');
    const r = await saveWorkingFile(root, 's1.txt', 'um\r\nTRÊS\r\n', { expectHash: before.hash });
    expect(r.ok).toBe(true);
    expect(raw('s1.txt').toString('utf8')).toBe('um\r\nTRÊS\r\n');
    if (r.ok) expect(r.stamp.hash).toBe((await readWorkingFile(root, 's1.txt')).hash);
    expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('regrava na codificação do arquivo (Latin-1 continua Latin-1, UTF-16 com BOM continua)', async () => {
    put('l1b.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    const b1 = await readWorkingFile(root, 'l1b.txt');
    expect((await saveWorkingFile(root, 'l1b.txt', 'café!\n', { expectHash: b1.hash })).ok).toBe(true);
    expect([...raw('l1b.txt')]).toEqual([0x63, 0x61, 0x66, 0xe9, 0x21, 0x0a]);
    put('u16b.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('oi\r\n', 'utf16le')]));
    const b2 = await readWorkingFile(root, 'u16b.txt');
    expect((await saveWorkingFile(root, 'u16b.txt', 'oi!\r\n', { expectHash: b2.hash })).ok).toBe(true);
    expect([...raw('u16b.txt').subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(raw('u16b.txt').subarray(2).toString('utf16le')).toBe('oi!\r\n');
  });

  it('caractere que a codificação não tem: NADA é gravado e a resposta diz qual', async () => {
    put('l1c.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    const b = await readWorkingFile(root, 'l1c.txt');
    const orig = raw('l1c.txt');
    const r = await saveWorkingFile(root, 'l1c.txt', 'café 😀\n', { expectHash: b.hash });
    expect(r).toMatchObject({ ok: false, reason: 'unencodable', char: '😀' });
    expect(raw('l1c.txt').equals(orig)).toBe(true);
    expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('mudou por fora desde a leitura: recusa; com force sobrescreve; e a resposta traz a impressão atual', async () => {
    put('c.txt', 'v1\n');
    const read = await readWorkingFile(root, 'c.txt');
    put('c.txt', 'v2 por fora\n');
    const r = await saveWorkingFile(root, 'c.txt', 'minha edição\n', { expectHash: read.hash });
    expect(r).toMatchObject({ ok: false, reason: 'changed' });
    expect(raw('c.txt').toString()).toBe('v2 por fora\n');
    if (!r.ok) expect(r.stamp?.hash).toBe((await readWorkingFile(root, 'c.txt')).hash);
    const forced = await saveWorkingFile(root, 'c.txt', 'minha edição\n', { expectHash: read.hash, force: true });
    expect(forced.ok).toBe(true);
    expect(raw('c.txt').toString()).toBe('minha edição\n');
  });

  it('arquivo removido por fora também conta como mudança; criar um novo é com expectHash null', async () => {
    put('d.txt', 'x\n');
    const read = await readWorkingFile(root, 'd.txt');
    rmSync(join(root, 'd.txt'));
    expect(await saveWorkingFile(root, 'd.txt', 'y\n', { expectHash: read.hash })).toMatchObject({ ok: false, reason: 'changed' });
    expect((await saveWorkingFile(root, 'sub/novo.txt', 'novo\n', { expectHash: null })).ok).toBe(true);
    expect(raw('sub/novo.txt').toString()).toBe('novo\n');
    expect(await saveWorkingFile(root, 'sub/novo.txt', 'outro\n', { expectHash: null })).toMatchObject({ ok: false, reason: 'changed' });
  });

  it('mantém o modo do arquivo (executável) onde o sistema tem modo', async () => {
    if (process.platform === 'win32') return;
    put('run.sh', '#!/bin/sh\n');
    chmodSync(join(root, 'run.sh'), 0o755);
    const b = await readWorkingFile(root, 'run.sh');
    await saveWorkingFile(root, 'run.sh', '#!/bin/sh\necho oi\n', { expectHash: b.hash });
    expect(statSync(join(root, 'run.sh')).mode & 0o777).toBe(0o755);
  });

  it('recusa caminho fora do repositório', async () => {
    await expect(saveWorkingFile(root, '../fora.txt', 'x', { expectHash: null })).rejects.toThrow();
    expect(existsSync(join(root, '..', 'fora.txt'))).toBe(false);
  });
});

describe('writeWorkingFile (usado pelo descarte por linha) também é atômico', () => {
  it('grava sem deixar temporário', async () => {
    put('w.txt', 'a\n');
    await writeWorkingFile(root, 'w.txt', 'b\n');
    expect(raw('w.txt').toString()).toBe('b\n');
    expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});

describe('cópia de segurança e desfazer (substituição em vários arquivos)', () => {
  const lote = () => mkdtempSync(join(tmpdir(), 'gn-bk-'));

  it('guarda o que estava no disco antes de gravar; a primeira cópia do lote é a original', async () => {
    put('b1.txt', 'antes\r\n');
    const bk = lote();
    try {
      const r1 = await readWorkingFile(root, 'b1.txt');
      const a = await saveWorkingFile(root, 'b1.txt', 'depois\r\n', { expectHash: r1.hash }, bk);
      expect(a).toMatchObject({ ok: true, backedUp: true });
      expect(readFileSync(join(bk, 'b1.txt')).toString()).toBe('antes\r\n');
      // gravar de novo no mesmo lote não troca a cópia original
      if (!a.ok) throw new Error('x');
      await saveWorkingFile(root, 'b1.txt', 'de novo\r\n', { expectHash: a.stamp.hash }, bk);
      expect(readFileSync(join(bk, 'b1.txt')).toString()).toBe('antes\r\n');
      // sem lote não há cópia
      put('b2.txt', 'x\n');
      const r2 = await readWorkingFile(root, 'b2.txt');
      const b = await saveWorkingFile(root, 'b2.txt', 'y\n', { expectHash: r2.hash });
      expect(b).toMatchObject({ ok: true });
      expect(b.ok && b.backedUp).toBeFalsy();
    } finally {
      rmSync(bk, { recursive: true, force: true });
    }
  });

  it('não copia quando a gravação é recusada (arquivo mudou, caractere fora da codificação)', async () => {
    put('b3.txt', 'um\n');
    const bk = lote();
    try {
      const r = await readWorkingFile(root, 'b3.txt');
      put('b3.txt', 'mudou por fora\n');
      expect(await saveWorkingFile(root, 'b3.txt', 'x\n', { expectHash: r.hash }, bk)).toMatchObject({ ok: false, reason: 'changed' });
      expect(existsSync(join(bk, 'b3.txt'))).toBe(false);
      expect(raw('b3.txt').toString()).toBe('mudou por fora\n');
    } finally {
      rmSync(bk, { recursive: true, force: true });
    }
  });

  it('desfazer devolve o arquivo (byte a byte, com a codificação e o fim de linha originais) só se o disco ainda é o que foi gravado', async () => {
    const original = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0d, 0x0a, 0x66, 0x6f, 0x6f, 0x0d, 0x0a]); // "café\r\nfoo\r\n" em windows-1252
    put('b4.txt', original);
    const bk = lote();
    try {
      const r = await readWorkingFile(root, 'b4.txt');
      const w = await saveWorkingFile(root, 'b4.txt', r.text.replace('foo', 'bar'), { expectHash: r.hash, encoding: r.encoding }, bk);
      if (!w.ok) throw new Error('x');
      expect(raw('b4.txt').toString('latin1')).toBe('caf\u00e9\r\nbar\r\n');
      // a pessoa mexeu depois: nada é sobrescrito
      put('b4.txt', 'mexi depois\n');
      expect(await restoreWorkingFile(root, bk, 'b4.txt', w.stamp.hash)).toMatchObject({ ok: false, reason: 'changed' });
      expect(raw('b4.txt').toString()).toBe('mexi depois\n');
      // volta ao que a substituição gravou e então desfaz
      writeFileSync(join(root, 'b4.txt'), Buffer.from('caf\u00e9\r\nbar\r\n', 'latin1'));
      expect(await restoreWorkingFile(root, bk, 'b4.txt', w.stamp.hash)).toMatchObject({ ok: true });
      expect(raw('b4.txt').equals(original)).toBe(true);
      expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    } finally {
      rmSync(bk, { recursive: true, force: true });
    }
  });

  it('desfazer sem cópia diz "missing"; caminho fora do repositório é recusado', async () => {
    const bk = lote();
    try {
      put('b5.txt', 'a\n');
      expect(await restoreWorkingFile(root, bk, 'b5.txt', 'x')).toMatchObject({ ok: false, reason: 'missing' });
      await expect(restoreWorkingFile(root, bk, '../fora.txt', 'x')).rejects.toThrow();
    } finally {
      rmSync(bk, { recursive: true, force: true });
    }
  });

  it('a poda apaga só os lotes antigos', async () => {
    const base = lote();
    try {
      mkdirSync(join(base, 'velho'));
      mkdirSync(join(base, 'novo'));
      writeFileSync(join(base, 'velho', 'a.txt'), 'x');
      const old = new Date(Date.now() - 40 * 24 * 3600 * 1000);
      utimesSync(join(base, 'velho'), old, old);
      await pruneBackups(base, 30 * 24 * 3600 * 1000);
      expect(readdirSync(base)).toEqual(['novo']);
      await pruneBackups(join(base, 'nao-existe'), 1); // nunca lança
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
