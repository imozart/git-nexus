import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CommitRejectedError,
  commit,
  getFileDiff,
  getGitStatus,
  getHistory,
  getMergeConflicts,
  resolveConflictFile,
  runGit,
  scanDirectories,
  stageFiles,
  unstageFiles,
} from '../src/index.js';

let root: string;
let repo: string;
const git = (...a: string[]) => runGit(repo, a);

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-'));
  repo = join(root, 'projetos', 'app');
  mkdirSync(repo, { recursive: true });
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Teste');
  await git('config', 'user.email', 'teste@example.com');
  await git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'a.txt'), 'linha1\nlinha2\nlinha3\n');
  await git('add', '.');
  await git('commit', '-m', 'init');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('git-core (repositório real)', () => {
  it('varre pastas raiz e encontra o repositório', async () => {
    const found = await scanDirectories([root]);
    expect(found.map((r) => r.name)).toEqual(['app']);
    expect(found[0]!.isWsl).toBe(false);
  });

  it('status, stage/unstage e diff', async () => {
    writeFileSync(join(repo, 'a.txt'), 'linha1\nLINHA2\nlinha3\n');
    writeFileSync(join(repo, 'novo.txt'), 'oi\n');
    let s = await getGitStatus(repo);
    expect(s.branch).toBe('main');
    expect(s.unstaged.sort()).toEqual(['a.txt', 'novo.txt']);

    expect(await getFileDiff(repo, 'a.txt', false)).toContain('+LINHA2');
    expect(await getFileDiff(repo, 'novo.txt', false)).toContain('+oi');

    await stageFiles(repo, ['a.txt']);
    s = await getGitStatus(repo);
    expect(s.staged).toEqual(['a.txt']);
    await unstageFiles(repo, ['a.txt']);
    expect((await getGitStatus(repo)).staged).toEqual([]);
    await git('checkout', '--', 'a.txt');
    await git('clean', '-fdq');
  });

  it('commit devolve hash e histórico; hook que rejeita expõe a saída', async () => {
    writeFileSync(join(repo, 'b.txt'), 'b\n');
    await stageFiles(repo, ['b.txt']);
    const ok = await commit(repo, 'feat: adiciona b\n');
    expect(ok.commitHash).toMatch(/^[0-9a-f]{40}$/);
    const hist = await getHistory(repo);
    expect(hist[0]!.subject).toBe('feat: adiciona b');

    const hook = join(repo, '.git', 'hooks', 'commit-msg');
    writeFileSync(hook, '#!/bin/sh\necho "HOOK-BLOQUEOU: mensagem fora do padrao" >&2\nexit 1\n', { mode: 0o755 });
    writeFileSync(join(repo, 'c.txt'), 'c\n');
    await stageFiles(repo, ['c.txt']);
    const err = await commit(repo, 'qualquer coisa\n').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CommitRejectedError);
    expect((err as CommitRejectedError).hookOutput).toContain('HOOK-BLOQUEOU');
    rmSync(hook);
    await commit(repo, 'chore: c\n');
  });

  it('fluxo de conflito 3-way com trava de marcadores', async () => {
    await git('checkout', '-b', 'feature');
    writeFileSync(join(repo, 'a.txt'), 'linha1\nTHEIRS\nlinha3\n');
    await git('commit', '-am', 'theirs');
    await git('checkout', 'main');
    writeFileSync(join(repo, 'a.txt'), 'linha1\nOURS\nlinha3\n');
    await git('commit', '-am', 'ours');
    const merge = await runGit(repo, ['merge', 'feature'], { check: false });
    expect(merge.code).not.toBe(0);

    const conflicts = await getMergeConflicts(repo);
    expect(conflicts).toHaveLength(1);
    const c = conflicts[0]!;
    expect(c.filePath).toBe('a.txt');
    expect(c.base).toBe('linha1\nlinha2\nlinha3\n');
    expect(c.ours).toContain('OURS');
    expect(c.theirs).toContain('THEIRS');
    expect(c.hasUnresolvedMarkers).toBe(true);
    expect(c.workingContent).toContain('<<<<<<<');

    // trava: não grava com marcadores
    expect(await resolveConflictFile(repo, 'a.txt', c.workingContent!)).toBe(false);
    // caminho fora do repositório é recusado
    await expect(resolveConflictFile(repo, '../fora.txt', 'x')).rejects.toThrow();

    expect(await resolveConflictFile(repo, 'a.txt', 'linha1\nOURS+THEIRS\nlinha3\n')).toBe(true);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toContain('OURS+THEIRS');
    expect(await getMergeConflicts(repo)).toHaveLength(0);
  });
});
