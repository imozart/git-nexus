// Núcleo puro da busca na história (fase 9 da #233), sem Vue e sem DOM: o formulário, o pedido que sai dele, o que a pesquisa do repositório entrega ao
// histórico, o texto do selo de cada commit e o destaque do trecho no diff.
import { makeRanger, type HistoryHit, type HistoryKind, type HistoryMode, type HistoryQuery, type HistoryScope, type Ranger } from '@git-nexus/git-core/pure';

/** Os modos que a pessoa escolhe (o `range` — histórico de um trecho — vem do editor, não do seletor). */
export type FormMode = Exclude<HistoryMode, 'range'>;

export interface HistoryForm {
  text: string;
  mode: FormMode;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  scope: HistoryScope;
  revision: string;
  author: string;
  since: string;
  until: string;
  /** Arquivo ou máscaras (`*.ts, !*.test.ts`). */
  include: string;
  /** Vem da pesquisa do repositório ("só nesta pasta"). */
  folder: string;
  follow: boolean;
  /** O histórico de um trecho (`git log -L`): quando preenchido, o texto não vale. */
  lines: { file: string; start: number; end: number } | null;
}

export const emptyForm = (): HistoryForm => ({
  text: '',
  mode: 'pickaxe',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  scope: 'current',
  revision: '',
  author: '',
  since: '',
  until: '',
  include: '',
  folder: '',
  follow: false,
  lines: null,
});

/** A última busca e os filtros de cada repositório, lembrados enquanto o app está aberto (fechar e reabrir a aba do repositório não os perde). */
export const historyMemory = new Map<string, HistoryForm>();

/** O pedido ao núcleo; `skip` só no "carregar mais". */
export function toQuery(f: HistoryForm, skip = 0): HistoryQuery {
  const q: HistoryQuery = {
    text: f.lines ? '' : f.text,
    mode: f.lines ? 'range' : f.mode,
    regex: f.regex,
    caseSensitive: f.caseSensitive,
    wholeWord: f.wholeWord,
    scope: f.scope,
    ...(f.scope === 'branch' || f.scope === 'range' ? { revision: f.revision.trim() } : {}),
    author: f.author,
    since: f.since,
    until: f.until,
    include: f.include,
    folder: f.folder,
    follow: f.follow && !f.lines,
    ...(f.lines ? { lines: f.lines } : {}),
    ...(skip ? { skip } : {}),
  };
  return q;
}

/** O formulário de um pedido (quem abre a história de fora passa um pedido e a tela o mostra para a pessoa ajustar). */
export function formFromQuery(q: Partial<HistoryQuery>): HistoryForm {
  const f = emptyForm();
  return {
    ...f,
    text: q.text ?? '',
    mode: q.mode && q.mode !== 'range' ? q.mode : 'pickaxe',
    caseSensitive: !!q.caseSensitive,
    wholeWord: !!q.wholeWord,
    regex: !!q.regex,
    scope: q.scope ?? 'current',
    revision: q.revision ?? '',
    author: q.author ?? '',
    since: q.since ?? '',
    until: q.until ?? '',
    include: q.include ?? '',
    folder: q.folder ?? '',
    follow: !!q.follow,
    lines: q.mode === 'range' && q.lines ? q.lines : null,
  };
}

/** O que a janela "Pesquisar no repositório" entrega: o texto, as opções do campo, as máscaras e a pasta; um branch/tag escolhido lá vira o escopo. */
export function fromSearchPrefs(p: { pattern: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean; include?: string; folder?: string; scope?: string; revision?: string }): HistoryQuery {
  const branch = p.scope === 'revision' && !!p.revision?.trim();
  return {
    text: p.pattern,
    mode: 'pickaxe',
    caseSensitive: p.caseSensitive,
    wholeWord: p.wholeWord,
    regex: p.regex,
    ...(branch ? { scope: 'branch' as const, revision: p.revision!.trim() } : {}),
    include: p.include ?? '',
    folder: p.folder ?? '',
  };
}

/** Há `--follow` possível: UM arquivo (sem máscara de verdade, vírgula, `!` nem pasta). */
export function canFollow(f: Pick<HistoryForm, 'include' | 'folder' | 'lines'>): boolean {
  const only = f.include.trim();
  return !f.lines && !f.folder && !!only && !/[*?[\],\s!]/.test(only) && !only.endsWith('/');
}

/** Pode buscar? Texto ou algum filtro; o trecho já basta. */
export function canSearch(f: HistoryForm): boolean {
  if (f.lines) return true;
  if (f.scope === 'branch' && !f.revision.trim()) return false;
  if (f.scope === 'range' && !/^[^.\s]\S*\.\.\S+$/.test(f.revision.trim())) return false;
  return !!(f.text.trim() || f.author.trim() || f.since.trim() || f.until.trim() || f.include.trim() || f.folder.trim());
}

