// Tela inicial (#286): ordenar e filtrar a lista de repositórios, e lembrar a escolha (sem Vue, para testar).
import type { RepoSummary, RepositoryMeta } from '@git-nexus/git-core/pure';

/** Estado de um repositório na lista: o resumo, ou o erro de quem não pôde ser lido, ou nada ainda (carregando). */
export type HomeSummary = RepoSummary | { error: string } | undefined;
export type HomeSummaries = Record<string, HomeSummary>;

export type HomeSort = 'opened' | 'name' | 'branch' | 'changes' | 'behind' | 'activity';
export type HomeDir = 'asc' | 'desc';
export type HomeDensity = 'comfortable' | 'compact' | 'table';
export type HomeFilter = 'pending' | 'behind' | 'no-upstream' | 'conflict';

export const HOME_SORTS: HomeSort[] = ['opened', 'name', 'branch', 'changes', 'behind', 'activity'];
export const HOME_DENSITIES: HomeDensity[] = ['comfortable', 'compact', 'table'];
export const HOME_FILTERS: HomeFilter[] = ['pending', 'behind', 'no-upstream', 'conflict'];

/** A direção natural de cada ordenação: nomes de A a Z; o resto, o maior (ou mais recente) primeiro. */
export const defaultDir = (s: HomeSort): HomeDir => (s === 'name' || s === 'branch' ? 'asc' : 'desc');

const ok = (s: HomeSummary): s is RepoSummary => !!s && !('error' in s);
const isDirty = (s: RepoSummary) => s.staged + s.unstaged + s.conflicted > 0;
export const changesOf = (s: RepoSummary) => s.staged + s.unstaged + s.untracked;

/** Precisa de atenção: sem resumo ainda (ou com erro), alterações locais, commits para enviar/receber ou a branch remota apagada. */
export function needsAttention(s: HomeSummary): boolean {
  return !ok(s) || isDirty(s) || s.untracked > 0 || s.ahead > 0 || s.behind > 0 || s.gone;
}

/** O repositório passa neste filtro? Os filtros que dependem do resumo (todos menos "pendências") excluem quem ainda não o tem. */
export function matchesFilter(f: HomeFilter, s: HomeSummary): boolean {
  switch (f) {
    case 'pending':
      return needsAttention(s);
    case 'behind':
      return ok(s) && s.behind > 0;
    case 'no-upstream':
      return ok(s) && !s.upstream && !s.detached;
    case 'conflict':
      return ok(s) && s.conflicted > 0;
  }
}

/** Busca por nome ou caminho, mais os filtros ligados (todos precisam valer: "atrás do remoto" E "com conflito"). */
export function filterRepos(repos: RepositoryMeta[], sums: HomeSummaries, filters: readonly HomeFilter[], query: string): RepositoryMeta[] {
  const q = query.trim().toLowerCase();
  return repos.filter((r) => (!q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)) && filters.every((f) => matchesFilter(f, sums[r.id])));
}

/** Quando o repositório teve atividade: a data do último commit (0 se ainda não se sabe). */
const activityOf = (s: HomeSummary): number => (ok(s) ? (s.lastCommit?.date ?? 0) : 0);

/**
 * Ordena sem alterar a lista recebida. O que ainda não tem dado (resumo carregando ou com erro) vai sempre para o fim, em qualquer direção,
 * para a lista não "pular" enquanto os resumos chegam em lotes; empate desempata pelo nome, para a ordem ser estável.
 */
export function sortRepos(repos: RepositoryMeta[], sums: HomeSummaries, sort: HomeSort, dir: HomeDir): RepositoryMeta[] {
  const sign = dir === 'asc' ? 1 : -1;
  const byName = (a: RepositoryMeta, b: RepositoryMeta) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path);
  const num = (r: RepositoryMeta): number | null => {
    const s = sums[r.id];
    switch (sort) {
      case 'opened':
        return r.lastOpenedAt;
      case 'changes':
        return ok(s) ? changesOf(s) : null;
      case 'behind':
        return ok(s) ? s.behind : null;
      case 'activity':
        return ok(s) && s.lastCommit ? s.lastCommit.date : null;
      default:
        return 0;
    }
  };
  const text = (r: RepositoryMeta): string | null => {
    if (sort === 'name') return r.name;
    const s = sums[r.id];
    return ok(s) ? s.branch.toLowerCase() : null;
  };
  return [...repos].sort((a, b) => {
    if (sort === 'name' || sort === 'branch') {
      const x = text(a);
      const y = text(b);
      if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1;
      return sign * x.localeCompare(y, undefined, { sensitivity: 'base' }) || byName(a, b);
    }
    const x = num(a);
    const y = num(b);
    if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1;
    return sign * (x - y) || byName(a, b);
  });
}

/** Ao clicar no cabeçalho de uma coluna: a mesma coluna inverte a direção; outra coluna começa na direção natural dela. */
export function nextSort(cur: { sort: HomeSort; dir: HomeDir }, clicked: HomeSort): { sort: HomeSort; dir: HomeDir } {
  return cur.sort === clicked ? { sort: clicked, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { sort: clicked, dir: defaultDir(clicked) };
}

export interface HomePrefs {
  sort: HomeSort;
  dir: HomeDir;
  density: HomeDensity;
  filters: HomeFilter[];
}

export const DEFAULT_HOME_PREFS: HomePrefs = { sort: 'opened', dir: 'desc', density: 'comfortable', filters: [] };

/** Lê o que está salvo (JSON): valor desconhecido ou torto volta ao padrão, campo por campo, nunca quebra. */
export function parseHomePrefs(raw: string | null | undefined): HomePrefs {
  let o: Partial<Record<keyof HomePrefs, unknown>> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    if (v && typeof v === 'object') o = v as typeof o;
  } catch {
    /* salvo corrompido: usa o padrão */
  }
  const sort = HOME_SORTS.find((s) => s === o.sort) ?? DEFAULT_HOME_PREFS.sort;
  return {
    sort,
    dir: o.dir === 'asc' || o.dir === 'desc' ? o.dir : defaultDir(sort),
    density: HOME_DENSITIES.find((d) => d === o.density) ?? DEFAULT_HOME_PREFS.density,
    filters: Array.isArray(o.filters) ? HOME_FILTERS.filter((f) => (o.filters as unknown[]).includes(f)) : [],
  };
}
