// Busca na história v2 (fase 9 da #233): a parte pura. Normaliza o pedido, monta os argumentos do `git log`, lê cada commit da saída (com o diff, para dizer se o
// texto ENTROU, SAIU ou MUDOU) e resume. Roda no núcleo (que dispara o Git) e na interface (que destaca o trecho); nada aqui toca o disco nem o Git.
import {
  SEARCH_MAX_PATTERN,
  cleanFolder,
  compileJsRegex,
  fixedRanges,
  isSafeRevision,
  maskPathspecs,
  maskedInFolder,
  parseMasks,
  regexRanges,
} from './search-pure.js';
import type { HistoryFileHit, HistoryHit, HistoryKind, HistoryMode, HistoryQuery, HistoryScope } from './types/ipc.js';

export const HISTORY_PAGE = 200;
export const HISTORY_MAX_PAGE = 1000;
export const HISTORY_TIMEOUT_MS = 60_000;
/** Arquivos listados por commit (o resto vira `filesMore`) e o tamanho do diff guardado do `-L`. */
export const HISTORY_MAX_FILES = 50;
export const HISTORY_PATCH_CAP = 20_000;
/** Início de cada commit na saída do `git log` (separador de registro) e entre os campos (separador de unidade). */
export const RS = '\x1e';
export const FS = '\x1f';

export type HistoryError =
  | { code: 'emptyQuery' }
  | { code: 'tooLong'; max: number }
  | { code: 'multiline' }
  | { code: 'badMask'; mask: string }
  | { code: 'badRevision'; rev: string }
  | { code: 'badFollow' }
  | { code: 'badLines' }
  | { code: 'badDate'; value: string };

export interface NormalizedHistory {
  mode: HistoryMode;
  text: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  scope: HistoryScope;
  /** Revisões de `branch` (uma) e `range` (as duas pontas), já conferidas. */
  revs: string[];
  author: string;
  since: string;
  until: string;
  /** Pathspecs do Git (máscaras e pasta). */
  pathspecs: string[];
  /** O arquivo literal de `--follow`. */
  follow: string;
  lines: { file: string; start: number; end: number } | null;
  skip: number;
  limit: number;
  timeoutMs: number;
}

const clamp = (n: number | undefined, lo: number, hi: number, d: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n as number))) : d);
// eslint-disable-next-line no-control-regex
const hasControl = (s: string) => /[\u0000-\u001f]/.test(s);

