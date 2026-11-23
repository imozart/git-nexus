<script lang="ts">
// Preferências e histórico da busca no arquivo: valem para todos os editores da sessão (abrir outro arquivo mantém "Aa", "ab" e ".*").
import { reactive, ref } from 'vue';
import { HISTORY_MAX, pushHistory } from '@git-nexus/ui-kit';

const KEY = 'gitnexus.find';
function load(): { caseSensitive: boolean; wholeWord: boolean; regex: boolean; preserveCase: boolean; history: string[]; replaceHistory: string[] } {
  const base = { caseSensitive: false, wholeWord: false, regex: false, preserveCase: false, history: [] as string[], replaceHistory: [] as string[] };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<typeof base>;
    return {
      caseSensitive: raw.caseSensitive === true,
      wholeWord: raw.wholeWord === true,
      regex: raw.regex === true,
      preserveCase: raw.preserveCase === true,
      history: Array.isArray(raw.history) ? raw.history.filter((h): h is string => typeof h === 'string').slice(-HISTORY_MAX) : [],
      replaceHistory: Array.isArray(raw.replaceHistory) ? raw.replaceHistory.filter((h): h is string => typeof h === 'string').slice(-HISTORY_MAX) : [],
    };
  } catch {
    return base;
  }
}
const initial = load();
/** As três opções e o texto da última busca (volta preenchido quando não há seleção para usar). */
const prefs = reactive({ caseSensitive: initial.caseSensitive, wholeWord: initial.wholeWord, regex: initial.regex, preserveCase: initial.preserveCase, last: '', lastReplace: '' });
const history = ref<string[]>(initial.history);
/** Textos de "Substituir por" usados antes (↑ e ↓ no campo). */
const replaceHistory = ref<string[]>(initial.replaceHistory);
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ caseSensitive: prefs.caseSensitive, wholeWord: prefs.wholeWord, regex: prefs.regex, preserveCase: prefs.preserveCase, history: history.value, replaceHistory: replaceHistory.value }));
  } catch {
    /* sem armazenamento: a busca funciona do mesmo jeito, só não lembra */
  }
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref as vref, watch } from 'vue';
import { EditorView } from '@codemirror/view';
import { GnButton, GnIconButton, GnSearchField, GnTooltip, regexProblem } from '@git-nexus/ui-kit';
import { t } from '../i18n';
import { MARK_BUCKETS, analyze, makeQuery, matchesIn, nextMatch, seedText, type FindStats, type Span } from '../find-core';
import { findField, setFind } from '../find-ext';
import { infoAt, planReplaceAll, replacementFor, selectAllMatches } from '../replace-core';

const props = defineProps<{
  view: EditorView;
  /** Texto para começar (a seleção ou a palavra sob o cursor); vazio = o da última busca. */
  seed: string;
  /** Abre já com o campo "Substituir por" (Ctrl+H). */
  replace?: boolean;
  /** Muda a cada edição ou mudança de seleção do editor: é o sinal para recontar. */
  revision: number;
}>();
const emit = defineEmits<{ (e: 'close'): void }>();

const text = vref(props.seed || prefs.last);
const field = vref<InstanceType<typeof GnSearchField>>();
const stats = vref<FindStats>({ total: 0, capped: false, current: 0 });
const marks = vref<number[]>([]);
const wrapNote = vref('');
/** Somente leitura: só busca (sem campo "Substituir por"). */
const readOnly = props.view.state.readOnly;
const replaceOpen = vref(!!props.replace && !readOnly);
const replaceText = vref(prefs.lastReplace);
const replaceField = vref<InstanceType<typeof GnSearchField>>();
/** A ocorrência atual e como ficará (prévia). */
const preview = vref<{ from: string; to: string } | null>(null);
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
    updatePreview();
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

/** Aviso curto ao lado do contador (a região é role="status": o leitor de tela anuncia). */
function say(text: string, ms = 2200): void {
  wrapNote.value = text;
  clearTimeout(wrapTimer);
  wrapTimer = setTimeout(() => (wrapNote.value = ''), ms);
}
const note = (key: 'find.wrapEnd' | 'find.wrapStart'): void => say(t(key));

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

