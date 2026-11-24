// Núcleo puro da busca em vários repositórios (fase 8 da #233), sem Vue e sem DOM: o prefixo virtual que identifica o dono de cada arquivo, o estado de cada
// repositório, os conjuntos salvos e a última seleção, e a montagem da lista com um cabeçalho por repositório.
//
// A ideia que mantém a janela simples: na busca em vários repositórios o `file` de cada ocorrência vira `<alias>/<caminho>`, em que `alias` é um nome único do
// repositório. Com isso o modelo de resultados, o recolher, o ocultar e a prévia da substituição (tudo chaveado por `file`) funcionam sem saber que há vários
// repositórios, e o repositório vira a "pasta" de cima. Só quem fala com o disco (abrir, gravar, substituir) desfaz o prefixo (`ownerOf`).
import type { RepositoryMeta, SearchDone } from '@git-nexus/git-core/pure';
import type { RepoState, Row } from './search-window-core';

/** Um repositório do catálogo participando da busca. */
export interface Slot {
  id: string;
  /** Nome único dentro da busca (o prefixo virtual dos arquivos dele). */
  alias: string;
  name: string;
  path: string;
  /** Repositório dentro do WSL (`\\wsl$\...`): vai com a marca no seletor. */
  wsl: boolean;
}

export const isWslPath = (p: string): boolean => /^\\\\(wsl\$|wsl\.localhost)\\/i.test(p);

/** Nomes únicos: o nome da pasta e, se repetir, `nome~2`, `nome~3`... (sem barra, que separa o prefixo do caminho). */
export function assignAliases(repos: readonly RepositoryMeta[]): Slot[] {
  const used = new Set<string>();
  return repos.map((r) => {
    const base = (r.name || r.path.split(/[\\/]/).filter(Boolean).pop() || 'repo').replace(/[\\/]/g, '_');
    let alias = base;
    for (let n = 2; used.has(alias); n++) alias = `${base}~${n}`;
    used.add(alias);
    return { id: r.id, alias, name: r.name, path: r.path, wsl: isWslPath(r.path) };
  });
}

export const virtualFile = (alias: string, rel: string): string => `${alias}/${rel}`;

/** O dono de um arquivo virtual e o caminho dele dentro do repositório (`null` se o prefixo não é de nenhum). */
export function ownerOf(file: string, slots: ReadonlyMap<string, Slot>): { slot: Slot; rel: string } | null {
  const at = file.indexOf('/');
  if (at <= 0) return null;
  const slot = slots.get(file.slice(0, at));
  return slot ? { slot, rel: file.slice(at + 1) } : null;
}

/** O prefixo (alias) de um arquivo ou pasta virtual: a primeira parte do caminho. */
export const aliasOf = (path: string): string => (path.includes('/') ? path.slice(0, path.indexOf('/')) : path);

/** O caminho como a pessoa o lê: sem o prefixo virtual. A pasta que é o próprio repositório vira '' (a raiz). */
export function plainPath(path: string, multi: boolean): string {
  if (!multi) return path;
  const at = path.indexOf('/');
  return at < 0 ? '' : path.slice(at + 1);
}

// ---------- estado de cada repositório ----------

export interface RepoRun {
  slot: Slot;
  state: RepoState;
  hits: number;
  files: number;
  message?: string;
  cut?: 'limit' | 'global' | 'time';
  ms?: number;
}

export const newRun = (slot: Slot): RepoRun => ({ slot, state: 'queued', hits: 0, files: 0 });

/** O fim de um repositório, do jeito que o worker o conta, vira o estado dele. */
export function runFromDone(prev: RepoRun, d: SearchDone): RepoRun {
  const base = { ...prev, hits: d.hits || prev.hits, files: d.files || prev.files, ms: d.ms, ...(d.message ? { message: d.message } : {}) };
  if (d.cancelled) return { ...base, state: 'cancelled' };
  if (d.reason === 'unavailable') return { ...base, state: 'unavailable' };
  if (d.reason === 'noGit') return { ...base, state: 'noGit' };
  if (d.reason === 'noRevision') return { ...base, state: 'noRevision' };
  if (!d.ok) return { ...base, state: 'error' };
  const cut = d.reason === 'globalLimit' ? 'global' : d.truncatedReason === 'limit' ? 'limit' : d.truncatedReason === 'time' ? 'time' : undefined;
  return { ...base, state: 'done', ...(cut ? { cut } : {}) };
}

/** O repositório ainda não terminou. */
export const isActive = (s: RepoState): boolean => s === 'queued' || s === 'running';

/** Os totais do que a busca em vários juntou (o contador diz "320 ocorrências em 41 arquivos de 3 repositórios"). */
export function totalsOf(runs: Iterable<RepoRun>): { repos: number; withHits: number; active: number; failed: number; cut: number } {
  let repos = 0;
  let withHits = 0;
  let active = 0;
  let failed = 0;
  let cut = 0;
  for (const r of runs) {
    repos++;
    if (r.hits > 0) withHits++;
    if (isActive(r.state)) active++;
    if (r.state === 'error' || r.state === 'unavailable' || r.state === 'noGit') failed++;
    if (r.cut) cut++;
  }
  return { repos, withHits, active, failed, cut };
}

// ---------- lista: um cabeçalho por repositório ----------

