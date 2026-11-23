<script lang="ts">
// Preferências da janela: valem entre aberturas (a janela "reabre onde estava": texto, opções, máscaras e a divisória).
import { reactive } from 'vue';
import { clampSplit } from '../search-window-core';

const KEY = 'gitnexus.searchWindow';
function load() {
  const base = { pattern: '', regex: false, caseSensitive: false, wholeWord: false, include: '', split: 0.4 };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<typeof base>;
    return {
      pattern: typeof raw.pattern === 'string' ? raw.pattern.slice(0, 4000) : '',
      regex: raw.regex === true,
      caseSensitive: raw.caseSensitive === true,
      wholeWord: raw.wholeWord === true,
      include: typeof raw.include === 'string' ? raw.include.slice(0, 500) : '',
      split: clampSplit(typeof raw.split === 'number' ? raw.split : base.split),
    };
  } catch {
    return base;
  }
}
const prefs = reactive(load());
/** A última ocorrência aberta (por repositório): a janela volta a ela ao reabrir. */
const lastOpen = new Map<string, string>();
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* sem armazenamento: funciona do mesmo jeito, só não lembra */
  }
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { GnBadge, GnButton, GnDialog, GnIcon, GnIconButton, GnSearchField, GnTooltip, regexProblem } from '@git-nexus/ui-kit';
import { encodingLabel, type RepositoryMeta, type SearchDone, type SearchHit, type WorkingFileInfo } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { locale, t, type MessageKey } from '../i18n';
import { useWorkspaceStore } from '../stores/workspace';
import CodeEditor from './CodeEditor.vue';
import {
  ROW_H,
  ResultModel,
  changedOutside,
  formatDuration,
  marksOf,
  pieces,
  readOnlyReason,
  scrollToRow,
  stepFile,
  stepHit,
  windowRange,
  type Mark,
  type Row,
} from '../search-window-core';

const props = defineProps<{ repo: RepositoryMeta; seed: string; openN: number }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const ws = useWorkspaceStore();

// ---------- busca ----------
const model = new ResultModel();
const rows = shallowRef<Row[]>([]);
const collapsed = ref(new Set<string>());
const done = ref<SearchDone | null>(null);
const running = ref(false);
const live = ref({ hits: 0, files: 0 });
const selectedKey = ref<string | null>(null);
let seq = 0;
let currentId = '';
let pending: SearchHit[] = [];
let doneEvent: SearchDone | null = null;
/** Temporizador (não `requestAnimationFrame`) que leva os lotes para a lista: com a janela em segundo plano os quadros param, e o fim da busca nunca seria aplicado. */
let raf: ReturnType<typeof setTimeout> | 0 = 0;
const FRAME_MS = 16;
let timer: ReturnType<typeof setTimeout> | undefined;

const patternError = computed(() => {
  const m = prefs.regex && prefs.pattern ? regexProblem(prefs.pattern) : null;
  return m ? t('find.regexError', { msg: m }) : '';
});
const fieldLabels = computed(() => ({ clear: t('find.clear'), caseSensitive: t('find.case'), wholeWord: t('find.word'), regex: t('find.regex') }));

/** Os lotes chegam em ondas: cada quadro leva no máximo isto para a lista, e a interface nunca fica parada com 5 mil ocorrências de uma vez. */
const PER_FRAME = 1200;

/** Refazer a busca por causa de uma gravação (e não de uma digitação): a lista antiga fica na tela até chegar o primeiro lote novo (nada de piscar vazio). */
let replaceOnFirst = false;

const schedule = (): void => {
  if (!raf) raf = setTimeout(flush, FRAME_MS);
};

function flush(): void {
  raf = 0;
  if (pending.length) {
    if (replaceOnFirst) {
      model.clear();
      replaceOnFirst = false;
    }
    model.add(pending.splice(0, PER_FRAME));
    rows.value = model.rows(collapsed.value);
    live.value = { hits: model.total, files: model.files };
  }
  if (pending.length) schedule();
  else if (doneEvent) finish();
}

