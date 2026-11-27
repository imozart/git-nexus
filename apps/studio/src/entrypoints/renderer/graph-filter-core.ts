// Filtros do Grafo (#294): o estado gravado por repositório, os chips dos filtros ativos, os favoritos nomeados e os períodos prontos (sem Vue nem `window`, para testar).
// A tradução para o `git log` mora no núcleo (`git-core/history-filter.ts`); aqui só o que a interface precisa.
import { activeFilterCount, type HistoryFilter, type RefScope } from '@git-nexus/git-core/pure';

export const SCOPES: readonly RefScope[] = ['current', 'all', 'local', 'chosen'];
export type PeriodId = 'any' | 'today' | '7d' | '30d' | 'custom';
export const PERIODS: readonly PeriodId[] = ['any', 'today', '7d', '30d', 'custom'];
/** O que cada período pronto manda ao Git (`--since`); "hoje" é desde a meia-noite. */
const PERIOD_SINCE: Record<'today' | '7d' | '30d', string> = { today: 'midnight', '7d': '7 days ago', '30d': '30 days ago' };

const text = (v: unknown, max = 200): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** Lê o filtro gravado (JSON): qualquer coisa fora do formato volta ao padrão, campo a campo, e nunca quebra. */
export function parseGraphFilter(raw: string | null | undefined): HistoryFilter {
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    /* gravado corrompido: o padrão */
  }
  const f: HistoryFilter = {};
  if ((SCOPES as readonly unknown[]).includes(o.scope) && o.scope !== 'current') f.scope = o.scope as RefScope;
  if (Array.isArray(o.branches)) {
    const b = o.branches.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 30);
    if (b.length) f.branches = b;
  }
  for (const k of ['remotes', 'tags', 'noMerges', 'unpublished', 'simplify'] as const) if (o[k] === true) f[k] = true;
  for (const k of ['author', 'since', 'until', 'path'] as const) {
    const v = text(o[k], k === 'author' ? 200 : 100).trim();
    if (v) f[k] = v;
  }
  if (o.order === 'date') f.order = 'date';
  return f;
}

/** O período que o filtro representa: um dos prontos (só `since`, igual ao do atalho), "intervalo" quando há datas próprias, "qualquer" sem datas. */
export function periodOf(f: HistoryFilter): PeriodId {
  const since = f.since?.trim() ?? '';
  const until = f.until?.trim() ?? '';
  if (!since && !until) return 'any';
  if (!until) for (const id of ['today', '7d', '30d'] as const) if (since === PERIOD_SINCE[id]) return id;
  return 'custom';
}

/** Escolhe um período: os prontos preenchem `since` e esvaziam `until`; "qualquer" esvazia os dois; "intervalo" mantém o que já havia (ou abre vazio). */
export function withPeriod(f: HistoryFilter, id: PeriodId): HistoryFilter {
  const next = { ...f };
  if (id === 'any') {
    delete next.since;
    delete next.until;
  } else if (id === 'custom') {
    if (periodOf(f) !== 'custom') {
      delete next.until;
      next.since = f.since ?? '';
    }
  } else {
    next.since = PERIOD_SINCE[id];
    delete next.until;
  }
  return next;
}

export type ChipId = 'scope' | 'remotes' | 'tags' | 'author' | 'period' | 'path' | 'noMerges' | 'unpublished' | 'simplify';

/** Os filtros ligados, na ordem em que aparecem como chips. */
export function activeChips(f: HistoryFilter): ChipId[] {
  const out: ChipId[] = [];
  if ((f.scope ?? 'current') !== 'current') out.push('scope');
  if (f.remotes) out.push('remotes');
  if (f.tags) out.push('tags');
  if (f.author?.trim()) out.push('author');
  if (f.since?.trim() || f.until?.trim()) out.push('period');
  if (f.path?.trim()) out.push('path');
  if (f.noMerges) out.push('noMerges');
  if (f.unpublished) out.push('unpublished');
  if (f.simplify && f.path?.trim()) out.push('simplify');
  return out;
}

/** O filtro sem este chip (cada chip remove só o seu filtro). */
export function removeChip(f: HistoryFilter, id: ChipId): HistoryFilter {
  const next = { ...f };
  switch (id) {
    case 'scope':
      delete next.scope;
      delete next.branches;
      break;
    case 'period':
      delete next.since;
      delete next.until;
      break;
    case 'path':
      delete next.path;
      delete next.simplify;
      break;
    default:
      delete next[id];
  }
  return next;
}

/** Dois filtros iguais (a ordem das chaves e o que está vazio não contam). */
export const sameFilter = (a: HistoryFilter, b: HistoryFilter): boolean => JSON.stringify(parseGraphFilter(JSON.stringify(a))) === JSON.stringify(parseGraphFilter(JSON.stringify(b)));

/** Os branches escolhidos digitados ("feat/x, v1.0"): separados por vírgula ou espaço, sem repetir. */
export const parseBranchList = (s: string): string[] => [...new Set(s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean))].slice(0, 30);

/** Quantos filtros estão ligados (o selo do botão); o mesmo conceito do núcleo. */
export const filterCount = (f: HistoryFilter): number => activeFilterCount(f);

// --- favoritos nomeados ("Meus commits da semana") -------------------------------------------------------------------------------------------------------------------

export interface FilterFavorite {
  name: string;
  filter: HistoryFilter;
}
export const MAX_FAVORITES = 20;

export function parseFavorites(raw: string | null | undefined): FilterFavorite[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    const out: FilterFavorite[] = [];
    for (const x of v) {
      if (!x || typeof x !== 'object') continue;
      const name = text((x as { name?: unknown }).name, 40).trim();
      if (name && !out.some((f) => f.name === name)) out.push({ name, filter: parseGraphFilter(JSON.stringify((x as { filter?: unknown }).filter ?? {})) });
    }
    return out.slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

/** Salva (ou substitui, pelo mesmo nome) um favorito; nome vazio não salva. O mais recente fica primeiro; passa de 20, o mais antigo sai. */
export function saveFavorite(list: readonly FilterFavorite[], name: string, filter: HistoryFilter): FilterFavorite[] {
  const n = name.trim().slice(0, 40);
  if (!n) return [...list];
  return [{ name: n, filter: parseGraphFilter(JSON.stringify(filter)) }, ...list.filter((f) => f.name !== n)].slice(0, MAX_FAVORITES);
}

export const deleteFavorite = (list: readonly FilterFavorite[], name: string): FilterFavorite[] => list.filter((f) => f.name !== name);
