// Núcleo puro dos filtros e do histórico da janela "Pesquisar no repositório" (sem Vue e sem DOM, para testar): os escopos e filtros que viram o pedido do
// núcleo da busca, o histórico de pesquisas por repositório, e as mensagens que ajudam a pessoa (expressão inválida com a posição, o que fica de fora,
// sugestões quando nada é encontrado).
import { cleanFolder, type SearchQuery, type SearchScope, type SearchSkipped } from '@git-nexus/git-core/pure';
import type { Group } from './search-window-core';

export const SCOPES: readonly SearchScope[] = ['worktree', 'tracked', 'changed', 'staged', 'revision'];
export const GROUPS: readonly Group[] = ['file', 'folder', 'flat'];
export const MAX_CONTEXT = 5;

/** Tudo o que a janela filtra além do texto e das opções do campo (Aa, ab, .*) e das máscaras. */
export interface Filters {
  scope: SearchScope;
  /** Branch, tag ou commit, quando `scope` é `revision`. */
  revision: string;
  /** Só dentro desta pasta ('' = o repositório todo). */
  folder: string;
  includeIgnored: boolean;
  includeUntracked: boolean;
  includeSubmodules: boolean;
  /** Linhas de contexto antes e depois de cada ocorrência (0 a 5). */
  context: number;
  group: Group;
}

export const DEFAULT_FILTERS: Filters = {
  scope: 'worktree',
  revision: '',
  folder: '',
  includeIgnored: false,
  includeUntracked: true,
  includeSubmodules: false,
  context: 0,
  group: 'file',
};

/** Lê os filtros guardados, aceitando só valores válidos (o resto volta ao padrão). */
export function readFilters(raw: unknown): Filters {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof Filters): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (DEFAULT_FILTERS[k] as boolean));
  const ctx = typeof o.context === 'number' && Number.isFinite(o.context) ? Math.min(MAX_CONTEXT, Math.max(0, Math.floor(o.context))) : 0;
  return {
    scope: SCOPES.includes(o.scope as SearchScope) ? (o.scope as SearchScope) : DEFAULT_FILTERS.scope,
    revision: typeof o.revision === 'string' ? o.revision.slice(0, 200) : '',
    folder: typeof o.folder === 'string' ? o.folder.slice(0, 500) : '',
    includeIgnored: bool('includeIgnored'),
    includeUntracked: bool('includeUntracked'),
    includeSubmodules: bool('includeSubmodules'),
    context: ctx,
    group: GROUPS.includes(o.group as Group) ? (o.group as Group) : DEFAULT_FILTERS.group,
  };
}

/** O que a janela pergunta: o texto, as opções do campo, as máscaras e os filtros. */
export interface QueryPrefs extends Filters {
  pattern: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string;
}

/** O pedido do núcleo da busca. `revision` só vai quando o escopo é a revisão. */
export function buildQuery(p: QueryPrefs, extra: { limit?: number; offset?: number } = {}): SearchQuery {
  const folder = cleanFolder(p.folder) ?? p.folder;
  return {
    pattern: p.pattern,
    regex: p.regex,
    caseSensitive: p.caseSensitive,
    wholeWord: p.wholeWord,
    scope: p.scope,
    ...(p.scope === 'revision' ? { revision: p.revision.trim() } : {}),
    ...(p.include.trim() ? { include: p.include.trim() } : {}),
    ...(folder ? { folder } : {}),
    includeIgnored: p.includeIgnored,
    includeUntracked: p.includeUntracked,
    includeSubmodules: p.includeSubmodules,
    contextBefore: p.context,
    contextAfter: p.context,
    ...extra,
  };
}

/** O caminho de um arquivo como máscara: espaço e vírgula separariam máscaras, então viram `?` (um caractere qualquer). */
export const maskForPath = (path: string): string => path.replace(/[\s,]/g, '?');

/** Falta dizer a revisão: a busca ainda não pode rodar. */
export const needsRevision = (p: Pick<Filters, 'scope' | 'revision'>): boolean => p.scope === 'revision' && !p.revision.trim();

export type FilterKey = 'scope' | 'folder' | 'ignored' | 'untracked' | 'submodules' | 'context' | 'group';

/** Os filtros que não estão no padrão, na ordem em que aparecem (o resumo ao lado do botão Filtros e o contador do botão). */
export function changedFilters(f: Filters): FilterKey[] {
  const out: FilterKey[] = [];
  if (f.scope !== DEFAULT_FILTERS.scope) out.push('scope');
  if (f.folder.trim()) out.push('folder');
  if (f.includeIgnored) out.push('ignored');
  if (!f.includeUntracked) out.push('untracked');
  if (f.includeSubmodules) out.push('submodules');
  if (f.context > 0) out.push('context');
  if (f.group !== DEFAULT_FILTERS.group) out.push('group');
  return out;
}

// ---------------------------------------------------------------- histórico de pesquisas

export const HISTORY_MAX = 30;

/** Uma pesquisa feita antes: o texto e tudo o que a refaz igual (opções, máscara, onde procurar). */
export interface HistoryEntry {
  pattern: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  include: string;
  scope: SearchScope;
  revision: string;
  folder: string;
}