/** Aplica os padrões e os limites do pedido; recusa o que nunca deve virar argumento do Git. */
export function normalizeHistoryQuery(q: HistoryQuery): { query: NormalizedHistory } | { error: HistoryError } {
  const mode: HistoryMode = q.mode ?? 'pickaxe';
  const scope: HistoryScope = q.scope ?? 'current';
  const text = mode === 'range' ? '' : mode === 'message' ? (q.text ?? '').trim() : q.text ?? '';
  if (text.length > SEARCH_MAX_PATTERN) return { error: { code: 'tooLong', max: SEARCH_MAX_PATTERN } };
  if ((mode === 'lines' || mode === 'message') && /[\r\n]/.test(text)) return { error: { code: 'multiline' } };
  const author = (q.author ?? '').trim();
  // data sem hora ("2026-01-07"): o Git a lê com a hora de AGORA, então o dia inteiro só entrava a partir de certa hora do relógio; `desde` vale do começo do dia e `até` do fim dele
  const bareDay = /^\d{4}-\d{2}-\d{2}$/;
  const sinceRaw = (q.since ?? '').trim();
  const untilRaw = (q.until ?? '').trim();
  const since = bareDay.test(sinceRaw) ? `${sinceRaw} 00:00:00` : sinceRaw;
  const until = bareDay.test(untilRaw) ? `${untilRaw} 23:59:59` : untilRaw;
  for (const d of [since, until]) if (d && (hasControl(d) || d.length > 80)) return { error: { code: 'badDate', value: d.slice(0, 40) } };
  if (hasControl(author)) return { error: { code: 'emptyQuery' } };

  const revs: string[] = [];
  const rev = (q.revision ?? '').trim();
  if (scope === 'branch') {
    if (!isSafeRevision(rev)) return { error: { code: 'badRevision', rev } };
    revs.push(rev);
  } else if (scope === 'range') {
    const ends = rev.split('..');
    if (ends.length !== 2 || !ends.every(isSafeRevision)) return { error: { code: 'badRevision', rev } };
    revs.push(...ends);
  }

  let lines: NormalizedHistory['lines'] = null;
  let pathspecs: string[] = [];
  let follow = '';
  if (mode === 'range') {
    const file = cleanFolder(q.lines?.file);
    const start = Math.floor(q.lines?.start ?? 0);
    const end = Math.floor(q.lines?.end ?? 0);
    if (!file || !(start >= 1) || !(end >= start) || end - start > 200_000 || file.includes(':') || file.includes(',')) return { error: { code: 'badLines' } };
    lines = { file, start, end };
  } else {
    const parsed = parseMasks(q.include);
    if ('error' in parsed) return { error: { code: 'badMask', mask: parsed.error } };
    const folder = cleanFolder(q.folder);
    if (folder === null) return { error: { code: 'badMask', mask: q.folder ?? '' } };
    const masks = folder ? maskedInFolder(parsed.masks, folder) : parsed.masks;
    if (q.follow) {
      // `--follow` do Git aceita UM arquivo: sem máscara de verdade nem pasta
      const only = (q.include ?? '').trim();
      const file = cleanFolder(only);
      if (!file || folder || /[*?[\],\s!]/.test(only) || only.endsWith('/')) return { error: { code: 'badFollow' } };
      follow = file;
    } else pathspecs = maskPathspecs(masks);
    if (!text.trim() && !author && !since && !until && !pathspecs.length && !follow) return { error: { code: 'emptyQuery' } };
  }
  return {
    query: {
      mode,
      text,
      regex: !!q.regex,
      caseSensitive: !!q.caseSensitive,
      // palavra inteira em texto de várias linhas não tem como ser conferida linha a linha
      wholeWord: !!q.wholeWord && !(mode === 'pickaxe' && /\n/.test(text)),
      scope,
      revs,
      author,
      since,
      until,
      pathspecs,
      follow,
      lines,
      skip: clamp(q.skip, 0, 10_000_000, 0),
      limit: clamp(q.limit, 1, HISTORY_MAX_PAGE, HISTORY_PAGE),
      timeoutMs: clamp(q.timeoutMs, 1000, 600_000, HISTORY_TIMEOUT_MS),
    },
  };
}

// ---------------------------------------------------------------- argumentos do git log

/** Texto literal como expressão regular POSIX estendida (a do `-G`, `--pickaxe-regex`, `--grep -E` e `--author -E`). */
export const escapeEre = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** O texto como ERE que não diferencia maiúsculas sem depender de `-i` (o autor é sempre procurado assim, sem mexer no `Aa` do texto). */
export function ciEre(s: string): string {
  let out = '';
  for (const ch of s) {
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    out += lo !== up && lo.length === 1 && up.length === 1 ? `[${lo}${up}]` : escapeEre(ch);
  }
  return out;
}

/** O que o Git ainda não sabe fazer sozinho (palavra inteira): o núcleo confere no diff e descarta o que não vale. */
export const needsJsFilter = (n: NormalizedHistory): boolean => n.wholeWord && (n.mode === 'pickaxe' || n.mode === 'lines');

/** As revisões a percorrer. `headExists` = o repositório tem commit (um repositório novo não tem HEAD). */
export function historyRevs(n: NormalizedHistory, headExists = true): string[] {
  switch (n.scope) {
    case 'all':
      return ['--branches', '--tags', '--remotes', ...(headExists ? ['HEAD'] : [])];
    case 'tags':
      return ['--tags'];
    case 'branch':
    case 'range':
      return n.revs.length === 2 ? [`${n.revs[0]}..${n.revs[1]}`] : [...n.revs];
    default:
      return ['HEAD'];
  }
}

export const HISTORY_FORMAT = `--format=${RS}%H${FS}%P${FS}%an${FS}%at${FS}%D${FS}%s`;

