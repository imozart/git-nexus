// Qual é a ação certa para o estado de sincronização da branch (puro: sem Vue, sem API). É o que decide o rótulo e o clique do botão de sincronização.
import { syncState, type BaseComparison, type SyncInfo } from '@git-nexus/git-core/pure';

/**
 * - `fetch`: em dia, ou sem o que comparar (HEAD desanexado): só buscar do remoto;
 * - `update`: atrás: trazer os commits (fast-forward);
 * - `push`: à frente: enviar;
 * - `publish`: sem upstream, ou com a remota apagada: publicar a branch;
 * - `choose`: divergida: a pessoa escolhe merge ou rebase.
 */
export type SyncAction = 'fetch' | 'update' | 'push' | 'publish' | 'choose';

export function syncAction(s: SyncInfo): SyncAction {
  switch (syncState(s)) {
    case 'behind':
      return 'update';
    case 'ahead':
      return 'push';
    case 'diverged':
      return 'choose';
    case 'no-upstream':
    case 'gone':
      return 'publish';
    default:
      return 'fetch';
  }
}

/** O nome do remoto para o rótulo ("origin"): o do upstream, senão o da base (origin/main), senão `origin`. */
export function remoteName(s: Pick<SyncInfo, 'upstream'> | null | undefined, base?: BaseComparison | null): string {
  const ref = s?.upstream ?? base?.base ?? '';
  const i = ref.indexOf('/');
  return i > 0 ? ref.slice(0, i) : 'origin';
}
