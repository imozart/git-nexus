// Busca v2 no conteúdo dos arquivos: a parte pura (máscaras, argumentos do `git grep`, leitura da saída com colunas, corte centrado na ocorrência e
// destaque). Roda no núcleo (que dispara o git) e na interface (que desenha o resultado); nada aqui toca o disco nem o Git.
import type { SearchQuery } from './types/ipc.js';

/** Ocorrências por página (padrão) e o teto do pedido. */
export const SEARCH_PAGE = 1000;
export const SEARCH_MAX_PAGE = 5000;
/** Tamanho máximo do texto procurado (era 500). */
export const SEARCH_MAX_PATTERN = 4000;
/** Arquivos maiores que isto ficam de fora da busca de várias linhas (e aparecem como ignorados). */
export const SEARCH_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Linhas maiores que isto são cortadas EM TORNO da ocorrência. */
export const SEARCH_LINE_CLIP = 300;
export const SEARCH_MAX_CONTEXT = 5;
export const SEARCH_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------- máscaras

export interface Masks {
  include: string[];
  exclude: string[];
}

/** Uma máscara vira um glob do Git: sem barra vale em qualquer pasta (`*.ts` → `**\/*.ts`), `pasta/` vale pela pasta inteira. */
function toGlob(mask: string): string {
  let m = mask.replace(/^\.\//, '');
  if (m.endsWith('/')) {
    m = m.slice(0, -1);
    return m.includes('/') ? `${m}/**` : `**/${m}/**`;
  }
  return m.includes('/') ? m : `**/${m}`;
}

/**
 * Lê `*.ts, *.vue, !*.test.ts, !dist/` (vírgula ou espaço; `!` exclui). Recusa o que não é máscara de arquivo: `..`, magia de pathspec (`:(...)`),
 * barra no começo e caracteres de controle. Nada do que o usuário digita vira opção do Git.
 */
export function parseMasks(text: string | undefined): { masks: Masks } | { error: string } {
  const masks: Masks = { include: [], exclude: [] };
  for (const raw of (text ?? '').split(/[,\s]+/)) {
    if (!raw) continue;
    const neg = raw.startsWith('!');
    const body = neg ? raw.slice(1) : raw;
    // eslint-disable-next-line no-control-regex
    if (!body || body.startsWith(':') || body.startsWith('/') || body.startsWith('-') || /[\u0000-\u001f]/.test(body) || body.split('/').includes('..')) return { error: raw };
    (neg ? masks.exclude : masks.include).push(toGlob(body));
  }
  return { masks };
}

/** As máscaras como pathspecs do Git (o que vem depois de `--`). */
export const maskPathspecs = (m: Masks): string[] => [...m.include.map((g) => `:(glob)${g}`), ...m.exclude.map((g) => `:(exclude,glob)${g}`)];

// ---------------------------------------------------------------- pedido normalizado

export interface NormalizedQuery extends Required<Pick<SearchQuery, 'pattern' | 'scope' | 'contextBefore' | 'contextAfter' | 'limit' | 'offset' | 'timeoutMs'>> {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  multiline: boolean;
  revision: string;
  masks: Masks;
  includeIgnored: boolean;
  includeUntracked: boolean;
  includeSubmodules: boolean;
}

/** A pasta do pedido, limpa (`./` e `/` nas pontas saem, a contrabarra vira `/`); `null` se não é um caminho de pasta (`..`, magia de pathspec, controle). */
export function cleanFolder(folder: string | undefined): string | null {
  let f = (folder ?? '').trim().replace(/\\/g, '/');
  // sem expressão regular nas pontas (barras repetidas em texto digitado fariam uma regex lenta)
  while (f.startsWith('./')) f = f.slice(2);
  let from = 0;
  let to = f.length;
  while (from < to && f[from] === '/') from++;
  while (to > from && f[to - 1] === '/') to--;
  f = f.slice(from, to);
  if (!f || f === '.') return '';
  // eslint-disable-next-line no-control-regex
  if (f.startsWith(':') || f.startsWith('-') || /[\u0000-\u001f]/.test(f) || f.split('/').some((p) => p === '..' || p === '')) return null;
  return f;
}

/** As máscaras dentro de uma pasta: sem máscara de inclusão, a pasta inteira; com elas, cada uma sob a pasta. As exclusões continuam valendo onde estiverem. */
export function maskedInFolder(masks: Masks, folder: string): Masks {
  const lit = folder.replace(/[*?[\]\\]/g, '\\$&');
  return { include: masks.include.length ? masks.include.map((g) => `${lit}/${g}`) : [`${lit}/**`], exclude: masks.exclude };
}

const clamp = (n: number | undefined, lo: number, hi: number, d: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n as number))) : d);

