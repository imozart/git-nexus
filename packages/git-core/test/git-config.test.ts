// Configuração do Git editável pelas Configurações: leitura nos dois escopos, gravação, remoção, e a recusa de chave fora da lista e de valor inválido.
// Git de verdade, com o escopo GLOBAL isolado num arquivo temporário (GIT_CONFIG_GLOBAL): o teste nunca toca o ~/.gitconfig de quem o roda.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GIT_CONFIG_KEYS, GitConfigError, getGitConfig, setGitConfig, validateGitConfigValue } from '../src/index.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let root: string;
let repo: string;
const saved: Record<string, string | undefined> = {};
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const entry = async (key: string, repoPath: string | null = repo) => (await getGitConfig(repoPath, [key]))[0]!;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-cfg-'));
  for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
  process.env.GIT_CONFIG_GLOBAL = join(root, 'global.gitconfig'); // o "global" deste teste
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  repo = join(root, 'r');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  sh(repo, 'config', 'core.fsmonitor', 'false');
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
});

describe('git config das Configurações', () => {
  it('lê global, do repositório e efetivo; o do repositório vence', async () => {
    await setGitConfig(null, 'global', 'user.name', 'Pessoa Global');
    expect(await entry('user.name')).toEqual({ key: 'user.name', global: 'Pessoa Global', local: null, value: 'Pessoa Global' });
    await setGitConfig(repo, 'local', 'user.name', 'Pessoa Local');
    expect(await entry('user.name')).toEqual({ key: 'user.name', global: 'Pessoa Global', local: 'Pessoa Local', value: 'Pessoa Local' });
    expect(sh(repo, 'config', '--local', 'user.name')).toBe('Pessoa Local');
    // sem repositório, só o global
    expect(await entry('user.name', null)).toEqual({ key: 'user.name', global: 'Pessoa Global', local: null, value: 'Pessoa Global' });
  });

  it('remover o valor do repositório devolve o global; remover o que não existe não é erro', async () => {
    await setGitConfig(repo, 'local', 'user.name', null);
    expect((await entry('user.name')).value).toBe('Pessoa Global');
    await expect(setGitConfig(repo, 'local', 'user.email', null)).resolves.toBeUndefined();
  });

  it('as opções de lista guardam o valor escolhido (assinatura, pull, quebra de linha, conflitos)', async () => {
    for (const [k, v] of [['gpg.format', 'ssh'], ['commit.gpgsign', 'true'], ['pull.rebase', 'merges'], ['core.autocrlf', 'input'], ['rerere.enabled', 'true'], ['merge.conflictStyle', 'zdiff3']] as const) {
      await setGitConfig(repo, 'local', k, v);
      expect((await entry(k)).local).toBe(v);
    }
  });

  it('recusa chave fora da lista, valor inválido, e escopo do repositório sem repositório', async () => {
    await expect(setGitConfig(repo, 'local', 'core.sshCommand' as never, 'ssh -o x')).rejects.toMatchObject({ code: 'key' });
    await expect(setGitConfig(repo, 'local', 'core.hooksPath' as never, '/x')).rejects.toBeInstanceOf(GitConfigError);
    await expect(setGitConfig(repo, 'local', 'gpg.format', 'pgp')).rejects.toMatchObject({ code: 'value' });
    await expect(setGitConfig(repo, 'local', 'user.email', 'sem-arroba')).rejects.toMatchObject({ code: 'email' });
    await expect(setGitConfig(repo, 'local', 'init.defaultBranch', 'a..b')).rejects.toMatchObject({ code: 'branch' });
    await expect(setGitConfig(repo, 'local', 'user.name', 'duas\nlinhas')).rejects.toMatchObject({ code: 'value' });
    await expect(setGitConfig(repo, 'local', 'user.name', '   ')).rejects.toMatchObject({ code: 'value' });
    await expect(setGitConfig(null, 'local', 'user.name', 'x')).rejects.toMatchObject({ code: 'scope' });
    expect(() => validateGitConfigValue('user.email', 'a@b.co')).not.toThrow();
    expect(() => validateGitConfigValue('init.defaultBranch', 'principal')).not.toThrow();
  });

  it('só devolve as chaves da lista (uma chave estranha pedida é ignorada)', async () => {
    const r = await getGitConfig(repo, ['user.name', 'core.sshCommand']);
    expect(r.map((e) => e.key)).toEqual(['user.name']);
    expect((await getGitConfig(repo)).map((e) => e.key)).toEqual(GIT_CONFIG_KEYS);
  });
});
