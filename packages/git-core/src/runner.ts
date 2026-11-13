import { spawn } from 'node:child_process';
import { parseWslPath } from './wsl.js';

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

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      const result: GitResult = {
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        code: code ?? -1,
      };
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
