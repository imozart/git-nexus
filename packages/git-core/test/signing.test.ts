import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CommitFailedError,
  amendCommit,
  askpassEnv,
  classifyCommitFailure,
  commit,
  getSigningInfo,
  setActiveAskpass,
  startAskpassBridge,
  type AskpassBridge,
} from '../src/index.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

let root: string;
let n = 0;
let hasKeygen = true;
const GIT_ENV = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim();
const keys: Record<string, string> = {};
let bridge: AskpassBridge | null = null;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-sign-'));
  Object.assign(process.env, GIT_ENV);
  try {
    // uma chave SSH sem senha e outra com frase-senha: assinar por SSH não precisa de gpg nem de servidor
    for (const [name, pass] of [['plain', ''], ['pass', 'frase-secreta']] as const) {
      const f = join(root, `key-${name}`);
      execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', pass, '-C', 'teste', '-f', f]);
      keys[name] = f;
    }
  } catch {
    hasKeygen = false; // sem ssh-keygen neste computador: os testes de assinatura real não se aplicam
  }
});
afterEach(async () => {
  setActiveAskpass(null);
  await bridge?.close();
  bridge = null;
});
afterAll(() => {
  for (const k of Object.keys(GIT_ENV)) delete process.env[k];
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function repo(opts: { key?: string; gpgsign?: boolean } = {}): string {
  const dir = join(root, `r${++n}`);
  sh(root, 'init', '-q', '-b', 'main', dir);
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['core.autocrlf', 'false'], ['commit.gpgsign', String(!!opts.gpgsign)]]) sh(dir, 'config', k!, v!);
  if (opts.key) {
    sh(dir, 'config', 'gpg.format', 'ssh');
    sh(dir, 'config', 'user.signingkey', opts.key + '.pub');
  }
  writeFileSync(join(dir, 'a.txt'), String(Math.random()));
  sh(dir, 'add', '-A');
  return dir;
}
const signed = (dir: string) => sh(dir, 'cat-file', 'commit', 'HEAD').includes('gpgsig');

describe('getSigningInfo', () => {
  it('sem nada configurado: desligado, formato openpgp, sem chave', async () => {
    const dir = repo();
    expect(await getSigningInfo(dir)).toMatchObject({ enabled: false, format: 'openpgp' });
  });

  it('lê commit.gpgsign, gpg.format e user.signingkey', async () => {
    const dir = repo({ gpgsign: true });
    sh(dir, 'config', 'gpg.format', 'ssh');
    sh(dir, 'config', 'user.signingkey', '/x/y.pub');
    expect(await getSigningInfo(dir)).toEqual({ enabled: true, format: 'ssh', key: '/x/y.pub' });
  });

  it('formato desconhecido volta para openpgp; gpgsign aceita "yes"/"on"', async () => {
    const dir = repo();
    sh(dir, 'config', 'gpg.format', 'estranho');
    sh(dir, 'config', 'commit.gpgsign', 'yes');
    expect(await getSigningInfo(dir)).toMatchObject({ enabled: true, format: 'openpgp' });
  });
});

describe('classificação da falha de assinatura', () => {
  it('reconhece as mensagens do gpg e do ssh', () => {
    for (const out of [
      'error: gpg failed to sign the data\nfatal: failed to write commit object',
      "gpg: skipped \"ABCD\": No secret key\n[GNUPG:] INV_SGNR 9 ABCD",
      "Couldn't load public key /x/y.pub: No such file or directory",
      'Load key "/x/y": error in libcrypto',
      'Enter passphrase: incorrect passphrase supplied to decrypt private key',
      'fatal: user.signingkey needs to be set for ssh signing',
      'error: Signing file failed\nssh-keygen: failed',
    ]) expect(classifyCommitFailure(out), out).toBe('signing');
  });

  it('não confunde com hook nem com outras causas', () => {
    expect(classifyCommitFailure('pre-commit hook: lint falhou')).toBe('other');
    expect(classifyCommitFailure('nothing to commit, working tree clean')).toBe('nothing');
  });
});