// ---------------------------------------------------------------- selo

export type KindTone = 'success' | 'danger' | 'warn' | 'accent' | 'neutral';

/** O tom do selo; o texto traz o sentido (+ entrou, − saiu), a cor só reforça. */
export const KIND_TONE: Record<HistoryKind, KindTone> = { added: 'success', removed: 'danger', changed: 'warn', message: 'accent', unknown: 'neutral' };

/** A chave do texto do selo. */
export const KIND_KEY = { added: 'hs.kind.added', removed: 'hs.kind.removed', changed: 'hs.kind.changed', message: 'hs.kind.message', unknown: 'hs.kind.unknown' } as const;

/** Os números do selo: "+2", "−1", "−1 +2" (sem número quando o Git achou mas não deu para contar). */
export function kindNumbers(h: Pick<HistoryHit, 'kind' | 'added' | 'removed'>): string {
  if (h.kind === 'message' || h.kind === 'unknown') return '';
  const parts: string[] = [];
  if (h.removed) parts.push(`−${h.removed}`);
  if (h.added) parts.push(`+${h.added}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------- diff destacado

export interface DiffSegment {
  text: string;
  hit: boolean;
}
export type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'ctx';

export interface DiffLine {
  kind: DiffLineKind;
  segments: DiffSegment[];
}

/** O texto de uma linha em pedaços, com o que casa com a busca marcado. */
export function segmentsOf(text: string, ranger: Ranger | null): DiffSegment[] {
  const ranges = ranger ? ranger.ranges(text) : [];
  if (!ranges.length) return [{ text, hit: false }];
  const out: DiffSegment[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) out.push({ text: text.slice(at, a), hit: false });
    out.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

/** O diff de um commit linha a linha: o trecho que casa vai marcado nas linhas `+` e `-` (só nelas: o resto é contexto). */
export function diffLines(diff: string, ranger: Ranger | null, max = 4000): DiffLine[] {
  const out: DiffLine[] = [];
  let inHunk = false;
  for (const raw of diff.split('\n')) {
    if (out.length >= max) break;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.startsWith('diff --git ')) inHunk = false;
    if (line.startsWith('@@')) {
      inHunk = true;
      out.push({ kind: 'hunk', segments: [{ text: line, hit: false }] });
    } else if (inHunk && line.startsWith('+')) out.push({ kind: 'add', segments: [{ text: '+', hit: false }, ...segmentsOf(line.slice(1), ranger)] });
    else if (inHunk && line.startsWith('-')) out.push({ kind: 'del', segments: [{ text: '-', hit: false }, ...segmentsOf(line.slice(1), ranger)] });
    else out.push({ kind: inHunk ? 'ctx' : 'meta', segments: [{ text: line, hit: false }] });
  }
  return out;
}

/** O destacador do que se procurou (a mesma regra do `Aa`, `ab` e `.*`); `null` sem texto ou em mensagem/trecho. */
export function rangerFor(q: Pick<HistoryQuery, 'text' | 'mode' | 'regex' | 'caseSensitive' | 'wholeWord'>): Ranger | null {
  if (q.mode === 'message' || q.mode === 'range' || !q.text) return null;
  return makeRanger(q);
}

// ---------------------------------------------------------------- trecho do editor

export interface SelectionInfo {
  text: string;
  /** Primeira e última linha da seleção (de 1); sem seleção, a linha do cursor nas duas. */
  startLine: number;
  endLine: number;
}

/** O pedido "Quando isto entrou ou saiu?" para um texto selecionado (uma linha só; de várias o `-S` aceita, no limite de 4000 caracteres). */
export function enteredQuery(text: string): HistoryQuery {
  return { text, mode: 'pickaxe', caseSensitive: true };
}

/** O pedido "Histórico destas linhas" para um arquivo e uma seleção. */
export function linesQuery(file: string, sel: Pick<SelectionInfo, 'startLine' | 'endLine'>): HistoryQuery {
  return { text: '', mode: 'range', lines: { file, start: sel.startLine, end: Math.max(sel.startLine, sel.endLine) } };
}

/** Quanto tempo atrás, para a data do resultado ("há 3 meses" cabe melhor que a data completa numa linha de lista). */
export function shortDate(epochSeconds: number, intl: string): string {
  return new Date(epochSeconds * 1000).toLocaleDateString(intl, { year: 'numeric', month: 'short', day: 'numeric' });
}
