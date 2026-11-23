<script setup lang="ts">
// Novo resolvedor de conflitos (issue #231): o ARQUIVO COMO VAI FICAR em foco, com cada conflito dentro dele como um cartão.
// O texto vem sempre do modelo de escolhas (resolveMerge, do núcleo), nunca é editado "no escuro" e nunca tem marcador.
// Fase 3: navegação entre conflitos, régua lateral, ações em massa, desfazer/refazer, rascunho automático e atalhos na paleta (Ctrl+K).
// Fase 6: conflitos simples (sugestão determinística por cartão e "resolver os simples" com a lista e o motivo, só depois de confirmar) e o
// arquivo que o Git já preencheu com uma resolução gravada (rerere): aceitar, revisar/editar ou esquecer.
// Fase 5: visão lado a lado (minha | resultado | a que chega) sobre o MESMO modelo de escolhas, destaque por palavra, ignorar espaços,
// caracteres invisíveis, fim de linha das versões (e do resultado) e histórico do trecho.
import { computed, nextTick, onBeforeUnmount, onMounted, onUpdated, reactive, ref, watch } from 'vue';
import { GnButton, GnIconButton, GnSegmented, GnTooltip } from '@git-nexus/ui-kit';
import {
  buildMerge,
  emptyChoices,
  hasMixedEol,
  pairMarks,
  presetPicks,
  resolveMerge,
  spaceOnlyConflicts,
  suggestions,
  summarizePicks,
  type ConflictHistoryEntry,
  type ConflictMarks,
  type ConflictPreset,
  type MergeChoices,
  type MergeConflictBlock,
  type PickedLine,
  type ResultLine,
  type Suggestion,
} from '@git-nexus/git-core/pure';
import MergeLines from './MergeLines.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import ContextMenu, { type MenuItem } from './ContextMenu.vue';
import { highlightLines } from '../syntax-lines';
import { api, errMsg } from '../api';
import { eolInfo, eolName, historyLine, LINE_PX, markHtml, MIN_SIDE_BY_SIDE, showInvisibles } from '../merge-compare-core';
import { mergeIgnoreSpace, mergeShowInvisibles, mergeSideBySide } from '../merge-view-prefs';
import { clearDraft, loadDraft, saveDraft } from '../merge-draft';
import {
  applyBulk,
  deriveChoices,
  draftSignature,
  emptyHistory,
  hasTyped,
  isChange,
  layoutResult,
  lineSpan,
  orient,
  pendingOf,
  pendingSimple,
  pendingSpaceOnly,
  picksText,
  recordChange,
  recordedDiff,
  redoChoice,
  resolvedCount,
  selectedLines,
  sideLabels,
  SIMPLE_REASON,
  SIMPLE_WHAT,
  stepConflict,
  theirsFirst,
  togglePick,
  typedPicks,
  undoChoice,
  type BulkAction,
  type ChoiceHistory,
} from '../merge-resolver-core';
import { useCommandsStore, shortcutLabel, type Command } from '../stores/commands';
import { useWorkspaceStore } from '../stores/workspace';
import { t, dateLocale, locale, type MessageKey } from '../i18n';

const props = defineProps<{
  block: MergeConflictBlock;
  busy?: boolean;
  /** Rebase: o Git inverte os lados (a "ours" é o branch de destino). */
  rebase?: boolean;
  /** Id do repositório (aba ativa dos atalhos) e chave do rascunho. */
  repoId: string;
  draftKey?: string;
  /** Caminho do repositório (histórico do trecho). */
  repoPath?: string;
}>();
const emit = defineEmits<{ (e: 'resolve', merged: string): void; (e: 'forget'): void }>();

const cmds = useCommandsStore();
const ws = useWorkspaceStore();

const oriented = computed(() => orient(props.block, !!props.rebase));
const model = computed(() => buildMerge(oriented.value));
const labels = computed(() => sideLabels(props.block.workingContent, oriented.value.swapped));
const sig = computed(() => draftSignature(oriented.value));

const choices = ref<MergeChoices>(emptyChoices());
const history = ref<ChoiceHistory>(emptyHistory());
const result = computed(() => resolveMerge(model.value, choices.value));
const layout = computed(() => layoutResult(model.value, result.value));

// realce de sintaxe: o resultado inteiro (para as linhas do fluxo) e cada versão (para as linhas dos cartões)
const file = computed(() => props.block.filePath);
const hlResult = computed(() => highlightLines(result.value.lines.map((l) => l.text), file.value));
const hlMine = computed(() => highlightLines(model.value.mine.lines, file.value));
const hlTheirs = computed(() => highlightLines(model.value.theirs.lines, file.value));
const hlBase = computed(() => highlightLines(model.value.base.lines, file.value));

// ---------------------------------------------------------------- comparação: palavra, espaço, invisíveis, fim de linha

/** Conflitos cujas duas versões só diferem em espaço: só são reclassificados com "ignorar espaços" ligado. */
const spaceOnly = computed(() => (mergeIgnoreSpace.value ? new Set(spaceOnlyConflicts(model.value)) : new Set<number>()));
const spaceOnlyPending = computed(() => (mergeIgnoreSpace.value ? pendingSpaceOnly(model.value, choices.value).length : 0));
/** Destaque por palavra do trecho de cada conflito, calculado só quando o cartão aparece (e guardado enquanto o modelo e a opção não mudam). */
const wordMarks = computed(() => {
  const cache = new Map<number, ConflictMarks>();
  const m3 = model.value; // lidos aqui para o cache valer só enquanto o modelo e a opção forem os mesmos
  const ignoreSpace = mergeIgnoreSpace.value;
  return (idx: number): ConflictMarks => {
    let m = cache.get(idx);
    if (!m) {
      const seg = m3.segments[idx]!;
      m = pairMarks(m3.mine.lines.slice(seg.mine.start, seg.mine.end), m3.theirs.lines.slice(seg.theirs.start, seg.theirs.end), { ignoreSpace });
      cache.set(idx, m);
    }
    return m;
  };
});
/** O HTML de uma linha de uma das versões: realce de sintaxe + o que mudou dentro da linha + invisíveis (se ligado). `n` é o índice absoluto da linha. */
function lineHtml(side: 'mine' | 'theirs', idx: number, n: number): string {
  const base = (side === 'mine' ? hlMine : hlTheirs).value[n] ?? '';
  const html = markHtml(base, wordMarks.value(idx)[side].get(n - model.value.segments[idx]![side].start));
  return (mergeShowInvisibles.value ? showInvisibles(html, model.value[side].eols[n] ?? '') : html) || '&nbsp;';
}
const toggleSplit = () => (mergeSideBySide.value = !mergeSideBySide.value);
const toggleIgnoreSpace = () => (mergeIgnoreSpace.value = !mergeIgnoreSpace.value);
const toggleInvisibles = () => (mergeShowInvisibles.value = !mergeShowInvisibles.value);
/** Linha de uma versão fora de um conflito (sem destaque por palavra): realce de sintaxe e, se ligado, invisíveis. */
function plainHtml(side: 'mine' | 'theirs', n: number): string {
  const base = (side === 'mine' ? hlMine : hlTheirs).value[n] ?? '';
  return (mergeShowInvisibles.value ? showInvisibles(base, model.value[side].eols[n] ?? '') : base) || '&nbsp;';
}
const COLS = ['mine', 'result', 'theirs'] as const;
const connH = (idx: number) => {
  const seg = model.value.segments[idx]!;
  return Math.max(seg.mine.end - seg.mine.start, seg.theirs.end - seg.theirs.start, layout.value[idx]!.lines.length, 1) * LINE_PX;
};
const eol = computed(() => eolInfo(model.value));
const mixedEol = computed(() => hasMixedEol(result.value.lines));
const eolOptions = computed(() => [
  { value: 'mine', label: t('mr.eol.mine', { eol: eol.value.mine || 'LF' }) },
  { value: 'theirs', label: t('mr.eol.theirs', { eol: eol.value.theirs || 'LF' }) },
  { value: 'lf', label: t('mr.eol.lf') },
  { value: 'crlf', label: t('mr.eol.crlf') },
]);
function setEol(v: string): void {
  if (v === choices.value.eol || !['mine', 'theirs', 'lf', 'crlf'].includes(v)) return;
  commit({ ...choices.value, eol: v as MergeChoices['eol'] });
}

// ---------------------------------------------------------------- conflitos simples (sugestões determinísticas, sem IA)

const simpleMap = computed(() => suggestions(model.value));
/** A sugestão de um conflito ainda pendente (o decidido pelo usuário nunca é sugerido de novo). */
const suggestionOf = (idx: number): Suggestion | undefined => (stateOf(idx) === 'pending' ? simpleMap.value.get(idx) : undefined);
const simpleItems = computed(() => pendingSimple(model.value, choices.value));
const reasonText = (s: Suggestion): string => t(SIMPLE_REASON[s.kind] as MessageKey);
const whatText = (s: Suggestion): string => t((s.kind === 'insertions' && s.order === 'theirs-first' ? 'mr.simpleWhat.insertionsTheirs' : SIMPLE_WHAT[s.kind]) as MessageKey);
const suggestionTip = (s: Suggestion): string => t('mr.suggestTip', { reason: reasonText(s), what: whatText(s) });
function applySuggestion(idx: number): void {
  const s = simpleMap.value.get(idx);
  if (!s) return;
  activeIdx.value = idx;
  setPicks(idx, s.picks);
  expanded.delete(idx);
}
const askingSimple = ref(false);
const SIMPLE_LIST_MAX = 10;
/** A lista do diálogo: cada conflito com o motivo e o que será aplicado (nada é aplicado sem esta confirmação). */
const simpleLines = computed(() => {
  const items = simpleItems.value;
  const rows = items.slice(0, SIMPLE_LIST_MAX).map(({ idx, suggestion }) =>
    t('mr.simpleItem', { i: conflictNo(idx), span: spanText(idx), reason: reasonText(suggestion), what: whatText(suggestion) }),
  );
  if (items.length > SIMPLE_LIST_MAX) rows.push(t('mr.simpleMore', { n: items.length - SIMPLE_LIST_MAX }));
  return [t('mr.simpleBody', { n: items.length }), ...rows, t('mr.simpleKeep')];
});

// ---------------------------------------------------------------- resolução gravada pelo Git (rerere)