/** Uma revisão válida: nome de branch, tag ou commit, sem espaço, sem `..` e sem começar com `-` (nunca vira opção do Git). */
export const isSafeRevision = (r: string): boolean => /^[A-Za-z0-9_@][A-Za-z0-9_@./~^{}+-]*$/.test(r) && !r.includes('..') && !r.endsWith('/') && !r.endsWith('.lock');

export type NormalizeError = { code: 'empty' } | { code: 'tooLong'; max: number } | { code: 'badMask'; mask: string } | { code: 'badRevision'; rev: string };

/** Aplica os padrões e os limites do pedido. A busca de várias linhas liga sozinha quando o texto tem quebra de linha (ou `\n` na regex). */
export function normalizeQuery(q: SearchQuery): { query: NormalizedQuery } | { error: NormalizeError } {
  if (!q.pattern.trim()) return { error: { code: 'empty' } };
  if (q.pattern.length > SEARCH_MAX_PATTERN) return { error: { code: 'tooLong', max: SEARCH_MAX_PATTERN } };
  const parsed = parseMasks(q.include);
  if ('error' in parsed) return { error: { code: 'badMask', mask: parsed.error } };
  const folder = cleanFolder(q.folder);
  if (folder === null) return { error: { code: 'badMask', mask: q.folder ?? '' } };
  const scope = q.scope ?? 'worktree';
  const revision = (q.revision ?? '').trim();
  if (scope === 'revision' && !isSafeRevision(revision)) return { error: { code: 'badRevision', rev: revision } };
  const regex = !!q.regex;
  const multiline = !!q.multiline || /[\r\n]/.test(q.pattern) || (regex && /\\n|\\r/.test(q.pattern));
  return {
    query: {
      pattern: q.pattern,
      regex,
      caseSensitive: !!q.caseSensitive,
      wholeWord: !!q.wholeWord,
      multiline,
      scope,
      revision,
      masks: folder ? maskedInFolder(parsed.masks, folder) : parsed.masks,
      includeIgnored: !!q.includeIgnored,
      includeUntracked: q.includeUntracked ?? true,
      includeSubmodules: !!q.includeSubmodules,
      contextBefore: clamp(q.contextBefore, 0, SEARCH_MAX_CONTEXT, 0),
      contextAfter: clamp(q.contextAfter, 0, SEARCH_MAX_CONTEXT, 0),
      limit: clamp(q.limit, 1, SEARCH_MAX_PAGE, SEARCH_PAGE),
      offset: clamp(q.offset, 0, 1_000_000, 0),
      timeoutMs: clamp(q.timeoutMs, 1000, 600_000, SEARCH_TIMEOUT_MS),
    },
  };
}

// ---------------------------------------------------------------- argumentos do git grep

