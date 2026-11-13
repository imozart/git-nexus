import { GitError, runGit } from './runner.js';

export interface CommitOutput {
  commitHash: string;
  /** stdout/stderr (inclui saída dos hooks) para exibir na UI. */
  output: string;
}

export class CommitRejectedError extends Error {
  constructor(
    readonly hookOutput: string,
    readonly exitCode: number,
  ) {
    super('Commit rejeitado (hook ou git).');
    this.name = 'CommitRejectedError';
  }
}

/**
 * Cria o commit a partir de uma mensagem já validada/formatada.
 * NUNCA usa `--no-verify`: os hooks locais executam e sua saída é devolvida.
 */
export async function commit(repoPath: string, message: string): Promise<CommitOutput> {
  try {
    const r = await runGit(repoPath, ['commit', '-F', '-'], { stdin: message });
    const { stdout: hash } = await runGit(repoPath, ['rev-parse', 'HEAD']);
    return { commitHash: hash.trim(), output: r.stdout + r.stderr };
  } catch (e) {
    if (e instanceof GitError) throw new CommitRejectedError(e.result.stdout + e.result.stderr, e.result.code);
    throw e;
  }
}