/** `banner`: o Git preencheu o arquivo e a tela pergunta o que fazer; `reviewing`: aberto para revisão; `inexact`: não deu para separar por conflito. */
const rr = ref<'banner' | 'reviewing' | 'inexact' | null>(props.block.rerere ? 'banner' : null);
watch(() => props.block.rerere?.recordedAt, (v) => (rr.value = v ? 'banner' : null));
const rrDate = computed(() => {
  const d = new Date(props.block.rerere?.recordedAt ?? '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(dateLocale.value, { day: '2-digit', month: '2-digit' });
});
const RR_DIFF_MAX = 30;
/** O que a resolução gravada mudou em relação a ficar com a minha versão, linha a linha (a mais e a menos). */
const rrDiff = computed(() => {
  if (!props.block.rerere) return [] as Array<{ sign: '+' | '−'; text: string }>;
  const out: Array<{ sign: '+' | '−'; text: string }> = [];
  for (const r of recordedDiff(model.value, props.block.workingContent ?? '')) {
    if (r.oldText !== undefined) out.push({ sign: '−', text: r.oldText });
    if (r.newText !== undefined) out.push({ sign: '+', text: r.newText });
  }
  return out;
});
const pendingAccept = ref(false);
/** Aceitar: o arquivo como o Git o deixou (com o aviso de fim de linha misto, se for o caso). */
function acceptRecorded(): void {
  const w = props.block.workingContent;
  if (w === undefined) return;
  if (/\r\n/.test(w) && /(^|[^\r])\n/.test(w)) {
    pendingAccept.value = true;
    askingMixed.value = true;
  } else emit('resolve', w);
}
/** Esquecer: o conflito volta ao original (com os marcadores), então as escolhas abertas na revisão deixam de valer. */
function forgetRecorded(): void {
  if (rr.value === 'reviewing') {
    choices.value = emptyChoices();
    history.value = emptyHistory();
  }
  emit('forget');
}
/** Revisar/editar: cada conflito já vem decidido como a resolução gravada (se o arquivo não se explicar por escolhas, avisa e não inventa). */
function reviewRecorded(): void {
  const c = deriveChoices(model.value, props.block.workingContent ?? '');
  if (!c) {
    rr.value = 'inexact';
    return;
  }
  commit(c);
  rr.value = 'reviewing';
  expanded.clear();
  void nextTick(() => goTo(model.value.conflicts[0] ?? null));
}

// ---------------------------------------------------------------- lado a lado

const root = ref<HTMLElement>();
const width = ref(Infinity);
/** Em pouca largura a visão lado a lado se desliga e a padrão assume (nada de rolagem horizontal escondendo a decisão). */
const split = computed(() => mergeSideBySide.value && width.value >= MIN_SIDE_BY_SIDE);
const splitNarrow = computed(() => mergeSideBySide.value && !split.value);
/** Trechos iguais e longos ficam dobrados no lado a lado (o arquivo inteiro em três colunas seria pesado e cansativo). */
const FOLD_OVER = 12;
const unfolded = reactive(new Set<number>());
const isFolded = (idx: number) => {
  const seg = model.value.segments[idx]!;
  return seg.kind === 'stable' && seg.mine.end - seg.mine.start > FOLD_OVER && !unfolded.has(idx);
};
/** Na visão padrão o trecho igual e longo mostra só estas linhas de contexto em cada ponta; o meio dobra ("N linhas iguais") e abre sob demanda. É o que mantém um arquivo de dezenas de milhares de linhas rápido: o DOM só tem o que o usuário vai olhar. */
const CONTEXT_LINES = 3;
interface FoldView {
  head: { lines: ResultLine[]; first: number; offset: number };
  tail: { lines: ResultLine[]; first: number; offset: number };
  hidden: number;
}
/** As pontas visíveis de um trecho igual dobrado na visão padrão, ou `null` quando ele aparece inteiro (curto, ou o usuário abriu). */
function foldView(idx: number): FoldView | null {
  const seg = model.value.segments[idx]!;
  const l = layout.value[idx]!;
  if (seg.kind !== 'stable' || unfolded.has(idx) || l.lines.length <= FOLD_OVER) return null;
  const cut = l.lines.length - CONTEXT_LINES;
  return {
    head: { lines: l.lines.slice(0, CONTEXT_LINES), first: l.first, offset: l.offset },
    tail: { lines: l.lines.slice(cut), first: l.first + cut, offset: l.offset + cut },
    hidden: cut - CONTEXT_LINES,
  };
}
/** Polígono do conector entre uma coluna lateral e a do resultado, desenhado com a altura real das linhas (a esquerda liga a minha ao resultado; a direita, o resultado à que chega). */
function connPath(side: 'left' | 'right', idx: number): string {
  const seg = model.value.segments[idx]!;
  const r = side === 'left' ? seg.mine : seg.theirs;
  const a = (r.end - r.start) * LINE_PX;
  const b = layout.value[idx]!.lines.length * LINE_PX;
  const [l, rt] = side === 'left' ? [a, b] : [b, a];
  return `M0 0 L26 0 L26 ${rt} L0 ${l} Z`;
}
/** Tom do conector: o estado do conflito, ou de quem veio a mudança. */
const connTone = (idx: number): string => {
  const seg = model.value.segments[idx]!;
  return seg.kind === 'conflict' ? (stateOf(idx) === 'pending' ? 'pending' : 'resolved') : seg.kind;
};

// ---------------------------------------------------------------- histórico do trecho (sob demanda)

const lineHistory = reactive<Record<string, { state: 'loading' | 'ok' | 'none'; text: string }>>({});
const historyKey = (idx: number, side: 'mine' | 'theirs') => `${idx}:${side}`;
async function showHistory(idx: number, side: 'mine' | 'theirs'): Promise<void> {
  const seg = model.value.segments[idx]!;
  const r = seg[side];
  if (!props.repoPath || r.end <= r.start) return;
  const k = historyKey(idx, side);
  lineHistory[k] = { state: 'loading', text: '' };
  // na orientação da tela "minha" é o estágio 2 (ours); no rebase o Git inverte e "minha" é o estágio 3
  const stage = (side === 'mine') !== oriented.value.swapped ? 'ours' : 'theirs';
  try {
    const h: ConflictHistoryEntry | null = await api.getConflictHistory(props.repoPath, props.block.filePath, stage, r.start + 1, r.end);
    lineHistory[k] = h ? { state: 'ok', text: historyLine(h, dateLocale.value) } : { state: 'none', text: '' };
  } catch (e) {
    lineHistory[k] = { state: 'none', text: errMsg(e) };
  }
}

// estado só da tela: cartões abertos, base aberta, ordem (a origin primeiro), edição à mão, conflito ativo
const expanded = reactive(new Set<number>());
const baseOpen = reactive(new Set<number>());
const swapped = reactive(new Set<number>());
const editing = ref<number | null>(null);
const editText = ref('');
const activeIdx = ref<number | null>(null);
const live = ref('');
const notice = ref<'restored' | 'stale' | null>(null);
const scroller = ref<HTMLElement>();
const inner = ref<HTMLElement>();

/** Toda mudança das escolhas passa por aqui: guarda o estado anterior para "Desfazer". */
function commit(next: MergeChoices): void {
  history.value = recordChange(history.value, choices.value);
  choices.value = next;
}

function undo(): void {
  const r = undoChoice(history.value, choices.value);
  if (!r) return;
  history.value = r.history;
  choices.value = r.choices;
  live.value = t('mr.announceUndo');
}
function redo(): void {
  const r = redoChoice(history.value, choices.value);
  if (!r) return;
  history.value = r.history;
  choices.value = r.choices;
  live.value = t('mr.announceRedo');
}

const STATE_KEY = { pending: 'mr.statePending', resolved: 'mr.stateResolved', edited: 'mr.stateEdited' } as const;
const picksOf = (idx: number): PickedLine[] | undefined => choices.value.picks[idx];
const stateOf = (idx: number): 'pending' | 'resolved' | 'edited' => (picksOf(idx) === undefined ? 'pending' : hasTyped(picksOf(idx)) ? 'edited' : 'resolved');
const conflictNo = (idx: number) => model.value.conflicts.indexOf(idx) + 1;
const resolved = computed(() => resolvedCount(model.value, choices.value));
const pendingCount = computed(() => result.value.pending.length);
const position = computed(() => (activeIdx.value === null ? 0 : conflictNo(activeIdx.value)));

function summary(idx: number): string {
  const s = summarizePicks(picksOf(idx) ?? []);
  const parts = [
    s.mine ? t('mr.sumMine', { n: s.mine }) : '',
    s.theirs ? t('mr.sumTheirs', { n: s.theirs }) : '',
    s.base ? t('mr.sumBase', { n: s.base }) : '',
    s.typed ? t('mr.sumTyped', { n: s.typed }) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' + ') : t('mr.sumNone');
}

function spanText(idx: number): string {
  const { from, to } = lineSpan(layout.value[idx]!);
  if (!layout.value[idx]!.lines.length) return t('mr.noLines');
  return from === to ? t('mr.line1', { a: from }) : t('mr.lines', { a: from, b: to });
}
/** "Conflito 3 de 7, linhas 42 a 58": guardado por conteúdo, porque em arquivo grande são centenas de nomes recalculados a cada escolha. */
const regionNames = new Map<string, string>();
function regionName(idx: number): string {
  const l = layout.value[idx]!;
  const { from, to } = lineSpan(l);
  const key = `${locale.value}|${conflictNo(idx)}|${model.value.conflicts.length}|${l.lines.length}|${from}|${to}`;
  let name = regionNames.get(key);
  if (name === undefined) {
    name = t('mr.region', { i: conflictNo(idx), n: model.value.conflicts.length, span: spanText(idx) });
    if (regionNames.size > 2000) regionNames.clear();
    regionNames.set(key, name);
  }
  return name;
}

function announce(idx: number): void {
  live.value = picksOf(idx) === undefined ? t('mr.announcePending', { i: conflictNo(idx) }) : t('mr.announceResolved', { i: conflictNo(idx), summary: summary(idx) });
}

function setPicks(idx: number, picks: PickedLine[] | undefined): void {
  const next = { ...choices.value.picks };
  if (picks === undefined) delete next[idx];
  else next[idx] = picks;
  commit({ ...choices.value, picks: next });
  announce(idx);
}

function preset(idx: number, p: ConflictPreset, reversed = false): void {
  activeIdx.value = idx;
  if (reversed) swapped.add(idx);
  else swapped.delete(idx);
  setPicks(idx, presetPicks(model.value, idx, p));
  expanded.delete(idx);
}

function toggle(idx: number, side: 'mine' | 'theirs', line: number): void {
  const picks = picksOf(idx);
  const first = theirsFirst(picks, swapped.has(idx)) ? 'theirs' : 'mine';
  setPicks(idx, togglePick(picks, side, line, first));
  expanded.add(idx); // continua aberto: decidir linha a linha pede várias caixas seguidas
}

function swapOrder(idx: number): void {
  const picks = picksOf(idx);
  const next = !theirsFirst(picks, swapped.has(idx));
  if (next) swapped.add(idx);
  else swapped.delete(idx);
  // reordena as linhas já marcadas (só faz diferença quando há linhas dos dois lados)
  const mine = (picks ?? []).filter((p) => p.from === 'mine');
  const theirs = (picks ?? []).filter((p) => p.from === 'theirs');
  const rest = (picks ?? []).filter((p) => p.from !== 'mine' && p.from !== 'theirs');
  if (picks !== undefined && !rest.length) setPicks(idx, next ? [...theirs, ...mine] : [...mine, ...theirs]);
  expanded.add(idx);
}

function startEdit(idx: number): void {
  editing.value = idx;
  const seg = model.value.segments[idx]!;
  editText.value = picksOf(idx) === undefined ? model.value.mine.lines.slice(seg.mine.start, seg.mine.end).join('\n') : picksText(layout.value[idx]!.lines);
  void nextTick(() => scroller.value?.querySelector<HTMLTextAreaElement>(`[data-edit="${idx}"]`)?.focus());
}
function applyEdit(idx: number): void {
  setPicks(idx, typedPicks(editText.value));
  editing.value = null;
  expanded.delete(idx);
}

const changeReverted = (idx: number) => choices.value.reverted.includes(idx);
function toggleChange(idx: number): void {
  const set = new Set(choices.value.reverted);
  if (set.has(idx)) set.delete(idx);
  else set.add(idx);
  commit({ ...choices.value, reverted: [...set].sort((a, b) => a - b) });
}

/** "Reiniciar arquivo": volta ao estado de conflito original (e dá para desfazer). */
function resetFile(): void {
  if (choices.value.eol === 'mine' && !Object.keys(choices.value.picks).length && !choices.value.reverted.length) return;
  commit(emptyChoices());
  expanded.clear();
  baseOpen.clear();
  swapped.clear();
  editing.value = null;
  live.value = '';
  void nextTick(jumpToFirstPending);
}

/** Estado inicial de um arquivo: o rascunho guardado, se ainda vale para estas três versões. */
function init(): void {
  history.value = emptyHistory();
  choices.value = emptyChoices();
  expanded.clear();
  baseOpen.clear();
  swapped.clear();
  unfolded.clear();
  heights.clear();
  for (const k of Object.keys(lineHistory)) delete lineHistory[k];
  editing.value = null;
  activeIdx.value = null;
  live.value = '';
  notice.value = null;
  rr.value = props.block.rerere ? 'banner' : null;
  if (props.draftKey) {
    const d = loadDraft(props.draftKey, sig.value, model.value);
    if (d.status === 'ok') {
      choices.value = d.choices;
      notice.value = 'restored';
    } else if (d.status === 'stale') {
      clearDraft(props.draftKey);
      notice.value = 'stale';
    }
  }
  void nextTick(jumpToFirstPending);
}
// se as versões mudarem por baixo (o arquivo foi recarregado com outro conteúdo), as escolhas antigas não valem mais
watch(() => `${sig.value}|${props.rebase ? 1 : 0}`, init);
// rascunho automático: a cada mudança das escolhas
watch(choices, (c) => props.draftKey && saveDraft(props.draftKey, sig.value, c));

// ---------------------------------------------------------------- navegação

const cardEl = (idx: number) => scroller.value?.querySelector<HTMLElement>(`[data-seg="${idx}"]`) ?? null;

// ---------------------------------------------------------------- arquivos grandes: só o que está perto da tela é desenhado
/** Acima deste número de trechos o resolvedor desenha só os que estão perto da área visível; os demais viram um espaço reservado, com a altura que tinham, e a tela segue rápida com dezenas de milhares de linhas. */
const WINDOW_OVER = 60;
const windowed = computed(() => model.value.segments.length > WINDOW_OVER);
/** Trechos perto da área visível (o observador de interseção os mantém), mais o conflito ativo e o que está em edição. */
const near = reactive(new Set<number>());
const heights = new Map<number, number>();
const shown = (idx: number) => !windowed.value || near.has(idx) || idx === activeIdx.value || idx === editing.value;
/** A altura do espaço reservado: a última medida do trecho ou, na primeira vez, uma estimativa pelas linhas. */
const estimates = computed(() =>
  model.value.segments.map((seg) => {
    const rows = Math.max(seg.mine.end - seg.mine.start, seg.theirs.end - seg.theirs.start);
    if (seg.kind === 'conflict') return 190 + 38 * rows;
    if (seg.kind === 'stable') return 19 * Math.min(rows, 2 * CONTEXT_LINES) + (rows > FOLD_OVER ? 34 : 0);
    return 19 * rows + 44;
  }),
);
const placeholderHeight = (idx: number): number => heights.get(idx) || estimates.value[idx]!;
let io: IntersectionObserver | null = null;
function watchSegments(): void {
  if (!io || !windowed.value) return;
  for (const el of scroller.value?.querySelectorAll<HTMLElement>('[data-seg]') ?? []) io.observe(el);
}
function onSegmentsSeen(entries: IntersectionObserverEntry[]): void {
  for (const e of entries) {
    const el = e.target as HTMLElement;
    const idx = Number(el.dataset.seg);
    if (!el.classList.contains('mr__ph')) heights.set(idx, e.boundingClientRect.height);
    if (e.isIntersecting) near.add(idx);
    else near.delete(idx);
  }
}

function goTo(idx: number | null): void {
  if (idx === null) return;
  activeIdx.value = idx;
  if (stateOf(idx) !== 'pending') expanded.add(idx);
  void nextTick(() => {
    const el = cardEl(idx);
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  });
}
const step = (dir: 1 | -1, pendingOnly = false) => goTo(stepConflict(model.value, choices.value, activeIdx.value, dir, pendingOnly));

/** Ao abrir o arquivo a tela já mostra o primeiro conflito pendente. */
function jumpToFirstPending(): void {
  const first = pendingOf(model.value, choices.value)[0];
  if (first === undefined) return;
  activeIdx.value = first;
  cardEl(first)?.scrollIntoView({ block: 'center' });
}

// régua lateral: onde estão os conflitos e as mudanças aplicadas, no arquivo todo (clicável)
interface Mark {
  idx: number;
  kind: 'pending' | 'resolved' | 'change';
  top: number;
}
const marks = ref<Mark[]>([]);
let measureQueued = false;
/** Pede a medição da régua; várias seguidas (cada escolha, cada trecho que entra na janela) viram uma por quadro. */
function measure(): void {
  if (measureQueued) return;
  measureQueued = true;
  const run = () => {
    measureQueued = false;
    doMeasure();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}
function doMeasure(): void {
  const box = inner.value;
  if (!box) return;
  const total = Math.max(box.scrollHeight, 1);
  const out: Mark[] = [];
  const els = new Map<number, HTMLElement>();
  for (const el of scroller.value?.querySelectorAll<HTMLElement>('[data-seg]') ?? []) if (!els.has(Number(el.dataset.seg))) els.set(Number(el.dataset.seg), el);
  for (const idx of [...model.value.conflicts, ...model.value.changes]) {
    const el = els.get(idx);
    if (!el) continue;
    const isConflict = model.value.segments[idx]!.kind === 'conflict';
    out.push({ idx, kind: isConflict ? (stateOf(idx) === 'pending' ? 'pending' : 'resolved') : 'change', top: Math.min(el.offsetTop / total, 0.985) });
  }
  marks.value = out;
}
let ro: ResizeObserver | null = null;
let roWidth: ResizeObserver | null = null;
watch([choices, model, split, mergeIgnoreSpace, mergeShowInvisibles], () => void nextTick(measure));
function markClick(m: Mark): void {
  if (m.kind === 'change') cardEl(m.idx)?.scrollIntoView({ block: 'center' });
  else goTo(m.idx);
}
const markTitle = (m: Mark) => (m.kind === 'change' ? t('mr.applied') : regionName(m.idx));

// ---------------------------------------------------------------- ações em massa

const menu = ref<{ x: number; y: number } | null>(null);
const asking = ref<null | 'pendingMine' | 'pendingTheirs'>(null);
const bulkItems = computed<MenuItem[]>(() => {
  const n = pendingCount.value;
  return [
    { id: 'pendingMine', label: t('mr.bulkPendingMine', { n }), disabled: n === 0 },
    { id: 'pendingTheirs', label: t('mr.bulkPendingTheirs', { n }), disabled: n === 0 },
    { id: 'simple', label: t('mr.bulkSimple', { n: simpleItems.value.length }), disabled: simpleItems.value.length === 0 },
    ...(mergeIgnoreSpace.value ? [{ id: 'spaceOnly', label: t('mr.bulkSpaceOnly', { n: spaceOnlyPending.value }), disabled: spaceOnlyPending.value === 0 }] : []),
    { id: 'sep', separator: true },
    { id: 'changesAll', label: t('mr.bulkChangesAll'), disabled: !model.value.changes.length },
    { id: 'changesMine', label: t('mr.bulkChangesMine'), disabled: !model.value.changes.length },
    { id: 'changesTheirs', label: t('mr.bulkChangesTheirs'), disabled: !model.value.changes.length },
  ];
});
function openBulk(ev: MouseEvent): void {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
  menu.value = { x: r.left, y: r.bottom + 4 };
}
function onBulk(id: string): void {
  menu.value = null;
  if (id === 'pendingMine' || id === 'pendingTheirs') asking.value = id;
  else if (id === 'simple') askingSimple.value = true;
  else runBulk(id as BulkAction);
}
function runBulk(action: BulkAction): void {
  const before = pendingCount.value;
  const spaceBefore = spaceOnlyPending.value;
  const simpleBefore = simpleItems.value.length;
  commit(applyBulk(model.value, choices.value, action));
  if (action === 'simple') {
    live.value = t('mr.announceSimple', { n: simpleBefore });
    askingSimple.value = false;
  }
  if (action === 'pendingMine' || action === 'pendingTheirs') live.value = t('mr.announceBulk', { n: before });
  if (action === 'spaceOnly') live.value = t('mr.announceSpaceOnly', { n: spaceBefore });
  asking.value = null;
}

const askingMixed = ref(false);
/** "Marcar como resolvido": com fim de linha misto no resultado, pergunta antes (o aviso diz como uniformizar). */
function onResolve(): void {
  if (result.value.text === null) return;
  if (mixedEol.value) askingMixed.value = true;
  else emit('resolve', result.value.text);
}
function confirmMixed(): void {
  askingMixed.value = false;
  const accepting = pendingAccept.value;
  pendingAccept.value = false;
  if (accepting) emit('resolve', props.block.workingContent ?? '');
  else if (result.value.text !== null) emit('resolve', result.value.text);
}
function cancelMixed(): void {
  askingMixed.value = false;
  pendingAccept.value = false;
}
const confirmLines = computed(() => [
  t(asking.value === 'pendingMine' ? 'mr.bulkConfirmMine' : 'mr.bulkConfirmTheirs', { n: pendingCount.value }),
  t('mr.bulkConfirmKeep'),
]);

// ---------------------------------------------------------------- atalhos e paleta (Ctrl+K)

const SHORTCUTS = {
  next: 'F7',
  prev: 'Shift+F7',
  nextPending: 'Alt+ArrowDown',
  mine: 'Alt+1',
  theirs: 'Alt+2',
  both: 'Alt+3',
  none: 'Alt+0',
  undo: 'Mod+Z',
  redo: 'Mod+Y',
} as const;
const sc = (k: keyof typeof SHORTCUTS) => shortcutLabel(SHORTCUTS[k]);

const isActiveTab = () => ws.activeId === `merge:${props.repoId}`;
/** Digitando num campo de texto, Ctrl+Z é do campo (a edição à mão), não do histórico de escolhas. */
const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'text'));
};
const current = () => activeIdx.value ?? pendingOf(model.value, choices.value)[0] ?? model.value.conflicts[0] ?? null;
function chooseCurrent(p: ConflictPreset): void {
  const idx = current();
  if (idx === null) return;
  preset(idx, p);
  if (p !== 'none') step(1, true);
}

