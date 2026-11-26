import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { onGitCommand, runGit } from '@git-nexus/git-core';
import type { GitCommandEvent } from '@git-nexus/git-core/pure';
import { WORKER_METHODS } from '../src/shared/channels';
import { BACKGROUND_METHODS, originOf } from '../src/worker/origin';
import { createHandlers } from '../src/worker/handlers';

// Quem pediu cada comando (#289): a origem decidida por método chega, pelo worker de verdade, a cada comando git que ele dispara.
describe('origem por método', () => {
  it('a busca e a atualização automáticas (silent) são de segundo plano; o mesmo método chamado pelo botão é da pessoa', () => {
    expect(originOf('fetchRepo', ['/r', true])).toBe('background');
    expect(originOf('fetchRepo', ['/r', false])).toBe('user');
    expect(originOf('fetchRepo', ['/r'])).toBe('user');
    expect(originOf('pullRepo', ['/r', true])).toBe('background');
    expect(originOf('pullRepo', ['/r'])).toBe('user');
  });

  it('o status que mantém a tela em dia e as buscas são de segundo plano; commit, stage, checkout e o que se clica são da pessoa', () => {
    for (const m of ['getGitStatus', 'getRepoSummary', 'listBranches', 'getToolsUsage', 'startSearch', 'startHistorySearch', 'getSearchIndex']) expect(originOf(m, [])).toBe('background');
    for (const m of ['stageFiles', 'executeCommit', 'checkoutBranch', 'pushRepo', 'getFileDiff', 'getBlame', 'getCommitDetail', 'createStash', 'cherryPickCommit']) expect(originOf(m, [])).toBe('user');
  });

  it('todo método da lista de segundo plano existe de verdade (um nome errado deixaria o comando como "da pessoa" sem ninguém notar)', () => {
    const all = new Set<string>(WORKER_METHODS);
    expect([...BACKGROUND_METHODS].filter((m) => !all.has(m))).toEqual([]);
  });
});

describe('a origem chega ao comando git (worker real)', () => {
  let root: string;
  let repo: string;
  let handlers: ReturnType<typeof createHandlers>;
  const events: GitCommandEvent[] = [];
  let off: () => void;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'gitnexus-wo-'));
    repo = join(root, 'r');
    await runGit(root, ['init', '-q', '-b', 'main', repo]);
    for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.fsmonitor', 'false']]) await runGit(repo, ['config', k!, v!]);
    writeFileSync(join(repo, 'a.txt'), 'um\n');
    handlers = createHandlers(join(root, 'data'));
    off = onGitCommand((e) => events.push(e));
  }, 60_000);
  afterAll(() => {
    off();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const run = async (fn: () => Promise<unknown>): Promise<GitCommandEvent[]> => {
    events.length = 0;
    await fn();
    return [...events];
  };

  it('status (segundo plano) e stage (pessoa)', async () => {
    const st = await run(() => handlers.getGitStatus(repo));
    expect(st.length).toBeGreaterThan(0);
    expect(st.every((e) => e.origin === 'background')).toBe(true);
    const add = await run(() => handlers.stageFiles(repo, ['a.txt']));
    expect(add.some((e) => / add /.test(e.command))).toBe(true);
    expect(add.every((e) => e.origin === 'user')).toBe(true);
  });

  it('o resumo da tela inicial é de segundo plano e as chamadas em paralelo não misturam as origens', async () => {
    const got = await run(() => Promise.all([handlers.getRepoSummary(repo), handlers.stageFiles(repo, ['a.txt']), handlers.getGitStatus(repo)]));
    expect(got.length).toBeGreaterThan(2);
    expect(got.filter((e) => / add /.test(e.command)).every((e) => e.origin === 'user')).toBe(true);
    expect(got.filter((e) => /status|log -1/.test(e.command)).every((e) => e.origin === 'background')).toBe(true);
  });
});
