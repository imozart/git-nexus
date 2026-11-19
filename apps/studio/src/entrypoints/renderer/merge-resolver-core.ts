// Lógica pura (sem Vue) do resolvedor de conflitos: orientação dos lados, rótulos e as escolhas linha a linha.
// O motor da fusão está em @git-nexus/git-core (merge3.ts); aqui só o que a tela decide em cima dele.
import {
  findConflictRegions,
  type MergeChoices,
  type MergeModel,
  type MergeSegment,
  type LineOrigin,
  type PickedLine,
  type ResultLine,
  type MergeResult,
} from '@git-nexus/git-core/pure';

/** As três versões como a tela as chama: "minha" (a do usuário) e "que chega". */
export interface Oriented {
  base: string;
  mine: string;
  theirs: string;
  /** No rebase o Git inverte os lados: a "ours" (estágio 2) é o branch sobre o qual se reaplica e a "theirs" é o commit do usuário. */
  swapped: boolean;
}

/** `ours` e `theirs` são os estágios 2 e 3 do índice. No rebase a versão do usuário é a `theirs`, então os lados trocam. */
export function orient(block: { base: string; ours: string; theirs: string }, rebase: boolean): Oriented {
  return rebase
    ? { base: block.base, mine: block.theirs, theirs: block.ours, swapped: true }
    : { base: block.base, mine: block.ours, theirs: block.theirs, swapped: false };
}

export interface SideLabels {
  /** Como o Git rotulou cada lado nos marcadores (`HEAD`, nome do branch, `abc1234 (assunto)`); vazio se o arquivo não os tem. */
  mine: string;
  theirs: string;
}

/** Rótulos dos lados lidos dos marcadores do arquivo no disco (o primeiro conflito), já na orientação da tela. */
export function sideLabels(working: string | undefined, swapped: boolean): SideLabels {
  const r = working ? findConflictRegions(working)[0] : undefined;
  const ours = r?.oursLabel ?? '';
  const theirs = r?.theirsLabel ?? '';
  return swapped ? { mine: theirs, theirs: ours } : { mine: ours, theirs };
}

// ---------------------------------------------------------------- escolhas por linha

type Pickable = 'mine' | 'theirs';

/** Linhas (0-based, na versão) de um lado que estão marcadas. */
export function selectedLines(picks: readonly PickedLine[] | undefined, side: Pickable | 'base'): Set<number> {
  const set = new Set<number>();
  for (const p of picks ?? []) if (p.from === side) set.add(p.line);
  return set;
}

/** Tem linha digitada à mão (a escolha deixou de ser "linhas dos lados")? */
export const hasTyped = (picks: readonly PickedLine[] | undefined): boolean => !!picks?.some((p) => p.from === 'typed');

/** As linhas da origin vêm antes das minhas na escolha? (só vale quando as duas têm linhas; senão `fallback`.) */
export function theirsFirst(picks: readonly PickedLine[] | undefined, fallback = false): boolean {
  const first = (side: PickedLine['from']) => picks?.findIndex((p) => p.from === side) ?? -1;
  const m = first('mine');
  const t = first('theirs');
  return m >= 0 && t >= 0 ? t < m : fallback;
}

/** Marca ou desmarca uma linha. O resultado é sempre "minhas em ordem" + "da origin em ordem" (ou o inverso, com `first`); linha digitada é descartada. */
export function togglePick(picks: readonly PickedLine[] | undefined, side: Pickable, line: number, first: Pickable = 'mine'): PickedLine[] {
  const sel: Record<Pickable, Set<number>> = { mine: selectedLines(picks, 'mine'), theirs: selectedLines(picks, 'theirs') };
  if (sel[side].has(line)) sel[side].delete(line);
  else sel[side].add(line);
  const order: Pickable[] = first === 'theirs' ? ['theirs', 'mine'] : ['mine', 'theirs'];
  return order.flatMap((s) => [...sel[s]].sort((a, b) => a - b).map((l): PickedLine => ({ from: s, line: l })));
}

/** Linhas digitadas à mão (um texto com uma linha por linha) viram a escolha do conflito. */
export function typedPicks(text: string): PickedLine[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => ({ from: 'typed', text: l }));
}

/** O texto de uma escolha, uma linha por linha (ponto de partida de "editar à mão"). */
export const picksText = (lines: readonly ResultLine[]): string => lines.map((l) => l.text).join('\n');

// ---------------------------------------------------------------- resultado por segmento

export interface SegmentLayout {
  /** Número (1-based) da primeira linha do segmento no resultado (também quando ele não tem linhas). */
  first: number;
  lines: ResultLine[];
  /** Índice, em `result.lines`, da primeira linha do segmento (para achar o HTML realçado dela). */
  offset: number;
}

/** As linhas do resultado separadas por segmento, com a numeração do arquivo final. */
export function layoutResult(model: MergeModel, result: MergeResult): SegmentLayout[] {
  const out: SegmentLayout[] = model.segments.map(() => ({ first: 0, lines: [], offset: 0 }));
  for (const l of result.lines) out[l.segment]!.lines.push(l);
  let at = 0; // as linhas de cada segmento são contíguas e na ordem dos segmentos
  for (const seg of out) {
    seg.offset = at;
    seg.first = at + 1;
    at += seg.lines.length;
  }
  return out;
}

/** O intervalo de linhas do segmento no resultado, para o nome da região ("linhas 42 a 58"). */
export function lineSpan(seg: SegmentLayout): { from: number; to: number } {
  return { from: seg.first, to: Math.max(seg.first, seg.first + seg.lines.length - 1) };
}

/** Conflitos já decididos (têm uma entrada em `picks`). */
export const resolvedCount = (model: MergeModel, choices: MergeChoices): number => model.conflicts.filter((i) => choices.picks[i] !== undefined).length;

export const isChange = (seg: MergeSegment): boolean => seg.kind === 'mine' || seg.kind === 'theirs' || (seg.kind === 'same' && !seg.refined);

/** Símbolo da faixa de origem (cor E símbolo: a cor nunca é a única informação). */
export const ORIGIN_SYMBOL: Record<LineOrigin, string> = { stable: '', mine: 'M', theirs: 'O', both: 'M+O', base: 'B', typed: '✎', pending: 'M' };
