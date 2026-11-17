import { GitError, runGit } from './runner.js';
import { tm } from './messages.js';
import type { AmendInfo } from './types/ipc.js';

export interface CommitOutput {
  commitHash: string;
  /** stdout/stderr (inclui saída dos hooks) para exibir na UI. */
  output: string;
}

/** O git recusou o commit por um motivo que não conseguimos explicar (em geral, um hook): a saída completa é o que a pessoa precisa ler. */
export class CommitRejectedError extends Error {
  constructor(
    readonly hookOutput: string,
    readonly exitCode: number,
  ) {
    super('Commit rejeitado (hook ou git).');
    this.name = 'CommitRejectedError';
  }
}

export type CommitFailureKind = 'identity' | 'nothing' | 'unmerged' | 'locked' | 'other';

/** O commit falhou por uma causa CONHECIDA que não é hook: `message` já explica em linguagem simples e `output` guarda a saída do git. */
export class CommitFailedError extends Error {
  constructor(
    readonly kind: Exclude<CommitFailureKind, 'other'>,
    message: string,
    readonly output: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = 'CommitFailedError';
  }
}

/**
 * Descobre a causa pela saída do git (o git não dá um código por motivo). Só reconhece o que é inconfundível; o resto é `other`,
 * que continua sendo mostrado com a saída completa (é onde caem os hooks, cuja mensagem é livre).
 */
export function classifyCommitFailure(output: string): CommitFailureKind {
  if (/author identity unknown|please tell me who you are|unable to auto-detect|auto-detection is disabled|empty ident name/i.test(output)) return 'identity';
  if (/unable to create .*index\.lock|another git process seems to be running/i.test(output)) return 'locked';
  if (/committing is not possible because you have unmerged files/i.test(output)) return 'unmerged';
  if (/nothing (added )?to commit|no changes added to commit/i.test(output)) return 'nothing';
  return 'other';
}

function friendly(kind: Exclude<CommitFailureKind, 'other'>): string {
  switch (kind) {
    case 'identity':
      return tm(
        'O git não sabe quem você é. Configure o nome e o e-mail (git config user.name / user.email) e tente de novo.',
        'Git does not know who you are. Set your name and email (git config user.name / user.email) and try again.',
      );
    case 'nothing':
      return tm('Não há nada para commitar: faça o stage de ao menos uma alteração.', 'There is nothing to commit: stage at least one change.');
    case 'unmerged':
      return tm('Há arquivos em conflito: resolva e marque como resolvido antes de commitar.', 'There are conflicted files: resolve them and mark them as resolved before committing.');
    case 'locked':
      return tm(
        'Outro processo do git está usando o repositório (index.lock). Aguarde ele terminar e tente de novo.',
        'Another git process is using the repository (index.lock). Wait for it to finish and try again.',
      );
  }
}

/**
 * Cria o commit a partir de uma mensagem já validada/formatada.
 * NUNCA usa `--no-verify`: os hooks locais executam e sua saída é devolvida.
 * Causas conhecidas (identidade, nada no stage, conflito, lock) viram `CommitFailedError` com a explicação; o resto
 * (inclusive qualquer hook) vira `CommitRejectedError` com a saída completa.
 */
export async function commit(repoPath: string, message: string): Promise<CommitOutput> {
  return runCommit(repoPath, ['commit', '-F', '-'], message);
}

/**
 * Emenda o último commit com o que está no stage e a mensagem dada (`git commit --amend`). Mesmos hooks, mesmas mensagens de erro.
 * Sem nada no stage, só troca a mensagem.
 */
export async function amendCommit(repoPath: string, message: string): Promise<CommitOutput> {
  return runCommit(repoPath, ['commit', '--amend', '-F', '-'], message);
}

export async function getAmendInfo(repoPath: string): Promise<AmendInfo> {
  const log = await runGit(repoPath, ['log', '-1', '--format=%B%x00%P'], { check: false });
  if (log.code !== 0 || !log.stdout.trim()) return { hasHead: false, message: '', pushed: false, isMerge: false };
  const [message = '', parents = ''] = log.stdout.split('\0');
  const upstream = await runGit(repoPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { check: false });
  const pushed = upstream.code === 0 && (await runGit(repoPath, ['merge-base', '--is-ancestor', 'HEAD', '@{u}'], { check: false })).code === 0;
  return { hasHead: true, message: message.trim(), pushed, isMerge: parents.trim().split(/\s+/).filter(Boolean).length > 1 };
}

async function runCommit(repoPath: string, args: string[], message: string): Promise<CommitOutput> {
  try {
    const r = await runGit(repoPath, args, { stdin: message });
    const { stdout: hash } = await runGit(repoPath, ['rev-parse', 'HEAD']);
    return { commitHash: hash.trim(), output: r.stdout + r.stderr };
  } catch (e) {
    if (e instanceof GitError) {
      const output = e.result.stdout + e.result.stderr;
      const kind = classifyCommitFailure(output);
      if (kind === 'other') throw new CommitRejectedError(output, e.result.code);
      throw new CommitFailedError(kind, friendly(kind), output, e.result.code);
    }
    throw e;
  }
}