function mrCommands(): Command[] {
  const when = () => isActiveTab() && model.value.conflicts.length > 0;
  const group = t('mr.group');
  const k = 'conflito conflict merge resolver';
  return [
    { id: 'mr.next', title: t('mr.cmd.next'), group, shortcut: SHORTCUTS.next, keywords: k, when, run: () => step(1) },
    { id: 'mr.prev', title: t('mr.cmd.prev'), group, shortcut: SHORTCUTS.prev, keywords: k, when, run: () => step(-1) },
    { id: 'mr.nextPending', title: t('mr.cmd.nextPending'), group, shortcut: SHORTCUTS.nextPending, keywords: k, when, run: () => step(1, true) },
    { id: 'mr.mine', title: t('mr.cmd.mine'), group, shortcut: SHORTCUTS.mine, keywords: k, when, run: () => chooseCurrent('mine') },
    { id: 'mr.theirs', title: t('mr.cmd.theirs'), group, shortcut: SHORTCUTS.theirs, keywords: k, when, run: () => chooseCurrent('theirs') },
    { id: 'mr.both', title: t('mr.cmd.both'), group, shortcut: SHORTCUTS.both, keywords: k, when, run: () => chooseCurrent('both') },
    { id: 'mr.none', title: t('mr.cmd.none'), group, shortcut: SHORTCUTS.none, keywords: k, when, run: () => chooseCurrent('none') },
    { id: 'mr.undo', title: t('mr.cmd.undo'), group, shortcut: SHORTCUTS.undo, keywords: k, when: () => isActiveTab() && !typing() && history.value.past.length > 0, run: undo },
    { id: 'mr.redo', title: t('mr.cmd.redo'), group, shortcut: SHORTCUTS.redo, keywords: k, when: () => isActiveTab() && !typing() && history.value.future.length > 0, run: redo },
    { id: 'mr.bulkMine', title: t('mr.cmd.bulkMine'), group, keywords: k, when: () => when() && pendingCount.value > 0, run: () => (asking.value = 'pendingMine') },
    { id: 'mr.bulkTheirs', title: t('mr.cmd.bulkTheirs'), group, keywords: k, when: () => when() && pendingCount.value > 0, run: () => (asking.value = 'pendingTheirs') },
    { id: 'mr.bulkSimple', title: t('mr.cmd.bulkSimple'), group, keywords: k, when: () => when() && simpleItems.value.length > 0, run: () => (askingSimple.value = true) },
    { id: 'mr.bulkSpaceOnly', title: t('mr.cmd.bulkSpaceOnly'), group, keywords: k, when: () => when() && spaceOnlyPending.value > 0, run: () => runBulk('spaceOnly') },
    { id: 'mr.changesAll', title: t('mr.cmd.changesAll'), group, keywords: k, when: () => when() && model.value.changes.length > 0, run: () => runBulk('changesAll') },
  ];
}
let offCommands: (() => void) | null = null;