// ---------- substituir ----------
const canReplace = computed(() => !!query.value && stats.value.total > 0 && !error.value);
const ropts = () => ({ regex: prefs.regex, preserveCase: prefs.preserveCase });
const shown = (s: string): string => (s.length > 60 ? s.slice(0, 59) + '…' : s).replace(/\r\n|\r|\n/g, '↵').replace(/\t/g, '⇥');

/** A prévia da ocorrência atual: o trecho achado e o texto novo (com grupos, escapes e caixa). */
function updatePreview(): void {
  const q = query.value;
  const st = props.view.state;
  const sel = st.selection.main;
  const m = replaceOpen.value && q && stats.value.current > 0 ? infoAt(st, q, range(), { from: sel.from, to: sel.to }) : null;
  preview.value = m ? { from: shown(m.text), to: shown(replacementFor(replaceText.value, m, ropts(), st.lineBreak)) } : null;
}

function rememberReplace(): void {
  prefs.lastReplace = replaceText.value;
  replaceHistory.value = pushHistory(replaceHistory.value, replaceText.value);
  persist();
}

/** Substituir (botão e Enter no campo novo): troca a ocorrência selecionada e vai para a próxima; se a seleção não é uma ocorrência, só vai para a primeira. */
function replaceOne(): void {
  const q = query.value;
  if (!q || readOnly) return;
  const st = props.view.state;
  const sel = st.selection.main;
  const m = infoAt(st, q, range(), { from: sel.from, to: sel.to });
  if (!m) {
    go(false);
    return;
  }
  const insert = replacementFor(replaceText.value, m, ropts(), st.lineBreak);
  const end = m.from + insert.length;
  props.view.dispatch({ changes: { from: m.from, to: m.to, insert }, selection: { anchor: end }, userEvent: 'input.replace' });
  rememberReplace();
  anchor = end;
  go(false);
}

/** Substituir todas: UMA transação (um Ctrl+Z desfaz tudo) e o aviso diz quantas. */
function replaceAll(): void {
  const q = query.value;
  if (!q || readOnly) return;
  const plan = planReplaceAll(props.view.state, q, range(), replaceText.value, ropts());
  if (plan.tooMany) return say(t('find.tooMany'), 5000);
  if (!plan.count) return;
  props.view.dispatch({ changes: plan.changes, userEvent: 'input.replace.all' });
  rememberReplace();
  say(t('find.replacedAll', { n: plan.count }), 5000);
}

/** Selecionar todas as ocorrências (vários cursores): o foco volta ao editor, onde digitar troca todas de uma vez. */
function selectAll(): void {
  const q = query.value;
  if (!q) return;
  const r = selectAllMatches(props.view.state, q, range());
  if (!r) return;
  props.view.dispatch({ selection: r.selection, effects: EditorView.scrollIntoView(r.selection.main.head, { y: 'center' }), userEvent: 'select' });
  say(r.capped ? t('find.selectedCapped', { n: r.count }) : t('find.selected', { n: r.count }), 5000);
  props.view.focus();
}

function openReplace(focusIt: boolean): void {
  if (readOnly) return;
  replaceOpen.value = true;
  if (focusIt) void nextTick(() => replaceField.value?.select());
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
  () => [prefs.caseSensitive, prefs.wholeWord, prefs.regex, prefs.preserveCase],
  () => persist(),
);
watch([replaceText, () => prefs.preserveCase, () => prefs.regex, replaceOpen], () => updatePreview());

onMounted(() => {
  props.view.dispatch({ effects: setFind.of({ query: query.value, range: null }) });
  if (query.value) incremental();
  recount();
  if (replaceOpen.value && text.value) void nextTick(() => replaceField.value?.select());
  else field.value?.select();
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
  } else if (mod && !e.altKey && e.key.toLowerCase() === 'h') {
    e.preventDefault();
    openReplace(true);
  } else if (e.key === 'Enter' && e.altKey) {
    // Alt+Enter: selecionar todas as ocorrências; Ctrl+Alt+Enter: substituir todas
    e.preventDefault();
    if (mod) replaceAll();
    else selectAll();
  }
}

