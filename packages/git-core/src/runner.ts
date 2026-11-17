import { spawn } from 'node:child_process';
import { formatGitCommand, isReadOnlyGit, trimOutput } from './git-command.js';
import type { GitCommandEvent } from './types/ipc.js';
import { parseWslPath } from './wsl.js';

const listeners = new Set<(e: GitCommandEvent) => void>();
let nextEventId = 1;

/** Observa todo comando git executado por `runGit` (a aba "Log" do app). Devolve a função que cancela. */
export function onGitCommand(cb: (e: GitCommandEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(repoPath: string, args: string[], startedAt: number, code: number, stdout: string, stderr: string): void {
  if (!listeners.size) return;
  const readOnly = isReadOnlyGit(args);
  const output = trimOutput([stderr, stdout].filter((s) => s.trim()).join('\n'));
  const e: GitCommandEvent = {
    id: nextEventId++,
    repoPath,
    command: formatGitCommand(args),
    readOnly,
    startedAt,
    durationMs: Date.now() - startedAt,
    code,
    ...(output && (!readOnly || code !== 0) ? { output } : {}),
  };
  for (const l of listeners) {
    try {
      l(e);
    } catch {
      /* um observador com defeito não pode quebrar o git */
    }
  }
}

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface GitRunOptions {
  stdin?: string;
  /** Variáveis extras de ambiente. */
  env?: NodeJS.ProcessEnv;
  /** Lança erro se o exit code != 0 (padrão: true). */
  check?: boolean;
  /** Recebe o stderr à medida que chega (para ler o progresso do git). Não substitui `GitResult.stderr`. */
  onStderr?: (chunk: string) => void;
}

export class GitError extends Error {
  constructor(
    message: string,
    readonly result: GitResult,
    readonly args: string[],
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/**
 * Executa `git` no repositório. Para caminhos `\\wsl$\...` roda o git DENTRO da
 * distro via `wsl.exe`, evitando o protocolo 9P (lento e causa de `index.lock` preso).
 */
export function runGit(repoPath: string, args: string[], opts: GitRunOptions = {}): Promise<GitResult> {
  const wsl = process.platform === 'win32' ? parseWslPath(repoPath) : null;
  const [cmd, cmdArgs, cwd] = wsl
    ? ['wsl.exe', ['-d', wsl.distro, '--cd', wsl.linuxPath, '--exec', 'git', ...args], undefined]
    : ['git', args, repoPath];

  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => {
      err.push(d);
      if (opts.onStderr) {
        try {
          opts.onStderr(d.toString('utf8'));
        } catch {
          /* quem observa não pode derrubar o git */
        }
      }
    });
    child.on('error', (err) => {
      emit(repoPath, args, startedAt, -1, '', err.message);
      reject(err);
    });
    child.on('close', (code) => {
      const result: GitResult = {
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        code: code ?? -1,
      };
      emit(repoPath, args, startedAt, result.code, result.stdout, result.stderr);
      if ((opts.check ?? true) && result.code !== 0) {
        reject(new GitError(`git ${args.join(' ')} falhou (${result.code}): ${result.stderr.trim()}`, result, args));
      } else {
        resolve(result);
      }
    });
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}
