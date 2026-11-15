import type { FileEntry } from '@git-nexus/git-core/pure';
import { t, type MessageKey } from './i18n';

export type CheckState = 'checked' | 'partial' | 'unchecked';
export type StatusLetter = 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | '?';

export const isUntracked = (e: FileEntry) => e.x === '?';
/** Tem algo no índice (vai para o próximo commit). */
export const hasStaged = (e: FileEntry) => e.x !== ' ' && e.x !== '?';
const hasWorktree = (e: FileEntry) => e.y !== ' ' && e.y !== '?';

/** checked = tudo incluído no commit · partial = parte no stage, parte pendente · unchecked = pendente. */
export function checkState(e: FileEntry): CheckState {
  if (!hasStaged(e)) return 'unchecked';
  return hasWorktree(e) ? 'partial' : 'checked';
}

export function statusLetter(e: FileEntry): StatusLetter {
  if (isUntracked(e)) return '?';
  const c = hasWorktree(e) && !hasStaged(e) ? e.y : e.x !== ' ' ? e.x : e.y;
  return (['M', 'A', 'D', 'R', 'C', 'T'].includes(c) ? c : 'M') as StatusLetter;
}

const STATUS_KEY: Record<StatusLetter, MessageKey> = {
  M: 'status.M',
  A: 'status.A',
  D: 'status.D',
  R: 'status.R',
  C: 'status.C',
  T: 'status.T',
  '?': 'status.untracked',
};
/** Nome do status no idioma atual (lê o idioma reativo: serve em templates e computed). */
export const statusLabel = (l: StatusLetter): string => t(STATUS_KEY[l]);

export function splitPath(p: string): { name: string; dir: string } {
  const clean = p.replace(/\/$/, '');
  const i = clean.lastIndexOf('/');
  return { name: clean.slice(i + 1) + (p.endsWith('/') ? '/' : ''), dir: i === -1 ? '' : clean.slice(0, i) };
}

const byPath = (a: FileEntry, b: FileEntry) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' });

export function groupEntries(entries: FileEntry[]): { changes: FileEntry[]; unversioned: FileEntry[] } {
  return {
    changes: entries.filter((e) => !isUntracked(e)).sort(byPath),
    unversioned: entries.filter(isUntracked).sort(byPath),
  };
}
