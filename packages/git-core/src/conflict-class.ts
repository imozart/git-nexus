// Conflitos "simples": os que têm uma saída óbvia e que dá para resolver sem adivinhar (puro: roda no renderer).
//
// Cada conflito do modelo (`merge3.ts`) é classificado por regras determinísticas, sem IA. A classificação só devolve uma SUGESTÃO
// (as linhas que ficariam); quem aplica é a tela, depois de mostrar a lista com o motivo e de o usuário confirmar. O que não cabe
// numa das classes abaixo devolve `null` e fica para decisão do usuário: nada é "adivinhado".
//
//   space       só difere em espaço em branco (reindentação, espaço no fim, linha em branco a mais)  → a minha
//   reformat    um lado só reformatou (espaço) e o outro mudou de verdade                           → o lado que mudou
//   removed     um lado apagou o trecho e o outro só reformatou                                      → a remoção
//   neighbors   edições em linhas vizinhas que não se sobrepõem (o Git marca por vizinhança)         → as duas edições
//   insertions  inserções diferentes no mesmo ponto (item de lista, import, configuração)            → as duas
//   words       cada lado mudou uma ponta diferente da mesma linha                                   → combinadas por palavra

import { diffHunks, type DiffHunk } from './line-diff.js';
import type { MergeModel, PickedLine } from './merge3.js';
import { mergeWords, squashSpace } from './word-diff.js';

export type SimpleKind = 'space' | 'reformat' | 'removed' | 'neighbors' | 'insertions' | 'words';

export interface Suggestion {
  kind: SimpleKind;
  /** As linhas que o conflito passa a ter (a escolha que a tela grava). */
  picks: PickedLine[];
  /** `insertions`: qual inserção vem primeiro (a ordem em que a lista fica ordenada, ou a minha antes da que chega). */
  order?: 'mine-first' | 'theirs-first';
}

/** Inserções maiores que isto já não são "um item de lista": ficam para o usuário. */
export const MAX_INSERT_LINES = 30;
/** Acima disto o conflito não é classificado (o custo não compensa e conflito grande não é "simples"). */
export const MAX_CLASSIFY_LINES = 400;

type Side = 'mine' | 'theirs';
interface Hunk extends DiffHunk {
  side: Side | 'both';
}

const squashed = (lines: readonly string[]): string => squashSpace(lines.join('\n'));
const nonBlank = (l: string): boolean => l.trim() !== '';

/** A lista com as linhas do segmento de uma versão, como `PickedLine`. */
const pickAll = (side: Side, range: { start: number; end: number }): PickedLine[] => Array.from({ length: range.end - range.start }, (_, k) => ({ from: side, line: range.start + k }));

function lineHunks(model: MergeModel, idx: number): { picks: PickedLine[]; kind: 'neighbors' | 'insertions'; order?: Suggestion['order'] } | null {
  const seg = model.segments[idx]!;
  const bk = model.base.keys.slice(seg.base.start, seg.base.end);
  const mk = model.mine.keys.slice(seg.mine.start, seg.mine.end);
  const tk = model.theirs.keys.slice(seg.theirs.start, seg.theirs.end);
  const hm = diffHunks(bk, mk);
  const ht = diffHunks(bk, tk);
  const same = (a: DiffHunk, b: DiffHunk) =>
    a.aStart === b.aStart && a.aEnd === b.aEnd && a.bEnd - a.bStart === b.bEnd - b.bStart && mk.slice(a.bStart, a.bEnd).every((k, i) => k === tk[b.bStart + i]);

  // as mudanças dos dois lados em ordem; a mesma mudança nos dois lados entra uma vez
  const all: Hunk[] = [];
  for (const h of hm) all.push({ ...h, side: ht.some((o) => same(h, o)) ? 'both' : 'mine' });
  for (const h of ht) if (!hm.some((o) => same(o, h))) all.push({ ...h, side: 'theirs' });
  all.sort((a, b) => a.aStart - b.aStart || a.aEnd - b.aEnd || (a.side === 'mine' ? -1 : 1));
  if (!all.length) return null;

  let touching = false;
  let insertionsOnly = true;
  let samePoint = false;
  for (let i = 0; i < all.length; i++) {
    const h = all[i]!;
    insertionsOnly &&= h.aEnd === h.aStart;
    const prev = all[i - 1];
    if (!prev) continue;
    if (h.aStart < prev.aEnd) return null; // se sobrepõem (ou uma inserção cai no meio do trecho que o outro lado mudou): conflito de verdade
    if (h.aStart === prev.aEnd) {
      touching = true;
      if (prev.aStart === prev.aEnd && h.aStart === h.aEnd && prev.side !== h.side) samePoint = true;
    }
  }
  if (!touching) return null;

  const sameInsertPoint = samePoint && insertionsOnly;
  if (sameInsertPoint) {
    // os dois só inseriram, no mesmo ponto: precisa de algo em volta (senão são dois arquivos novos), blocos pequenos e sem linha repetida
    const hasContext = seg.base.start > 0 || seg.base.end < model.base.lines.length;
    const a = all.filter((h) => h.side === 'mine');
    const b = all.filter((h) => h.side === 'theirs');
    if (!hasContext || all.length !== 2 || a.length !== 1 || b.length !== 1) return null;
    const mineLines = model.mine.lines.slice(seg.mine.start + a[0]!.bStart, seg.mine.start + a[0]!.bEnd);
    const theirsLines = model.theirs.lines.slice(seg.theirs.start + b[0]!.bStart, seg.theirs.start + b[0]!.bEnd);
    if (mineLines.length > MAX_INSERT_LINES || theirsLines.length > MAX_INSERT_LINES) return null;
    const have = new Set(mineLines.filter(nonBlank));
    if (theirsLines.some((l) => nonBlank(l) && have.has(l))) return null; // juntar repetiria linha
    // ordem sugerida: a que mantém a lista ordenada (com as linhas em volta); sem isso, a minha primeiro
    const before = seg.base.start > 0 ? model.base.lines[seg.base.start - 1] : undefined;
    const after = seg.base.end < model.base.lines.length ? model.base.lines[seg.base.end] : undefined;
    const sorted = (xs: Array<string | undefined>) => {
      const ys = xs.filter((x): x is string => x !== undefined);
      return ys.every((y, i) => i === 0 || ys[i - 1]! <= y);
    };
    const theirsFirst = !sorted([before, ...mineLines, ...theirsLines, after]) && sorted([before, ...theirsLines, ...mineLines, after]);
    const m = pickAll('mine', { start: seg.mine.start + a[0]!.bStart, end: seg.mine.start + a[0]!.bEnd });
    const t = pickAll('theirs', { start: seg.theirs.start + b[0]!.bStart, end: seg.theirs.start + b[0]!.bEnd });
    return { kind: 'insertions', picks: theirsFirst ? [...t, ...m] : [...m, ...t], order: theirsFirst ? 'theirs-first' : 'mine-first' };
  }

  // edições vizinhas: o que não mudou vem da minha versão (cada linha mantém o seu fim de linha), cada mudança do lado de onde veio
  const mineIndex = (baseLine: number): number => {
    let shift = 0;
    for (const h of hm) if (h.aEnd <= baseLine) shift += h.bEnd - h.bStart - (h.aEnd - h.aStart);
    return seg.mine.start + baseLine + shift;
  };
  const picks: PickedLine[] = [];
  let pos = 0;
  const keep = (to: number) => {
    for (; pos < to; pos++) picks.push({ from: 'mine', line: mineIndex(pos) });
  };
  for (const h of all) {
    keep(h.aStart);
    const from: Side = h.side === 'theirs' ? 'theirs' : 'mine';
    const start = (from === 'mine' ? seg.mine.start : seg.theirs.start) + h.bStart;
    picks.push(...pickAll(from, { start, end: start + (h.bEnd - h.bStart) }));
    pos = h.aEnd;
  }
  keep(bk.length);
  return { kind: 'neighbors', picks };
}