function finish(): void {
  if (replaceOnFirst) {
    // a busca nova terminou sem nenhuma ocorrência: a lista velha sai agora
    model.clear();
    rows.value = [];
    live.value = { hits: 0, files: 0 };
    replaceOnFirst = false;
  }
  done.value = doneEvent;
  doneEvent = null;
  running.value = false;
  if (done.value && !done.value.ok) searchError.value = done.value.message ?? t('sw.failed');
  afterResults();
}

function resetResults(): void {
  model.clear();
  pending = [];
  doneEvent = null;
  if (raf) clearTimeout(raf);
  raf = 0;
  rows.value = [];
  live.value = { hits: 0, files: 0 };
  done.value = null;
  searchError.value = '';
}

const searchError = ref('');

async function run(keep = false): Promise<void> {
  clearTimeout(timer);
  if (currentId) void api.cancelSearch(currentId).catch(() => undefined);
  const pattern = prefs.pattern;
  currentId = '';
  if (keep && model.total) {
    pending = [];
    doneEvent = null;
    if (raf) clearTimeout(raf);
    raf = 0;
    searchError.value = '';
    replaceOnFirst = true;
  } else {
    replaceOnFirst = false;
    resetResults();
  }
  if (!pattern.trim() || patternError.value) {
    running.value = false;
    return;
  }
  const id = `sw${++seq}-${Date.now().toString(36)}`;
  currentId = id;
  running.value = true;
  try {
    await api.startSearch(
      props.repo.path,
      { pattern, regex: prefs.regex, caseSensitive: prefs.caseSensitive, wholeWord: prefs.wholeWord, include: prefs.include.trim() || undefined, limit: 5000 },
      id,
    );
  } catch (e) {
    if (currentId === id) {
      running.value = false;
      searchError.value = errMsg(e);
    }
  }
}

function later(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void run(), 250);
}
watch(
  () => [prefs.pattern, prefs.regex, prefs.caseSensitive, prefs.wholeWord, prefs.include],
  () => {
    persist();
    // expressão inválida: os resultados velhos saem na hora (não ficam na tela dizendo o que a pesquisa anterior achou)
    if (patternError.value || !prefs.pattern.trim()) {
      clearTimeout(timer);
      if (currentId) void api.cancelSearch(currentId).catch(() => undefined);
      currentId = '';
      running.value = false;
      resetResults();
    } else later();
  },
);

function stop(): void {
  if (currentId) void api.cancelSearch(currentId).catch(() => undefined);
}

let offBatch: (() => void) | undefined;
let offDone: (() => void) | undefined;

const counter = computed(() => {
  if (patternError.value) return '';
  if (running.value) return t('sw.searching', { n: live.value.hits });
  const d = done.value;
  if (!d || !d.ok) return '';
  if (!d.hits) return `${t('sw.none')} · ${formatDuration(d.ms, locale.value)}`;
  return `${t('search.matches', { n: d.hits })} ${t('search.inFiles', { n: d.files })} · ${formatDuration(d.ms, locale.value)}`;
});
const notes = computed(() => {
  const d = done.value;
  const out: string[] = [];
  if (d?.truncated) out.push(t('sw.truncated', { n: d.hits }));
  if (d?.skipped.length) out.push(t('sw.skipped', { n: d.skipped.length }));
  return out.join(' · ');
});

// ---------- lista virtualizada ----------
const listEl = ref<HTMLElement>();
const scrollTop = ref(0);
const viewport = ref(300);
let ro: ResizeObserver | undefined;
const range = computed(() => windowRange(scrollTop.value, viewport.value, rows.value.length));
const visible = computed(() => {
  const { start, end } = range.value;
  return Array.from({ length: end - start }, (_, k) => ({ i: start + k, row: rows.value[start + k]! }));
});
let scrollRaf = 0;
function onScroll(): void {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    scrollTop.value = listEl.value?.scrollTop ?? 0;
  });
}
function ensureVisible(index: number): void {
  const el = listEl.value;
  if (!el) return;
  const to = scrollToRow(index, el.scrollTop, el.clientHeight);
  if (to !== null) el.scrollTop = to;
}
const selectedIndex = computed(() => (selectedKey.value === null ? -1 : rows.value.findIndex((r) => r.key === selectedKey.value)));

