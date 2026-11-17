// Texto do estado de sincronização de uma branch (adiante/atrás do remoto). Uma única fonte para o tooltip, o aria-label e as telas.
import { syncState, type SyncInfo } from '@git-nexus/git-core/pure';
import { t } from './i18n';

/** Frase completa: "5 commits atrás de origin/feat/x", "Em dia com origin/main", "Sem upstream…". Vazia se ainda não há dados. */
export function syncText(s: SyncInfo | null | undefined): string {
  if (!s) return '';
  const up = s.upstream ?? '';
  switch (syncState(s)) {
    case 'detached':
      return t('sync.detached');
    case 'no-upstream':
      return t('sync.noUpstream');
    case 'gone':
      return t('sync.gone', { up });
    case 'diverged':
      return t('sync.diverged', { up, ahead: s.ahead, behind: s.behind });
    case 'behind':
      return t('sync.behind', { n: s.behind, up });
    case 'ahead':
      return t('sync.ahead', { n: s.ahead, up });
    case 'in-sync':
      return t('sync.inSync', { up });
  }
}
