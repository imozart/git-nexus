// Lógica pura (sem Vue) do resolvedor de conflitos: orientação dos lados, rótulos e as escolhas linha a linha.
// O motor da fusão está em @git-nexus/git-core (merge3.ts); aqui só o que a tela decide em cima dele.
import {
  bulkChoices,
  findConflictRegions,
  presetPicks,
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
  // `git checkout -m` (reabrir conflito) rotula os lados só como ours/theirs: isso não diz nada ao usuário
  const generic = (l: string | undefined) => (l === 'ours' || l === 'theirs' ? '' : (l ?? ''));
  const ours = generic(r?.oursLabel);
  const theirs = generic(r?.theirsLabel);
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

// ---------------------------------------------------------------- desfazer e refazer

/** Pilhas de desfazer/refazer das escolhas de UM arquivo (cada estado é um `MergeChoices` imutável). */
export interface ChoiceHistory {
  past: MergeChoices[];
  future: MergeChoices[];
}
export const MAX_HISTORY = 200;
export const emptyHistory = (): ChoiceHistory => ({ past: [], future: [] });

/** Registra `current` como o estado ao qual "desfazer" volta; uma escolha nova zera o "refazer". */
export function recordChange(h: ChoiceHistory, current: MergeChoices): ChoiceHistory {
  return { past: [...h.past.slice(-(MAX_HISTORY - 1)), current], future: [] };
}

export function undoChoice(h: ChoiceHistory, current: MergeChoices): { history: ChoiceHistory; choices: MergeChoices } | null {
  const prev = h.past[h.past.length - 1];
  return prev ? { history: { past: h.past.slice(0, -1), future: [current, ...h.future] }, choices: prev } : null;
}

export function redoChoice(h: ChoiceHistory, current: MergeChoices): { history: ChoiceHistory; choices: MergeChoices } | null {
  const next = h.future[0];
  return next ? { history: { past: [...h.past, current], future: h.future.slice(1) }, choices: next } : null;
}

// ---------------------------------------------------------------- ações em massa e navegação

export type BulkAction = 'pendingMine' | 'pendingTheirs' | 'changesAll' | 'changesMine' | 'changesTheirs';

/** Conflitos ainda sem decisão (índices em `model.segments`). */
export const pendingOf = (model: MergeModel, choices: MergeChoices): number[] => model.conflicts.filter((i) => choices.picks[i] === undefined);

/**
 * Ação em massa sobre o arquivo. `pendingMine`/`pendingTheirs` decidem SÓ os conflitos pendentes (o que o usuário já decidiu não muda);
 * `changesAll`/`changesMine`/`changesTheirs` escolhem quais mudanças sem conflito entram (os conflitos não são tocados).
 */
export function applyBulk(model: MergeModel, choices: MergeChoices, action: BulkAction): MergeChoices {
  if (action === 'pendingMine' || action === 'pendingTheirs') {
    const side = action === 'pendingMine' ? 'mine' : 'theirs';
    const picks = { ...choices.picks };
    for (const idx of pendingOf(model, choices)) picks[idx] = presetPicks(model, idx, side);
    return { ...choices, picks };
  }
  const which = action === 'changesAll' ? 'all' : action === 'changesMine' ? 'mine' : 'theirs';
  return { ...choices, reverted: bulkChoices(model, { conflicts: 'pending', changes: which }).reverted };
}

/** Próximo/anterior conflito a partir de `from` (índice de segmento; `null` = ainda nenhum), dando a volta no arquivo. `null` se não há. */
export function stepConflict(model: MergeModel, choices: MergeChoices, from: number | null, dir: 1 | -1, pendingOnly = false): number | null {
  const list = pendingOnly ? pendingOf(model, choices) : model.conflicts;
  if (!list.length) return null;
  if (from === null) return dir === 1 ? list[0]! : list[list.length - 1]!;
  const after = dir === 1 ? list.find((i) => i > from) : [...list].reverse().find((i) => i < from);
  return after ?? (dir === 1 ? list[0]! : list[list.length - 1]!);
}

// ---------------------------------------------------------------- rascunho

const fnv = (s: string, seed: number): number => {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** Identidade das três versões (já orientadas): se qualquer uma mudar, o rascunho deixa de valer. */
export function draftSignature(o: { base: string; mine: string; theirs: string }): string {
  const all = `${o.base}\u0000${o.mine}\u0000${o.theirs}`;
  return `${o.base.length}.${o.mine.length}.${o.theirs.length}.${fnv(all, 2166136261).toString(36)}${fnv(all, 0x9747b28c).toString(36)}`;
}

const isInt = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
const EOLS = ['mine', 'theirs', 'lf', 'crlf'];

/** Valida (sem confiar no que veio do disco) um `MergeChoices` contra o modelo: devolve o saneado, ou `null` se não casa. */
export function validateChoices(model: MergeModel, raw: unknown): MergeChoices | null {
  const r = raw as { picks?: unknown; reverted?: unknown; eol?: unknown } | null;
  if (!r || typeof r !== 'object' || typeof r.picks !== 'object' || !r.picks || !Array.isArray(r.reverted) || !EOLS.includes(r.eol as string)) return null;
  const picks: Record<number, PickedLine[]> = {};
  for (const [k, list] of Object.entries(r.picks as Record<string, unknown>)) {
    const idx = Number(k);
    const seg = model.segments[idx];
    if (!isInt(idx) || !seg || seg.kind !== 'conflict' || !Array.isArray(list)) return null;
    const out: PickedLine[] = [];
    for (const p of list as Array<Record<string, unknown>>) {
      if (p?.from === 'typed' && typeof p.text === 'string') out.push({ from: 'typed', text: p.text });
      else if ((p?.from === 'mine' || p?.from === 'theirs' || p?.from === 'base') && isInt(p.line) && p.line >= seg[p.from].start && p.line < seg[p.from].end) out.push({ from: p.from, line: p.line });
      else return null;
    }
    picks[idx] = out;
  }
  const reverted: number[] = [];
  for (const i of r.reverted) {
    if (!isInt(i) || !model.changes.includes(i)) return null;
    reverted.push(i);
  }
  return { picks, reverted, eol: r.eol as MergeChoices['eol'] };
}

export type DraftLoad = { status: 'none' } | { status: 'stale' } | { status: 'ok'; choices: MergeChoices };

/** Texto guardado do rascunho (`null` quando não há nada a guardar: nenhuma escolha feita). */
export function serializeDraft(sig: string, choices: MergeChoices): string | null {
  const empty = !Object.keys(choices.picks).length && !choices.reverted.length && choices.eol === 'mine';
  return empty ? null : JSON.stringify({ v: 1, sig, choices, at: Date.now() });
}

/** Lê um rascunho: `stale` quando as versões mudaram (a assinatura não bate) ou o conteúdo não casa com o modelo. */
export function parseDraft(raw: string | null, sig: string, model: MergeModel): DraftLoad {
  if (!raw) return { status: 'none' };
  try {
    const d = JSON.parse(raw) as { v?: unknown; sig?: unknown; choices?: unknown };
    if (d.v !== 1 || d.sig !== sig) return { status: 'stale' };
    const choices = validateChoices(model, d.choices);
    return choices ? { status: 'ok', choices } : { status: 'stale' };
  } catch {
    return { status: 'stale' };
  }
}

/** Como o arquivo aparece na lista: quantos conflitos tem e quantos já foram decididos (pelo rascunho). `null` em `conflicts` = não calculado. */
export function fileSummary(model: MergeModel | null, choices: MergeChoices | null): { conflicts: number | null; resolved: number } {
  if (!model) return { conflicts: null, resolved: 0 };
  return { conflicts: model.conflicts.length, resolved: choices ? resolvedCount(model, choices) : 0 };
}