const showHelp = ref(false);
const HELP: Array<[keyof typeof SHORTCUTS, MessageKey]> = [
  ['next', 'mr.cmd.next'],
  ['prev', 'mr.cmd.prev'],
  ['nextPending', 'mr.cmd.nextPending'],
  ['mine', 'mr.cmd.mine'],
  ['theirs', 'mr.cmd.theirs'],
  ['both', 'mr.cmd.both'],
  ['none', 'mr.cmd.none'],
  ['undo', 'mr.cmd.undo'],
  ['redo', 'mr.cmd.redo'],
];

onMounted(() => {
  init();
  offCommands = cmds.register(mrCommands);
  if (typeof ResizeObserver !== 'undefined' && inner.value) {
    ro = new ResizeObserver(() => measure());
    ro.observe(inner.value);
  }
  if (root.value) {
    width.value = root.value.clientWidth || Infinity;
    if (typeof ResizeObserver !== 'undefined') {
      roWidth = new ResizeObserver(() => (width.value = root.value?.clientWidth || Infinity));
      roWidth.observe(root.value);
    }
  }
  if (typeof IntersectionObserver !== 'undefined' && scroller.value) io = new IntersectionObserver(onSegmentsSeen, { root: scroller.value, rootMargin: '1500px 0px' });
  void nextTick(() => {
    watchSegments();
    measure();
  });
});
onUpdated(watchSegments);
watch(
  () => near.size,
  () => void nextTick(measure),
);
onBeforeUnmount(() => {
  io?.disconnect();
  offCommands?.();
  ro?.disconnect();
  roWidth?.disconnect();
});

const changeKey = (idx: number) => {
  const k = model.value.segments[idx]!.kind;
  return k === 'mine' ? 'mr.changeMine' : k === 'theirs' ? 'mr.changeTheirs' : 'mr.changeBoth';
};
const changeSym = (idx: number) => {
  const k = model.value.segments[idx]!.kind;
  return k === 'mine' ? 'M' : k === 'theirs' ? 'O' : 'M+O';
};

const explain = computed(() => {
  const { mine, theirs } = labels.value;
  if (props.rebase) return mine && theirs ? t('mr.explainRebase', { mine, theirs }) : t('mr.explainRebaseBare');
  return mine && theirs ? t('mr.explainMerge', { mine, theirs }) : t('mr.explainMergeBare');
});
</script>