/**
 * Junta as linhas do modelo (que chegam misturadas, pois os repositórios correm juntos) por repositório e põe o cabeçalho de cada um na frente, na ordem dos
 * `slots` (o da aba ativa primeiro). Recolher o repositório esconde tudo o que tem dentro. Repositório sem ocorrência também ganha cabeçalho: é onde a pessoa
 * vê "buscando", "sem Git" ou "pasta sumida".
 */
export function withRepoHeaders(rows: readonly Row[], slots: readonly Slot[], runs: ReadonlyMap<string, RepoRun>, collapsedRepos: ReadonlySet<string>): Row[] {
  const buckets = new Map<string, Row[]>();
  for (const s of slots) buckets.set(s.alias, []);
  for (const r of rows) {
    const a = aliasOf(r.kind === 'dir' ? r.dir : r.kind === 'repo' ? r.alias : r.file);
    buckets.get(a)?.push(r);
  }
  const out: Row[] = [];
  for (const s of slots) {
    const mine = buckets.get(s.alias)!;
    const run = runs.get(s.alias);
    const closed = collapsedRepos.has(s.alias);
    // por arquivo/pasta cada arquivo diz quantas ocorrências tem (mesmo recolhido); na lista plana só há as ocorrências
    const fileRows = mine.filter((r): r is Extract<Row, { kind: 'file' }> => r.kind === 'file');
    const hits = fileRows.length ? fileRows.reduce((n, r) => n + r.count, 0) : mine.reduce((n, r) => (r.kind === 'hit' ? n + 1 : n), 0);
    const files = fileRows.length ? fileRows.length : new Set(mine.filter((r): r is Extract<Row, { kind: 'hit' }> => r.kind === 'hit').map((r) => r.file)).size;
    out.push({
      kind: 'repo',
      key: `r:${s.alias}`,
      alias: s.alias,
      name: s.name,
      count: hits,
      files,
      state: run?.state ?? 'queued',
      collapsed: closed,
      ...(run?.message ? { message: run.message } : {}),
      ...(run?.cut ? { cut: run.cut } : {}),
    });
    if (!closed) out.push(...mine);
  }
  return out;
}

export const repoKey = (alias: string): string => `r:${alias}`;

// ---------- escolher onde: a seleção, os atalhos e os conjuntos salvos ----------

export const MAX_SELECTED = 200;
export const MAX_SETS = 30;

/** Um conjunto salvo ("Backend", "Front"): um nome e os ids do catálogo. */
export interface RepoSet {
  name: string;
  ids: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_SELECTED) : []);

/** Só os ids que ainda existem no catálogo, sem repetir, na ordem em que estavam. */
export function pruneIds(ids: readonly string[], catalog: readonly Pick<RepositoryMeta, 'id'>[]): string[] {
  const known = new Set(catalog.map((r) => r.id));
  return [...new Set(ids)].filter((i) => known.has(i));
}

export function readSets(raw: unknown): RepoSet[] {
  if (!Array.isArray(raw)) return [];
  const out: RepoSet[] = [];
  for (const s of raw) {
    const name = typeof (s as RepoSet)?.name === 'string' ? (s as RepoSet).name.trim().slice(0, 60) : '';
    if (!name || out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, ids: strings((s as RepoSet).ids) });
    if (out.length >= MAX_SETS) break;
  }
  return out;
}

/** Salva (ou troca, pelo nome sem diferenciar caixa) um conjunto; o mais recente fica por último. */
export function upsertSet(sets: readonly RepoSet[], name: string, ids: readonly string[]): RepoSet[] {
  const n = name.trim().slice(0, 60);
  if (!n) return [...sets];
  const rest = sets.filter((s) => s.name.toLowerCase() !== n.toLowerCase());
  return [...rest, { name: n, ids: [...new Set(ids)].slice(0, MAX_SELECTED) }].slice(-MAX_SETS);
}

export const removeSet = (sets: readonly RepoSet[], name: string): RepoSet[] => sets.filter((s) => s.name !== name);

/** Os atalhos do seletor. */
export const pickAll = (catalog: readonly Pick<RepositoryMeta, 'id'>[]): string[] => catalog.map((r) => r.id).slice(0, MAX_SELECTED);
export const pickOpen = (catalog: readonly Pick<RepositoryMeta, 'id'>[], openIds: readonly string[]): string[] => pruneIds(openIds, catalog);

/** A ordem de uma busca: o repositório da aba ativa primeiro e os outros como a pessoa escolheu. */
export function searchOrder(ids: readonly string[], activeId: string): string[] {
  const list = [...new Set(ids)];
  return list.includes(activeId) ? [activeId, ...list.filter((i) => i !== activeId)] : list;
}

/** "3 repositórios" do chip: só aparece com mais de um repositório escolhido. */
export const isMulti = (ids: readonly string[]): boolean => ids.length > 1;

/** Filtro do seletor: por nome ou caminho, sem diferenciar caixa nem acento. */
export function matchRepos<T extends Pick<RepositoryMeta, 'name' | 'path'>>(repos: readonly T[], query: string): T[] {
  const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const q = norm(query.trim());
  return q ? repos.filter((r) => norm(r.name).includes(q) || norm(r.path).includes(q)) : [...repos];
}