describe('commit assinado (SSH de verdade)', () => {
  it('commit sem opção segue a configuração: gpgsign desligado → não assina', async () => {
    if (!hasKeygen) return;
    const dir = repo({ key: keys.plain! });
    await commit(dir, 'feat: sem assinatura');
    expect(signed(dir)).toBe(false);
  });

  it('sign=true assina (-S) mesmo com commit.gpgsign desligado, e a assinatura confere', async () => {
    if (!hasKeygen) return;
    const dir = repo({ key: keys.plain! });
    await commit(dir, 'feat: assinado', { sign: true });
    expect(signed(dir)).toBe(true);
    expect(sh(dir, 'cat-file', 'commit', 'HEAD')).toContain('BEGIN SSH SIGNATURE');
  });

  it('commit.gpgsign ligado assina sozinho; sign=false desliga (--no-gpg-sign)', async () => {
    if (!hasKeygen) return;
    const dir = repo({ key: keys.plain!, gpgsign: true });
    await commit(dir, 'feat: automático');
    expect(signed(dir)).toBe(true);
    writeFileSync(join(dir, 'b.txt'), 'b');
    sh(dir, 'add', '-A');
    await commit(dir, 'feat: sem assinar de propósito', { sign: false });
    expect(signed(dir)).toBe(false);
  });

  it('emendar também assina (e sign=false tira a assinatura)', async () => {
    if (!hasKeygen) return;
    const dir = repo({ key: keys.plain! });
    await commit(dir, 'feat: base');
    await amendCommit(dir, 'feat: base emendado', { sign: true });
    expect(signed(dir)).toBe(true);
    await amendCommit(dir, 'feat: base sem assinatura', { sign: false });
    expect(signed(dir)).toBe(false);
  });

  it('chave que não existe: falha com a explicação de assinatura (não "commit rejeitado")', async () => {
    if (!hasKeygen) return;
    const dir = repo({ key: join(root, 'nao-existe') });
    const err = await commit(dir, 'feat: x', { sign: true }).catch((e) => e);
    expect(err).toBeInstanceOf(CommitFailedError);
    expect((err as CommitFailedError).kind).toBe('signing');
    expect((err as CommitFailedError).message).toMatch(/assinar o commit|sign the commit/i);
    // e nenhum commit foi criado
    expect(execFileSync('git', ['rev-list', '--count', '--all'], { cwd: dir, encoding: 'utf8' }).trim()).toBe('0');
  });
});

describe('frase-senha da chave SSH pela ponte de credenciais', () => {
  it('a ponte pergunta a frase-senha, o app responde e o commit é assinado', async () => {
    if (!hasKeygen) return;
    const dir = repo({ key: keys.pass! });
    const seen: string[] = [];
    const b = await startAskpassBridge({
      dir: join(root, 'ask'),
      onRequest: (r) => {
        seen.push(r.kind);
        setTimeout(() => b.answer(r.id, 'frase-secreta'), 30);
      },
    });
    bridge = b;
    setActiveAskpass(b);
    expect(askpassEnv().GIT_ASKPASS).toBe(b.env.GIT_ASKPASS);
    const r = await commit(dir, 'feat: assinado com frase-senha', { sign: true }).catch((e) => e);
    expect(seen).toContain('passphrase');
    expect(r).not.toBeInstanceOf(Error);
    expect(signed(dir)).toBe(true);
  });

  it('frase-senha errada: falha como assinatura, sem commit', async () => {
    if (!hasKeygen) return;
    const dir = repo({ key: keys.pass! });
    const seen: string[] = [];
    const b = await startAskpassBridge({
      dir: join(root, 'ask2'),
      onRequest: (r) => {
        seen.push(r.kind);
        setTimeout(() => b.answer(r.id, 'errada'), 30);
      },
    });
    bridge = b;
    setActiveAskpass(b);
    const err = await commit(dir, 'feat: x', { sign: true }).catch((e) => e);
    expect(err).toBeInstanceOf(CommitFailedError);
    expect((err as CommitFailedError).kind).toBe('signing');
  });

  it('sem a ponte, askpassEnv é vazio (o comando roda como sempre)', () => {
    expect(askpassEnv()).toEqual({});
  });
});