/**
 * Os argumentos do `git log` do pedido. O texto vai colado na opção (`-S<texto>`, `--grep=<padrão>`): nunca vira outra opção. Sem `-n` nem `--skip`: o
 * Git só aplica os dois ANTES do filtro do `-S`/`-G` (contam commits candidatos, não achados), então quem lê a saída encerra o Git quando a página enche e
 * pula os achados da página anterior.
 */
export function buildHistoryArgs(n: NormalizedHistory, headExists = true): string[] {
  const args = ['-c', 'core.quotepath=false', 'log', '--no-color', HISTORY_FORMAT];
  if (n.since) args.push(`--since=${n.since}`);
  if (n.until) args.push(`--until=${n.until}`);
  if (n.author) args.push('--extended-regexp', `--author=${ciEre(n.author)}`);
  if (n.mode === 'range') {
    // `-L` já é o diff do trecho e não aceita caminho nem pickaxe
    args.push(`-L${n.lines!.start},${n.lines!.end}:${n.lines!.file}`, '--no-ext-diff', '--no-textconv', ...historyRevs(n, headExists));
    return args;
  }
  const text = n.text;
  if (n.mode === 'message') {
    if (text) {
      let pat = n.regex ? text : escapeEre(text);
      if (n.wholeWord) pat = `(^|[^[:alnum:]_])(${pat})($|[^[:alnum:]_])`;
      args.push('--extended-regexp', `--grep=${pat}`);
    }
  } else {
    if (text) {
      // texto de várias linhas: o contexto traz as linhas vizinhas, senão o diff não mostra o texto inteiro
      const ctx = n.mode === 'pickaxe' && !n.regex && n.text.includes('\n') ? n.text.split('\n').length : 0;
      args.push('-p', `-U${ctx}`, '-M', '--no-ext-diff', '--no-textconv');
      // palavra inteira não existe no `-S`: o `-G` traz as linhas mexidas que têm o texto e o núcleo confere o resto no diff
      const useG = n.mode === 'lines' || n.wholeWord;
      if (useG) args.push(`-G${n.regex ? text : escapeEre(text)}`);
      else args.push(`-S${text}`, ...(n.regex ? ['--pickaxe-regex'] : []));
    }
  }
  if (!n.caseSensitive && n.text) args.push('--regexp-ignore-case');
  if (n.follow) args.push('--follow');
  args.push(...historyRevs(n, headExists));
  if (n.follow) args.push('--', n.follow);
  else if (n.pathspecs.length) args.push('--', ...n.pathspecs);
  return args;
}

/** Os mesmos filtros sem o texto e sem o diff, para contar os commits do escopo (`git rev-list`). */
export function buildScopeArgs(n: NormalizedHistory, headExists = true): string[] {
  const args = ['rev-list', ...historyRevs(n, headExists)];
  if (n.since) args.push(`--since=${n.since}`);
  if (n.until) args.push(`--until=${n.until}`);
  if (n.author) args.push('--extended-regexp', `--author=${ciEre(n.author)}`);
  if (n.pathspecs.length) args.push('--', ...n.pathspecs);
  return args;
}

// ---------------------------------------------------------------- contar e destacar

export interface Ranger {
  /** Os trechos `[início, fim)` do texto procurado na linha. */
  ranges: (line: string) => Array<[number, number]>;
}

/** O texto procurado como função de trechos de uma linha (a mesma regra do `Aa`, `ab` e `.*` da pesquisa); `null` se a expressão não compila no JavaScript. */
export function makeRanger(q: Pick<HistoryQuery, 'text' | 'regex' | 'caseSensitive' | 'wholeWord'>): Ranger | null {
  const text = q.text ?? '';
  if (!text) return null;
  const caseSensitive = !!q.caseSensitive;
  const wholeWord = !!q.wholeWord;
  if (!q.regex) return { ranges: (line) => fixedRanges(line, text, caseSensitive, wholeWord) };
  const c = compileJsRegex({ pattern: text, regex: true, caseSensitive, wholeWord });
  if ('error' in c) return null;
  return { ranges: (line) => regexRanges(line, c.re) };
}

// ---------------------------------------------------------------- ler um commit

