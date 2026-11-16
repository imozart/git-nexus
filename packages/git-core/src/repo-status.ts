import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { emitGitProgress, progressReader } from './progress.js';
import { runGit } from './runner.js';
import type { RepoSummary, SyncResult } from './types/ipc.js';
import { tm } from './messages.js';

/** Parse de `git status --porcelain=v2 --branch -z`. */
export function parseSummary(raw: string): RepoSummary {
  const s: RepoSummary = {
    branch: '',
    detached: false,
    upstream: null,
    gone: false,
    lastFetch: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };
  const parts = raw.split('\0').filter(Boolean);
  let sawAb = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.startsWith('# branch.head ')) {
      const h = p.slice('# branch.head '.length);
      s.detached = h === '(detached)';
      s.branch = s.detached ? 'HEAD (desanexado)' : h;
    } else if (p.startsWith('# branch.upstream ')) s.upstream = p.slice('# branch.upstream '.length);
    else if (p.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(p);
      if (m) {
        sawAb = true;
        s.ahead = Number(m[1]);
        s.behind = Number(m[2]);
      }
    } else if (p.startsWith('1 ') || p.startsWith('2 ')) {
      const xy = p.slice(2, 4);
      if (xy[0] !== '.') s.staged++;
      if (xy[1] !== '.') s.unstaged++;
      if (p.startsWith('2 ')) i++; // renomeação: o próximo item é o caminho de origem
    } else if (p.startsWith('u ')) s.conflicted++;
    else if (p.startsWith('? ')) s.untracked++;
  }
  // Com upstream configurado, o git omite "branch.ab" quando a branch remota não existe mais (foi apagada).
  s.gone = s.upstream !== null && !sawAb;
  return s;
}

/**
 * Quando o repositório falou com o remoto pela última vez (ms desde 1970): a data de `FETCH_HEAD`, que todo fetch e todo pull reescrevem,
 * inclusive os feitos fora do app. `null` se nunca buscou ou se não der para ler (por exemplo, repositório dentro do WSL).
 */
export async function getLastFetch(repoPath: string): Promise<number | null> {
  try {
    const r = await runGit(repoPath, ['rev-parse', '--git-path', 'FETCH_HEAD'], { check: false });
    const rel = r.stdout.trim();
    if (r.code !== 0 || !rel) return null;
    return (await stat(isAbsolute(rel) ? rel : join(repoPath, rel))).mtimeMs;
  } catch {
    return null;
  }
}

export async function getRepoSummary(repoPath: string): Promise<RepoSummary> {
  const [r, lastFetch] = await Promise.all([runGit(repoPath, ['status', '--porcelain=v2', '--branch', '-z']), getLastFetch(repoPath)]);
  return { ...parseSummary(r.stdout), lastFetch };
}

/** Sem terminal: nunca pergunta senha (o git falha em vez de travar esperando entrada). */
export const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' };

/** `git fetch --all --prune`. */
export async function fetchRepo(repoPath: string): Promise<SyncResult> {
  const onStderr = progressReader((p) => emitGitProgress({ repoPath, op: 'fetch', phase: p.phase, percent: p.percent }));
  const r = await runGit(repoPath, ['fetch', '--all', '--prune', '--progress'], { check: false, env: NO_PROMPT, onStderr });
  if (r.code !== 0) return { ok: false, message: firstLine(r.stderr) || tm('Falha ao buscar do remoto.', 'Failed to fetch from the remote.') };
  return { ok: true, message: 'Buscado.' };
}

/**
 * Atualiza a branch atual só por fast-forward: nunca cria merge nem reescreve nada.
 * Recusa se não houver upstream, se estiver desanexado ou se a branch tiver divergido.
 */
export async function pullRepo(repoPath: string): Promise<SyncResult> {
  const s = await getRepoSummary(repoPath);
  if (s.detached) return { ok: false, message: tm('HEAD desanexado: nada a atualizar.', 'Detached HEAD: nothing to update.') };
  if (!s.upstream) return { ok: false, message: tm('A branch não tem upstream configurado.', 'The branch has no upstream configured.') };
  if (s.conflicted) return { ok: false, message: tm('Há conflitos a resolver antes de atualizar.', 'There are conflicts to resolve before updating.') };
  const r = await runGit(repoPath, ['pull', '--ff-only'], { check: false, env: NO_PROMPT });
  const out = (r.stderr + r.stdout).trim();
  if (r.code === 0) return { ok: true, message: /Already up to date|Já está atualizado/i.test(out) ? tm('Já estava atualizado.', 'Already up to date.') : tm('Atualizado (fast-forward).', 'Updated (fast-forward).') };
  if (/not possible to fast-forward|diverging|divergent/i.test(out)) return { ok: false, message: tm('A branch divergiu do remoto: atualize manualmente (merge ou rebase).', 'The branch diverged from the remote: update manually (merge or rebase).') };
  if (/would be overwritten|Your local changes/i.test(out)) return { ok: false, message: tm('Alterações locais conflitam com o que veio do remoto.', 'Local changes conflict with what came from the remote.') };
  return { ok: false, message: firstLine(out) || 'Falha ao atualizar.' };
}

const firstLine = (s: string) => s.trim().split('\n').find((l) => l.trim()) ?? '';