<template>
  <div ref="root" class="mr" data-testid="merge-resolver" :data-view="split ? 'split' : 'stacked'">
    <div class="mr__top">
      <div class="mr__sides" data-testid="mr-explain">
        <span class="mr__chip mr__chip--mine"><b>M</b>{{ t('mr.mine') }}<template v-if="labels.mine"> · {{ labels.mine }}</template></span>
        <span class="mr__chip mr__chip--theirs"><b>O</b>{{ t('mr.theirs') }}<template v-if="labels.theirs"> · {{ labels.theirs }}</template></span>
        <span class="mr__explain">{{ explain }}</span>
      </div>
      <p v-if="notice" class="mr__notice" :class="`mr__notice--${notice}`" role="status" data-testid="mr-notice">{{ notice === 'restored' ? t('mr.noteRestored') : t('mr.noteStale') }}</p>
      <p v-if="block.kind === 'both-added'" class="mr__notice" role="status" data-testid="mr-both-added">{{ t('mr.bothAdded') }}</p>
      <!-- o Git preencheu este arquivo com uma resolução gravada (rerere), mas ele segue em conflito no índice -->
      <section v-if="rr" class="rr" role="region" :aria-label="t('mr.rr.title', { date: rrDate })" data-testid="mr-rerere" :data-state="rr">
        <div class="rr__head">
          <span class="card__tag">rerere</span>
          <strong>{{ t('mr.rr.title', { date: rrDate }) }}</strong>
          <span class="mr__spacer" />
          <GnButton v-if="rr !== 'reviewing'" size="sm" variant="primary" tone="success" :disabled="busy" data-testid="mr-rr-accept" @click="acceptRecorded">{{ t('mr.rr.accept') }}<GnTooltip :text="t('mr.rr.acceptTip')" /></GnButton>
          <GnButton v-if="rr === 'banner'" size="sm" data-testid="mr-rr-review" @click="reviewRecorded">{{ t('mr.rr.review') }}<GnTooltip :text="t('mr.rr.reviewTip')" /></GnButton>
          <GnButton size="sm" variant="ghost" tone="warn" :disabled="busy" data-testid="mr-rr-forget" @click="forgetRecorded">{{ t('mr.rr.forget') }}<GnTooltip :text="t('mr.rr.forgetTip')" /></GnButton>
        </div>
        <p v-if="rr === 'banner'" class="card__muted">{{ t('mr.rr.body') }}</p>
        <p v-else-if="rr === 'reviewing'" class="card__muted" role="status" data-testid="mr-rr-reviewing">{{ t('mr.rr.reviewing') }}</p>
        <p v-else class="card__muted" role="status" data-testid="mr-rr-inexact">{{ t('mr.rr.notExact') }}</p>
        <template v-if="rr === 'banner'">
          <p class="card__muted">{{ rrDiff.length ? t('mr.rr.diff') : t('mr.rr.diffNone') }}</p>
          <ul v-if="rrDiff.length" class="rr__diff" data-testid="mr-rr-diff">
            <li v-for="(r, i) in rrDiff.slice(0, RR_DIFF_MAX)" :key="i" class="rr__row" :class="r.sign === '+' ? 'rr__row--add' : 'rr__row--del'">
              <b aria-hidden="true">{{ r.sign }}</b><span class="mr__sr">{{ r.sign === '+' ? t('mr.rr.added') : t('mr.rr.removed') }}: </span><code>{{ r.text || ' ' }}</code>
            </li>
            <li v-if="rrDiff.length > RR_DIFF_MAX" class="card__muted">{{ t('mr.simpleMore', { n: rrDiff.length - RR_DIFF_MAX }) }}</li>
          </ul>
        </template>
      </section>
      <div class="mr__bar">
        <GnIconButton icon="up" :label="t('mr.prev')" :title="`${t('mr.prev')} (${sc('prev')})`" :disabled="!model.conflicts.length" data-testid="mr-prev" @click="step(-1)" />
        <GnIconButton icon="down" :label="t('mr.next')" :title="`${t('mr.next')} (${sc('next')})`" :disabled="!model.conflicts.length" data-testid="mr-next" @click="step(1)" />
        <span class="mr__progress" data-testid="mr-progress">{{ t('mr.position', { k: position || '–', n: model.conflicts.length }) }} · {{ t('mr.resolvedOf', { done: resolved }) }}</span>
        <GnButton size="sm" variant="ghost" :disabled="pendingCount === 0" data-testid="mr-next-pending" @click="step(1, true)">
          {{ t('mr.nextPending') }}<GnTooltip :text="`${t('mr.cmd.nextPending')} (${sc('nextPending')})`" />
        </GnButton>
        <span class="mr__spacer" />
        <GnButton size="sm" variant="ghost" :disabled="!history.past.length" data-testid="mr-undo" @click="undo">{{ t('mr.undo') }}<GnTooltip :text="`${t('mr.undo')} (${sc('undo')})`" /></GnButton>
        <GnButton size="sm" variant="ghost" :disabled="!history.future.length" data-testid="mr-redo" @click="redo">{{ t('mr.redo') }}<GnTooltip :text="`${t('mr.redo')} (${sc('redo')})`" /></GnButton>
        <GnButton size="sm" :disabled="!model.conflicts.length && !model.changes.length" aria-haspopup="menu" data-testid="mr-bulk" @click="openBulk">{{ t('mr.bulk') }}</GnButton>
        <GnButton size="sm" variant="ghost" tone="warn" data-testid="mr-reset" @click="resetFile">{{ t('mr.reset') }}</GnButton>
        <GnButton variant="primary" tone="success" data-testid="mr-resolve" :disabled="pendingCount > 0 || busy" @click="onResolve">
          {{ pendingCount ? t('mr.missing', { n: pendingCount }) : t('mr.markResolved') }}
        </GnButton>
      </div>
      <div class="mr__view" data-testid="mr-view">
        <GnButton size="sm" :variant="mergeSideBySide ? 'primary' : 'ghost'" :aria-pressed="mergeSideBySide" data-testid="mr-view-split" @click="toggleSplit">{{ t('mr.viewSplit') }}<GnTooltip :text="t('mr.viewSplitTip')" /></GnButton>
        <GnButton size="sm" :variant="mergeIgnoreSpace ? 'primary' : 'ghost'" :aria-pressed="mergeIgnoreSpace" data-testid="mr-ignore-space" @click="toggleIgnoreSpace">{{ t('mr.ignoreSpace') }}<GnTooltip :text="t('mr.ignoreSpaceTip')" /></GnButton>
        <GnButton size="sm" :variant="mergeShowInvisibles ? 'primary' : 'ghost'" :aria-pressed="mergeShowInvisibles" data-testid="mr-invisibles" @click="toggleInvisibles">{{ t('mr.invisibles') }}<GnTooltip :text="t('mr.invisiblesTip')" /></GnButton>
      </div>
      <p v-if="splitNarrow" class="mr__notice" role="status" data-testid="mr-split-narrow">{{ t('mr.viewSplitNarrow') }}</p>
      <div v-if="eol.differs || mixedEol" class="mr__eol" data-testid="mr-eol">
        <span v-if="eol.differs">{{ t('mr.eolDiffers', { mine: eol.mine || 'LF', theirs: eol.theirs || 'LF' }) }}</span>
        <GnSegmented :model-value="choices.eol" :options="eolOptions" :aria-label="t('mr.eolLabel')" data-testid="mr-eol-choice" @update:model-value="setEol($event)" />
        <strong v-if="mixedEol" class="mr__eol-warn" role="status" data-testid="mr-eol-mixed">{{ t('mr.eolMixed') }}</strong>
      </div>
    </div>

    <div class="mr__body">
      <div ref="scroller" class="mr__scroll" data-testid="mr-scroll">
        <div ref="inner" class="mr__inner">
          <p v-if="!model.conflicts.length" class="mr__none">{{ t('mr.noConflicts') }}</p>
          <template v-for="(seg, idx) in model.segments" :key="idx">
            <!-- arquivo grande: o trecho longe da tela é só um espaço reservado (a região do conflito continua nomeada para o leitor de tela) -->
            <div
              v-if="!shown(idx)"
              class="mr__ph"
              :role="seg.kind === 'conflict' ? 'region' : undefined"
              :aria-label="seg.kind === 'conflict' ? regionName(idx) : undefined"
              :style="{ height: `${placeholderHeight(idx)}px` }"
              :data-seg="idx"
              :data-kind="seg.kind"
              data-testid="mr-ph"
            ></div>
            <template v-else>
            <!-- lado a lado: minha | resultado | a que chega, com conectores (as escolhas são as mesmas da visão padrão) -->
            <template v-if="split">
              <GnButton v-if="isFolded(idx)" size="sm" variant="ghost" class="sp__fold" :data-seg="idx" data-testid="mr-fold" @click="unfolded.add(idx)">
                {{ t('mr.foldedLines', { n: seg.mine.end - seg.mine.start }) }}
              </GnButton>
              <div
                v-else
                class="sp"
                :class="[`sp--${seg.kind}`, { 'sp--active': activeIdx === idx, 'sp--done': seg.kind === 'conflict' && stateOf(idx) !== 'pending' }]"
                :role="seg.kind === 'conflict' ? 'region' : undefined"
                :tabindex="seg.kind === 'conflict' ? -1 : undefined"
                :aria-label="seg.kind === 'conflict' ? regionName(idx) : undefined"
                :data-testid="seg.kind === 'conflict' ? 'mr-card' : 'mr-sp-row'"
                :data-seg="idx"
                :data-kind="seg.kind"
                :data-state="seg.kind === 'conflict' ? stateOf(idx) : undefined"
                :data-pending="seg.kind === 'conflict' ? stateOf(idx) === 'pending' : undefined"
                @focusin="seg.kind === 'conflict' && (activeIdx = idx)"
                @click="seg.kind === 'conflict' && (activeIdx = idx)"
              >
                <header v-if="seg.kind === 'conflict'" class="sp__head">
                  <span class="card__state" :class="`card__state--${stateOf(idx)}`" data-testid="mr-state">{{ t(STATE_KEY[stateOf(idx)]) }}</span>
                  <strong>{{ t('mr.conflict', { i: conflictNo(idx), n: model.conflicts.length }) }}</strong>
                  <span class="card__muted">{{ spanText(idx) }}</span>
                  <span v-if="stateOf(idx) !== 'pending'" class="card__muted" data-testid="mr-summary">· {{ summary(idx) }}</span>
                  <span v-if="spaceOnly.has(idx)" class="card__tag" data-testid="mr-space-only">{{ t('mr.spaceOnly') }}<GnTooltip :text="t('mr.spaceOnlyTip')" /></span>
                <span v-if="suggestionOf(idx)" class="card__tag card__tag--simple" data-testid="mr-simple" :data-kind="suggestionOf(idx)!.kind">{{ t('mr.suggestTag') }}: {{ reasonText(suggestionOf(idx)!) }}</span>
                  <span class="mr__spacer" />
                  <GnButton v-if="suggestionOf(idx)" size="sm" variant="primary" data-testid="mr-suggest" @click="applySuggestion(idx)">{{ t('mr.suggest') }}<GnTooltip :text="suggestionTip(suggestionOf(idx)!)" /></GnButton>
                  <GnButton size="sm" data-testid="mr-use-mine" @click="preset(idx, 'mine')">{{ t('mr.useMine') }}</GnButton>
                  <GnButton size="sm" data-testid="mr-use-theirs" @click="preset(idx, 'theirs')">{{ t('mr.useTheirs') }}</GnButton>
                  <GnButton size="sm" data-testid="mr-use-both" @click="preset(idx, 'both', swapped.has(idx))">{{ t('mr.useBoth') }}</GnButton>
                  <GnButton size="sm" data-testid="mr-swap" @click="swapOrder(idx)">{{ t('mr.swapOrder') }}</GnButton>
                  <GnButton size="sm" data-testid="mr-use-none" @click="preset(idx, 'none')">{{ t('mr.useNone') }}</GnButton>
                  <GnButton size="sm" data-testid="mr-edit" @click="startEdit(idx)">{{ t('mr.edit') }}</GnButton>
                  <GnButton v-if="stateOf(idx) !== 'pending'" size="sm" variant="ghost" tone="warn" data-testid="mr-reopen" @click="setPicks(idx, undefined)">{{ t('mr.reopen') }}</GnButton>
                </header>
                <div v-if="seg.kind === 'conflict' && (lineHistory[historyKey(idx, 'mine')] || lineHistory[historyKey(idx, 'theirs')])" class="sp__hist">
                  <p v-for="side in (['mine', 'theirs'] as const)" v-show="lineHistory[historyKey(idx, side)]" :key="side" class="card__muted" data-testid="mr-history-result" :data-side="side" :data-state="lineHistory[historyKey(idx, side)]?.state">
                    <b>{{ side === 'mine' ? 'M' : 'O' }}</b>
                    {{ lineHistory[historyKey(idx, side)]?.state === 'loading' ? t('mr.historyLoading') : lineHistory[historyKey(idx, side)]?.state === 'ok' ? lineHistory[historyKey(idx, side)]!.text : t('mr.historyNone') }}
                  </p>
                </div>

                <template v-for="col in COLS" :key="col">
                  <svg
                    v-if="col !== 'mine'"
                    class="sp__conn"
                    :class="[`sp__conn--${connTone(idx)}`, { 'sp__conn--label': seg.kind === 'conflict' }]"
                    :viewBox="`0 0 26 ${connH(idx)}`"
                    width="26"
                    :height="connH(idx)"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    data-testid="mr-conn"
                  >
                    <path :d="connPath(col === 'result' ? 'left' : 'right', idx)" />
                  </svg>

                  <!-- as versões dos lados -->
                  <div v-if="col !== 'result'" class="sp__col" :class="[`sp__col--${col}`, { 'sp__col--changed': seg.kind !== 'stable' && (seg.kind === 'conflict' || seg.kind === 'same' || seg.kind === col) }]" :data-col="col">
                    <div v-if="seg.kind === 'conflict'" class="sp__label">
                      <b class="side__sym" :class="`side__sym--${col}`">{{ col === 'mine' ? 'M' : 'O' }}</b>
                      <strong>{{ col === 'mine' ? t('mr.mine') : t('mr.theirs') }}</strong>
                      <span v-if="labels[col]" class="card__muted">{{ labels[col] }}</span>
                      <span class="mr__spacer" />
                      <GnButton v-if="repoPath && seg[col].end > seg[col].start" size="sm" variant="ghost" data-testid="mr-history" :data-side="col" @click="showHistory(idx, col)">{{ t('mr.history') }}<GnTooltip :text="t('mr.historyTip')" /></GnButton>
                    </div>
                    <p v-if="seg.kind === 'conflict' && seg[col].end === seg[col].start" class="side__empty">{{ t('mr.noLines') }}</p>
                    <template v-for="n in seg[col].end - seg[col].start" :key="n">
                      <label v-if="seg.kind === 'conflict'" class="pl" :class="{ 'pl--on': selectedLines(picksOf(idx), col).has(seg[col].start + n - 1) }" data-testid="mr-pick" :data-side="col">
                        <input
                          type="checkbox"
                          :checked="selectedLines(picksOf(idx), col).has(seg[col].start + n - 1)"
                          :aria-label="t('mr.pickLine', { n: seg[col].start + n, side: col === 'mine' ? t('mr.mine') : t('mr.theirs') })"
                          @change="toggle(idx, col, seg[col].start + n - 1)"
                        />
                        <span class="pl__no">{{ seg[col].start + n }}</span>
                        <!-- eslint-disable-next-line vue/no-v-html: highlightLines escapa o texto; markHtml e showInvisibles só acrescentam marcas -->
                        <span class="pl__code" v-html="lineHtml(col, idx, seg[col].start + n - 1)"></span>
                      </label>
                      <div v-else class="spl" data-testid="mr-sp-line">
                        <span class="pl__no">{{ seg[col].start + n }}</span>
                        <!-- eslint-disable-next-line vue/no-v-html: highlightLines escapa o texto -->
                        <span class="pl__code" v-html="plainHtml(col, seg[col].start + n - 1)"></span>
                      </div>
                    </template>
                  </div>

                  <!-- o resultado -->
                  <div v-else class="sp__col sp__col--result" data-col="result">
                    <div v-if="seg.kind === 'conflict'" class="sp__label">
                      <strong>{{ t('mr.colResult') }}</strong>
                      <span v-if="stateOf(idx) === 'pending'" class="card__muted">{{ t('mr.splitPending') }}</span>
                    </div>
                    <div v-if="editing === idx" class="card__edit">
                      <p class="card__muted">{{ t('mr.editHint') }}</p>
                      <textarea v-model="editText" class="card__ta" rows="6" spellcheck="false" :aria-label="t('mr.editLabel', { i: conflictNo(idx) })" :data-edit="idx" />
                      <div class="card__actions">
                        <GnButton size="sm" data-testid="mr-edit-apply" @click="applyEdit(idx)">{{ t('mr.editApply') }}</GnButton>
                        <GnButton size="sm" variant="ghost" @click="editing = null">{{ t('mr.editCancel') }}</GnButton>
                      </div>
                    </div>
                    <p v-else-if="seg.kind === 'conflict' && stateOf(idx) !== 'pending' && !layout[idx]!.lines.length" class="side__empty" data-testid="mr-preview-none">{{ t('mr.noLines') }}</p>
                    <MergeLines v-else :lines="layout[idx]!.lines" :first="layout[idx]!.first" :html="hlResult" :offset="layout[idx]!.offset" :invisibles="mergeShowInvisibles" />
                    <div v-if="isChange(seg)" class="note" data-testid="mr-change" :data-reverted="changeReverted(idx)">
                      <span class="note__sym">{{ changeSym(idx) }}</span>
                      <strong>{{ changeReverted(idx) ? t('mr.notApplied') : t('mr.applied') }}</strong>
                      <GnButton size="sm" variant="ghost" data-testid="mr-toggle-change" @click="toggleChange(idx)">{{ changeReverted(idx) ? t('mr.applyChange') : t('mr.undoChange') }}</GnButton>
                    </div>
                  </div>
                </template>
              </div>
            </template>

            <!-- conflito: cartão -->
            <section
              v-else-if="seg.kind === 'conflict'"
              class="card"
              :class="{ 'card--done': stateOf(idx) !== 'pending', 'card--active': activeIdx === idx }"
              role="region"
              tabindex="-1"
              :aria-label="regionName(idx)"
              data-testid="mr-card"
              :data-seg="idx"
              :data-state="stateOf(idx)"
              :data-pending="stateOf(idx) === 'pending'"
              @focusin="activeIdx = idx"
              @click="activeIdx = idx"
            >
              <header class="card__head">
                <span class="card__state" :class="`card__state--${stateOf(idx)}`" data-testid="mr-state">{{ t(STATE_KEY[stateOf(idx)]) }}</span>
                <strong>{{ t('mr.conflict', { i: conflictNo(idx), n: model.conflicts.length }) }}</strong>
                <span class="card__muted">{{ spanText(idx) }}</span>
                <span v-if="stateOf(idx) !== 'pending'" class="card__muted" data-testid="mr-summary">· {{ summary(idx) }}</span>
                <span v-if="spaceOnly.has(idx)" class="card__tag" data-testid="mr-space-only">{{ t('mr.spaceOnly') }}<GnTooltip :text="t('mr.spaceOnlyTip')" /></span>
                <span v-if="suggestionOf(idx)" class="card__tag card__tag--simple" data-testid="mr-simple" :data-kind="suggestionOf(idx)!.kind">{{ t('mr.suggestTag') }}: {{ reasonText(suggestionOf(idx)!) }}</span>
                <span class="mr__spacer" />
                <GnButton v-if="suggestionOf(idx)" size="sm" variant="primary" data-testid="mr-suggest" @click="applySuggestion(idx)">{{ t('mr.suggest') }}<GnTooltip :text="suggestionTip(suggestionOf(idx)!)" /></GnButton>
                <GnButton v-if="stateOf(idx) !== 'pending' && editing !== idx" size="sm" variant="ghost" @click="expanded.has(idx) ? expanded.delete(idx) : expanded.add(idx)">
                  {{ expanded.has(idx) ? t('mr.collapse') : t('mr.change') }}
                </GnButton>
              </header>

              <!-- resolvido e recolhido: só o resultado -->
              <MergeLines v-if="stateOf(idx) !== 'pending' && !expanded.has(idx) && editing !== idx" :lines="layout[idx]!.lines" :first="layout[idx]!.first" :html="hlResult" :offset="layout[idx]!.offset" :invisibles="mergeShowInvisibles" />

              <template v-else>
                <!-- editar à mão -->
                <div v-if="editing === idx" class="card__edit">
                  <p class="card__muted">{{ t('mr.editHint') }}</p>
                  <textarea v-model="editText" class="card__ta" rows="6" spellcheck="false" :aria-label="t('mr.editLabel', { i: conflictNo(idx) })" :data-edit="idx" />
                  <div class="card__actions">
                    <GnButton size="sm" data-testid="mr-edit-apply" @click="applyEdit(idx)">{{ t('mr.editApply') }}</GnButton>
                    <GnButton size="sm" variant="ghost" @click="editing = null">{{ t('mr.editCancel') }}</GnButton>
                  </div>
                </div>

                <template v-else>
                  <!-- as duas versões, empilhadas, com uma caixa por linha -->
                  <div v-for="side in (['mine', 'theirs'] as const)" :key="side" class="side" :class="`side--${side}`" :data-side="side">
                    <div class="side__label">
                      <b class="side__sym">{{ side === 'mine' ? 'M' : 'O' }}</b>
                      <strong>{{ side === 'mine' ? t('mr.mine') : t('mr.theirs') }}</strong>
                      <span v-if="labels[side]" class="card__muted">{{ labels[side] }}</span>
                      <span class="mr__spacer" />
                      <span class="card__muted">{{ t('mr.nLines', { n: seg[side].end - seg[side].start }) }}</span>
                      <GnButton v-if="repoPath && seg[side].end > seg[side].start" size="sm" variant="ghost" data-testid="mr-history" :data-side="side" @click="showHistory(idx, side)">{{ t('mr.history') }}<GnTooltip :text="t('mr.historyTip')" /></GnButton>
                    </div>
                    <p v-if="lineHistory[historyKey(idx, side)]" class="side__hist card__muted" data-testid="mr-history-result" :data-side="side" :data-state="lineHistory[historyKey(idx, side)]!.state">
                      {{ lineHistory[historyKey(idx, side)]!.state === 'loading' ? t('mr.historyLoading') : lineHistory[historyKey(idx, side)]!.state === 'ok' ? lineHistory[historyKey(idx, side)]!.text : t('mr.historyNone') }}
                    </p>
                    <p v-if="seg[side].end === seg[side].start" class="side__empty">{{ t('mr.noLines') }}</p>
                    <label
                      v-for="n in seg[side].end - seg[side].start"
                      :key="n"
                      class="pl"
                      :class="{ 'pl--on': selectedLines(picksOf(idx), side).has(seg[side].start + n - 1) }"
                      data-testid="mr-pick"
                    >
                      <input
                        type="checkbox"
                        :checked="selectedLines(picksOf(idx), side).has(seg[side].start + n - 1)"
                        :aria-label="t('mr.pickLine', { n: seg[side].start + n, side: side === 'mine' ? t('mr.mine') : t('mr.theirs') })"
                        @change="toggle(idx, side, seg[side].start + n - 1)"
                      />
                      <span class="pl__no">{{ seg[side].start + n }}</span>
                      <!-- eslint-disable-next-line vue/no-v-html: highlightLines escapa o texto -->
                      <span class="pl__code" v-html="lineHtml(side, idx, seg[side].start + n - 1)"></span>
                    </label>
                  </div>

                  <!-- a base fica recolhida -->
                  <div class="base">
                    <GnButton size="sm" variant="ghost" :aria-expanded="baseOpen.has(idx)" data-testid="mr-base-toggle" @click="baseOpen.has(idx) ? baseOpen.delete(idx) : baseOpen.add(idx)">
                      {{ t('mr.base', { n: seg.base.end - seg.base.start }) }}
                    </GnButton>
                    <span v-if="model.base.lines.length === 0" class="card__muted">{{ t('mr.baseNone') }}</span>
                    <div v-if="baseOpen.has(idx)" class="base__lines">
                      <div v-for="n in seg.base.end - seg.base.start" :key="n" class="base__row">
                        <span class="pl__no">{{ seg.base.start + n }}</span>
                        <!-- eslint-disable-next-line vue/no-v-html: highlightLines escapa o texto -->
                        <span class="pl__code" v-html="hlBase[seg.base.start + n - 1] || '&nbsp;'"></span>
                      </div>
                    </div>
                  </div>

                  <div class="card__actions">
                    <GnButton size="sm" data-testid="mr-use-mine" @click="preset(idx, 'mine')">{{ t('mr.useMine') }}</GnButton>
                    <GnButton size="sm" data-testid="mr-use-theirs" @click="preset(idx, 'theirs')">{{ t('mr.useTheirs') }}</GnButton>
                    <GnButton size="sm" data-testid="mr-use-both" @click="preset(idx, 'both', swapped.has(idx))">{{ t('mr.useBoth') }}</GnButton>
                    <GnButton size="sm" data-testid="mr-swap" @click="swapOrder(idx)">{{ t('mr.swapOrder') }}</GnButton>
                    <GnButton size="sm" data-testid="mr-use-none" @click="preset(idx, 'none')">{{ t('mr.useNone') }}</GnButton>
                    <GnButton size="sm" data-testid="mr-edit" @click="startEdit(idx)">{{ t('mr.edit') }}</GnButton>
                    <GnButton v-if="stateOf(idx) !== 'pending'" size="sm" variant="ghost" tone="warn" data-testid="mr-reopen" @click="setPicks(idx, undefined)">{{ t('mr.reopen') }}</GnButton>
                  </div>

                  <!-- prévia do trecho: exatamente o que será gravado -->
                  <div class="preview">
                    <div class="preview__head"><strong>{{ t('mr.preview') }}</strong><span class="card__muted">{{ t('mr.previewHint') }}</span></div>
                    <p v-if="stateOf(idx) === 'pending'" class="side__empty" data-testid="mr-preview-empty">{{ t('mr.previewEmpty') }}</p>
                    <p v-else-if="!layout[idx]!.lines.length" class="side__empty" data-testid="mr-preview-none">{{ t('mr.noLines') }}</p>
                    <MergeLines v-else :lines="layout[idx]!.lines" :first="layout[idx]!.first" :html="hlResult" :offset="layout[idx]!.offset" :invisibles="mergeShowInvisibles" />
                  </div>
                </template>
              </template>
            </section>

            <!-- o resto do arquivo: no fluxo normal, com a origem na margem -->
            <div v-else :data-seg="idx" :data-kind="seg.kind">
              <template v-if="foldView(idx)">
                <MergeLines :lines="foldView(idx)!.head.lines" :first="foldView(idx)!.head.first" :html="hlResult" :offset="foldView(idx)!.head.offset" :invisibles="mergeShowInvisibles" />
                <GnButton size="sm" variant="ghost" class="sp__fold" data-testid="mr-fold" @click="unfolded.add(idx)">{{ t('mr.foldedLines', { n: foldView(idx)!.hidden }) }}</GnButton>
                <MergeLines :lines="foldView(idx)!.tail.lines" :first="foldView(idx)!.tail.first" :html="hlResult" :offset="foldView(idx)!.tail.offset" :invisibles="mergeShowInvisibles" />
              </template>
              <MergeLines v-else :lines="layout[idx]!.lines" :first="layout[idx]!.first" :html="hlResult" :offset="layout[idx]!.offset" :invisibles="mergeShowInvisibles" />
              <div v-if="isChange(seg)" class="note" data-testid="mr-change" :data-reverted="changeReverted(idx)">
                <span class="note__sym">{{ changeSym(idx) }}</span>
                <strong>{{ changeReverted(idx) ? t('mr.notApplied') : t('mr.applied') }}</strong>
                <span class="card__muted">· {{ t(changeKey(idx)) }} · {{ t('mr.nLines', { n: Math.max(seg.mine.end - seg.mine.start, seg.theirs.end - seg.theirs.start, seg.base.end - seg.base.start) }) }}</span>
                <GnButton size="sm" variant="ghost" data-testid="mr-toggle-change" @click="toggleChange(idx)">{{ changeReverted(idx) ? t('mr.applyChange') : t('mr.undoChange') }}</GnButton>
              </div>
            </div>
            </template>
          </template>
        </div>
      </div>

      <!-- régua: posição dos conflitos (vermelho pendente, verde resolvido) e das mudanças aplicadas; clicável (a navegação por teclado são os atalhos) -->
      <div class="mr__ruler" aria-hidden="true" data-testid="mr-ruler">
        <div
          v-for="m in marks"
          :key="m.idx"
          class="mark"
          :class="`mark--${m.kind}`"
          :style="{ top: `${m.top * 100}%` }"
          :data-mark="m.kind"
          :data-idx="m.idx"
          @click="markClick(m)"
        >
          <GnTooltip :text="markTitle(m)" />
        </div>
      </div>
    </div>

    <div class="mr__legend" data-testid="mr-legend" :aria-label="t('mr.legend')">
      <span class="lg lg--mine"><b>M</b>{{ t('mr.legendMine') }}</span>
      <span class="lg lg--theirs"><b>O</b>{{ t('mr.legendTheirs') }}</span>
      <span class="lg lg--both"><b>M+O</b>{{ t('mr.legendBoth') }}</span>
      <span class="lg lg--typed"><b>✎</b>{{ t('mr.legendTyped') }}</span>
      <span class="lg lg--base"><b>B</b>{{ t('mr.legendBase') }}</span>
      <span class="lg lg--word"><mark class="wd">ab</mark>{{ t('mr.legendWord') }}</span>
      <span class="mr__spacer" />
      <GnButton size="sm" variant="ghost" :aria-expanded="showHelp" data-testid="mr-help-toggle" @click="showHelp = !showHelp">{{ t('mr.shortcuts') }}</GnButton>
    </div>
    <ul v-if="showHelp" class="mr__help" data-testid="mr-help">
      <li v-for="[key, title] in HELP" :key="key"><kbd>{{ sc(key) }}</kbd> {{ t(title) }}</li>
    </ul>
    <div class="mr__sr" aria-live="polite" data-testid="mr-live">{{ live }}</div>

    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="bulkItems" @select="onBulk" @close="menu = null" />
    <ConfirmDialog
      v-if="askingSimple"
      :title="t('mr.simpleTitle')"
      :lines="simpleLines"
      :confirm-label="t('mr.simpleConfirm', { n: simpleItems.length })"
      @confirm="runBulk('simple')"
      @cancel="askingSimple = false"
    />
    <ConfirmDialog
      v-if="askingMixed"
      :title="t('mr.mixedTitle')"
      :lines="[t('mr.mixedBody'), t('mr.mixedHint')]"
      :confirm-label="t('mr.mixedConfirm')"
      @confirm="confirmMixed"
      @cancel="cancelMixed"
    />
    <ConfirmDialog
      v-if="asking"
      :title="t('mr.bulkConfirmTitle')"
      :lines="confirmLines"
      :confirm-label="asking === 'pendingMine' ? t('mr.useMine') : t('mr.useTheirs')"
      @confirm="runBulk(asking)"
      @cancel="asking = null"
    />
  </div>