export interface GrepOptions {
  /** O Git desta máquina suporta `-P` (PCRE2). */
  pcre: boolean;
  threads: number;
  /** Pathspecs extras (arquivos escolhidos pelo escopo `changed`, ou os candidatos da busca de várias linhas). */
  files?: string[];
  /** `-o`: só os trechos achados (o oráculo das colunas). */
  onlyMatching?: boolean;
  /** `-l`: só os nomes dos arquivos (candidatos da busca de várias linhas). */
  listFiles?: boolean;
  /** Procura este texto no lugar do padrão do pedido (o literal de pré-filtro). */
  pattern?: string;
  /** Esse texto é fixo, não expressão regular. */
  fixed?: boolean;
  /** Não acrescenta as máscaras aos caminhos: `files` já vem filtrado (um caminho literal e uma máscara de inclusão se SOMAM no Git, não se cruzam). */
  skipMasks?: boolean;
}

export type Dialect = 'fixed' | 'pcre' | 'extended';

export const dialectOf = (q: Pick<NormalizedQuery, 'regex'>, pcre: boolean): Dialect => (!q.regex ? 'fixed' : pcre ? 'pcre' : 'extended');

/**
 * Os argumentos de `git grep` para o pedido. `-z -n --column` dão arquivo, linha e coluna (em bytes) sem aspas; o texto vai depois de `-e` (um padrão que
 * começa com "-" não vira opção) e as máscaras e os arquivos depois de `--`. Sem `-I`: o binário que casa aparece como "Binary file x matches" e é
 * listado como ignorado (nunca em silêncio).
 */
export function buildGrepArgs(q: NormalizedQuery, o: GrepOptions): string[] {
  const dialect: Dialect = o.fixed ? 'fixed' : dialectOf(q, o.pcre);
  const args = ['grep', '-z', '--no-color'];
  if (o.listFiles) args.push('-l');
  else args.push('-n', '--column');
  if (o.onlyMatching) args.push('-o');
  if (!o.listFiles && !o.onlyMatching) {
    if (q.contextBefore) args.push('-B', String(q.contextBefore));
    if (q.contextAfter) args.push('-A', String(q.contextAfter));
  }
  args.push(dialect === 'fixed' ? '--fixed-strings' : dialect === 'pcre' ? '--perl-regexp' : '--extended-regexp');
  if (!q.caseSensitive) args.push('--ignore-case');
  if (q.wholeWord) args.push('--word-regexp');
  if (q.scope === 'worktree' && !q.includeSubmodules) {
    if (q.includeUntracked || q.includeIgnored) args.push('--untracked');
    if (q.includeIgnored) args.push('--no-exclude-standard');
  }
  if (q.scope === 'changed' && !q.includeSubmodules) args.push('--untracked');
  if (q.scope === 'staged') args.push('--cached');
  if (q.includeSubmodules) args.push('--recurse-submodules');
  if (o.threads > 1) args.push(`--threads=${o.threads}`);
  args.push('-e', o.pattern ?? q.pattern);
  if (q.scope === 'revision') args.push(q.revision);
  args.push('--', ...(o.files ?? []), ...(o.skipMasks ? [] : maskPathspecs(q.masks)));
  return args;
}

/** Caminho literal para o Git (sem glob nem magia): usado nos arquivos do escopo `changed` e nos candidatos. */
export const literalPathspec = (file: string): string => `:(literal)${file}`;

/**
 * O trecho fixo mais longo de uma busca de várias linhas, para o `git grep -l` escolher os candidatos: a parte da pergunta que fica numa linha só. `null`
 * quando não há (o núcleo varre todos os arquivos do escopo).
 */
export function candidateLiteral(pattern: string, regex: boolean): string | null {
  const parts = regex ? pattern.split(/\\[nr]|[\r\n]+/) : pattern.split(/[\r\n]+/);
  let best = '';
  for (const part of parts) {
    // numa regex só serve o trecho sem metacaracteres (ou com eles escapados): na dúvida, não filtra
    const lit = regex ? (/^(?:[^\\^$.*+?()[\]{}|]|\\[\\^$.*+?()[\]{}|/-])+$/.test(part) ? part.replace(/\\(.)/g, '$1') : '') : part;
    if (lit.trim().length > best.length) best = lit;
  }
  return best.trim() ? best : null;
}

// ---------------------------------------------------------------- destaque

const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);

