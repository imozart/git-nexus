import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formatGitCommand, isReadOnlyGit, onGitCommand, redactSecrets, runGit, trimOutput, type GitCommandEvent } from '../src/index.js';

describe('formatGitCommand', () => {
  it('mostra o comando como o usuário digitaria, com aspas só quando precisa', () => {
    expect(formatGitCommand(['status', '--porcelain=v2', '-z'])).toBe('git status --porcelain=v2 -z');
    expect(formatGitCommand(['commit', '-m', 'feat: algo novo'])).toBe('git commit -m "feat: algo novo"');
    expect(formatGitCommand(['log', '--format=%H%x00%s', '--', 'a b.txt'])).toBe('git log --format=%H%x00%s -- "a b.txt"');
  });

  it('esconde credenciais na URL e em cabeçalhos', () => {
    expect(formatGitCommand(['clone', 'https://iago:ghp_SEGREDO123@github.com/x/y.git'])).toBe('git clone https://***@github.com/x/y.git');
    expect(formatGitCommand(['clone', 'https://ghp_SEGREDO123@github.com/x/y.git'])).not.toContain('SEGREDO');
    const h = formatGitCommand(['-c', 'http.extraHeader=Authorization: Bearer abc.def', 'fetch']);
    expect(h).not.toContain('abc.def');
    expect(h).toContain('Authorization: ***');
    expect(h.endsWith('fetch')).toBe(true);
    expect(formatGitCommand(['remote', 'add', 'o', 'https://u:p@h/r.git'])).not.toContain('u:p');
  });

  it('não mexe em URL sem credencial nem em e-mails de autor', () => {
    expect(redactSecrets('https://github.com/imozart/git-nexus.git')).toBe('https://github.com/imozart/git-nexus.git');
    expect(redactSecrets('--author=Fulano <fulano@exemplo.com>')).toBe('--author=Fulano <fulano@exemplo.com>');
  });
});

describe('isReadOnlyGit', () => {
  it('consultas', () => {
    for (const a of [
      ['status', '--porcelain'],
      ['log', '-n', '5'],
      ['diff', '--cached'],
      ['rev-parse', 'HEAD'],
      ['for-each-ref'],
      ['branch'],
      ['branch', '--list', 'feat/*'],
      ['branch', '--show-current'],
      ['tag', '-l'],
      ['stash', 'list'],
      ['remote', '-v'],
      ['remote', 'get-url', 'origin'],
      ['config', '--get', 'user.name'],
      ['reflog', '-n', '20'],
      ['-c', 'core.quotepath=off', '-C', 'x', 'status'],
      ['--no-pager', 'show', 'HEAD'],
    ]) {
      expect(isReadOnlyGit(a), a.join(' ')).toBe(true);
    }
  });

  it('alterações (na dúvida, conta como alteração)', () => {
    for (const a of [
      ['add', 'a.txt'],
      ['commit', '-m', 'x'],
      ['reset', '--hard'],
      ['checkout', 'main'],
      ['branch', 'nova'],
      ['branch', '-D', 'velha'],
      ['tag', 'v1.0.0'],
      ['stash', 'push'],
      ['stash', 'drop'],
      ['push', 'origin', 'main'],
      ['fetch', '--all'],
      ['reflog', 'expire', '--all'],
      ['config', 'user.name', 'X'],
      ['remote', 'add', 'o', 'u'],
      ['mergetool'],
      [],
    ]) {
      expect(isReadOnlyGit(a), a.join(' ')).toBe(false);
    }
  });
});

describe('trimOutput', () => {
  it('limpa, corta e esconde segredos', () => {
    expect(trimOutput('\r\n  remote: ok \r\n\r\n')).toBe('remote: ok');
    expect(trimOutput('x'.repeat(50), 10)).toBe('x'.repeat(10) + '\n…');
    expect(trimOutput('fatal: https://u:senha@h/r.git')).toBe('fatal: https://***@h/r.git');
  });
});

describe('runGit emite eventos', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const repo = () => {
    const d = mkdtempSync(join(tmpdir(), 'gitnexus-log-'));
    dirs.push(d);
    return d;
  };

  it('um evento por comando, com tipo, código, duração e saída só quando importa', async () => {
    const dir = repo();
    const seen: GitCommandEvent[] = [];
    const off = onGitCommand((e) => seen.push(e));
    try {
      await runGit(dir, ['init', '-b', 'main']);
      await runGit(dir, ['status', '--porcelain']);
      await runGit(dir, ['rev-parse', '--verify', 'HEAD'], { check: false }); // falha: repositório sem commits
      await expect(runGit(dir, ['checkout', 'nao-existe'])).rejects.toThrow();
    } finally {
      off();
    }
    expect(seen.map((e) => e.command)).toEqual(['git init -b main', 'git status --porcelain', 'git rev-parse --verify HEAD', 'git checkout nao-existe']);
    expect(seen.map((e) => e.readOnly)).toEqual([false, true, true, false]);
    expect(seen.map((e) => e.code === 0)).toEqual([true, true, false, false]);
    expect(seen.every((e) => e.repoPath === dir && e.durationMs >= 0 && e.startedAt > 0)).toBe(true);
    expect(new Set(seen.map((e) => e.id)).size).toBe(4); // ids únicos
    expect(seen[0]!.output).toMatch(/Initialized|Reinitialized|hint/i); // alteração: guarda a saída
    expect(seen[1]!.output).toBeUndefined(); // consulta bem-sucedida: sem saída
    expect(seen[2]!.output).toBeDefined(); // consulta que falhou: mostra o motivo
    expect(seen[3]!.output).toMatch(/pathspec|did not match/i);
  });

  it('observador com defeito não quebra o git, e cancelar a assinatura para os eventos', async () => {
    const dir = repo();
    const off = onGitCommand(() => {
      throw new Error('boom');
    });
    await expect(runGit(dir, ['init'])).resolves.toMatchObject({ code: 0 });
    off();
    const seen: GitCommandEvent[] = [];
    const off2 = onGitCommand((e) => seen.push(e));
    off2();
    await runGit(dir, ['status']);
    expect(seen).toEqual([]);
  });
});
