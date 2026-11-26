// Origem dos comandos do Log do Git (#289): quem pediu (a pessoa ou o app por conta própria) chega a cada comando, mesmo depois de await e com chamadas em
// paralelo; sem informação vale "segundo plano"; e o log nunca leva segredos (token na URL, senha na saída).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GitCommandEvent } from '../src/index.js';
import { onGitCommand, runGit, withGitOrigin } from '../src/index.js';

vi.setConfig({ testTimeout: 60_000 });

let dir: string;
const events: GitCommandEvent[] = [];
let off: () => void;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitnexus-origin-'));
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  off = onGitCommand((e) => events.push(e));
});
afterAll(() => {
  off();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
const take = () => events.splice(0, events.length);

describe('origem do comando', () => {
  it('sem informação, o comando é de segundo plano; dentro de withGitOrigin, é o que foi dito', async () => {
    await runGit(dir, ['status', '--porcelain']);
    await withGitOrigin('user', () => runGit(dir, ['rev-parse', '--git-dir']));
    expect(take().map((e) => e.origin)).toEqual(['background', 'user']);
  });

  it('vale para tudo o que a chamada inicia, inclusive depois de await e dentro de funções aninhadas', async () => {
    await withGitOrigin('user', async () => {
      await runGit(dir, ['status', '--porcelain']);
      await new Promise((r) => setTimeout(r, 20));
      await Promise.all([runGit(dir, ['rev-parse', '--git-dir']), runGit(dir, ['rev-parse', '--show-toplevel'])]);
    });
    expect(take().map((e) => e.origin)).toEqual(['user', 'user', 'user']);
  });

  it('um contexto interno de segundo plano vence o de fora (o índice de busca, posto para andar por uma busca da pessoa)', async () => {
    await withGitOrigin('user', async () => {
      await withGitOrigin('background', () => runGit(dir, ['rev-parse', '--git-dir']));
      await runGit(dir, ['status', '--porcelain']);
    });
    expect(take().map((e) => e.origin)).toEqual(['background', 'user']);
  });

  it('chamadas em paralelo não misturam as origens', async () => {
    await Promise.all([
      withGitOrigin('user', async () => {
        await new Promise((r) => setTimeout(r, 30));
        await runGit(dir, ['rev-parse', '--git-dir']);
      }),
      withGitOrigin('background', () => runGit(dir, ['status', '--porcelain'])),
    ]);
    const got = take();
    expect(got.find((e) => e.command.includes('rev-parse'))!.origin).toBe('user');
    expect(got.find((e) => e.command.includes('status'))!.origin).toBe('background');
  });
});

describe('o log não leva segredos', () => {
  it('token e senha na URL (no comando e na saída de erro) nunca chegam ao evento', async () => {
    const url = 'https://usuario:SEGREDO-TOKEN-123@127.0.0.1:1/x.git';
    await withGitOrigin('user', () => runGit(dir, ['ls-remote', url], { check: false }));
    await withGitOrigin('user', () => runGit(dir, ['fetch', url], { check: false }));
    const got = take();
    expect(got.length).toBe(2);
    expect(got.every((e) => e.code !== 0)).toBe(true);
    expect(JSON.stringify(got)).not.toContain('SEGREDO-TOKEN-123');
    // o comando continua legível (só o segredo some)
    expect(got[0]!.command).toContain('ls-remote');
  });

  it('um cabeçalho de autorização e uma variável de ambiente com token também são cobertos pela mesma regra', async () => {
    await withGitOrigin('user', () =>
      runGit(dir, ['-c', 'http.extraHeader=Authorization: Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'ls-remote', 'https://127.0.0.1:1/y.git'], { check: false }),
    );
    expect(JSON.stringify(take())).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  });
});