</template>

<style scoped lang="scss">
.mr {
  position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0;
  &__top { border-bottom: 1px solid var(--gn-border); background: var(--gn-surface); }
  &__sides { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 12px 0; }
  &__chip { display: inline-flex; gap: 6px; align-items: center; padding: 1px 8px; border-radius: 10px; font-size: 12px; border: 1px solid var(--gn-border); b { font-size: 9px; } }
  &__chip--mine b { color: var(--gn-accent); }
  &__chip--theirs b { color: var(--gn-renamed); }
  &__explain { color: var(--gn-muted); font-size: 12px; }
  &__notice { margin: 6px 12px 0; padding: 4px 10px; border-radius: var(--gn-radius); font-size: 12px; background: color-mix(in srgb, var(--gn-accent) 12%, transparent); color: var(--gn-text); }
  &__notice--stale { background: color-mix(in srgb, var(--gn-warn) 16%, transparent); }
  &__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 8px 12px; }
  &__view { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 0 12px 8px; }
  &__eol { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 0 12px 8px; font-size: 12px; color: var(--gn-muted); }
  &__eol-warn { color: var(--gn-warn); font-weight: 600; }
  &__progress { font-weight: 600; margin: 0 4px; }
  &__spacer { flex: 1; }
  &__body { flex: 1; min-height: 0; display: flex; }
  &__scroll { flex: 1; min-width: 0; overflow: auto; padding-bottom: 12px; }
  &__inner { position: relative; }
  &__none { margin: 12px; color: var(--gn-muted); }
  &__ruler { position: relative; flex: none; width: 14px; background: var(--gn-surface); border-left: 1px solid var(--gn-border); }
  &__legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; padding: 4px 12px; border-top: 1px solid var(--gn-border); background: var(--gn-surface); color: var(--gn-muted); font-size: 11px; }
  &__help { list-style: none; margin: 0; padding: 6px 12px 8px; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 2px 16px; border-top: 1px solid var(--gn-border); background: var(--gn-surface); font-size: 12px; kbd { display: inline-block; min-width: 86px; padding: 0 6px; margin-right: 6px; border: 1px solid var(--gn-border); border-radius: var(--gn-radius-sm); color: var(--gn-text); } }
  // texto só para leitores de tela
  &__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
