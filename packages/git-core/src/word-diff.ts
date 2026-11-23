// Diferença DENTRO da linha (por palavra) e conflitos que só diferem em espaço. Puro: roda no renderer.
//
// A tela do resolvedor usa isto para destacar a vírgula ou o nome que mudou entre a versão do usuário e a que chega, e para
// reconhecer o conflito que existe só porque uma das versões reindentou o trecho ("ignorar diferença de espaços").

import { diffHunks, diffLines } from './line-diff.js';
import type { MergeModel } from './merge3.js';

/** Trecho `[start, end)` de uma linha, em unidades UTF-16 (os índices de `String`). */
export interface CharRange {
  start: number;
  end: number;
}

export interface WordDiff {
  a: CharRange[];
  b: CharRange[];
}

/** Acima disto a linha não é comparada por palavra (custo): a tela só mostra a linha inteira como diferente. */
export const MAX_WORD_DIFF_CHARS = 2000;
/** Acima disto o conflito não ganha destaque por palavra (a comparação linha a linha já custa o bastante). */
export const MAX_MARKED_LINES = 400;

interface Token {
  text: string;
  start: number;
  end: number;
  space: boolean;
}

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  for (const m of s.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    out.push({ text: m[0], start, end: start + m[0].length, space: /^\s/u.test(m[0]) });
  }
  return out;
}

/** O texto sem nenhum espaço em branco (a chave de "só difere em espaço"). */
export const squashSpace = (s: string): string => s.replace(/\s+/gu, '');

/** Une trechos que se tocam ou que só têm espaço entre si ("one two three" é um destaque só, não três). */
function merge(ranges: CharRange[], text: string): CharRange[] {
  const out: CharRange[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && (r.start <= last.end || /^\s*$/u.test(text.slice(last.end, r.start)))) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/**
 * O que mudou entre duas linhas, por palavra (palavra = letras/dígitos seguidos; cada símbolo e cada trecho de espaço é uma peça).
 * Com `ignoreSpace` os espaços não contam: duas linhas que só diferem neles não têm destaque nenhum.
 */
export function wordDiff(a: string, b: string, opts: { ignoreSpace?: boolean } = {}): WordDiff {
  if (a === b || a.length > MAX_WORD_DIFF_CHARS || b.length > MAX_WORD_DIFF_CHARS) return { a: [], b: [] };
  const keep = (t: Token) => !(opts.ignoreSpace && t.space);
  const ta = tokenize(a).filter(keep);
  const tb = tokenize(b).filter(keep);
  const ra: CharRange[] = [];
  const rb: CharRange[] = [];
  for (const h of diffHunks(ta.map((t) => t.text), tb.map((t) => t.text))) {
    if (h.aEnd > h.aStart) ra.push({ start: ta[h.aStart]!.start, end: ta[h.aEnd - 1]!.end });
    if (h.bEnd > h.bStart) rb.push({ start: tb[h.bStart]!.start, end: tb[h.bEnd - 1]!.end });
  }
  return { a: merge(ra, a), b: merge(rb, b) };
}

/**
 * Junta, por palavra, duas edições da MESMA linha (`base` → `mine` e `base` → `theirs`): só quando os trechos que mudaram não se
 * tocam (há pelo menos uma peça intacta entre eles: um mudou o começo da linha e o outro o fim). Se os dois mexeram no mesmo lugar,
 * ou em peças coladas, devolve `null`: quem decide é o usuário. Mudança idêntica dos dois lados vale uma vez.
 */
export function mergeWords(base: string, mine: string, theirs: string): string | null {
  if (mine === theirs) return mine;
  if (mine === base) return theirs;
  if (theirs === base) return mine;
  if (base.length > MAX_WORD_DIFF_CHARS || mine.length > MAX_WORD_DIFF_CHARS || theirs.length > MAX_WORD_DIFF_CHARS) return null;
  const tb = tokenize(base).map((t) => t.text);
  const tm = tokenize(mine).map((t) => t.text);
  const tt = tokenize(theirs).map((t) => t.text);
  interface Edit {
    aStart: number;
    aEnd: number;
    text: string;
  }
  const edits = (tokens: string[]): Edit[] => diffHunks(tb, tokens).map((h) => ({ aStart: h.aStart, aEnd: h.aEnd, text: tokens.slice(h.bStart, h.bEnd).join('') }));
  const all = [...edits(tm), ...edits(tt)].sort((x, y) => x.aStart - y.aStart || x.aEnd - y.aEnd);
  const out: Edit[] = [];
  for (const e of all) {
    const last = out[out.length - 1];
    if (last && last.aStart === e.aStart && last.aEnd === e.aEnd && last.text === e.text) continue; // a mesma mudança dos dois lados
    if (last && e.aStart <= last.aEnd) return null; // se tocam ou se sobrepõem
    out.push(e);
  }
  let text = '';
  let pos = 0;
  for (const e of out) {
    text += tb.slice(pos, e.aStart).join('') + e.text;
    pos = e.aEnd;
  }
  return text + tb.slice(pos).join('');
}

export interface ConflictMarks {
  /** Por linha (0-based, dentro do trecho do conflito): o que mudou naquela linha. */
  mine: Map<number, CharRange[]>;
  theirs: Map<number, CharRange[]>;
}

/**
 * Destaque por palavra das duas versões de um trecho: as linhas são pareadas pelo diff (as que mudaram de um lado para o outro) e
 * cada par é comparado por palavra. Linha que só existe de um lado não ganha destaque por palavra (ela inteira já é a diferença).
 */
export function pairMarks(mine: readonly string[], theirs: readonly string[], opts: { ignoreSpace?: boolean } = {}): ConflictMarks {
  const out: ConflictMarks = { mine: new Map(), theirs: new Map() };
  if (mine.length > MAX_MARKED_LINES || theirs.length > MAX_MARKED_LINES) return out;
  const key = (l: string) => (opts.ignoreSpace ? squashSpace(l) : l);
  const rows = diffLines(mine.map(key), theirs.map(key));
  for (const r of rows) {
    if (r.kind !== 'change') continue;
    const mi = r.oldNo! - 1;
    const ti = r.newNo! - 1;
    const d = wordDiff(mine[mi]!, theirs[ti]!, opts);
    if (d.a.length) out.mine.set(mi, d.a);
    if (d.b.length) out.theirs.set(ti, d.b);
  }
  return out;
}

/**
 * Conflitos (índices de segmento) cujas duas versões só diferem em espaço em branco: reindentação, espaço no fim da linha, linha em
 * branco a mais. É o que "ignorar diferença de espaços" reclassifica e o que dá para resolver de uma vez.
 */
export function spaceOnlyConflicts(model: MergeModel): number[] {
  return model.conflicts.filter((idx) => {
    const seg = model.segments[idx]!;
    const join = (side: 'mine' | 'theirs') => squashSpace(model[side].lines.slice(seg[side].start, seg[side].end).join('\n'));
    return join('mine') === join('theirs');
  });
}
