// Estado de sincronização de uma branch com o remoto (adiante/atrás), sem nenhuma API do Node: serve o renderer e os testes.

/** O mínimo que se precisa saber de uma branch para dizer se ela está em dia. `RepoSummary` e `BranchInfo` já têm esses campos. */
export interface SyncInfo {
  upstream: string | null;
  /** Commits locais ainda não enviados. */
  ahead: number;
  /** Commits do remoto ainda não trazidos. */
  behind: number;
  /** O upstream está configurado, mas a branch remota foi apagada. */
  gone: boolean;
  /** HEAD desanexado: não há branch para comparar. */
  detached?: boolean;
}

export type SyncState = 'detached' | 'no-upstream' | 'gone' | 'in-sync' | 'behind' | 'ahead' | 'diverged';

/** Classifica a branch: em dia, atrás, à frente, divergida (os dois ao mesmo tempo), sem upstream, remota apagada ou HEAD desanexado. */
export function syncState(s: SyncInfo): SyncState {
  if (s.detached) return 'detached';
  if (!s.upstream) return 'no-upstream';
  if (s.gone) return 'gone';
  if (s.ahead > 0 && s.behind > 0) return 'diverged';
  if (s.behind > 0) return 'behind';
  if (s.ahead > 0) return 'ahead';
  return 'in-sync';
}
