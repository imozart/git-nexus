<script lang="ts">
// Preferências e histórico da busca no arquivo: valem para todos os editores da sessão (abrir outro arquivo mantém "Aa", "ab" e ".*").
import { reactive, ref } from 'vue';
import { HISTORY_MAX, pushHistory } from '@git-nexus/ui-kit';

const KEY = 'gitnexus.find';
function load(): { caseSensitive: boolean; wholeWord: boolean; regex: boolean; history: string[] } {
  const base = { caseSensitive: false, wholeWord: false, regex: false, history: [] as string[] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<typeof base>;
    return {
      caseSensitive: raw.caseSensitive === true,
      wholeWord: raw.wholeWord === true,
      regex: raw.regex === true,
      history: Array.isArray(raw.history) ? raw.history.filter((h): h is string => typeof h === 'string').slice(-HISTORY_MAX) : [],
    };
  } catch {
    return base;
  }
}
const initial = load();
/** As três opções e o texto da última busca (volta preenchido quando não há seleção para usar). */
const prefs = reactive({ caseSensitive: initial.caseSensitive, wholeWord: initial.wholeWord, regex: initial.regex, last: '' });
const history = ref<string[]>(initial.history);
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ caseSensitive: prefs.caseSensitive, wholeWord: prefs.wholeWord, regex: prefs.regex, history: history.value }));
  } catch {
    /* sem armazenamento: a busca funciona do mesmo jeito, só não lembra */
  }
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref as vref, watch } from 'vue';
import { EditorView } from '@codemirror/view';
import { GnButton, GnIconButton, GnSearchField, GnTooltip, regexProblem } from '@git-nexus/ui-kit';
import { t } from '../i18n';
import { MARK_BUCKETS, analyze, makeQuery, matchesIn, nextMatch, seedText, type FindStats, type Span } from '../find-core';
import { findField, setFind } from '../find-ext';

const props = defineProps<{
  view: EditorView;
  /** Texto para começar (a seleção ou a palavra sob o cursor); vazio = o da última busca. */
  seed: string;
  /** Muda a cada edição ou mudança de seleção do editor: é o sinal para recontar. */
  revision: number;
}>();
const emit = defineEmits<{ (e: 'close'): void }>();

const text = vref(props.seed || prefs.last);
const field = vref<InstanceType<typeof GnSearchField>>();
const stats = vref<FindStats>({ total: 0, capped: false, current: 0 });
const marks = vref<number[]>([]);
const wrapNote = vref('');
let anchor = props.view.state.selection.main.from;
/** A seleção de várias linhas de quando a barra abriu: é o trecho do "Na seleção" (a busca incremental seleciona a ocorrência, e isso não conta). */
const selAtOpen = vref<Span | null>(null);
function captureSelection(): void {
  const sel = props.view.state.selection.main;
  selAtOpen.value = sel.empty || seedText(props.view.state) ? null : { from: sel.from, to: sel.to };
}
captureSelection();
let timer: ReturnType<typeof setTimeout> | undefined;
let wrapTimer: ReturnType<typeof setTimeout> | undefined;

const query = computed(() => makeQuery({ text: text.value, caseSensitive: prefs.caseSensitive, wholeWord: prefs.wholeWord, regex: prefs.regex }));
const error = computed(() => {
  const msg = prefs.regex && text.value ? regexProblem(text.value) : null;
  return msg ? t('find.regexError', { msg }) : '';
});
const labels = computed(() => ({ clear: t('find.clear'), caseSensitive: t('find.case'), wholeWord: t('find.word'), regex: t('find.regex') }));
/** O trecho "na seleção" (a fonte da verdade é o estado do editor: ele acompanha as edições). */
const range = (): Span | null => props.view.state.field(findField).range;
const selectionOnly = computed(() => props.revision >= 0 && range() !== null);
const hasSelection = computed(() => selAtOpen.value !== null);

const counter = computed(() => {
  if (!query.value) return '';
  const s = stats.value;
  if (s.total === 0) return t('find.none');
  const total = s.capped ? `${s.total}+` : String(s.total);
  if (s.current) return t('find.of', { i: s.current, total });
  return s.capped ? t('find.capped', { n: s.total }) : t('find.count', { n: s.total });
});
const none = computed(() => !!query.value && stats.value.total === 0);

let counted = false;
function recount(): void {
  clearTimeout(timer);
  const run = (): void => {
    const r = analyze(props.view.state, query.value, range());
    stats.value = r.stats;
    marks.value = r.marks;
    counted = true;
  };
  // a primeira contagem não espera; as seguintes (digitar, rolar, editar) juntam os pedidos de 60 ms
  if (!counted) run();
  else timer = setTimeout(run, 60);
}

function select(m: Span): void {
  props.view.dispatch({ selection: { anchor: m.from, head: m.to }, effects: EditorView.scrollIntoView(m.from, { y: 'center' }) });
}

/** Busca incremental: a cada letra, vai para a primeira ocorrência a partir de onde a pessoa estava (não a partir da ocorrência anterior). */
function incremental(): void {
  const q = query.value;
  if (!q) return;
  const r = range();
  const lo = r?.from ?? 0;
  const hi = r?.to ?? props.view.state.doc.length;
  const m = matchesIn(props.view.state, q, Math.max(lo, anchor), hi, 1)[0] ?? matchesIn(props.view.state, q, lo, hi, 1)[0];
  if (m) select(m);
}

function note(key: 'find.wrapEnd' | 'find.wrapStart'): void {
  wrapNote.value = t(key);
  clearTimeout(wrapTimer);
  wrapTimer = setTimeout(() => (wrapNote.value = ''), 2200);
}