function toggleFile(file: string): void {
  const next = new Set(collapsed.value);
  if (!next.delete(file)) next.add(file);
  collapsed.value = next;
  rows.value = model.rows(next);
}

// ---------- arquivo aberto ----------
interface Open {
  file: string;
  info: WorkingFileInfo;
  /** O texto como foi lido do disco (para saber se está alterado). */
  original: string;
  /** Muda a cada leitura: recria o editor (o fim de linha e as marcas dependem do texto lido). */
  n: number;
}
const cur = ref<Open | null>(null);
const editText = ref('');
const loadingFile = ref(false);
const marks = ref<Mark[]>([]);
const editorRef = ref<InstanceType<typeof CodeEditor>>();
let loadN = 0;
let openSeq = 0;

const roReason = computed(() => (cur.value ? readOnlyReason(cur.value.info) : null));
const readOnly = computed(() => roReason.value !== null);
const dirty = computed(() => !!cur.value && !readOnly.value && editText.value !== cur.value.original);
const eolLabel = computed(() => (cur.value ? (cur.value.info.eol === 'crlf' ? 'CRLF' : cur.value.info.eol === 'lf' ? 'LF' : cur.value.info.eol === 'mixed' ? t('sw.eolMixed') : '') : ''));

const notice = ref<{ kind: 'ok' | 'error'; text: string } | null>(null);
const external = ref<'changed' | 'gone' | null>(null);

function lineMarks(text: string, file: string): Mark[] {
  const lines = text.split(/\r\n|\r|\n/);
  return model.hitsOf(file).flatMap((h) => marksOf(h, lines[h.line - 1] ?? ''));
}
function refreshMarks(): void {
  if (cur.value) marks.value = lineMarks(cur.value.original, cur.value.file);
}

async function loadFile(file: string): Promise<boolean> {
  const mine = ++openSeq;
  loadingFile.value = true;
  external.value = null;
  try {
    const info = await api.readWorkingFile(props.repo.path, file);
    if (mine !== openSeq) return false;
    cur.value = { file, info, original: info.text, n: ++loadN };
    editText.value = info.text;
    marks.value = lineMarks(info.text, file);
    return true;
  } catch (e) {
    if (mine === openSeq) notice.value = { kind: 'error', text: errMsg(e) };
    return false;
  } finally {
    if (mine === openSeq) loadingFile.value = false;
  }
}

/** Abre a ocorrência: carrega o arquivo (se for outro), leva o editor à linha e, com `focus`, entrega o foco a ele. */
async function openHit(hit: SearchHit, focus = false): Promise<void> {
  if (cur.value?.file !== hit.file) {
    if (!(await guard())) return;
    if (!(await loadFile(hit.file))) return;
  }
  lastOpen.set(props.repo.id, hitKeyOf(hit));
  await nextTick();
  const line = editText.value.split(/\r\n|\r|\n/)[hit.line - 1] ?? '';
  const m = marksOf(hit, line)[0];
  editorRef.value?.reveal(hit.line, m?.from ?? 0, m?.to ?? 0, focus);
}
const hitKeyOf = (h: SearchHit): string => `${h.file}:${h.line}`;

let navTimer: ReturnType<typeof setTimeout> | undefined;
/** Selecionar pela lista: a lista anda na hora e o arquivo abre um instante depois (setas seguidas não leem um arquivo por tecla). */
function select(index: number, opts: { open?: boolean; focus?: boolean; now?: boolean } = {}): void {
  const r = rows.value[index];
  if (!r || r.kind !== 'hit') return;
  selectedKey.value = r.key;
  ensureVisible(index);
  if (opts.open === false) return;
  clearTimeout(navTimer);
  const go = (): void => void openHit(r.hit, opts.focus);
  if (opts.now || opts.focus) go();
  else navTimer = setTimeout(go, 70);
}

function onRowClick(i: number, r: Row): void {
  if (r.kind === 'file') toggleFile(r.file);
  else select(i, { now: true });
}