export const entryOf = (p: QueryPrefs): HistoryEntry => ({
  pattern: p.pattern,
  regex: p.regex,
  caseSensitive: p.caseSensitive,
  wholeWord: p.wholeWord,
  include: p.include.trim(),
  scope: p.scope,
  revision: p.scope === 'revision' ? p.revision.trim() : '',
  folder: p.folder.trim(),
});

const same = (a: HistoryEntry, b: HistoryEntry): boolean =>
  a.pattern === b.pattern && a.regex === b.regex && a.caseSensitive === b.caseSensitive && a.wholeWord === b.wholeWord && a.include === b.include && a.scope === b.scope && a.revision === b.revision && a.folder === b.folder;

/** A pesquisa mais recente fica no começo; a repetida sobe em vez de duplicar; guarda as últimas 30. Texto vazio não entra. */
export function pushHistory(list: readonly HistoryEntry[], e: HistoryEntry): HistoryEntry[] {
  if (!e.pattern.trim()) return [...list];
  return [e, ...list.filter((x) => !same(x, e))].slice(0, HISTORY_MAX);
}

/** Lê o histórico guardado, ignorando o que não é uma entrada válida. */
export function readHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object' || typeof (x as HistoryEntry).pattern !== 'string' || !(x as HistoryEntry).pattern.trim()) continue;
    const o = x as Partial<HistoryEntry>;
    out.push({
      pattern: o.pattern!.slice(0, 4000),
      regex: o.regex === true,
      caseSensitive: o.caseSensitive === true,
      wholeWord: o.wholeWord === true,
      include: typeof o.include === 'string' ? o.include.slice(0, 500) : '',
      scope: SCOPES.includes(o.scope as SearchScope) ? (o.scope as SearchScope) : 'worktree',
      revision: typeof o.revision === 'string' ? o.revision.slice(0, 200) : '',
      folder: typeof o.folder === 'string' ? o.folder.slice(0, 500) : '',
    });
    if (out.length >= HISTORY_MAX) break;
  }
  return out;
}

/** As entradas que começam por (ou contêm) o que foi digitado; sem texto, todas. */
export function historyMatching(list: readonly HistoryEntry[], typed: string): HistoryEntry[] {
  const q = typed.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((e) => e.pattern.toLowerCase().includes(q));
}

// ---------------------------------------------------------------- mensagens

/**
 * Onde a expressão regular quebra (índice no texto, a partir de 0): o parêntese ou colchete que não fecha (ou não abriu) e o quantificador sem nada antes.
 * `null` quando não sabe dizer (o motivo vem na mensagem do motor).
 */
export function regexErrorAt(pattern: string): number | null {
  const open: number[] = [];
  let cls = -1;
  let prevAtom = false; // há algo para o quantificador repetir
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      i++;
      prevAtom = true;
      continue;
    }
    if (cls >= 0) {
      if (ch === ']') {
        cls = -1;
        prevAtom = true;
      }
      continue;
    }
    if (ch === '[') cls = i;
    else if (ch === '(') {
      open.push(i);
      prevAtom = false;
    } else if (ch === ')') {
      if (!open.length) return i;
      open.pop();
      prevAtom = true;
    } else if (ch === '|') prevAtom = false;
    else if (ch === '*' || ch === '+' || ch === '?') {
      if (ch === '?' && pattern[i - 1] === '(') prevAtom = false; // `(?i)`, `(?:`: o `?` abre o grupo
      else if (!prevAtom) return i; // nada antes para repetir
    } else prevAtom = true;
  }
  if (cls >= 0) return cls;
  return open.length ? open[open.length - 1]! : null;
}

/** Quantos arquivos ficaram de fora e por quê (a lista de `done.skipped` por motivo). */
export function skippedCounts(skipped: readonly SearchSkipped[]): { binary: number; large: number } {
  let binary = 0;
  let large = 0;
  for (const s of skipped) {
    if (s.reason === 'binary') binary++;
    else large++;
  }
  return { binary, large };
}

export type Suggestion = 'case' | 'word' | 'regex' | 'mask' | 'folder' | 'scope' | 'untracked' | 'ignored';

/** O que dá para afrouxar quando nada foi encontrado: só o que está apertando a busca agora (no máximo 4, do mais fácil para o mais amplo). */
export function emptySuggestions(p: QueryPrefs): Suggestion[] {
  const out: Suggestion[] = [];
  if (p.caseSensitive) out.push('case');
  if (p.wholeWord) out.push('word');
  if (p.regex) out.push('regex');
  if (p.include.trim()) out.push('mask');
  if (p.folder.trim()) out.push('folder');
  if (p.scope !== 'worktree') out.push('scope');
  else {
    if (!p.includeUntracked) out.push('untracked');
    if (!p.includeIgnored) out.push('ignored');
  }
  return out.slice(0, 4);
}

/** Aplica uma sugestão às preferências (devolve o que muda). */
export function applySuggestion(s: Suggestion): Partial<QueryPrefs> {
  switch (s) {
    case 'case':
      return { caseSensitive: false };
    case 'word':
      return { wholeWord: false };
    case 'regex':
      return { regex: false };
    case 'mask':
      return { include: '' };
    case 'folder':
      return { folder: '' };
    case 'scope':
      return { scope: 'worktree', revision: '' };
    case 'untracked':
      return { includeUntracked: true };
    case 'ignored':
      return { includeIgnored: true };
  }
}