/** Enter / Shift+Enter e os botões: próxima ou anterior, dando a volta no arquivo (e avisando). */
function go(backwards: boolean): void {
  const m = nextMatch(props.view.state, query.value, range(), backwards);
  if (!m) return;
  if (m.wrapped) note(backwards ? 'find.wrapStart' : 'find.wrapEnd');
  else wrapNote.value = '';
  select(m);
  anchor = m.from;
  remember();
}

/** Guarda a busca no histórico (quando a pessoa a USA: Enter ou navegar), não a cada letra digitada. */
function remember(): void {
  if (!text.value.trim() || !query.value) return;
  history.value = pushHistory(history.value, text.value);
  prefs.last = text.value;
  persist();
}

function toggleSelection(): void {
  const next: Span | null = selectionOnly.value ? null : selAtOpen.value;
  props.view.dispatch({ effects: setFind.of({ query: query.value, range: next }) });
}

watch(
  [query, () => props.revision],
  () => recount(),
  { flush: 'post' },
);
watch(query, (q, old) => {
  wrapNote.value = '';
  props.view.dispatch({ effects: setFind.of({ query: q, range: range() }) });
  if (q && (!old || !q.eq(old))) incremental();
  prefs.last = text.value;
});
watch(
  () => [prefs.caseSensitive, prefs.wholeWord, prefs.regex],
  () => persist(),
);

onMounted(() => {
  props.view.dispatch({ effects: setFind.of({ query: query.value, range: null }) });
  if (query.value) incremental();
  recount();
  field.value?.select();
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  clearTimeout(wrapTimer);
  remember();
  props.view.dispatch({ effects: setFind.of({ query: null, range: null }) });
});

/** Atalhos de dentro da barra (o foco está no campo, não no editor): Ctrl+F reabre, F3 e Ctrl+G navegam. */
function onKey(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    field.value?.select();
  } else if (e.key === 'F3' || (mod && !e.altKey && e.key.toLowerCase() === 'g')) {
    e.preventDefault();
    go(e.shiftKey);
  }
}

defineExpose({
  go,
  /** Abrir a busca de novo (Ctrl+F com a barra já aberta): com texto selecionado, troca a busca por ele; sempre foca e seleciona o campo. */
  reopen(seed: string) {
    if (seed) text.value = seed;
    captureSelection();
    anchor = props.view.state.selection.main.from;
    field.value?.select();
  },
});
</script>

<template>
  <div class="fb" role="search" :aria-label="t('find.region')" data-testid="find-bar" @keydown="onKey">
    <GnSearchField
      ref="field"
      v-model="text"
      v-model:case-sensitive="prefs.caseSensitive"
      v-model:whole-word="prefs.wholeWord"
      v-model:regex="prefs.regex"
      class="fb__field"
      :label="t('find.field')"
      :placeholder="t('find.placeholder')"
      :labels="labels"
      :error="error"
      :history="history"
      @enter="go"
      @escape="emit('close')"
    />
    <div class="fb__ctrls">
      <span class="fb__count" :class="{ 'fb__count--none': none }" role="status" aria-live="polite" data-testid="find-count">{{ counter }}<template v-if="wrapNote && query"> · {{ wrapNote }}</template></span>
      <GnIconButton icon="up" :label="t('find.prevName')" :title="t('find.prev')" :disabled="!query || stats.total === 0" data-testid="find-prev" @click="go(true)" />
      <GnIconButton icon="down" :label="t('find.nextName')" :title="t('find.next')" :disabled="!query || stats.total === 0" data-testid="find-next" @click="go(false)" />
      <GnButton
        size="sm"
        :tone="selectionOnly ? 'accent' : 'neutral'"
        :variant="selectionOnly ? undefined : 'ghost'"
        :aria-pressed="selectionOnly"
        :disabled="!selectionOnly && !hasSelection"
        data-testid="find-in-selection"
        @click="toggleSelection"
      >{{ t('find.inSelection') }}<GnTooltip :text="t('find.inSelectionTip')" /></GnButton>
      <GnIconButton icon="x" :label="t('find.close')" data-testid="find-close" @click="emit('close')" />
    </div>
  </div>
  <!-- marcas na barra de rolagem: onde, no arquivo, há ocorrências (decorativo: o contador é a informação) -->
  <div v-if="marks.length" class="fb__marks" aria-hidden="true" data-testid="find-marks">
    <i v-for="b in marks" :key="b" :style="{ top: (b / MARK_BUCKETS) * 100 + '%' }"></i>
  </div>
</template>

<style scoped lang="scss">
.fb {
  position: absolute; top: 6px; right: 18px; z-index: 5; box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 4px 6px;
  width: min(540px, calc(100% - 30px)); padding: 6px; background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: var(--gn-radius);
  box-shadow: var(--gn-shadow-md); font-family: var(--gn-font-ui);
}
.fb__field { flex: 1 1 210px; min-width: 0; }
.fb__ctrls { display: flex; align-items: center; flex: 0 1 auto; flex-wrap: nowrap; gap: 3px; min-height: 28px; margin-left: auto; }
.fb__count { min-width: 3.5em; padding: 0 4px; color: var(--gn-muted); font-size: 12px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.fb__count--none { color: var(--gn-danger); font-weight: 600; }
// ao lado da barra de rolagem do editor: faixa fina com uma marca por trecho que tem ocorrência
.fb__marks {
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 4; width: 7px; pointer-events: none;
  i { position: absolute; left: 1px; right: 1px; height: 3px; border-radius: 1px; background: var(--gn-warn); }
}
</style>