defineExpose({
  go,
  /** Abrir a busca de novo (Ctrl+F com a barra já aberta): com texto selecionado, troca a busca por ele; sempre foca e seleciona o campo. */
  reopen(seed: string, withReplace = false) {
    if (seed) text.value = seed;
    captureSelection();
    anchor = props.view.state.selection.main.from;
    if (withReplace && !readOnly) {
      replaceOpen.value = true;
      void nextTick(() => (text.value ? replaceField.value?.select() : field.value?.select()));
    } else field.value?.select();
  },
});
</script>

<template>
  <div class="fb" role="search" :aria-label="t('find.region')" data-testid="find-bar" @keydown="onKey">
    <GnIconButton
      v-if="!readOnly"
      class="fb__toggle"
      :icon="replaceOpen ? 'chevron-down' : 'chevron-right'"
      :label="t('find.toggleReplace')"
      :title="t('find.toggleReplaceTip')"
      :aria-expanded="replaceOpen"
      data-testid="find-toggle-replace"
      @click="replaceOpen ? (replaceOpen = false) : openReplace(true)"
    />
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
    <div v-if="replaceOpen && !readOnly" class="fb__row2" data-testid="find-replace-row">
      <GnSearchField
        ref="replaceField"
        v-model="replaceText"
        variant="replace"
        class="fb__field"
        :label="t('find.replaceField')"
        :placeholder="t('find.replacePlaceholder')"
        :labels="labels"
        :history="replaceHistory"
        @enter="replaceOne"
        @escape="emit('close')"
      />
      <div class="fb__ctrls">
        <GnButton size="sm" :disabled="!canReplace" data-testid="find-replace-one" @click="replaceOne">{{ t('find.replaceOne') }}<GnTooltip :text="t('find.replaceOneTip')" /></GnButton>
        <GnButton size="sm" :disabled="!canReplace" :aria-label="t('find.replaceAllName')" data-testid="find-replace-all" @click="replaceAll">{{ t('find.replaceAll') }}<GnTooltip :text="t('find.replaceAllTip')" /></GnButton>
        <GnButton
          size="sm"
          :tone="prefs.preserveCase ? 'accent' : 'neutral'"
          :variant="prefs.preserveCase ? undefined : 'ghost'"
          :aria-pressed="prefs.preserveCase"
          data-testid="find-preserve-case"
          @click="prefs.preserveCase = !prefs.preserveCase"
        >{{ t('find.preserveCase') }}<GnTooltip :text="t('find.preserveCaseTip')" /></GnButton>
        <GnButton size="sm" variant="ghost" :disabled="!query || stats.total === 0" data-testid="find-select-all" @click="selectAll">{{ t('find.selectAll') }}<GnTooltip :text="t('find.selectAllTip')" /></GnButton>
      </div>
      <div v-if="preview" class="fb__preview" data-testid="find-preview">{{ t('find.preview') }}: <code>{{ preview.from }}</code> → <code>{{ preview.to }}</code></div>
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
.fb__toggle.gn-btn { align-self: flex-start; margin-top: 1px; }
// segunda linha (substituir): alinhada ao campo de cima, que fica depois do botão de abrir/fechar
.fb__row2 { display: flex; flex-wrap: wrap; flex: 1 0 100%; align-items: flex-start; gap: 4px 6px; padding-left: 30px; box-sizing: border-box; }
.fb__preview {
  flex: 1 0 100%; min-width: 0; overflow: hidden; color: var(--gn-muted); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap;
  code { padding: 0 3px; border-radius: var(--gn-radius-sm); background: var(--gn-surface-2); color: var(--gn-text); font-family: var(--gn-mono); font-size: 11.5px; }
}
.fb__ctrls { display: flex; align-items: center; flex: 0 1 auto; flex-wrap: nowrap; gap: 3px; min-height: 28px; margin-left: auto; }
.fb__count { min-width: 3.5em; padding: 0 4px; color: var(--gn-muted); font-size: 12px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.fb__count--none { color: var(--gn-danger); font-weight: 600; }
// ao lado da barra de rolagem do editor: faixa fina com uma marca por trecho que tem ocorrência
.fb__marks {
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 4; width: 7px; pointer-events: none;
  i { position: absolute; left: 1px; right: 1px; height: 3px; border-radius: 1px; background: var(--gn-warn); }
}
</style>