.mark {
  position: absolute; left: 2px; right: 2px; height: 5px; border-radius: 2px; cursor: pointer;
  &--pending { background: var(--gn-danger); }
  &--resolved { background: var(--gn-success); }
  &--change { background: var(--gn-accent); opacity: 0.7; }
  &:hover { outline: 1px solid var(--gn-text); }
}
.lg b { display: inline-block; min-width: 22px; text-align: center; margin-right: 4px; padding: 0 4px; border-radius: 3px; font-size: 10px; }
.lg--mine b { color: var(--gn-accent); background: color-mix(in srgb, var(--gn-accent) 18%, transparent); }
.lg--theirs b { color: var(--gn-renamed); background: color-mix(in srgb, var(--gn-renamed) 18%, transparent); }
.lg--both b { color: var(--gn-success); background: color-mix(in srgb, var(--gn-success) 18%, transparent); }
.lg--typed b { color: var(--gn-warn); background: color-mix(in srgb, var(--gn-warn) 18%, transparent); }
.lg--word .wd { margin-right: 4px; }
.lg--base b { color: var(--gn-muted); background: color-mix(in srgb, var(--gn-muted) 18%, transparent); }

.note { display: flex; align-items: center; gap: 8px; margin: 2px 12px 2px 56px; min-height: 26px; font-size: 11px; color: var(--gn-muted); strong { color: var(--gn-text); font-weight: 500; } }
.note__sym { padding: 0 6px; border: 1px solid var(--gn-border); border-radius: 8px; font-size: 10px; }