/** `diff --git a/x b/x` → `x` (só quando os dois lados têm o mesmo nome, que é o caso sem renomeação). */
function nameFromDiffHeader(rest: string): string {
  const half = (rest.length - 5) / 2;
  if (Number.isInteger(half) && half > 0 && rest.startsWith('a/') && rest.slice(2 + half, 5 + half) === ' b/' && rest.slice(2, 2 + half) === rest.slice(5 + half)) return rest.slice(2, 2 + half);
  const i = rest.lastIndexOf(' b/');
  return i > 0 ? rest.slice(i + 3) : rest;
}

export interface ParseOptions {
  mode: HistoryMode;
  ranger: Ranger | null;
  /** O texto fixo tem várias linhas: a contagem olha cada trecho do diff como um texto só (com as linhas de contexto), não linha a linha. */
  joined?: boolean;
}

/** `+`, `-` e `ocorrências` de cada arquivo do diff de um commit. */
export function parsePatch(patch: string, o: ParseOptions): HistoryFileHit[] {
  const files: HistoryFileHit[] = [];
  let cur: HistoryFileHit | null = null;
  let inHunk = false;
  // texto de várias linhas: cada trecho (hunk) vira o texto de antes (contexto e linhas `-`) e o de depois (contexto e linhas `+`); a diferença é o que entrou ou saiu
  const totals = new Map<HistoryFileHit, { before: number; after: number }>();
  let before: string[] = [];
  let after: string[] = [];
  const count = (line: string): number => (o.mode === 'range' ? 1 : o.ranger ? o.ranger.ranges(line).length : 0);
  const flush = (): void => {
    if (cur && o.joined && (before.length || after.length)) {
      const t = totals.get(cur) ?? { before: 0, after: 0 };
      t.before += count(before.join('\n'));
      t.after += count(after.join('\n'));
      totals.set(cur, t);
    }
    before = [];
    after = [];
  };
  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('diff --git ')) {
      flush();
      cur = { path: nameFromDiffHeader(line.slice(11)), status: 'M', added: 0, removed: 0 };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    if (!inHunk) {
      if (line.startsWith('@@')) inHunk = true;
      else if (line.startsWith('new file mode')) cur.status = 'A';
      else if (line.startsWith('deleted file mode')) cur.status = 'D';
      else if (line.startsWith('rename from ')) (cur.status = 'R'), (cur.oldPath = line.slice(12));
      else if (line.startsWith('rename to ')) cur.path = line.slice(10);
      else if (line.startsWith('copy from ')) (cur.status = 'C'), (cur.oldPath = line.slice(10));
      else if (line.startsWith('copy to ')) cur.path = line.slice(8);
      else if (line.startsWith('old mode ')) cur.status = cur.status === 'M' ? 'T' : cur.status;
      else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) cur.binary = true;
      if (!inHunk) continue;
    }
    if (line.startsWith('@@')) {
      flush();
      continue;
    }
    if (line.startsWith('+')) {
      if (o.joined) after.push(line.slice(1));
      else cur.added += count(line.slice(1));
    } else if (line.startsWith('-')) {
      if (o.joined) before.push(line.slice(1));
      else cur.removed += count(line.slice(1));
    } else if (o.joined && line.startsWith(' ')) {
      before.push(line.slice(1));
      after.push(line.slice(1));
    }
  }
  flush();
  if (o.joined) {
    for (const f of files) {
      const t = totals.get(f);
      const net = t ? t.after - t.before : 0;
      f.added = Math.max(0, net);
      f.removed = Math.max(0, -net);
    }
  }
  return files;
}

export const kindOf = (added: number, removed: number): HistoryKind => (added > 0 && removed === 0 ? 'added' : removed > 0 && added === 0 ? 'removed' : added > 0 && removed > 0 ? 'changed' : 'unknown');

export interface RecordContext {
  n: NormalizedHistory;
  ranger: Ranger | null;
}

