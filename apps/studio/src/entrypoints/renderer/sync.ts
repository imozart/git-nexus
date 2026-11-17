// Texto do estado de sincronização de uma branch (adiante/atrás do remoto). Uma única fonte para o tooltip, o aria-label e as telas.
import { syncState, type BaseComparison, type SyncInfo } from '@git-nexus/git-core/pure';
import { agoParts } from './auto-fetch-core';
import { t } from './i18n';

/** "Última busca: há 4 min" (ou "agora há pouco"). Vazia sem upstream (não há com quem comparar) e "nunca" se o repositório ainda não buscou. */
export function lastFetchText(s: SyncInfo | null | undefined, now = Date.now()): string {
  if (!s || !s.upstream) return '';
  if (s.lastFetch == null) return t('sync.neverFetched');
  const a = agoParts(now, s.lastFetch);
  const when = a.unit === 'now' ? t('sync.agoNow') : t(a.unit === 'min' ? 'sync.agoMin' : a.unit === 'hour' ? 'sync.agoHour' : 'sync.agoDay', { n: a.n });
  return t('sync.lastFetch', { when });
}

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

/** Em relação à branch base (origin/main): "12 commits atrás de origin/main", "Divergida de…", "Em dia com…". Vazia sem comparação. */
export function baseText(b: BaseComparison | null | undefined): string {
  return b ? syncText({ upstream: b.base, ahead: b.ahead, behind: b.behind, gone: false }) : '';
}

/** Chip discreto do cabeçalho: "↓12 main", só quando a branch está atrás da base (é o que pede ação). Vazio nos outros casos. */
export function baseChip(b: BaseComparison | null | undefined): string {
  return b && b.behind > 0 ? `↓${b.behind} ${b.short}` : '';
}
