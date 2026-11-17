import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommitRejectedError, amendCommit, commit, getAmendInfo, runGit } from '../src/index.js';

let root: string;
let n = 0;
const g = (cwd: string, ...a: string[]) => runGit(cwd, a);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-amend-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function repo(): Promise<string> {
  const dir = join(root, `r${++n}`);
  await runGit(root, ['init', '-b', 'main', dir]);
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']] as const) await g(dir, 'config', k, v);
  return dir;
}
const put = (dir: string, f: string, c: string) => writeFileSync(join(dir, f), c);

describe('getAmendInfo', () => {
  it('sem commit nenhum: não há o que emendar', async () => {
    const dir = await repo();
    expect(await getAmendInfo(dir)).toEqual({ hasHead: false, message: '', pushed: false, isMerge: false });
  });

  it('devolve a mensagem completa do último commit; sem upstream, não foi enviado', async () => {
    const dir = await repo();
    put(dir, 'a.txt', 'a\n');
    await g(dir, 'add', '.');
    await commit(dir, 'feat(api): título\n\ncorpo do commit\n\nRefs: ABC-1\n');
    expect(await getAmendInfo(dir)).toEqual({ hasHead: true, message: 'feat(api): título\n\ncorpo do commit\n\nRefs: ABC-1', pushed: false, isMerge: false });
  });

  it('com upstream: só vira "enviado" quando o commit está no remoto', async () => {
    const bare = join(root, `bare${++n}.git`);
    await runGit(root, ['init', '--bare', '-b', 'main', bare]);
    const dir = await repo();
    await g(dir, 'remote', 'add', 'origin', bare);
    put(dir, 'a.txt', 'a\n');
    await g(dir, 'add', '.');
    await commit(dir, 'feat: um');
    await g(dir, 'push', '-q', '-u', 'origin', 'main');
    expect((await getAmendInfo(dir)).pushed).toBe(true);
    put(dir, 'b.txt', 'b\n');
    await g(dir, 'add', '.');
    await commit(dir, 'feat: dois');
    expect((await getAmendInfo(dir)).pushed).toBe(false); // o novo commit ainda não foi enviado
  });

  it('commit de merge é sinalizado', async () => {
    const dir = await repo();
    put(dir, 'a.txt', 'a\n');
    await g(dir, 'add', '.');
    await commit(dir, 'feat: base');
    await g(dir, 'checkout', '-q', '-b', 'outro');
    put(dir, 'b.txt', 'b\n');
    await g(dir, 'add', '.');
    await commit(dir, 'feat: b');
    await g(dir, 'checkout', '-q', 'main');
    put(dir, 'c.txt', 'c\n');
    await g(dir, 'add', '.');
    await commit(dir, 'feat: c');
    await g(dir, 'merge', '--no-ff', '-m', 'merge outro', 'outro');
    expect((await getAmendInfo(dir)).isMerge).toBe(true);
  });
});

describe('amendCommit', () => {
  it('inclui o que está no stage no ÚLTIMO commit (sem criar outro) e troca a mensagem', async () => {
    const dir = await repo();
    put(dir, 'a.txt', 'a\n');
    await g(dir, 'add', '.');
    await commit(dir, 'feat: primeiro');
    put(dir, 'b.txt', 'esquecido\n');
    await g(dir, 'add', '.');
    const r = await amendCommit(dir, 'feat: primeiro e o esquecido\n');
    expect(r.commitHash).toMatch(/^[0-9a-f]{40}$/);
    expect((await g(dir, 'rev-list', '--count', 'HEAD')).stdout.trim()).toBe('1'); // continua 1 commit
    expect((await g(dir, 'log', '-1', '--format=%s')).stdout.trim()).toBe('feat: primeiro e o esquecido');
    expect((await g(dir, 'show', '--stat', '--format=', 'HEAD')).stdout).toContain('b.txt');
  });

  it('sem nada no stage, só troca a mensagem', async () => {
    const dir = await repo();
    put(dir, 'a.txt', 'a\n');
    await g(dir, 'add', '.');
    await commit(dir, 'feat: erro de digitaçao');
    const before = (await g(dir, 'rev-parse', 'HEAD^{tree}')).stdout;
    await amendCommit(dir, 'feat: erro de digitação\n');
    expect((await g(dir, 'log', '-1', '--format=%s')).stdout.trim()).toBe('feat: erro de digitação');
    expect((await g(dir, 'rev-parse', 'HEAD^{tree}')).stdout).toBe(before); // a árvore não mudou
  });

  it('os hooks rodam (nunca --no-verify) e a recusa vem como CommitRejectedError', async () => {
    const dir = await repo();
    put(dir, 'a.txt', 'a\n');
    await g(dir, 'add', '.');
    await commit(dir, 'feat: ok');
    const hook = join(dir, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\necho "LINT-NO-AMEND"\nexit 1\n');
    chmodSync(hook, 0o755);
    put(dir, 'b.txt', 'b\n');
    await g(dir, 'add', '.');
    const err = await amendCommit(dir, 'feat: ok\n').catch((e) => e);
    expect(err).toBeInstanceOf(CommitRejectedError);
    expect((err as CommitRejectedError).hookOutput).toContain('LINT-NO-AMEND');
    expect((await g(dir, 'log', '-1', '--format=%s')).stdout.trim()).toBe('feat: ok'); // nada mudou
  });
});