/** Um registro da saída (o que vem depois do `\x1e`) como resultado; `null` quando o filtro do JavaScript descarta o commit. */
export function parseHistoryRecord(rec: string, c: RecordContext): HistoryHit | null {
  const nl = rec.indexOf('\n');
  const head = nl < 0 ? rec : rec.slice(0, nl);
  const body = nl < 0 ? '' : rec.slice(nl + 1);
  const [hash = '', parents = '', author = '', at = '0', refs = '', ...subj] = head.split(FS);
  if (!/^[0-9a-f]{7,64}$/i.test(hash)) return null;
  const base = {
    hash,
    shortHash: hash.slice(0, 7),
    parents: parents ? parents.split(' ') : [],
    refs: refs ? refs.split(', ').filter(Boolean) : [],
    author,
    date: Number(at),
    subject: subj.join(FS),
  };
  const n = c.n;
  if (n.mode === 'message' || !body.trim()) {
    // sem diff (mensagem, ou commit sem mudança de arquivo, como um merge)
    return { ...base, kind: n.mode === 'message' ? 'message' : 'unknown', added: 0, removed: 0, files: [] };
  }
  const multi = n.mode === 'pickaxe' && !n.regex && /\n/.test(n.text);
  let files = parsePatch(body, { mode: n.mode, ranger: c.ranger, joined: multi });
  if (n.mode === 'range') {
    const cleaned = body.replace(/^\n+/, '').trimEnd();
    const added = files.reduce((s, f) => s + f.added, 0);
    const removed = files.reduce((s, f) => s + f.removed, 0);
    return {
      ...base,
      kind: kindOf(added, removed) === 'unknown' ? 'changed' : kindOf(added, removed),
      added,
      removed,
      files: files.slice(0, HISTORY_MAX_FILES),
      patch: cleaned.slice(0, HISTORY_PATCH_CAP),
      ...(cleaned.length > HISTORY_PATCH_CAP ? { patchTruncated: true } : {}),
    };
  }
  if (needsJsFilter(n) && c.ranger) {
    // o Git trouxe os candidatos (`-G`); a palavra inteira vale só onde o texto de fato entrou ou saiu
    files = files.filter((f) => f.binary || (n.mode === 'pickaxe' ? f.added !== f.removed : f.added + f.removed > 0));
    if (!files.length) return null;
  }
  const added = files.reduce((s, f) => s + f.added, 0);
  const removed = files.reduce((s, f) => s + f.removed, 0);
  return {
    ...base,
    kind: c.ranger ? kindOf(added, removed) : 'unknown',
    added,
    removed,
    files: files.slice(0, HISTORY_MAX_FILES),
    ...(files.length > HISTORY_MAX_FILES ? { filesMore: files.length - HISTORY_MAX_FILES } : {}),
  };
}

/** Lê a saída do `git log` aos pedaços: um registro só fica completo quando o próximo começa (ou a saída acaba). */
export class HistoryStream {
  private buf = '';
  constructor(private readonly onRecord: (rec: string) => void) {}

  push(text: string): void {
    this.buf += text;
    // o buffer começa em RS (o início do registro que vem sendo lido): o próximo RS fecha o registro
    for (let i = this.buf.indexOf(RS, 1); i >= 0; i = this.buf.indexOf(RS, 1)) {
      const rec = this.buf.slice(this.buf.startsWith(RS) ? 1 : 0, i);
      this.buf = this.buf.slice(i);
      if (rec) this.onRecord(rec);
    }
  }

  end(): void {
    const rec = this.buf.startsWith(RS) ? this.buf.slice(1) : this.buf;
    this.buf = '';
    if (rec.trim()) this.onRecord(rec);
  }
}

// ---------------------------------------------------------------- resumo

export interface HistorySummary {
  /** O commit mais antigo em que o texto entrou. */
  firstAdded?: HistoryHit;
  /** O mais recente em que o texto saiu. */
  lastRemoved?: HistoryHit;
  added: number;
  removed: number;
  changed: number;
}

/** "Primeira vez que entrou / última vez que saiu", dentro do que está carregado (a tela avisa quando há mais páginas). */
export function summarizeHistory(hits: HistoryHit[]): HistorySummary {
  const out: HistorySummary = { added: 0, removed: 0, changed: 0 };
  for (const h of hits) {
    if (h.kind === 'added') out.added++;
    else if (h.kind === 'removed') out.removed++;
    else if (h.kind === 'changed') out.changed++;
    if (h.added > 0 && (!out.firstAdded || h.date < out.firstAdded.date)) out.firstAdded = h;
    if (h.removed > 0 && (!out.lastRemoved || h.date > out.lastRemoved.date)) out.lastRemoved = h;
  }
  return out;
}
