import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addToGitignore,
  applyDiscard,
  diffLines,
  discardFile,
  getFileSides,
  getGitStatus,
  restoreBackup,
  runGit,
  splitLines,
  stageFiles,
  writeWorkingFile,
} from '../src/index.js';

let root: string;
let repo: string;
let backups: string;
const git = (...a: string[]) => runGit(repo, a);
const read = (f: string) => readFileSync(join(repo, f), 'utf8');

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-ops-'));
  repo = join(root, 'repo');
  backups = join(root, 'backups');
  mkdirSync(repo);
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Teste');
  await git('config', 'user.email', 't@e.com');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'a.txt'), 'l1\nl2\nl3\nl4\n');
  writeFileSync(join(repo, 'b.txt'), 'b\n');
  await git('add', '.');
  await git('commit', '-m', 'init');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('descarte por linha (getFileSides + applyDiscard + writeWorkingFile)', () => {
  it('descarta só uma linha alterada e mantém as demais', async () => {
    writeFileSync(join(repo, 'a.txt'), 'l1\nL2\nl3\nNOVA\nl4\n');
    const sides = await getFileSides(repo, 'a.txt', false);
    expect(sides).toMatchObject({ isNew: false, isDeleted: false, binary: false });
    const o = splitLines(sides.oldText);
    const n = splitLines(sides.newText);
    const rows = diffLines(o.lines, n.lines);
    const idx = rows.findIndex((r) => r.newText === 'NOVA');
    await writeWorkingFile(repo, 'a.txt', applyDiscard(rows, new Set([idx]), n));
    expect(read('a.txt')).toBe('l1\nL2\nl3\nl4\n');
    await git('checkout', '--', 'a.txt');
  });

  it('arquivo novo (não rastreado) e arquivo removido', async () => {
    writeFileSync(join(repo, 'novo.txt'), 'x\n');
    expect(await getFileSides(repo, 'novo.txt', false)).toMatchObject({ isNew: true, newText: 'x\n', oldText: '' });
    rmSync(join(repo, 'b.txt'));
    expect(await getFileSides(repo, 'b.txt', false)).toMatchObject({ isDeleted: true, oldText: 'b\n', newText: '' });
    await git('checkout', '--', 'b.txt');
    rmSync(join(repo, 'novo.txt'));
  });

  it('modo staged compara HEAD com o índice', async () => {
    writeFileSync(join(repo, 'a.txt'), 'l1\nSTAGED\nl3\nl4\n');
    await stageFiles(repo, ['a.txt']);
    const s = await getFileSides(repo, 'a.txt', true);
    expect(s.oldText).toBe('l1\nl2\nl3\nl4\n');
    expect(s.newText).toBe('l1\nSTAGED\nl3\nl4\n');
    await git('restore', '--staged', '--worktree', '--', 'a.txt');
  });

  it('modo head compara o último commit com o working tree, ignorando o que está staged', async () => {
    writeFileSync(join(repo, 'a.txt'), 'l1\nSTAGED\nl3\nl4\n');
    await stageFiles(repo, ['a.txt']);
    writeFileSync(join(repo, 'a.txt'), 'l1\nSTAGED\nl3\nl4\nWORK\n');
    const head = await getFileSides(repo, 'a.txt', 'head');
    expect(head.oldText).toBe('l1\nl2\nl3\nl4\n');
    expect(head.newText).toBe('l1\nSTAGED\nl3\nl4\nWORK\n');
    const idx = await getFileSides(repo, 'a.txt', 'index');
    expect(idx.oldText).toBe('l1\nSTAGED\nl3\nl4\n');
    writeFileSync(join(repo, 'novo-head.txt'), 'n\n');
    expect(await getFileSides(repo, 'novo-head.txt', 'head')).toMatchObject({ isNew: true, oldText: '', newText: 'n\n' });
    rmSync(join(repo, 'novo-head.txt'));
    await git('restore', '--staged', '--worktree', '--', 'a.txt');
  });

  it('detecta binário e recusa caminho fora do repositório', async () => {
    writeFileSync(join(repo, 'bin.dat'), Buffer.from([1, 0, 2, 0]));
    expect((await getFileSides(repo, 'bin.dat', false)).binary).toBe(true);
    rmSync(join(repo, 'bin.dat'));
    await expect(writeWorkingFile(repo, '../fora.txt', 'x')).rejects.toThrow();
  });
});

describe('descarte por arquivo', () => {
  it('worktree: volta ao índice, mantendo o que está staged', async () => {
    writeFileSync(join(repo, 'a.txt'), 'l1\nSTAGED\nl3\nl4\n');
    await stageFiles(repo, ['a.txt']);
    writeFileSync(join(repo, 'a.txt'), 'l1\nSTAGED\nl3\nl4\nPERDER\n');
    const r = await discardFile(repo, 'a.txt', 'worktree', backups);
    expect(read('a.txt')).toBe('l1\nSTAGED\nl3\nl4\n');
    expect((await getGitStatus(repo)).staged).toEqual(['a.txt']);
    // desfazer: devolve o conteúdo descartado
    expect(r.backup).not.toBeNull();
    await restoreBackup(repo, 'a.txt', r.backup!);
    expect(read('a.txt')).toContain('PERDER');
    await discardFile(repo, 'a.txt', 'all', backups);
    expect(read('a.txt')).toBe('l1\nl2\nl3\nl4\n');
    const st = await getGitStatus(repo);
    expect(st.staged).toEqual([]);
    expect(st.unstaged).toEqual([]);
  });

  it('não rastreado: remove do disco (com backup)', async () => {
    writeFileSync(join(repo, 'lixo.txt'), 'x\n');
    mkdirSync(join(repo, 'pasta'));
    writeFileSync(join(repo, 'pasta', 'y.txt'), 'y\n');
    const r1 = await discardFile(repo, 'lixo.txt', 'worktree', backups);
    const r2 = await discardFile(repo, 'pasta/', 'worktree', backups);
    expect(existsSync(join(repo, 'lixo.txt'))).toBe(false);
    expect(existsSync(join(repo, 'pasta'))).toBe(false);
    expect(readFileSync(r1.backup!, 'utf8')).toBe('x\n');
    expect(existsSync(r2.backup!)).toBe(true);
  });

  it('arquivo novo staged: "all" remove do índice e do disco', async () => {
    writeFileSync(join(repo, 'novo-staged.txt'), 'n\n');
    await stageFiles(repo, ['novo-staged.txt']);
    await discardFile(repo, 'novo-staged.txt', 'all', backups);
    expect(existsSync(join(repo, 'novo-staged.txt'))).toBe(false);
    expect((await getGitStatus(repo)).staged).toEqual([]);
  });

  it('arquivo removido no disco: restaura', async () => {
    rmSync(join(repo, 'b.txt'));
    const r = await discardFile(repo, 'b.txt', 'worktree', backups);
    expect(r.backup).toBeNull();
    expect(read('b.txt')).toBe('b\n');
  });

  it('recusa caminho fora do repositório', async () => {
    await expect(discardFile(repo, '../x.txt', 'worktree', backups)).rejects.toThrow();
  });
});

describe('.gitignore', () => {
  it('acrescenta uma vez só, respeitando a última linha', async () => {
    writeFileSync(join(repo, '.gitignore'), 'node_modules');
    await addToGitignore(repo, '*.log');
    await addToGitignore(repo, '*.log');
    expect(read('.gitignore')).toBe('node_modules\n*.log\n');
  });
});
