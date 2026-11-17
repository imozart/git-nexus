import { explain, hadConflict } from './branches.js';
import { tm } from './messages.js';
import { operationInProgress } from './operations.js';
import { runGit } from './runner.js';
import type { BranchActionResult, InProgressKind } from './types/ipc.js';

// Cherry-pick e revert de UM commit, e o que fazer com uma operação que parou no meio (continuar ou abortar). Como o merge e o rebase em
// branches.ts, quando para por conflito não lança erro: devolve `conflicted` e a tela leva a pessoa aos conflitos.

const HASH = /^[0-9a-f]{7,40}$/i;

/** Sem editor: o git aceita a mensagem que já existe em vez de abrir um editor que ninguém vai ver. */
const NO_EDITOR = { GIT_EDITOR: 'true' };

function assertHash(hash: string): void {
  if (!HASH.test(hash)) throw new Error(tm('Commit inválido.', 'Invalid commit.'));
}

/** Operação parada no meio que esta tela sabe continuar ou abortar (o rebase tem o painel próprio). */
export async function getInProgress(repoPath: string): Promise<InProgressKind | null> {
  const op = await operationInProgress(repoPath);
  return op === 'cherry-pick' || op === 'revert' || op === 'merge' ? op : null;
}

async function isMergeCommit(repoPath: string, hash: string): Promise<boolean> {
  const r = await runGit(repoPath, ['rev-list', '--parents', '-n', '1', hash], { check: false });
  return r.stdout.trim().split(/\s+/).length > 2; // o próprio hash + 2 ou mais pais
}

async function apply(repoPath: string, kind: 'cherry-pick' | 'revert', hash: string): Promise<BranchActionResult> {
  assertHash(hash);
  const busy = await operationInProgress(repoPath);
  if (busy) {
    return {
      ok: false,
      message: tm(`Há uma operação em andamento (${busy}): conclua ou aborte antes.`, `There is an operation in progress (${busy}): finish or abort it first.`),
    };
  }
  const merge = (await isMergeCommit(repoPath, hash)) ? ['-m', '1'] : [];
  const args = kind === 'cherry-pick' ? ['cherry-pick', ...merge, hash] : ['revert', '--no-edit', ...merge, hash];
  const r = await runGit(repoPath, args, { check: false, env: NO_EDITOR });
  const out = r.stderr + r.stdout;
  const short = hash.slice(0, 7);

  if (r.code === 0) {
    return {
      ok: true,
      message:
        kind === 'cherry-pick'
          ? tm(`Commit ${short} aplicado nesta branch (cherry-pick).`, `Commit ${short} applied to this branch (cherry-pick).`)
          : tm(`Commit ${short} revertido: o novo commit desfaz as mudanças dele.`, `Commit ${short} reverted: the new commit undoes its changes.`),
    };
  }
  // sem mudança nenhuma (já está na branch): o git deixa a operação aberta e a saída também fala em "conflict"; testa ANTES do conflito de verdade.
  // Fecha a operação para não deixar a pessoa presa num estado vazio
  if (/nothing to commit|previous (cherry-pick|revert) is now empty|empty commit/i.test(out) && (await operationInProgress(repoPath)) === kind) {
    await runGit(repoPath, [kind, '--abort'], { check: false, env: NO_EDITOR });
    return {
      ok: false,
      message:
        kind === 'cherry-pick'
          ? tm('Nada a aplicar: as mudanças deste commit já estão na branch.', 'Nothing to apply: this commit\'s changes are already in the branch.')
          : tm('Nada a reverter: as mudanças deste commit já não estão na branch.', 'Nothing to revert: this commit\'s changes are no longer in the branch.'),
    };
  }
  if (hadConflict(out)) {
    return {
      ok: false,
      conflicted: true,
      message:
        kind === 'cherry-pick'
          ? tm('O cherry-pick parou por conflitos: resolva-os, e depois continue ou aborte.', 'The cherry-pick stopped on conflicts: resolve them, then continue or abort.')
          : tm('O revert parou por conflitos: resolva-os, e depois continue ou aborte.', 'The revert stopped on conflicts: resolve them, then continue or abort.'),
    };
  }
  return { ok: false, message: explain(out, kind === 'cherry-pick' ? tm('Não foi possível aplicar o commit.', 'Could not apply the commit.') : tm('Não foi possível reverter o commit.', 'Could not revert the commit.')) };
}

/** Aplica UM commit na branch atual (`git cherry-pick`). Commit de merge usa o primeiro pai (`-m 1`). */
export const cherryPickCommit = (repoPath: string, hash: string): Promise<BranchActionResult> => apply(repoPath, 'cherry-pick', hash);

/** Cria um commit que desfaz o commit dado (`git revert --no-edit`), sem reescrever o histórico. */
export const revertCommit = (repoPath: string, hash: string): Promise<BranchActionResult> => apply(repoPath, 'revert', hash);

/** Continua a operação parada (depois de resolver os conflitos e marcar como resolvidos). */
export async function continueOperation(repoPath: string): Promise<BranchActionResult> {
  const kind = await getInProgress(repoPath);
  if (!kind) return { ok: false, message: tm('Não há operação em andamento.', 'There is no operation in progress.') };
  const args = kind === 'merge' ? ['commit', '--no-edit'] : [kind, '--continue'];
  const r = await runGit(repoPath, args, { check: false, env: NO_EDITOR });
  const out = r.stderr + r.stdout;
  if (r.code === 0) return { ok: true, message: tm('Operação concluída.', 'Operation completed.') };
  if (hadConflict(out)) return { ok: false, conflicted: true, message: tm('Ainda há conflitos a resolver.', 'There are still conflicts to resolve.') };
  return { ok: false, message: explain(out, tm('Não foi possível continuar.', 'Could not continue.')) };
}

/** Abandona a operação parada e volta ao estado de antes dela (`--abort`). */
export async function abortOperation(repoPath: string): Promise<BranchActionResult> {
  const kind = await getInProgress(repoPath);
  if (!kind) return { ok: false, message: tm('Não há operação em andamento.', 'There is no operation in progress.') };
  const r = await runGit(repoPath, [kind, '--abort'], { check: false, env: NO_EDITOR });
  if (r.code !== 0) return { ok: false, message: explain(r.stderr + r.stdout, tm('Não foi possível abortar.', 'Could not abort.')) };
  return { ok: true, message: tm('Operação abortada: o repositório voltou ao estado de antes.', 'Operation aborted: the repository went back to how it was.') };
}