/** Todos os trechos de um texto FIXO na linha, na mesma regra do `git grep` (`-i`, `-w`). */
export function fixedRanges(text: string, pattern: string, caseSensitive: boolean, wholeWord: boolean): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!pattern) return out;
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? pattern : pattern.toLowerCase();
  // minúscula que muda o tamanho do texto (ex.: "İ") desalinharia as colunas: aí só vale a comparação exata
  const h = hay.length === text.length ? hay : text;
  const n = hay.length === text.length ? needle : pattern;
  for (let i = h.indexOf(n); i >= 0; i = h.indexOf(n, i + Math.max(1, n.length))) {
    if (wholeWord && (isWord(text[i - 1]) || isWord(text[i + n.length]))) continue;
    out.push([i, i + n.length]);
  }
  return out;
}

/**
 * A expressão do pedido como `RegExp` do JavaScript, para achar TODAS as ocorrências de uma linha que o Git já disse que casa. Entende o `(?i)`, `(?s)`
 * e `(?m)` no começo (o PCRE aceita, o JavaScript não). Se não compila, devolve o motivo: no destaque quem decide as colunas passa a ser o
 * `git grep -o` (oráculo); na busca de várias linhas é o erro que o usuário vê.
 */
export function compileJsRegex(q: Pick<NormalizedQuery, 'pattern' | 'regex' | 'caseSensitive' | 'wholeWord'>, extra = ''): { re: RegExp } | { error: string } {
  let body = q.regex ? q.pattern : q.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let flags = `g${extra}${q.caseSensitive ? '' : 'i'}`;
  const lead = /^\(\?([imsx]+)\)/.exec(body);
  if (lead && q.regex) {
    if (lead[1]!.includes('x')) return { error: '(?x)' };
    for (const f of lead[1]!) if (!flags.includes(f)) flags += f;
    body = body.slice(lead[0].length);
  }
  try {
    return { re: new RegExp(q.wholeWord ? `\\b(?:${body})\\b` : body, flags) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function jsRegexFor(q: Pick<NormalizedQuery, 'pattern' | 'regex' | 'caseSensitive' | 'wholeWord'>, extra = ''): RegExp | null {
  const r = compileJsRegex(q, extra);
  return 're' in r ? r.re : null;
}

/** Todos os trechos `[início, fim)` que `re` acha em `text` (sem trecho vazio). */
export function regexRanges(text: string, re: RegExp, max = 200): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m && out.length < max; m = re.exec(text)) {
    if (m[0].length === 0) re.lastIndex++;
    else out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

export interface Clipped {
  text: string;
  ranges: Array<[number, number]>;
  clippedStart: boolean;
  clippedEnd: boolean;
}

/** Corta uma linha longa EM TORNO da primeira ocorrência (reticências dos dois lados ficam por conta de quem desenha): o destaque nunca some por causa do corte. */
export function clipAround(text: string, ranges: Array<[number, number]>, max = SEARCH_LINE_CLIP): Clipped {
  if (text.length <= max) return { text, ranges, clippedStart: false, clippedEnd: false };
  const first = ranges[0] ?? [0, 0];
  let start = first[1] - first[0] >= max ? first[0] : Math.round((first[0] + first[1]) / 2 - max / 2);
  start = Math.max(0, Math.min(start, text.length - max));
  let end = Math.min(text.length, start + max);
  // não corta no meio de um par substituto (emoji)
  const isLow = (i: number) => i > 0 && i < text.length && text.charCodeAt(i) >= 0xdc00 && text.charCodeAt(i) <= 0xdfff;
  if (isLow(start)) start++;
  if (isLow(end)) end--;
  const shifted: Array<[number, number]> = [];
  for (const [a, b] of ranges) if (b > start && a < end) shifted.push([Math.max(a, start) - start, Math.min(b, end) - start]);
  return { text: text.slice(start, end), ranges: shifted, clippedStart: start > 0, clippedEnd: end < text.length };
}