/** Cada lado mudou uma ponta diferente da mesma linha: junta por palavra (só quando as três versões têm as mesmas linhas, uma a uma). */
function wordMerged(model: MergeModel, idx: number): PickedLine[] | null {
  const seg = model.segments[idx]!;
  const n = seg.base.end - seg.base.start;
  if (n === 0 || seg.mine.end - seg.mine.start !== n || seg.theirs.end - seg.theirs.start !== n) return null;
  const out: PickedLine[] = [];
  let combined = false;
  for (let i = 0; i < n; i++) {
    const b = model.base.lines[seg.base.start + i]!;
    const m = model.mine.lines[seg.mine.start + i]!;
    const t = model.theirs.lines[seg.theirs.start + i]!;
    if (m === t || t === b) out.push({ from: 'mine', line: seg.mine.start + i });
    else if (m === b) out.push({ from: 'theirs', line: seg.theirs.start + i });
    else {
      const merged = mergeWords(b, m, t);
      if (merged === null) return null;
      out.push({ from: 'typed', text: merged });
      combined = true;
    }
  }
  return combined ? out : null;
}

/** A sugestão para um conflito (índice do segmento), ou `null` se ele não cabe numa das classes simples. */
export function suggestConflict(model: MergeModel, idx: number): Suggestion | null {
  const seg = model.segments[idx];
  if (!seg || seg.kind !== 'conflict') return null;
  if (seg.base.end - seg.base.start > MAX_CLASSIFY_LINES || seg.mine.end - seg.mine.start > MAX_CLASSIFY_LINES || seg.theirs.end - seg.theirs.start > MAX_CLASSIFY_LINES) return null;
  const base = model.base.lines.slice(seg.base.start, seg.base.end);
  const mine = model.mine.lines.slice(seg.mine.start, seg.mine.end);
  const theirs = model.theirs.lines.slice(seg.theirs.start, seg.theirs.end);
  const sb = squashed(base);
  const sm = squashed(mine);
  const st = squashed(theirs);

  if (sm === st) return { kind: 'space', picks: pickAll('mine', seg.mine) };
  // um lado só reformatou: vale o outro (e se o outro apagou o trecho, é a remoção)
  if (sb === sm) return { kind: theirs.length ? 'reformat' : 'removed', picks: pickAll('theirs', seg.theirs) };
  if (sb === st) return { kind: mine.length ? 'reformat' : 'removed', picks: pickAll('mine', seg.mine) };

  const lines = lineHunks(model, idx);
  if (lines) return { kind: lines.kind, picks: lines.picks, ...(lines.order ? { order: lines.order } : {}) };
  const words = wordMerged(model, idx);
  return words ? { kind: 'words', picks: words } : null;
}

/** As sugestões de todos os conflitos do arquivo que cabem numa classe simples (índice do segmento → sugestão). */
export function suggestions(model: MergeModel): Map<number, Suggestion> {
  const out = new Map<number, Suggestion>();
  for (const idx of model.conflicts) {
    const s = suggestConflict(model, idx);
    if (s) out.set(idx, s);
  }
  return out;
}
