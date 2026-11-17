import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CommitFailedError, CommitRejectedError, classifyCommitFailure, commit, runGit } from '../src/index.js';

describe('classifyCommitFailure (textos do git)', () => {
  it('reconhece as causas conhecidas', () => {
    expect(classifyCommitFailure('Author identity unknown\n\n*** Please tell me who you are.')).toBe('identity');
    expect(classifyCommitFailure('fatal: no email was given and auto-detection is disabled')).toBe('identity');
    expect(classifyCommitFailure("fatal: Unable to create '/r/.git/index.lock': File exists.")).toBe('locked');
    expect(classifyCommitFailure('error: Committing is not possible because you have unmerged files.')).toBe('unmerged');
    expect(classifyCommitFailure('On branch main\nnothing to commit, working tree clean')).toBe('nothing');
    expect(classifyCommitFailure('no changes added to commit (use "git add")')).toBe('nothing');
  });
  it('o que não é inconfundível (hooks, mensagens livres) fica como "other" e mostra a saída completa', () => {
    expect(classifyCommitFailure('eslint: 3 erros')).toBe('other');
    expect(classifyCommitFailure('HOOK-BLOQUEOU')).toBe('other');
    expect(classifyCommitFailure('')).toBe('other');
  });
});

let root: string;
let n = 0;
const envBackup = { ...process.env };
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-commiterr-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => {
  process.env = { ...envBackup };
});

async function repo(identity = true): Promise<string> {
  const dir = join(root, `r${++n}`);
  await runGit(root, ['init', '-b', 'main', dir]);
  if (identity) {
    await runGit(dir, ['config', 'user.name', 'T']);
    await runGit(dir, ['config', 'user.email', 't@e.com']);
  }
  await runGit(dir, ['config', 'commit.gpgsign', 'false']);
  await runGit(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

describe('commit(): cada causa com a sua mensagem', () => {
  it('nada no stage: "nada para commitar" (antes: "rejeitado por hook")', async () => {
    const dir = await repo();
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    await runGit(dir, ['add', '.']);
    await commit(dir, 'feat: primeiro');
    const err = await commit(dir, 'feat: vazio').catch((e) => e);
    expect(err).toBeInstanceOf(CommitFailedError);
    expect((err as CommitFailedError).kind).toBe('nothing');
    expect((err as Error).message).toMatch(/nada para commitar/i);
    expect(err).not.toBeInstanceOf(CommitRejectedError);
  });

  it('sem identidade: explica como configurar', async () => {
    const dir = await repo(false);
    await runGit(dir, ['config', 'user.useConfigOnly', 'true']); // não adivinha nome/e-mail a partir do sistema
    const vazio = join(root, 'vazio.gitconfig'); // (no Windows /dev/null não serve para o git)
    writeFileSync(vazio, '');
    process.env.GIT_CONFIG_GLOBAL = vazio; // ignora o user.name da máquina que roda o teste
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    await runGit(dir, ['add', '.']);
    const err = await commit(dir, 'feat: x').catch((e) => e);
    expect(err).toBeInstanceOf(CommitFailedError);
    expect((err as CommitFailedError).kind).toBe('identity');
    expect((err as Error).message).toMatch(/user\.name/);
  });

  it('arquivos em conflito: pede para resolver antes', async () => {
    const dir = await repo();
    writeFileSync(join(dir, 'a.txt'), 'base\n');
    await runGit(dir, ['add', '.']);
    await commit(dir, 'feat: base');
    await runGit(dir, ['checkout', '-q', '-b', 'outro']);
    writeFileSync(join(dir, 'a.txt'), 'outro\n');
    await runGit(dir, ['commit', '-qam', 'outro']);
    await runGit(dir, ['checkout', '-q', 'main']);
    writeFileSync(join(dir, 'a.txt'), 'principal\n');
    await runGit(dir, ['commit', '-qam', 'principal']);
    await runGit(dir, ['merge', 'outro'], { check: false });
    const err = await commit(dir, 'feat: tentando').catch((e) => e);
    expect(err).toBeInstanceOf(CommitFailedError);
    expect((err as CommitFailedError).kind).toBe('unmerged');
  });

  it('hook que recusa continua sendo CommitRejectedError, com a saída do hook', async () => {
    const dir = await repo();
    const hook = join(dir, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\necho "LINT-FALHOU: 3 erros"\nexit 1\n');
    chmodSync(hook, 0o755);
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    await runGit(dir, ['add', '.']);
    const err = await commit(dir, 'feat: x').catch((e) => e);
    expect(err).toBeInstanceOf(CommitRejectedError);
    expect((err as CommitRejectedError).hookOutput).toContain('LINT-FALHOU');
  });

  it('commit normal continua funcionando', async () => {
    const dir = await repo();
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    await runGit(dir, ['add', '.']);
    const r = await commit(dir, 'feat: ok');
    expect(r.commitHash).toMatch(/^[0-9a-f]{40}$/);
  });
});
