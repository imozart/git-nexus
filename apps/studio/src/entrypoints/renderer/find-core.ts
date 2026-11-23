// Núcleo da busca dentro de UM arquivo (a barra do editor): consulta, contagem, navegação e marcas da barra de rolagem. Sem Vue e sem DOM, só o
// estado do CodeMirror, para testar. O @codemirror/search entra como MOTOR (`SearchQuery` e seus cursores: texto, regex, palavra inteira, caixa);
// a interface é a nossa (FindBar.vue, o campo do ui-kit, nossos textos e nossa acessibilidade).
import { SearchQuery } from '@codemirror/search';
import type { EditorState } from '@codemirror/state';

export interface FindOptions {
  text: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}
export interface Span {
  from: number;
  to: number;
}

/** Acima disto o contador diz "10000+" e a contagem para: arquivo enorme com uma letra comum não trava a tela. */
export const MAX_COUNT = 10_000;
/** Ocorrências desenhadas de uma vez (só as da parte visível do arquivo). */
export const MAX_DRAWN = 2_000;
/** Marcas na barra de rolagem: faixas da altura do arquivo, cada uma acesa se tiver ao menos uma ocorrência. */
export const MARK_BUCKETS = 240;

/** A consulta do motor. Sem regex o texto é LITERAL (`\n` digitado fica `\n`); com regex, `\n` quebra a linha. Vazia ou inválida: `null`. */
export function makeQuery(o: FindOptions): SearchQuery | null {
  if (!o.text) return null;
  const q = new SearchQuery({ search: o.text, caseSensitive: o.caseSensitive, wholeWord: o.wholeWord, regexp: o.regex, literal: !o.regex });
  return q.valid ? q : null;
}

/** Ocorrências em `[from, to]`, em ordem, ignorando as vazias (`a*`) e parando em `limit`. */
export function matchesIn(state: EditorState, q: SearchQuery, from: number, to: number, limit: number): Span[] {
  const out: Span[] = [];
  const cur = q.getCursor(state, from, to);
  for (let r = cur.next(); !r.done && out.length < limit; r = cur.next()) {
    const { from: a, to: b } = r.value;
    if (b > a) out.push({ from: a, to: b });
  }
  return out;
}

export interface FindStats {
  /** Quantas ocorrências (no máximo `MAX_COUNT`). */
  total: number;
  /** Passou do máximo: mostrar "10000+". */
  capped: boolean;
  /** Número (de 1) da ocorrência selecionada agora, ou 0 se a seleção não é uma ocorrência. */
  current: number;
}

function statsOf(state: EditorState, found: Span[]): FindStats {
  const sel = state.selection.main;
  const capped = found.length > MAX_COUNT;
  const total = capped ? MAX_COUNT : found.length;
  const at = found.findIndex((m) => m.from === sel.from && m.to === sel.to);
  return { total, capped, current: at >= 0 && at < total ? at + 1 : 0 };
}

/** Conta as ocorrências no intervalo (o arquivo todo, ou só a seleção) e diz qual é a atual. */
export function statsFor(state: EditorState, q: SearchQuery | null, range: Span | null): FindStats {
  if (!q) return { total: 0, capped: false, current: 0 };
  return statsOf(state, matchesIn(state, q, range?.from ?? 0, range?.to ?? state.doc.length, MAX_COUNT + 1));
}

/** Contador e marcas da barra de rolagem numa varredura só (a barra pede os dois a cada mudança). */
export function analyze(state: EditorState, q: SearchQuery | null, range: Span | null): { stats: FindStats; marks: number[] } {
  if (!q) return { stats: { total: 0, capped: false, current: 0 }, marks: [] };
  const found = matchesIn(state, q, range?.from ?? 0, range?.to ?? state.doc.length, MAX_COUNT + 1);
  return { stats: statsOf(state, found), marks: bucketsOf(state, found.slice(0, MAX_COUNT)) };
}

/**
 * Próxima ocorrência a partir da seleção (ou a anterior, com `backwards`), dentro do intervalo. Chegando ao fim, dá a volta (`wrapped`).
 * `null` se não há ocorrência alguma.
 */
export function nextMatch(state: EditorState, q: SearchQuery | null, range: Span | null, backwards: boolean): (Span & { wrapped: boolean }) | null {
  if (!q) return null;
  const lo = range?.from ?? 0;
  const hi = range?.to ?? state.doc.length;
  const sel = state.selection.main;
  const firstIn = (from: number, to: number, last: boolean): Span | null => {
    if (from > to) return null;
    const all = matchesIn(state, q, from, to, last ? Number.MAX_SAFE_INTEGER : 1);
    return (last ? all[all.length - 1] : all[0]) ?? null;
  };
  if (!backwards) {
    const after = firstIn(Math.max(lo, sel.to), hi, false);
    if (after) return { ...after, wrapped: false };
    const start = firstIn(lo, hi, false);
    return start ? { ...start, wrapped: true } : null;
  }
  const before = firstIn(lo, Math.min(hi, sel.from), true);
  if (before) return { ...before, wrapped: false };
  const end = firstIn(lo, hi, true);
  return end ? { ...end, wrapped: true } : null;
}

/**
 * Faixas (0 a `buckets - 1`) da altura do arquivo que têm ocorrência, para as marcas na barra de rolagem. Posição = número da linha, não o
 * deslocamento do texto: o que a barra de rolagem do editor mede é a altura, e linhas têm alturas parecidas.
 */
export function markBuckets(state: EditorState, q: SearchQuery | null, range: Span | null, buckets = MARK_BUCKETS): number[] {
  if (!q) return [];
  return bucketsOf(state, matchesIn(state, q, range?.from ?? 0, range?.to ?? state.doc.length, MAX_COUNT), buckets);
}

function bucketsOf(state: EditorState, found: Span[], buckets = MARK_BUCKETS): number[] {
  const lines = Math.max(1, state.doc.lines);
  const on = new Set<number>();
  for (const m of found) on.add(Math.min(buckets - 1, Math.floor(((state.doc.lineAt(m.from).number - 1) / lines) * buckets)));
  return [...on].sort((a, b) => a - b);
}

/** O texto a preencher ao abrir a busca: a seleção (de uma linha, até 200 caracteres) ou a palavra sob o cursor; senão vazio. */
export function seedText(state: EditorState): string {
  const sel = state.selection.main;
  if (!sel.empty) {
    const s = state.sliceDoc(sel.from, sel.to);
    return s.length <= 200 && !/[\r\n]/.test(s) ? s : '';
  }
  const word = state.wordAt(sel.head);
  return word && word.to - word.from <= 100 ? state.sliceDoc(word.from, word.to) : '';
}