.card {
  margin: 8px 12px 8px 46px; border: 1px solid color-mix(in srgb, var(--gn-danger) 55%, var(--gn-border)); border-radius: var(--gn-radius-lg); background: var(--gn-surface); box-shadow: var(--gn-shadow-md); overflow: hidden;
  &--done { border-color: var(--gn-border); box-shadow: none; }
  &:focus { outline: none; }
  &:focus-visible, &--active { border-color: var(--gn-accent); box-shadow: var(--gn-ring); }
  &__head { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: color-mix(in srgb, var(--gn-danger) 9%, var(--gn-surface)); border-bottom: 1px solid var(--gn-border); }
  &--done &__head { background: color-mix(in srgb, var(--gn-success) 9%, var(--gn-surface)); }
  &__state { padding: 0 8px; border-radius: 9px; font-size: 10px; font-weight: 600; }
  &__state--pending { color: var(--gn-danger); background: color-mix(in srgb, var(--gn-danger) 20%, transparent); }
  &__state--resolved { color: var(--gn-success); background: color-mix(in srgb, var(--gn-success) 20%, transparent); }
  &__state--edited { color: var(--gn-warn); background: color-mix(in srgb, var(--gn-warn) 20%, transparent); }
  &__muted { color: var(--gn-muted); font-size: 11px; }
  &__actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--gn-border); }
  &__edit { padding: 8px 12px; border-bottom: 1px solid var(--gn-border); p { margin: 0 0 6px; } }
  &__ta { width: 100%; font-family: var(--gn-mono); font-size: 12.5px; resize: vertical; }
}
.side {
  border-bottom: 1px solid var(--gn-border);
  &__label { display: flex; align-items: center; gap: 8px; padding: 5px 12px 3px; font-size: 11px; }
  &__sym { font-size: 10px; padding: 0 5px; border-radius: 3px; }
  &--mine &__sym { color: var(--gn-accent); background: color-mix(in srgb, var(--gn-accent) 18%, transparent); }
  &--theirs &__sym { color: var(--gn-renamed); background: color-mix(in srgb, var(--gn-renamed) 18%, transparent); }
  &__empty { margin: 0; padding: 3px 12px 6px; color: var(--gn-muted); font-size: 11px; }
}
.pl {
  display: grid; grid-template-columns: 26px 38px minmax(0, 1fr); align-items: center; line-height: 19px; cursor: pointer; font-family: var(--gn-mono); font-size: 12.5px; white-space: pre;
  input { margin: 0 auto; accent-color: var(--gn-accent); }
  &__no { text-align: right; padding-right: 10px; color: var(--gn-muted); }
  &__code { overflow: hidden; text-overflow: ellipsis; }
  &:not(&--on) &__code { opacity: 0.55; text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--gn-muted) 70%, transparent); }
}
.side--mine .pl--on { background: color-mix(in srgb, var(--gn-accent) 9%, transparent); }
.side--theirs .pl--on { background: color-mix(in srgb, var(--gn-renamed) 9%, transparent); }
.side--theirs .pl input { accent-color: var(--gn-renamed); }
.base { padding: 2px 8px; border-bottom: 1px solid var(--gn-border); display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.base__lines { flex-basis: 100%; font-family: var(--gn-mono); font-size: 12.5px; color: var(--gn-muted); }
.base__row { display: grid; grid-template-columns: 38px minmax(0, 1fr); line-height: 19px; white-space: pre; }
.preview { padding: 6px 0 8px; background: var(--gn-bg); }
.preview__head { display: flex; gap: 8px; padding: 0 12px 4px; font-size: 11px; align-items: baseline; }
.preview .side__empty { padding-top: 0; }
// realce de sintaxe também nas linhas dos cartões
.pl__code :deep(.tok-keyword), .pl__code :deep(.tok-operatorKeyword), .pl__code :deep(.tok-modifier) { color: var(--gn-accent); }
.pl__code :deep(.tok-string), .pl__code :deep(.tok-string2) { color: var(--gn-success); }
.pl__code :deep(.tok-number), .pl__code :deep(.tok-bool), .pl__code :deep(.tok-null) { color: var(--gn-warn); }
.pl__code :deep(.tok-comment) { color: var(--gn-muted); }
.pl__code :deep(.tok-typeName), .pl__code :deep(.tok-className) { color: var(--gn-renamed); }
.base__row :deep(.tok-comment) { color: var(--gn-muted); }

// diferença dentro da linha (cartões e colunas laterais): cor mais forte sobre o trecho; também sublinhada, para não depender só da cor
.wd, :deep(.wd) { background: color-mix(in srgb, var(--gn-warn) 38%, transparent); border-radius: 2px; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; color: inherit; }
// caracteres invisíveis: o texto continua o mesmo (a largura não muda), a marca é desenhada por cima
:deep(.inv) { position: relative; font-style: normal; }
:deep(.inv--sp::before), :deep(.inv--tab::before), :deep(.inv--eol::after) { position: absolute; left: 0; color: var(--gn-muted); opacity: 0.75; pointer-events: none; }
:deep(.inv--sp::before) { content: '·'; }
:deep(.inv--tab::before) { content: '→'; }
:deep(.inv--eol) { display: inline-block; width: 1.4em; }
:deep(.inv--lf::after) { content: '↵'; }
:deep(.inv--crlf::after) { content: '␍↵'; }
.card__tag { padding: 0 8px; border-radius: 9px; font-size: 10px; font-weight: 600; color: var(--gn-muted); border: 1px solid var(--gn-border); }
.card__tag--simple { color: var(--gn-success); border-color: color-mix(in srgb, var(--gn-success) 50%, var(--gn-border)); }

.rr {
  margin: 6px 12px 0; padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--gn-accent) 45%, var(--gn-border)); border-radius: var(--gn-radius);
  background: color-mix(in srgb, var(--gn-accent) 8%, transparent);
  p { margin: 4px 0 0; font-size: 12px; }
  &__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
  &__diff { list-style: none; margin: 4px 0 0; padding: 0; max-height: 160px; overflow: auto; border: 1px solid var(--gn-border); border-radius: var(--gn-radius-sm); background: var(--gn-surface); }
  &__row { display: flex; gap: 8px; padding: 0 8px; font-family: var(--gn-mono); font-size: 12px; white-space: pre; b { flex: none; width: 10px; } code { font-family: inherit; } }
  &__row--add { background: color-mix(in srgb, var(--gn-success) 16%, transparent); b { color: var(--gn-success); } }
  &__row--del { background: color-mix(in srgb, var(--gn-danger) 14%, transparent); b { color: var(--gn-danger); } }
}
.side__hist { margin: 0; padding: 0 12px 4px; }

// lado a lado: uma linha de grade por trecho (as três colunas rolam juntas, e cada coluna tem a altura do maior lado)
.sp {
  display: grid; grid-template-columns: minmax(0, 1fr) 26px minmax(0, 1fr) 26px minmax(0, 1fr); margin: 0 8px; align-items: start;
  &--conflict { margin-top: 6px; margin-bottom: 6px; border: 1px solid color-mix(in srgb, var(--gn-danger) 55%, var(--gn-border)); border-radius: var(--gn-radius-lg); background: var(--gn-surface); overflow: hidden; }
  &--done { border-color: var(--gn-border); }
  &--active { border-color: var(--gn-accent); box-shadow: var(--gn-ring); }
  &:focus { outline: none; }
  &:focus-visible { border-color: var(--gn-accent); box-shadow: var(--gn-ring); }
  &__head { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 6px 12px; background: color-mix(in srgb, var(--gn-danger) 9%, var(--gn-surface)); border-bottom: 1px solid var(--gn-border); }
  &--done &__head { background: color-mix(in srgb, var(--gn-success) 9%, var(--gn-surface)); }
  &__hist { grid-column: 1 / -1; padding: 4px 12px; border-bottom: 1px solid var(--gn-border); p { margin: 0; } }
  &__col { min-width: 0; font-family: var(--gn-mono); font-size: 12.5px; }
  &__label { display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 8px; font-family: var(--gn-font-ui); font-size: 11px; border-bottom: 1px solid var(--gn-border); }
  &__col--mine.sp__col--changed { background: color-mix(in srgb, var(--gn-accent) 6%, transparent); }
  &__col--theirs.sp__col--changed { background: color-mix(in srgb, var(--gn-renamed) 6%, transparent); }
  &__conn { align-self: start; display: block; path { fill: var(--gn-muted); opacity: 0.12; } }
  &__conn--label { margin-top: 26px; }
  &__conn--pending path { fill: var(--gn-danger); opacity: 0.2; }
  &__conn--resolved path, &__conn--same path { fill: var(--gn-success); opacity: 0.2; }
  &__conn--mine path { fill: var(--gn-accent); opacity: 0.22; }
  &__conn--theirs path { fill: var(--gn-renamed); opacity: 0.22; }
  &__conn--stable { visibility: hidden; }
  &__fold { display: block; width: calc(100% - 16px); margin: 2px 8px; border: 1px dashed var(--gn-border); color: var(--gn-muted); }
}
.sp__col .pl { grid-template-columns: 26px 38px minmax(0, 1fr); }
.sp__col--theirs .pl--on { background: color-mix(in srgb, var(--gn-renamed) 9%, transparent); }
.sp__col--mine .pl--on { background: color-mix(in srgb, var(--gn-accent) 9%, transparent); }
.sp__col--theirs .pl input { accent-color: var(--gn-renamed); }
.spl { display: grid; grid-template-columns: 38px minmax(0, 1fr); line-height: 19px; min-height: 19px; white-space: pre; }
.sp .card__edit { padding: 6px 8px; border-bottom: 0; }
.sp .note { margin: 2px 8px; }
</style>