// ---------- teclado ----------
function move(delta: 1 | -1, wrap = false): void {
  const i = stepHit(rows.value, selectedKey.value, delta, wrap);
  if (i >= 0) select(i);
}
function moveFile(delta: 1 | -1): void {
  const i = stepFile(rows.value, selectedKey.value, delta);
  if (i >= 0) select(i);
}
function openSelected(focus: boolean): void {
  const i = selectedIndex.value >= 0 ? selectedIndex.value : stepHit(rows.value, null, 1);
  if (i >= 0) select(i, { now: true, focus });
}

function onKey(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey;
  const target = e.target as HTMLElement;
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void save(false);
    return;
  }
  if (e.defaultPrevented) return; // o editor (a barra de busca do arquivo) já tratou
  if (mod && e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    moveFile(e.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (e.key === 'F3' && !target.closest('.cm-editor')) {
    e.preventDefault();
    move(e.shiftKey ? -1 : 1, true);
    return;
  }
  const inList = !!target.closest('.sw__head, .sw__list');
  if (inList && !mod && !e.altKey && !e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    move(e.key === 'ArrowDown' ? 1 : -1);
  } else if (inList && !mod && !e.altKey && e.key === 'Enter' && target.closest('.sw__list')) {
    e.preventDefault();
    openSelected(true);
  }
}

function onFieldEnter(): void {
  if (running.value || !done.value) {
    clearTimeout(timer);
    void run();
    return;
  }
  openSelected(true);
}

// ---------- gravar ----------
const saving = ref(false);

async function save(force: boolean): Promise<boolean> {
  const c = cur.value;
  if (!c || readOnly.value || saving.value) return false;
  if (!force && !dirty.value) return true;
  saving.value = true;
  notice.value = null;
  try {
    const r = await api.saveWorkingFile(props.repo.path, c.file, editText.value, { encoding: c.info.encoding, expectHash: c.info.hash, force });
    if (r.ok) {
      c.info = { ...c.info, hash: r.stamp.hash, size: r.stamp.size, mtimeMs: r.stamp.mtimeMs };
      c.original = editText.value;
      external.value = null;
      notice.value = { kind: 'ok', text: t('sw.saved') };
      ws.bump(props.repo.id);
      void run(true); // a lista se reajusta ao que ficou no disco
      return true;
    }
    if (r.reason === 'unencodable') notice.value = { kind: 'error', text: t('sw.unencodable', { char: r.char ?? '?', enc: encodingLabel(c.info.encoding) }) };
    else if (r.reason === 'changed') {
      notice.value = null;
      external.value = r.stamp ? 'changed' : 'gone';
    }
    else notice.value = { kind: 'error', text: t('sw.saveFailed', { msg: r.message }) };
    return false;
  } catch (e) {
    notice.value = { kind: 'error', text: t('sw.saveFailed', { msg: errMsg(e) }) };
    return false;
  } finally {
    saving.value = false;
  }
}

function revert(): void {
  const c = cur.value;
  if (!c) return;
  editText.value = c.original;
  cur.value = { ...c, n: ++loadN }; // recria o editor com o texto do disco
}

async function reload(): Promise<void> {
  if (cur.value) await loadFile(cur.value.file);
}

// ---------- mudou por fora? ----------
let checking = false;
async function checkExternal(): Promise<void> {
  const c = cur.value;
  if (!c || checking || saving.value) return;
  checking = true;
  try {
    const s = await api.stampWorkingFile(props.repo.path, c.file);
    if (cur.value !== c) return;
    if (!changedOutside({ hash: c.info.hash, size: c.info.size }, s)) {
      external.value = null;
      return;
    }
    if (!dirty.value) {
      const file = c.file;
      if (await loadFile(file)) {
        notice.value = { kind: 'ok', text: s ? t('sw.reloaded') : t('sw.ro.missing') };
        void run(true);
      }
    } else {
      notice.value = null;
      external.value = s ? 'changed' : 'gone';
    }
  } catch {
    /* sem resposta: a próxima tentativa (foco da janela, gravar) refaz */
  } finally {
    checking = false;
  }
}

// ---------- alterações não salvas ----------
const prompt = ref<{ file: string; resolve: (ok: boolean) => void } | null>(null);
/** Pergunta (Salvar / Descartar / Ficar) antes de sair de um arquivo alterado. Devolve se pode seguir. */
function guard(): Promise<boolean> {
  if (!dirty.value || !cur.value) return Promise.resolve(true);
  return new Promise((resolve) => {
    prompt.value = { file: cur.value!.file, resolve };
  });
}
function answer(a: 'save' | 'discard' | 'stay'): void {
  const p = prompt.value;
  if (!p) return;
  prompt.value = null;
  if (a === 'stay') return p.resolve(false);
  if (a === 'discard') {
    if (cur.value) editText.value = cur.value.original;
    return p.resolve(true);
  }
  void save(false).then((ok) => p.resolve(ok));
}

async function requestClose(): Promise<void> {
  if (await guard()) emit('close');
}

// ---------- ações do arquivo ----------
async function goTool(mode: 'history' | 'blame'): Promise<void> {
  const c = cur.value;
  if (!c || !(await guard())) return;
  emit('close');
  ws.openTools(props.repo, 'file', c.file, mode);
}
async function copyRef(): Promise<void> {
  const c = cur.value;
  const h = rows.value[selectedIndex.value];
  if (c) await api.copyText(h && h.kind === 'hit' ? `${c.file}:${h.hit.line}` : c.file).catch(() => undefined);
}
async function openOutside(): Promise<void> {
  if (cur.value) await api.openPath(props.repo.path, cur.value.file).catch(() => undefined);
}

// ---------- divisória ----------
const bodyEl = ref<HTMLElement>();
let dragging = false;
function onSplitDown(e: PointerEvent): void {
  dragging = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onSplitMove(e: PointerEvent): void {
  if (!dragging || !bodyEl.value) return;
  const r = bodyEl.value.getBoundingClientRect();
  prefs.split = clampSplit((e.clientY - r.top) / r.height);
}
function onSplitUp(): void {
  if (!dragging) return;
  dragging = false;
  persist();
}
function onSplitKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  prefs.split = clampSplit(prefs.split + (e.key === 'ArrowDown' ? 0.04 : -0.04));
  persist();
}

// ---------- ciclo de vida ----------
const field = ref<InstanceType<typeof GnSearchField>>();

/** Depois da busca: mantém a seleção se a ocorrência ainda existe, reabre a última (ao reabrir a janela) e refaz as marcas do arquivo aberto. */
function afterResults(): void {
  refreshMarks();
  const want = selectedKey.value ?? lastOpen.get(props.repo.id) ?? null;
  const idx = want ? rows.value.findIndex((r) => r.key === want) : -1;
  if (idx >= 0) {
    const r = rows.value[idx]!;
    selectedKey.value = r.key;
    void nextTick(() => ensureVisible(idx));
    if (r.kind === 'hit' && cur.value?.file !== r.file) void openHit(r.hit);
  } else if (selectedKey.value) selectedKey.value = null;
}

function applySeed(): void {
  if (props.seed) prefs.pattern = props.seed;
  void nextTick(() => field.value?.select());
}

watch(() => props.openN, () => {
  applySeed();
  if (props.seed) void run();
});

onMounted(() => {
  offBatch = api.onSearchBatch((e) => {
    if (e.id !== currentId) return;
    pending.push(...e.hits);
    schedule();
  });
  offDone = api.onSearchDone((e) => {
    if (e.id !== currentId) return;
    doneEvent = e;
    if (!pending.length && !raf) finish();
    else schedule();
  });
  if (listEl.value) {
    viewport.value = listEl.value.clientHeight;
    ro = new ResizeObserver(() => (viewport.value = listEl.value?.clientHeight ?? viewport.value));
    ro.observe(listEl.value);
  }
  window.addEventListener('focus', checkExternal);
  applySeed();
  if (prefs.pattern.trim()) void run();
});
onBeforeUnmount(() => {
  clearTimeout(timer);
  clearTimeout(navTimer);
  if (raf) clearTimeout(raf);
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  if (currentId) void api.cancelSearch(currentId).catch(() => undefined);
  offBatch?.();
  offDone?.();
  ro?.disconnect();
  window.removeEventListener('focus', checkExternal);
});

// o estado recolhido vai no nome (e não em aria-expanded: o diálogo trata um aria-expanded="true" na caixa como "lista aberta" e deixaria de fechar com Esc)
const rowLabel = (r: Row): string => (r.kind === 'file' ? t('sw.rowFile', { file: r.file, n: r.count }) + (r.collapsed ? ' ' + t('sw.collapsed') : '') : t('sw.rowHit', { line: r.hit.line, text: r.hit.text }));
const status = computed(() => (running.value ? '' : counter.value));
const emptyHint = computed(() => (!prefs.pattern.trim() ? t('sw.hint') : ''));
const splitPct = computed(() => Math.round(prefs.split * 100));
</script>

<template>
  <GnDialog width="min(1500px, 96vw)" max-height="90vh" :label="t('sw.label')" initial-focus="[data-testid='sf-input']" @close="requestClose">
    <div class="sw" data-testid="search-window" @keydown="onKey">
      <header class="sw__head">
        <GnSearchField
          ref="field"
          v-model="prefs.pattern"
          v-model:case-sensitive="prefs.caseSensitive"
          v-model:whole-word="prefs.wholeWord"
          v-model:regex="prefs.regex"
          class="sw__field"
          :label="t('sw.field')"
          :placeholder="t('sw.placeholder')"
          :labels="fieldLabels"
          :error="patternError"
          @enter="onFieldEnter"
        />
        <label class="sw__masks">
          <span>{{ t('sw.masks') }}</span>
          <input v-model="prefs.include" data-testid="sw-masks" :placeholder="t('sw.masksPh')" spellcheck="false" autocomplete="off" />
        </label>
        <span class="sw__count" data-testid="sw-count" role="status" aria-live="polite">{{ running ? t('sw.searching', { n: live.hits }) : status }}</span>
        <GnButton v-if="running" size="sm" tone="warn" data-testid="sw-stop" @click="stop">{{ t('sw.stop') }}</GnButton>
        <GnIconButton icon="x" :label="t('sw.close')" data-testid="sw-close" @click="requestClose" />
      </header>
      <p v-if="searchError" class="sw__error" role="alert" data-testid="sw-error">{{ searchError }}</p>
      <p v-else-if="notes" class="sw__notes" data-testid="sw-notes">{{ notes }}</p>

      <div ref="bodyEl" class="sw__body">
        <section class="sw__results" :style="{ flexBasis: splitPct + '%' }">
          <p v-if="emptyHint" class="sw__hint" data-testid="sw-hint">{{ emptyHint }}</p>
          <p v-else-if="done?.ok && !done.hits" class="sw__hint" data-testid="sw-empty">{{ t('search.none') }}</p>
          <div
            ref="listEl"
            class="sw__list"
            role="listbox"
            tabindex="0"
            :aria-label="t('sw.results')"
            :aria-activedescendant="selectedIndex >= 0 ? 'sw-r' + selectedIndex : undefined"
            data-testid="sw-list"
            @scroll="onScroll"
          >
            <div class="sw__spacer" :style="{ height: rows.length * ROW_H + 'px' }">
              <div class="sw__rows" :style="{ transform: `translateY(${range.start * ROW_H}px)` }">
                <div
                  v-for="v in visible"
                  :id="'sw-r' + v.i"
                  :key="v.row.key"
                  class="sw__row"
                  :class="{ 'sw__row--file': v.row.kind === 'file', 'sw__row--sel': v.row.key === selectedKey }"
                  role="option"
                  :aria-selected="v.row.key === selectedKey"
                  :aria-label="rowLabel(v.row)"
                  :data-testid="v.row.kind === 'file' ? 'sw-file-row' : 'sw-row'"
                  @click="onRowClick(v.i, v.row)"
                >
                  <template v-if="v.row.kind === 'file'">
                    <GnIcon :name="v.row.collapsed ? 'chevron-right' : 'chevron-down'" />
                    <span class="sw__fname">{{ v.row.file }}</span>
                    <GnBadge tone="neutral">{{ v.row.count }}</GnBadge>
                  </template>
                  <template v-else>
                    <span class="sw__ln">{{ v.row.hit.line }}</span>
                    <span class="sw__text"><template v-for="(p, k) in pieces(v.row.hit)" :key="k"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></span>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div
          class="sw__split"
          role="separator"
          aria-orientation="horizontal"
          tabindex="0"
          :aria-label="t('sw.split')"
          :aria-valuenow="splitPct"
          aria-valuemin="15"
          aria-valuemax="85"
          data-testid="sw-split"
          @pointerdown="onSplitDown"
          @pointermove="onSplitMove"
          @pointerup="onSplitUp"
          @keydown="onSplitKey"
        ></div>

        <section class="sw__file" data-testid="sw-file">
          <template v-if="cur">
            <div class="sw__fbar">
              <span class="sw__path" data-testid="sw-path">{{ cur.file }}</span>
              <GnBadge tone="neutral" data-testid="sw-encoding">{{ encodingLabel(cur.info.encoding) }}</GnBadge>
              <GnBadge v-if="eolLabel" tone="neutral" data-testid="sw-eol">{{ eolLabel }}</GnBadge>
              <GnBadge v-if="dirty" tone="warn" data-testid="sw-dirty">{{ t('sw.modified') }}</GnBadge>
              <span class="sw__spacer2"></span>
              <GnButton size="sm" variant="primary" :disabled="!dirty || saving" data-testid="sw-save" @click="save(false)">{{ t('sw.save') }}<GnTooltip :text="t('sw.saveTip')" /></GnButton>
              <GnButton size="sm" :disabled="!dirty" data-testid="sw-revert" @click="revert">{{ t('sw.revert') }}<GnTooltip :text="t('sw.revertTip')" /></GnButton>
              <GnButton size="sm" variant="ghost" data-testid="sw-history" @click="goTool('history')">{{ t('sw.history') }}</GnButton>
              <GnButton size="sm" variant="ghost" data-testid="sw-blame" @click="goTool('blame')">{{ t('sw.blame') }}</GnButton>
              <GnButton size="sm" variant="ghost" data-testid="sw-copy" @click="copyRef">{{ t('sw.copyRef') }}</GnButton>
              <GnButton size="sm" variant="ghost" data-testid="sw-open-out" @click="openOutside">{{ t('sw.openOut') }}</GnButton>
            </div>
            <p v-if="roReason" class="sw__ro" role="note" data-testid="sw-readonly">{{ t(('sw.ro.' + roReason) as MessageKey) }}</p>
            <div v-if="external" class="sw__external" role="alert" data-testid="sw-external">
              <span>{{ external === 'gone' ? t('sw.changedGone') : t('sw.changed') }}</span>
              <GnButton size="sm" data-testid="sw-reload" @click="reload">{{ t('sw.reload') }}</GnButton>
              <GnButton v-if="external === 'changed' || dirty" size="sm" tone="warn" data-testid="sw-overwrite" @click="save(true)">{{ t('sw.overwrite') }}</GnButton>
              <GnButton size="sm" variant="ghost" data-testid="sw-keep" @click="external = null">{{ t('sw.keep') }}</GnButton>
            </div>
            <p v-if="notice" class="sw__notice" :class="'sw__notice--' + notice.kind" :role="notice.kind === 'error' ? 'alert' : 'status'" data-testid="sw-notice">{{ notice.text }}</p>
            <div class="sw__editor" data-testid="sw-editor">
              <p v-if="loadingFile && !cur.info.text" class="sw__hint">{{ t('sw.loading') }}</p>
              <CodeEditor v-else :key="cur.n" ref="editorRef" v-model="editText" :filename="cur.file" :read-only="readOnly" :marks="marks" />
            </div>
          </template>
          <p v-else class="sw__hint" data-testid="sw-nofile">{{ loadingFile ? t('sw.loading') : t('sw.noFile') }}</p>
        </section>
      </div>
    </div>

    <GnDialog v-if="prompt" role="alertdialog" width="min(460px, 92vw)" :label="t('sw.unsavedTitle')" initial-focus="[data-testid='sw-unsaved-save']" @close="answer('stay')">
      <div class="sw__ask" data-testid="sw-unsaved">
        <h2>{{ t('sw.unsavedTitle') }}</h2>
        <p>{{ t('sw.unsavedBody', { file: prompt.file }) }}</p>
        <div class="sw__ask-btns">
          <GnButton variant="primary" data-testid="sw-unsaved-save" @click="answer('save')">{{ t('sw.save') }}</GnButton>
          <GnButton tone="danger" data-testid="sw-unsaved-discard" @click="answer('discard')">{{ t('sw.discard') }}</GnButton>
          <GnButton variant="ghost" data-testid="sw-unsaved-stay" @click="answer('stay')">{{ t('sw.keep') }}</GnButton>
        </div>
      </div>
    </GnDialog>
  </GnDialog>
</template>

<style scoped lang="scss">
.sw { display: flex; flex-direction: column; height: 86vh; min-height: 0; font-family: var(--gn-font-ui); }
.sw__head { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px 6px; }
.sw__field { flex: 1 1 360px; min-width: 0; }
.sw__masks { display: flex; align-items: center; gap: 6px; flex: 0 1 230px; min-width: 0; font-size: 12px; color: var(--gn-muted); input { flex: 1; min-width: 0; font-family: var(--gn-mono); } }
.sw__count { align-self: center; min-width: 8em; color: var(--gn-muted); font-size: 12.5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.sw__error { margin: 0; padding: 2px 14px 6px; color: var(--gn-danger); font-size: 12px; white-space: pre-wrap; }
.sw__notes { margin: 0; padding: 0 14px 6px; color: var(--gn-warn); font-size: 12px; }
.sw__body { flex: 1; display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--gn-border); }
.sw__results { display: flex; flex-direction: column; flex: 0 0 40%; min-height: 0; }
.sw__hint { margin: 0; padding: 10px 14px; color: var(--gn-muted); font-size: 12.5px; }
.sw__list { flex: 1; min-height: 0; overflow: auto; outline: none; &:focus-visible { box-shadow: inset 0 0 0 2px var(--gn-accent); } }
.sw__spacer { position: relative; width: 100%; }
.sw__rows { position: absolute; top: 0; left: 0; right: 0; }
.sw__row {
  display: flex; align-items: center; gap: 8px; height: 24px; box-sizing: border-box; padding: 0 12px; cursor: pointer; font: 12px var(--gn-mono); white-space: nowrap;
  &:hover { background: color-mix(in srgb, var(--gn-accent) 10%, transparent); }
  &--file { background: var(--gn-surface-2); font-weight: 600; }
  &--sel { background: color-mix(in srgb, var(--gn-accent) 24%, transparent); box-shadow: inset 3px 0 0 var(--gn-accent); }
}
.sw__fname { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.sw__ln { flex: none; min-width: 42px; text-align: right; color: var(--gn-muted); }
.sw__text { overflow: hidden; text-overflow: ellipsis; mark { background: color-mix(in srgb, var(--gn-warn) 45%, transparent); color: inherit; border-radius: 2px; } }
.sw__split {
  flex: none; height: 8px; cursor: row-resize; background: var(--gn-surface-2); border-block: 1px solid var(--gn-border); touch-action: none;
  &:hover, &:focus-visible { background: color-mix(in srgb, var(--gn-accent) 30%, var(--gn-surface-2)); outline: none; }
}
.sw__file { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.sw__fbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 6px 12px; border-bottom: 1px solid var(--gn-border); }
.sw__path { font: 600 12px var(--gn-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 46%; }
.sw__spacer2 { flex: 1; }
.sw__ro, .sw__notice { margin: 0; padding: 5px 12px; font-size: 12px; }
.sw__ro { color: var(--gn-warn); background: color-mix(in srgb, var(--gn-warn) 10%, transparent); }
.sw__notice--ok { color: var(--gn-success); }
.sw__notice--error { color: var(--gn-danger); white-space: pre-wrap; }
.sw__external { display: flex; align-items: center; gap: 8px; padding: 6px 12px; font-size: 12.5px; background: color-mix(in srgb, var(--gn-warn) 14%, transparent); border-bottom: 1px solid var(--gn-border); span { flex: 1; } }
.sw__editor { flex: 1; min-height: 0; position: relative; }
.sw__ask { padding: 18px 20px; h2 { margin: 0 0 8px; font-size: 15px; } p { margin: 0 0 14px; color: var(--gn-muted); word-break: break-word; } }
.sw__ask-btns { display: flex; justify-content: flex-end; gap: 8px; }
</style>
