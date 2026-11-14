import { runGit } from './runner.js';
import type { RepoSummary, SyncResult } from './types/ipc.js';

/** Parse de `git status --porcelain=v2 --branch -z`. */
export function parseSummary(raw: string): RepoSummary {
  const s: RepoSummary = {
    branch: '',
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };
  const parts = raw.split('\0').filter(Boolean);
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
  return s;
}

export async function getRepoSummary(repoPath: string): Promise<RepoSummary> {
  const r = await runGit(repoPath, ['status', '--porcelain=v2', '--branch', '-z']);
  return parseSummary(r.stdout);
}

/** Sem terminal: nunca pergunta senha (o git falha em vez de travar esperando entrada). */
const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' };

/** `git fetch --all --prune`. */
export async function fetchRepo(repoPath: string): Promise<SyncResult> {
  const r = await runGit(repoPath, ['fetch', '--all', '--prune'], { check: false, env: NO_PROMPT });
  if (r.code !== 0) return { ok: false, message: firstLine(r.stderr) || 'Falha ao buscar do remoto.' };
  return { ok: true, message: 'Buscado.' };
}

/**
 * Atualiza a branch atual só por fast-forward: nunca cria merge nem reescreve nada.
 * Recusa se não houver upstream, se estiver desanexado ou se a branch tiver divergido.
 */
export async function pullRepo(repoPath: string): Promise<SyncResult> {
  const s = await getRepoSummary(repoPath);
  if (s.detached) return { ok: false, message: 'HEAD desanexado: nada a atualizar.' };
  if (!s.upstream) return { ok: false, message: 'A branch não tem upstream configurado.' };
  if (s.conflicted) return { ok: false, message: 'Há conflitos a resolver antes de atualizar.' };
  const r = await runGit(repoPath, ['pull', '--ff-only'], { check: false, env: NO_PROMPT });
  const out = (r.stderr + r.stdout).trim();
  if (r.code === 0) return { ok: true, message: /Already up to date|Já está atualizado/i.test(out) ? 'Já estava atualizado.' : 'Atualizado (fast-forward).' };
  if (/not possible to fast-forward|diverging|divergent/i.test(out)) return { ok: false, message: 'A branch divergiu do remoto: atualize manualmente (merge ou rebase).' };
  if (/would be overwritten|Your local changes/i.test(out)) return { ok: false, message: 'Alterações locais conflitam com o que veio do remoto.' };
  return { ok: false, message: firstLine(out) || 'Falha ao atualizar.' };
}

const firstLine = (s: string) => s.trim().split('\n').find((l) => l.trim()) ?? '';
