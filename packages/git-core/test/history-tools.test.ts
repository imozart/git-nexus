import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getBlame,
  getCommitDetail,
  getCommitFileDiff,
  getFileAtRevision,
  getFileHistory,
  listTrackedFiles,
  parseBlame,
  runGit,
  searchHistory,
} from '../src/index.js';

let repo: string;
const git = (...a: string[]) => runGit(repo, a);
const hashes: Record<string, string> = {};

async function commit(file: string, content: string, msg: string, author = 'Ana <ana@e.com>') {
  writeFileSync(join(repo, file), content);
  await git('add', '.');
  await git('commit', '-m', msg, `--author=${author}`);
  hashes[msg] = (await git('rev-parse', 'HEAD')).stdout.trim();
}

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'gitnexus-hist-'));
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Beto');
  await git('config', 'user.email', 'beto@e.com');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.autocrlf', 'false');
  await commit('a.txt', 'um\ndois\n', 'feat: cria a');
  await commit('b.txt', 'bbb\n', 'feat: cria b', 'Caio <caio@e.com>');
  await commit('a.txt', 'um\nDOIS\ntres\n', 'fix: ajusta a');
  mkdirSync(join(repo, 'pasta'));
  renameSync(join(repo, 'a.txt'), join(repo, 'pasta', 'a.txt'));
  await git('add', '-A');
  await git('commit', '-m', 'refactor: move a');
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('busca no histórico', () => {
  it('por mensagem (sem diferenciar maiúsculas, texto literal)', async () => {
    expect((await searchHistory(repo, { text: 'CRIA' })).map((c) => c.subject).sort()).toEqual(['feat: cria a', 'feat: cria b']);
    expect(await searchHistory(repo, { text: 'a.*b' })).toEqual([]); // não é regex neste modo
  });

  it('por conteúdo (pickaxe) e por regex', async () => {
    const r = await searchHistory(repo, { text: 'tres', mode: 'content' });
    expect(r.map((c) => c.subject)).toEqual(['fix: ajusta a']);
    const g = await searchHistory(repo, { text: '^DOIS$', mode: 'regex' });
    expect(g.map((c) => c.subject)).toEqual(['fix: ajusta a']);
    await expect(searchHistory(repo, { text: '(', mode: 'regex' })).rejects.toThrow(/inválida/);
  });

  it('por autor, por caminho e combinados', async () => {
    expect((await searchHistory(repo, { author: 'Caio' })).map((c) => c.subject)).toEqual(['feat: cria b']);
    expect((await searchHistory(repo, { path: 'b.txt' })).map((c) => c.subject)).toEqual(['feat: cria b']);
    expect((await searchHistory(repo, { author: 'Ana', text: 'cria' })).map((c) => c.subject)).toEqual(['feat: cria a']);
    await expect(searchHistory(repo, { path: '../fora' })).rejects.toThrow();
  });
});

describe('histórico de arquivo e detalhe de commit', () => {
  it('segue renomeações', async () => {
    const h = await getFileHistory(repo, 'pasta/a.txt');
    expect(h.map((c) => c.subject)).toEqual(['refactor: move a', 'fix: ajusta a', 'feat: cria a']);
  });

  it('lista os arquivos do commit e o diff de um deles', async () => {
    const d = await getCommitDetail(repo, hashes['fix: ajusta a']!);
    expect(d.message).toBe('fix: ajusta a');
    expect(d.files).toEqual([{ status: 'M', path: 'a.txt' }]);
    const diff = await getCommitFileDiff(repo, hashes['fix: ajusta a']!, 'a.txt');
    expect(diff).toContain('+DOIS');
    expect(diff).toContain('+tres');
    await expect(getCommitDetail(repo, 'abc; rm -rf')).rejects.toThrow('inválido');
  });

  it('lista os arquivos versionados', async () => {
    expect((await listTrackedFiles(repo)).sort()).toEqual(['b.txt', 'pasta/a.txt']);
  });
});

describe('blame', () => {
  it('atribui cada linha ao commit certo', async () => {
    const b = await getBlame(repo, 'pasta/a.txt');
    expect(b.map((l) => [l.line, l.text, l.author])).toEqual([
      [1, 'um', 'Ana'],
      [2, 'DOIS', 'Ana'],
      [3, 'tres', 'Ana'],
    ]);
    expect(b[0]!.hash).toBe(hashes['feat: cria a']);
    expect(b[1]!.hash).toBe(hashes['fix: ajusta a']);
    expect(b[1]!.summary).toBe('fix: ajusta a');
    expect(b[0]!.date).toBeGreaterThan(1_600_000_000);
  });

  it('inclui alterações locais (linha ainda não commitada)', async () => {
    writeFileSync(join(repo, 'b.txt'), 'bbb\nlocal\n');
    const b = await getBlame(repo, 'b.txt');
    expect(b[1]!.text).toBe('local');
    expect(b[1]!.hash).toMatch(/^0{40}$/); // não commitada
    await git('checkout', '--', 'b.txt');
  });

  it('arquivo não versionado dá erro claro; parse tolera saída vazia', async () => {
    writeFileSync(join(repo, 'solto.txt'), 'x\n');
    await expect(getBlame(repo, 'solto.txt')).rejects.toThrow();
    expect(parseBlame('')).toEqual([]);
  });
});

describe('arquivo numa revisão', () => {
  it('devolve o texto como estava naquele commit; arquivo que ainda não existia vem como "não existe"', async () => {
    const a = await getFileAtRevision(repo, hashes['feat: cria a']!, 'a.txt');
    expect(a).toMatchObject({ exists: true, binary: false, tooBig: false });
    expect(a.text.replace(/\r\n/g, '\n')).toBe('um\ndois\n');
    const b = await getFileAtRevision(repo, hashes['feat: cria a']!, 'b.txt');
    expect(b).toMatchObject({ exists: false, text: '' });
  });
  it('recusa hash inválido e caminho fora do repositório', async () => {
    await expect(getFileAtRevision(repo, '--output=x', 'a.txt')).rejects.toThrow();
    await expect(getFileAtRevision(repo, hashes['feat: cria a']!, '../fora')).rejects.toThrow();
  });
  it('binário não devolve texto', async () => {
    writeFileSync(join(repo, 'bin.dat'), Buffer.from([1, 2, 0, 3, 4]));
    await git('add', 'bin.dat');
    await git('commit', '-m', 'bin');
    const h = (await git('rev-parse', 'HEAD')).stdout.trim();
    expect(await getFileAtRevision(repo, h, 'bin.dat')).toMatchObject({ exists: true, binary: true, text: '' });
  });
});
