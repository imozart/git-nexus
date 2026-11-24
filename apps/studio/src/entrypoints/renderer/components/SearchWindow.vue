<script lang="ts">
// Preferências da janela: valem entre aberturas (a janela "reabre onde estava": texto, opções, máscaras, filtros e a divisória).
import { reactive } from 'vue';
import { clampSplit } from '../search-window-core';
import { MAX_SELECTED, readSets, type RepoSet } from '../multi-search-core';
import { DEFAULT_FILTERS, readFilters, readHistory, type HistoryEntry } from '../search-filters-core';

const KEY = 'gitnexus.searchWindow';
function load() {
  const base = { pattern: '', regex: false, caseSensitive: false, wholeWord: false, include: '', split: 0.4, replaceText: '', preserveCase: false, repoIds: [] as string[], multi: false, ...DEFAULT_FILTERS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<typeof base>;
    return {
      pattern: typeof raw.pattern === 'string' ? raw.pattern.slice(0, 4000) : '',
      regex: raw.regex === true,
      caseSensitive: raw.caseSensitive === true,
      wholeWord: raw.wholeWord === true,
      include: typeof raw.include === 'string' ? raw.include.slice(0, 500) : '',
      split: clampSplit(typeof raw.split === 'number' ? raw.split : base.split),
      replaceText: typeof raw.replaceText === 'string' ? raw.replaceText.slice(0, 4000) : '',
      preserveCase: raw.preserveCase === true,
      // a última seleção de repositórios (busca em vários) e se a janela estava nesse modo
      repoIds: Array.isArray(raw.repoIds) ? raw.repoIds.filter((x): x is string => typeof x === 'string').slice(0, MAX_SELECTED) : [],
      multi: raw.multi === true,
      ...readFilters(raw),
    };
  } catch {
    return base;
  }
}
const prefs = reactive(load());
/** A última ocorrência aberta (por repositório): a janela volta a ela ao reabrir. */
const lastOpen = new Map<string, string>();

/** A última substituição em vários arquivos de cada repositório: o que dá para desfazer enquanto o app está aberto (a cópia de segurança fica na pasta de dados). */
interface LastReplace {
  batch: string;
  replacements: number;
  files: Array<{ file: string; afterHash: string }>;
}
const lastReplace = reactive<Record<string, LastReplace | undefined>>({});
function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* sem armazenamento: funciona do mesmo jeito, só não lembra */
  }
}

/** O histórico de pesquisas é por repositório e vive no armazenamento do app: sobrevive a fechar e abrir o app. */
const HISTORY_KEY = 'gitnexus.searchHistory';
function allHistory(): Record<string, unknown> {
  try {
    const all = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as unknown;
    return all && typeof all === 'object' && !Array.isArray(all) ? (all as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const loadHistory = (repoId: string): HistoryEntry[] => readHistory(allHistory()[repoId]);
function saveHistory(repoId: string, list: HistoryEntry[]): void {
  try {
    const all = allHistory();
    if (list.length) all[repoId] = list;
    else delete all[repoId];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  } catch {
    /* sem armazenamento: só não lembra */
  }
}
/** Os conjuntos de repositórios salvos ("Backend", "Front"): preferência do usuário, valem para qualquer repositório. */
const SETS_KEY = 'gitnexus.searchRepoSets';
function loadSets(): RepoSet[] {
  try {
    return readSets(JSON.parse(localStorage.getItem(SETS_KEY) ?? '[]'));
  } catch {
    return [];
  }
}
function saveSets(list: RepoSet[]): void {
  try {
    localStorage.setItem(SETS_KEY, JSON.stringify(list));
  } catch {
    /* sem armazenamento: só não lembra */
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
import SearchFilters from './SearchFilters.vue';
import SearchRepos from './SearchRepos.vue';
import {
  NO_HIDDEN,
  ROW_H,
  ResultModel,
  changedOutside,
  formatDuration,
  hasHidden,
  hideTarget,
  hitKey,
  isFileHidden,
  marksOf,
  pieces,
  readOnlyReason,
  scrollToRow,
  stepFile,
  stepHit,
  windowRange,
  type AfterLine,
  type Hidden,
  type Mark,
  type Row,
} from '../search-window-core';
import {
  applySuggestion,
  buildQuery,
  changedFilters,
  emptySuggestions,
  entryOf,
  historyMatching,
  needsRevision,
  pushHistory,
  regexErrorAt,
  skippedCounts,
  type FilterKey,
  type Filters,
  type Suggestion,
} from '../search-filters-core';
import type { SearchPreset } from '../stores/search';
import { makeQuery } from '../find-core';
import { applyFile, planFile, reasonCounts, scopeRefused, tally, type FilePlan, type RefuseReason } from '../replace-files-core';
import {
  aliasOf,
  assignAliases,
  isActive,
  newRun,
  withRepoHeaders,
  ownerOf,
  plainPath,
  pruneIds,
  runFromDone,
  searchOrder,
  totalsOf,
  virtualFile,
  type RepoRun,
  type Slot,
} from '../multi-search-core';

const props = defineProps<{ repo: RepositoryMeta; seed: string; openN: number; preset?: SearchPreset; replace?: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const ws = useWorkspaceStore();

// ---------- busca ----------
const model = new ResultModel();
const rows = shallowRef<Row[]>([]);
const collapsed = ref(new Set<string>());
const done = ref<SearchDone | null>(null);
const running = ref(false);
const live = ref({ hits: 0, files: 0 });

// ---------- vários repositórios (fase 8 da #233) ----------
/** O painel "onde pesquisar" (os repositórios do catálogo do app). */
const reposOpen = ref(false);
const catalog = ref<RepositoryMeta[]>([]);
const repoSets = ref<RepoSet[]>(loadSets());
/** Os repositórios da busca que está na tela, com o nome único (prefixo virtual) de cada um, e como cada um está. */
const slots = shallowRef<Slot[]>([]);
const slotMap = computed(() => new Map(slots.value.map((sl) => [sl.alias, sl])));
const runs = shallowRef(new Map<string, RepoRun>());
/** A busca que está na tela é em vários repositórios (os arquivos têm o prefixo virtual `<alias>/`). */
const resultsMulti = ref(false);
const rejected = ref(0);
let multiStart = 0;
const multiOn = computed(() => prefs.multi && prefs.repoIds.length > 0);
const openIds = computed(() => ws.tabs.filter((tab) => tab.repo).map((tab) => tab.repo!.id));
async function ensureCatalog(): Promise<void> {
  if (catalog.value.length) return;
  try {
    catalog.value = await api.getKnownRepositories();
  } catch {
    catalog.value = [];
  }
  // quem saiu do catálogo sai da seleção; sem ninguém, volta a procurar só neste repositório
  const keep = pruneIds(prefs.repoIds, catalog.value);
  if (keep.length !== prefs.repoIds.length) {
    prefs.repoIds = keep;
    if (!keep.length) prefs.multi = false;
  }
}
/** O dono de um arquivo da lista e o caminho dele dentro do repositório (numa busca de um repositório só, é este e o próprio caminho). */
function own(file: string): { repo: RepositoryMeta; rel: string } {
  if (resultsMulti.value) {
    const o = ownerOf(file, slotMap.value);
    const repo = o ? catalog.value.find((r) => r.id === o.slot.id) : undefined;
    if (o && repo) return { repo, rel: o.rel };
  }
  return { repo: props.repo, rel: file };
}
/** O nome do arquivo na lista, sem o prefixo virtual. */
const virtualOf = (repoId: string, rel: string): string => (resultsMulti.value ? virtualFile(slots.value.find((sl) => sl.id === repoId)?.alias ?? '', rel) : rel);
const collapsedRepos = (): Set<string> => new Set([...collapsed.value].filter((k) => k.startsWith('r:')).map((k) => k.slice(2)));
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
  if (!m) return '';
  const at = regexErrorAt(prefs.pattern);
  return t('find.regexError', { msg: m }) + (at === null ? '' : ` (${t('sw.regexAt', { n: at + 1 })})`);
});

// ---------- filtros, ocultar e histórico ----------
const filtersOpen = ref(false);
const hidden = shallowRef<Hidden>(NO_HIDDEN);
/** Quantas ocorrências a busca trouxe no total (o que está oculto da lista continua contando aqui). */
const totalN = ref(0);
const filters = computed<Filters>(() => ({
  scope: prefs.scope,
  revision: prefs.revision,
  folder: prefs.folder,
  includeIgnored: prefs.includeIgnored,
  includeUntracked: prefs.includeUntracked,
  includeSubmodules: prefs.includeSubmodules,
  context: prefs.context,
  group: prefs.group,
}));
const changed = computed(() => changedFilters(filters.value));
const scopeLabel = (): string => t(`sw.scope.${prefs.scope}` as MessageKey) + (prefs.scope === 'revision' && prefs.revision.trim() ? `: ${prefs.revision.trim()}` : '');
function chipText(k: FilterKey): string {
  const v = k === 'scope' ? scopeLabel() : k === 'folder' ? prefs.folder.trim() : k === 'group' ? t(`sw.group.${prefs.group}` as MessageKey) : String(prefs.context);
  return t(`sw.chip.${k}` as MessageKey, { v });
}
const searches = ref<HistoryEntry[]>([]);
const pastOpen = ref(false);
const pastActive = ref(0);
const pastList = computed(() => historyMatching(searches.value, prefs.pattern));
const hiddenCount = computed(() => Math.max(0, totalN.value - live.value.hits));
const suggestions = computed<Suggestion[]>(() => emptySuggestions(prefs));

// ---------- substituir em vários arquivos ----------
const replaceOpen = ref(props.replace === true);
const replaceField = ref<InstanceType<typeof GnSearchField>>();
/** A prévia de cada arquivo (o texto novo por linha, ou o motivo de não ser alterado), calculada do que está NO DISCO. */
const plans = shallowRef(new Map<string, FilePlan>());
/** O hash que cada arquivo tinha quando a prévia foi calculada: se mudar até o aplicar, o arquivo é recusado. */
const planHash = new Map<string, string>();
const planning = ref({ done: 0, total: 0 });
const applying = ref<{ done: number; total: number } | null>(null);
const confirmApply = ref(false);
interface ReplaceResult {
  kind: 'applied' | 'undone';
  replacements: number;
  files: number;
  skipped: Array<{ file: string; reason: RefuseReason | 'changedSince'; char?: string }>;
}
const result = ref<ReplaceResult | null>(null);
const refusedScope = computed(() => scopeRefused(prefs.scope));
const rquery = computed(() => makeQuery({ text: prefs.pattern, caseSensitive: prefs.caseSensitive, wholeWord: prefs.wholeWord, regex: prefs.regex }));
const ropts = computed(() => ({ regex: prefs.regex, preserveCase: prefs.preserveCase }));
/** Substituir em vários repositórios nasce DESLIGADO: só a pessoa liga, a cada busca, e a confirmação e o desfazer são por repositório. */
const allowMultiReplace = ref(false);
const multiLocked = computed(() => resultsMulti.value && !allowMultiReplace.value);
/** Os repositórios cuja última substituição ainda dá para desfazer (um botão por repositório). */
const undoRepos = computed(() => (resultsMulti.value ? slots.value.filter((sl) => lastReplace[sl.id]).map((sl) => ({ id: sl.id, name: sl.name })) : lastReplace[props.repo.id] ? [{ id: props.repo.id, name: props.repo.name }] : []));
/** Na confirmação: quais repositórios entram (só os marcados). */
const confirmRepos = ref(new Set<string>());
const fieldLabels = computed(() => ({ clear: t('find.clear'), caseSensitive: t('find.case'), wholeWord: t('find.word'), regex: t('find.regex') }));

/** Os lotes chegam em ondas: cada quadro leva no máximo isto para a lista, e a interface nunca fica parada com 5 mil ocorrências de uma vez. */
const PER_FRAME = 1200;

/** Refazer a busca por causa de uma gravação (e não de uma digitação): a lista antiga fica na tela até chegar o primeiro lote novo (nada de piscar vazio). */
let replaceOnFirst = false;

const schedule = (): void => {
  if (!raf) raf = setTimeout(flush, FRAME_MS);
};

/** Da prévia para a lista: o texto novo de cada ocorrência e o motivo de cada arquivo recusado (só com a substituição aberta). */
function previewData(): { after?: Map<string, AfterLine>; notes?: Map<string, string> } {
  if (!replaceOpen.value || !plans.value.size) return {};
  const after = new Map<string, AfterLine>();
  const notes = new Map<string, string>();
  for (const [file, pl] of plans.value) {
    if (!pl.ok) notes.set(file, pl.reason);
    else for (const [line, l] of pl.lines) after.set(`${file}:${line}`, { text: l.after, ranges: l.ranges, clippedStart: l.clippedStart, clippedEnd: l.clippedEnd });
  }
  return { after, notes };
}

/** Refaz as linhas da lista (agrupamento, recolhidos, ocultos e contexto) e os números que dependem delas. */
function rebuild(): void {
  const flat = model.rows({ collapsed: collapsed.value, group: prefs.group, hidden: hidden.value, context: prefs.context > 0, ...previewData() });
  rows.value = resultsMulti.value ? withRepoHeaders(flat, slots.value, runs.value, collapsedRepos()) : flat;
  live.value = model.count(hidden.value);
  totalN.value = model.total;
}

function flush(): void {
  raf = 0;
  if (pending.length) {
    if (replaceOnFirst) {
      model.clear();
      replaceOnFirst = false;
    }
    model.add(pending.splice(0, PER_FRAME));
    rebuild();
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
    totalN.value = 0;
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
  totalN.value = 0;
  done.value = null;
  searchError.value = '';
}

const searchError = ref('');

/** O fim da busca em vários repositórios, contado a partir de cada um (o worker só avisa o fim de cada repositório). */
function multiDone(id: string): SearchDone {
  const all = [...runs.value.values()];
  const tl = totalsOf(all);
  return {
    id,
    ok: true,
    dialect: 'fixed',
    hits: all.reduce((n, r) => n + r.hits, 0),
    files: all.reduce((n, r) => n + r.files, 0),
    skipped: [],
    cancelled: all.length > 0 && all.every((r) => r.state === 'cancelled'),
    truncated: tl.cut > 0,
    ms: Date.now() - multiStart,
  };
}

/** Começa a busca em vários repositórios: a lista vem do catálogo, o repositório da aba ativa vai primeiro e cada um ganha o nome único dele. */
async function startMulti(id: string): Promise<void> {
  await ensureCatalog();
  const byId = new Map(catalog.value.map((r) => [r.id, r]));
  const ids = searchOrder(pruneIds(prefs.repoIds, catalog.value), props.repo.id);
  slots.value = assignAliases(ids.map((i) => byId.get(i)!).filter(Boolean));
  runs.value = new Map(slots.value.map((sl) => [sl.alias, newRun(sl)]));
  resultsMulti.value = true;
  rejected.value = 0;
  multiStart = Date.now();
  if (!ids.length) {
    doneEvent = multiDone(id);
    finish();
    return;
  }
  const started = await api.startMultiSearch(ids, buildQuery(prefs, { limit: 5000 }), id);
  if (currentId !== id) return;
  rejected.value = started.rejected.length;
}

/** O fim de UM repositório: o estado dele muda e, quando todos terminaram, a busca acaba. */
function onRepoDone(e: SearchDone): void {
  const slot = slots.value.find((sl) => sl.id === e.repoId);
  if (!slot) return;
  const next = new Map(runs.value);
  next.set(slot.alias, runFromDone(next.get(slot.alias) ?? newRun(slot), e));
  runs.value = next;
  if (![...next.values()].some((r) => isActive(r.state))) doneEvent = multiDone(currentId);
  if (!pending.length && !raf && doneEvent) finish();
  else schedule();
}

/** Parar só este repositório (os outros seguem). */
function stopRepo(alias: string): void {
  const slot = slotMap.value.get(alias);
  if (slot && currentId) void api.cancelSearch(`${currentId}#${slot.id}`).catch(() => undefined);
}

/** `offset` > 0: a próxima página (carregar mais): os resultados já na lista ficam e os novos entram depois deles. */
async function run(keep = false, offset = 0): Promise<void> {
  clearTimeout(timer);
  if (currentId) void api.cancelSearch(currentId).catch(() => undefined);
  const pattern = prefs.pattern;
  currentId = '';
  if (offset > 0) {
    pending = [];
    doneEvent = null;
    if (raf) clearTimeout(raf);
    raf = 0;
    searchError.value = '';
    replaceOnFirst = false;
  } else if (keep && model.total) {
    pending = [];
    doneEvent = null;
    if (raf) clearTimeout(raf);
    raf = 0;
    searchError.value = '';
    replaceOnFirst = true;
    dropPlans(); // refeita por causa de uma gravação: o disco mudou
  } else {
    replaceOnFirst = false;
    hidden.value = NO_HIDDEN; // pesquisa nova: o que foi ocultado da anterior volta
    resetResults();
    dropPlans();
  }
  if (!pattern.trim() || patternError.value || needsRevision(prefs)) {
    running.value = false;
    return;
  }
  const id = `sw${++seq}-${Date.now().toString(36)}`;
  currentId = id;
  running.value = true;
  try {
    if (multiOn.value) await startMulti(id);
    else {
      resultsMulti.value = false;
      await api.startSearch(props.repo.path, buildQuery(prefs, { limit: 5000, ...(offset > 0 ? { offset } : {}) }), id);
    }
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
  () => [prefs.pattern, prefs.regex, prefs.caseSensitive, prefs.wholeWord, prefs.include, prefs.scope, prefs.revision, prefs.folder, prefs.includeIgnored, prefs.includeUntracked, prefs.includeSubmodules, prefs.context],
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

// agrupar só muda a forma da lista (não refaz a busca)
watch(
  () => prefs.group,
  () => {
    persist();
    rebuild();
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
  if (!totalN.value) return `${t('sw.none')} · ${formatDuration(d.ms, locale.value)}`;
  const ofRepos = resultsMulti.value ? ` ${t('sw.mr.ofRepos', { n: totalsOf(runs.value.values()).withHits })}` : '';
  return `${t('search.matches', { n: live.value.hits })} ${t('search.inFiles', { n: live.value.files })}${ofRepos} · ${formatDuration(d.ms, locale.value)}`;
});
/** O que ficou de fora e por quê, em uma frase: "Ignorados: 3 binários e 1 acima de 5 MB". */
const skippedText = computed(() => {
  const d = done.value;
  if (!d?.skipped.length) return '';
  const c = skippedCounts(d.skipped);
  const parts = [c.binary ? t('sw.skipBinary', { n: c.binary }) : '', c.large ? t('sw.skipLarge', { n: c.large }) : ''].filter(Boolean);
  return t('sw.skipped', { what: parts.join(t('sw.and')) });
});
const canMore = computed(() => !resultsMulti.value && !running.value && done.value?.ok === true && done.value.truncatedReason === 'limit' && done.value.nextOffset !== undefined);
const notes = computed(() => {
  const d = done.value;
  const out: string[] = [];
  if (resultsMulti.value) {
    // cada repositório mostra o seu estado no cabeçalho; aqui, o que ficou cortado e o que foi recusado, em uma frase
    const cut = [...runs.value.values()].filter((r) => r.cut);
    if (cut.length) out.push(t('sw.mr.cutNote', { names: cut.map((r) => r.slot.name).join(', ') }));
    if (rejected.value) out.push(t('sw.mr.rejected', { n: rejected.value }));
    return out.join(' · ');
  }
  if (d?.truncatedReason === 'limit') out.push(t('sw.truncated', { n: model.total }));
  else if (d?.truncated) out.push(d.message ?? t('sw.truncatedTime', { n: model.total }));
  if (skippedText.value) out.push(skippedText.value);
  return out.join(' · ');
});
function loadMore(): void {
  const next = done.value?.nextOffset;
  if (canMore.value && next !== undefined) void run(false, next);
}

// ---------- ocultar da lista ----------
function hide(index: number, level: 'hit' | 'file' | 'dir'): void {
  const r = rows.value[index];
  const target = r ? hideTarget(r, level) : null;
  if (!target) return;
  const h = hidden.value;
  const next = { hits: new Set(h.hits), files: new Set(h.files), dirs: new Set(h.dirs) };
  (target.kind === 'hit' ? next.hits : target.kind === 'file' ? next.files : next.dirs).add(target.key);
  hidden.value = next;
  rebuild();
  if (selectedKey.value !== null && !rows.value.some((x) => x.key === selectedKey.value)) {
    const from = Math.min(index, rows.value.length - 1);
    let j = rows.value.findIndex((x, k) => k >= from && x.kind === 'hit');
    if (j < 0) for (let k = from; k >= 0 && j < 0; k--) if (rows.value[k]!.kind === 'hit') j = k;
    if (j >= 0) select(j);
    else selectedKey.value = null;
  }
}
function unhide(): void {
  hidden.value = NO_HIDDEN;
  rebuild();
}

// ---------- histórico de pesquisas ----------
/** Guarda a pesquisa atual no histórico do repositório (a mais recente primeiro, sem repetir, as últimas 30). */
function remember(): void {
  if (!prefs.pattern.trim() || patternError.value) return;
  const e = entryOf(prefs);
  const top = searches.value[0];
  if (top && JSON.stringify(top) === JSON.stringify(e)) return;
  searches.value = pushHistory(searches.value, e);
  saveHistory(props.repo.id, searches.value);
}
function openPast(): void {
  pastActive.value = 0;
  pastOpen.value = true;
}
function closePast(): void {
  pastOpen.value = false;
  field.value?.focus();
}
function applyPast(i: number): void {
  const e = pastList.value[i];
  if (!e) return;
  pastOpen.value = false;
  Object.assign(prefs, { pattern: e.pattern, regex: e.regex, caseSensitive: e.caseSensitive, wholeWord: e.wholeWord, include: e.include, scope: e.scope, revision: e.revision, folder: e.folder });
  persist();
  remember(); // a escolhida sobe para o topo
  clearTimeout(timer);
  void run();
  void nextTick(() => field.value?.focus());
}
function removePast(i: number): void {
  const e = pastList.value[i];
  if (!e) return;
  searches.value = searches.value.filter((x) => x !== e);
  saveHistory(props.repo.id, searches.value);
  pastActive.value = Math.min(pastActive.value, Math.max(0, pastList.value.length - 1));
}
function clearPast(): void {
  searches.value = [];
  saveHistory(props.repo.id, []);
  closePast();
}
function pastText(e: HistoryEntry): string {
  const bits = [e.caseSensitive ? 'Aa' : '', e.wholeWord ? 'ab' : '', e.regex ? '.*' : '', e.include, e.scope !== 'worktree' ? t(`sw.scope.${e.scope}` as MessageKey) + (e.revision ? ` ${e.revision}` : '') : '', e.folder ? e.folder + '/' : ''];
  return bits.filter(Boolean).join(' · ');
}

function applySg(sg: Suggestion): void {
  Object.assign(prefs, applySuggestion(sg));
  clearTimeout(timer);
  void run();
}

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

function toggleKey(key: string): void {
  const next = new Set(collapsed.value);
  if (!next.delete(key)) next.add(key);
  collapsed.value = next;
  rebuild();
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
    const o = own(file);
    const info = await api.readWorkingFile(o.repo.path, o.rel);
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
  remember();
  if (opts.open === false) return;
  clearTimeout(navTimer);
  const go = (): void => void openHit(r.hit, opts.focus);
  if (opts.now || opts.focus) go();
  else navTimer = setTimeout(go, 70);
}

function onRowClick(i: number, r: Row): void {
  if (r.kind === 'file' || r.kind === 'dir' || r.kind === 'repo') toggleKey(r.key);
  else if (r.kind === 'hit') select(i, { now: true });
  else if (r.kind === 'new') select(i - 1, { now: true }); // a linha nova é da ocorrência de cima
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
  if (e.key === 'Escape' && filtersOpen.value) {
    e.preventDefault();
    closeFilters();
    return;
  }
  if (e.key === 'Escape' && reposOpen.value) {
    e.preventDefault();
    closeRepos();
    return;
  }
  // histórico de pesquisas: Alt+↓ (ou ↓ com o campo vazio) abre; ↑/↓ andam; Shift+Delete tira a entrada
  const inField = target.matches('.sw__field textarea, .sw__field input');
  if (inField && !pastOpen.value && e.key === 'ArrowDown' && !mod && !e.shiftKey && (e.altKey || !prefs.pattern)) {
    e.preventDefault();
    openPast();
    return;
  }
  if (pastOpen.value && !mod && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    pastActive.value = Math.min(Math.max(0, pastList.value.length - 1), Math.max(0, pastActive.value + (e.key === 'ArrowDown' ? 1 : -1)));
    return;
  }
  if (pastOpen.value && e.key === 'Delete' && e.shiftKey) {
    e.preventDefault();
    removePast(pastActive.value);
    return;
  }
  if (e.key === 'Delete' && target.closest('.sw__list') && selectedIndex.value >= 0 && !e.altKey) {
    e.preventDefault();
    hide(selectedIndex.value, e.shiftKey ? (mod ? 'dir' : 'file') : 'hit');
    return;
  }
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

function onFieldEscape(): void {
  if (pastOpen.value) pastOpen.value = false;
  else if (filtersOpen.value) closeFilters();
  else if (reposOpen.value) closeRepos();
}
function closeRepos(): void {
  reposOpen.value = false;
  void nextTick(() => reposBtn.value?.$el?.focus?.());
}
const reposBtn = ref<InstanceType<typeof GnButton>>();
function toggleRepos(): void {
  reposOpen.value = !reposOpen.value;
  if (reposOpen.value) void ensureCatalog();
}
/** A seleção do painel: nada escolhido, ou só este repositório, é a busca de sempre; o resto é a busca em vários. */
function onRepos(ids: string[]): void {
  prefs.repoIds = ids;
  prefs.multi = ids.length > 0 && !(ids.length === 1 && ids[0] === props.repo.id);
}
function onSets(list: RepoSet[]): void {
  repoSets.value = list;
  saveSets(list);
}
// trocar onde procurar refaz a busca (a lista velha seria de outro conjunto de repositórios)
watch(
  () => [prefs.repoIds.join(','), prefs.multi],
  () => {
    persist();
    allowMultiReplace.value = false;
    if (prefs.pattern.trim()) {
      clearTimeout(timer);
      void run();
    }
  },
);
function closeFilters(): void {
  filtersOpen.value = false;
  void nextTick(() => filtersBtn.value?.$el?.focus?.());
}
const filtersBtn = ref<InstanceType<typeof GnButton>>();

function onFieldEnter(): void {
  if (pastOpen.value) {
    applyPast(pastActive.value);
    return;
  }
  remember();
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
    const o = own(c.file);
    const r = await api.saveWorkingFile(o.repo.path, o.rel, editText.value, { encoding: c.info.encoding, expectHash: c.info.hash, force });
    if (r.ok) {
      c.info = { ...c.info, hash: r.stamp.hash, size: r.stamp.size, mtimeMs: r.stamp.mtimeMs };
      c.original = editText.value;
      external.value = null;
      notice.value = { kind: 'ok', text: t('sw.saved') };
      ws.bump(o.repo.id);
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
    const o = own(c.file);
    const s = await api.stampWorkingFile(o.repo.path, o.rel);
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
  if (await guard()) {
    remember();
    emit('close');
  }
}

// ---------- substituir em vários arquivos: prévia, aplicar e desfazer ----------
/** O conteúdo lido dos arquivos para a prévia (até um teto de memória): trocar o texto novo recalcula sem reler o disco. */
const CONTENT_BUDGET = 24 * 1024 * 1024;
let budget = 0;
const contents = new Map<string, WorkingFileInfo>();
let planSeq = 0;
let planTimer: ReturnType<typeof setTimeout> | undefined;

function dropPlans(): void {
  planSeq++;
  contents.clear();
  budget = 0;
  planHash.clear();
  if (plans.value.size) plans.value = new Map();
  planning.value = { done: 0, total: 0 };
}

async function contentOf(file: string): Promise<WorkingFileInfo> {
  const hit = contents.get(file);
  if (hit) return hit;
  const o = own(file);
  const info = await api.readWorkingFile(o.repo.path, o.rel);
  if (info.exists && !info.binary && !info.tooLarge && budget + info.text.length * 2 <= CONTENT_BUDGET) {
    contents.set(file, info);
    budget += info.text.length * 2;
  }
  return info;
}

/** Por que um arquivo lido não pode ser alterado (`null` = pode). */
function refusal(info: WorkingFileInfo): RefuseReason | null {
  if (!info.exists) return 'missing';
  if (info.binary) return 'binary';
  if (info.tooLarge) return 'tooLarge';
  if (info.invalid) return 'invalid';
  if (info.eol === 'mixed') return 'mixedEol';
  return null;
}

const hitLinesOf = (file: string): Set<number> => new Set(model.hitsOf(file).map((h) => h.line));

async function planOne(file: string): Promise<FilePlan> {
  const q = rquery.value;
  if (!q) return { ok: false, reason: 'failed' };
  const info = await contentOf(file);
  const why = refusal(info);
  if (why) return { ok: false, reason: why };
  planHash.set(file, info.hash);
  return planFile(info.text, info.eol, q, prefs.replaceText, ropts.value, hitLinesOf(file));
}

/** Calcula a prévia dos arquivos da lista (4 por vez), mostrando-a aos poucos. Só com a substituição aberta e depois que a busca terminou. */
function schedulePlans(ms: number): void {
  clearTimeout(planTimer);
  planTimer = setTimeout(() => void computePlans(), ms);
}
async function computePlans(): Promise<void> {
  const mine = ++planSeq;
  if (!replaceOpen.value || refusedScope.value || multiLocked.value || !rquery.value || patternError.value || !done.value?.ok || running.value) {
    if (plans.value.size) {
      plans.value = new Map();
      rebuild();
    }
    planning.value = { done: 0, total: 0 };
    return;
  }
  const files = model.fileNames;
  const next = new Map<string, FilePlan>();
  planning.value = { done: 0, total: files.length };
  let i = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const k = i++;
      if (k >= files.length || mine !== planSeq) return;
      const file = files[k]!;
      next.set(file, await planOne(file).catch(() => ({ ok: false, reason: 'failed' }) as FilePlan));
      if (mine !== planSeq) return;
      planning.value = { done: next.size, total: files.length };
      if (next.size % 40 === 0) {
        plans.value = new Map(next);
        rebuild();
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (mine !== planSeq) return;
  plans.value = next;
  rebuild();
}

/** As linhas escolhidas (as ocorrências que não foram ocultadas) de cada arquivo. */
function chosenLines(): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const h = hidden.value;
  for (const file of model.fileNames) {
    if (isFileHidden(file, h)) continue;
    const lines = new Set<number>();
    for (const hit of model.hitsOf(file)) if (!h.hits.has(hitKey(hit))) lines.add(hit.line);
    if (lines.size) out.set(file, lines);
  }
  return out;
}
const planReady = computed(() => replaceOpen.value && !refusedScope.value && !multiLocked.value && done.value?.ok === true && !running.value && planning.value.total > 0 && planning.value.done >= planning.value.total && plans.value.size === planning.value.total);
const totals = computed(() => {
  void live.value;
  void hidden.value;
  return planReady.value ? tally(plans.value, chosenLines()) : null;
});
const canApply = computed(() => !!totals.value && totals.value.replacements > 0 && !applying.value && !patternError.value);
const reasonText = (list: ReadonlyArray<{ reason: RefuseReason | 'changedSince' }>): string => reasonCounts(list as Array<{ reason: RefuseReason }>).map((r) => `${r.n} ${t(`sw.rp.why.${r.reason}` as MessageKey)}`).join(', ');
/** "142 substituições em 17 arquivos". */
const countText = (n: number, f: number): string => `${t('sw.rp.count', { n })} ${t('search.inFiles', { n: f })}`;
const summaryText = computed(() => {
  if (refusedScope.value) return '';
  if (multiLocked.value) return t('sw.mr.replaceOff');
  if (!prefs.pattern.trim() || !rquery.value) return t('sw.rp.needSearch');
  if (applying.value) return t('sw.rp.applying', { done: applying.value.done, total: applying.value.total });
  if (!planReady.value) return running.value || !done.value ? '' : t('sw.rp.preparing', { done: planning.value.done, total: planning.value.total });
  const tl = totals.value!;
  if (!tl.replacements) return t('sw.rp.nothing') + (tl.refused.length ? ` · ${t('sw.rp.refused', { n: tl.refused.length })} (${reasonText(tl.refused)})` : '');
  return countText(tl.replacements, tl.files) + (tl.refused.length ? ` · ${t('sw.rp.refused', { n: tl.refused.length })} (${reasonText(tl.refused)})` : '');
});

function toggleReplace(): void {
  replaceOpen.value = !replaceOpen.value;
  result.value = null;
  if (replaceOpen.value) {
    schedulePlans(0);
    void nextTick(() => replaceField.value?.focus());
  } else {
    dropPlans();
    rebuild();
  }
}
watch(
  () => [prefs.replaceText, prefs.preserveCase],
  () => {
    persist();
    if (replaceOpen.value) schedulePlans(250);
  },
);

/** Os totais de cada repositório (para a confirmação por repositório). */
const perRepoTotals = computed(() => {
  if (!resultsMulti.value || !totals.value) return [];
  const chosen = chosenLines();
  return slots.value
    .map((sl) => {
      const tl = tally(new Map([...plans.value].filter(([file]) => aliasOf(file) === sl.alias)), new Map([...chosen].filter(([file]) => aliasOf(file) === sl.alias)));
      return { alias: sl.alias, name: sl.name, replacements: tl.replacements, files: tl.files, refused: tl.refused.length };
    })
    .filter((r) => r.replacements > 0 || r.refused > 0);
});
function toggleConfirmRepo(alias: string, on: boolean): void {
  const next = new Set(confirmRepos.value);
  if (on) next.add(alias);
  else next.delete(alias);
  confirmRepos.value = next;
}
const confirmTotals = computed(() => {
  if (!resultsMulti.value) return totals.value;
  const rs = perRepoTotals.value.filter((r) => confirmRepos.value.has(r.alias));
  return { replacements: rs.reduce((n, r) => n + r.replacements, 0), files: rs.reduce((n, r) => n + r.files, 0) };
});

async function askApply(): Promise<void> {
  if (!canApply.value) return;
  if (!(await guard())) return; // alterações não salvas no arquivo aberto lá embaixo: salvar, descartar ou ficar
  confirmRepos.value = new Set(perRepoTotals.value.filter((r) => r.replacements > 0).map((r) => r.alias)); // cada repositório vem marcado e pode ser desmarcado
  confirmApply.value = true;
}

/**
 * Aplica: para cada arquivo, lê DE NOVO do disco do repositório dono; se o hash não é o da prévia o arquivo é recusado (mudou depois da busca); senão recalcula o
 * texto novo desse conteúdo (nunca do que a lista mostrava) e grava de forma atômica, com a cópia de segurança antes. Cada repositório tem o seu lote de cópia
 * (assim o desfazer é por repositório). Nunca cria commit.
 */
async function applyAll(): Promise<void> {
  confirmApply.value = false;
  const q = rquery.value;
  if (!q || !canApply.value) return;
  const wanted = (file: string): boolean => !resultsMulti.value || confirmRepos.value.has(aliasOf(file));
  const chosen = new Map([...chosenLines()].filter(([file]) => wanted(file)));
  const todo = [...chosen].filter(([file]) => plans.value.get(file)?.ok);
  const skipped: ReplaceResult['skipped'] = [];
  const batches = new Map<string, { batch: string; replacements: number; files: LastReplace['files'] }>();
  const appliedNames: string[] = [];
  let replacements = 0;
  applying.value = { done: 0, total: todo.length };
  let n = 0;
  try {
    for (const [file, lines] of todo) {
      const o = own(file);
      let grp = batches.get(o.repo.id);
      if (!grp) batches.set(o.repo.id, (grp = { batch: crypto.randomUUID(), replacements: 0, files: [] }));
      try {
        const cur = await api.readWorkingFile(o.repo.path, o.rel);
        const why = refusal(cur);
        if (why) skipped.push({ file, reason: why });
        else if (cur.hash !== planHash.get(file)) skipped.push({ file, reason: 'changed' });
        else {
          const again = planFile(cur.text, cur.eol, q, prefs.replaceText, ropts.value, hitLinesOf(file));
          if (!again.ok) skipped.push({ file, reason: again.reason });
          else {
            const next = applyFile(cur.text, cur.eol, q, prefs.replaceText, ropts.value, lines);
            if (next.replaced) {
              const r = await api.saveWorkingFile(o.repo.path, o.rel, next.text, { encoding: cur.encoding, expectHash: cur.hash, backup: grp.batch });
              if (r.ok) {
                grp.files.push({ file: o.rel, afterHash: r.stamp.hash });
                grp.replacements += next.replaced;
                appliedNames.push(file);
                replacements += next.replaced;
              } else skipped.push({ file, reason: r.reason === 'unencodable' ? 'unencodable' : r.reason === 'changed' ? 'changed' : 'failed', ...(r.char ? { char: r.char } : {}) });
            }
          }
        }
      } catch {
        skipped.push({ file, reason: 'failed' });
      }
      applying.value = { done: ++n, total: todo.length };
    }
  } finally {
    applying.value = null;
  }
  // os arquivos que a prévia já recusava (binário, grande...) também entram no resumo, para nada ficar calado
  for (const r of tally(plans.value, chosen).refused) skipped.push(r);
  for (const [repoId, g] of batches) if (g.files.length) lastReplace[repoId] = { batch: g.batch, replacements: g.replacements, files: g.files };
  result.value = { kind: 'applied', replacements, files: appliedNames.length, skipped };
  await afterWrite(appliedNames, [...batches].filter(([, g]) => g.files.length).map(([id]) => id));
}

/** Depois de gravar ou desfazer: a tela de cada repositório alterado recarrega, o arquivo aberto lá embaixo relê e a busca se refaz. */
async function afterWrite(files: string[], repoIds: string[]): Promise<void> {
  if (!files.length) return;
  for (const id of repoIds) ws.bump(id);
  if (cur.value && files.includes(cur.value.file)) await loadFile(cur.value.file);
  void run(true);
}

/** Desfaz a última substituição de UM repositório (cada repositório tem a sua cópia de segurança). */
async function undoReplace(repoId: string = props.repo.id): Promise<void> {
  const last = lastReplace[repoId];
  const repo = repoId === props.repo.id ? props.repo : catalog.value.find((r) => r.id === repoId);
  if (!last || !repo || applying.value) return;
  if (!(await guard())) return;
  const skipped: ReplaceResult['skipped'] = [];
  const restored: string[] = [];
  applying.value = { done: 0, total: last.files.length };
  let n = 0;
  try {
    for (const f of last.files) {
      try {
        const r = await api.restoreWorkingFile(repo.path, last.batch, f.file, f.afterHash);
        if (r.ok) restored.push(virtualOf(repo.id, f.file));
        else skipped.push({ file: virtualOf(repo.id, f.file), reason: r.reason === 'changed' ? 'changedSince' : 'failed' });
      } catch {
        skipped.push({ file: virtualOf(repo.id, f.file), reason: 'failed' });
      }
      applying.value = { done: ++n, total: last.files.length };
    }
  } finally {
    applying.value = null;
  }
  lastReplace[repoId] = undefined;
  result.value = { kind: 'undone', replacements: last.replacements, files: restored.length, skipped };
  await afterWrite(restored, [repo.id]);
}

const resultText = computed(() => {
  const r = result.value;
  if (!r) return '';
  const head = r.kind === 'applied' ? countText(r.replacements, r.files) : t('sw.rp.undone', { n: r.files });
  return head + (r.skipped.length ? `, ${t('sw.rp.refused', { n: r.skipped.length })} (${reasonText(r.skipped)})` : '');
});
const resultFiles = computed(() => (result.value?.skipped ?? []).slice(0, 12));

// ---------- ações do arquivo ----------
async function goTool(mode: 'history' | 'blame'): Promise<void> {
  const c = cur.value;
  if (!c || !(await guard())) return;
  emit('close');
  const o = own(c.file);
  ws.openTools(o.repo, 'file', o.rel, mode);
}
async function copyRef(): Promise<void> {
  const c = cur.value;
  const h = rows.value[selectedIndex.value];
  if (c) {
    const o = own(c.file);
    await api.copyText(h && h.kind === 'hit' ? `${o.rel}:${h.hit.line}` : o.rel).catch(() => undefined);
  }
}
async function openOutside(): Promise<void> {
  if (cur.value) {
    const o = own(cur.value.file);
    await api.openPath(o.repo.path, o.rel).catch(() => undefined);
  }
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

const onFilters = (f: Filters): void => void Object.assign(prefs, f);
const rowStyle = (r: Row): Record<string, string> | undefined => (r.kind === 'dir' || r.kind === 'repo' ? undefined : { paddingLeft: `${12 + r.depth * 14}px` });
const rowTestId = (r: Row): string => (r.kind === 'repo' ? 'sw-repo-row' : r.kind === 'file' ? 'sw-file-row' : r.kind === 'dir' ? 'sw-dir-row' : r.kind === 'ctx' ? 'sw-ctx-row' : r.kind === 'new' ? 'sw-new-row' : 'sw-row');
/** A ocorrência tem prévia (a linha nova logo abaixo): a lista a mostra como "antes". */
const hasAfter = (key: string): boolean => replaceOpen.value && plans.value.size > 0 && previewKeys.value.has(key);
const previewKeys = computed(() => {
  const keys = new Set<string>();
  for (const [file, pl] of plans.value) if (pl.ok) for (const line of pl.lines.keys()) keys.add(`${file}:${line}`);
  return keys;
});
/** Clicar fora do histórico aberto fecha. */
function onPointer(e: PointerEvent): void {
  if (pastOpen.value && !(e.target as HTMLElement).closest('.sw__past, .sw__pastbtn')) pastOpen.value = false;
}

/** Depois da busca: mantém a seleção se a ocorrência ainda existe, reabre a última (ao reabrir a janela) e refaz as marcas do arquivo aberto. */
function afterResults(): void {
  refreshMarks();
  schedulePlans(0);
  const want = selectedKey.value ?? lastOpen.get(props.repo.id) ?? null;
  const idx = want ? rows.value.findIndex((r) => r.key === want) : -1;
  if (idx >= 0) {
    const r = rows.value[idx]!;
    selectedKey.value = r.key;
    void nextTick(() => ensureVisible(idx));
    if (r.kind === 'hit' && cur.value?.file !== r.file) void openHit(r.hit);
  } else if (selectedKey.value) selectedKey.value = null;
}

/** "Pesquisar neste arquivo / nesta pasta": a máscara, a pasta e o onde vêm de quem abriu a janela. */
function applyPreset(): void {
  const p = props.preset;
  if (!p) return;
  prefs.include = p.include ?? '';
  prefs.folder = p.folder ?? '';
  prefs.scope = p.scope ?? 'worktree';
}

function applySeed(): void {
  applyPreset();
  if (props.seed) prefs.pattern = props.seed;
  void nextTick(() => field.value?.select());
}

watch(() => props.openN, () => {
  if (props.replace && !replaceOpen.value) toggleReplace();
  else if (props.replace) void nextTick(() => replaceField.value?.focus());
  applySeed();
  if (props.seed) void run();
  else if (props.preset && prefs.pattern.trim()) void run();
});

onMounted(() => {
  offBatch = api.onSearchBatch((e) => {
    if (resultsMulti.value && e.repoId && e.id === `${currentId}#${e.repoId}`) {
      const slot = slots.value.find((sl) => sl.id === e.repoId);
      if (!slot) return;
      for (const h of e.hits) pending.push({ ...h, file: virtualFile(slot.alias, h.file) });
      schedule();
      return;
    }
    if (e.id !== currentId) return;
    pending.push(...e.hits);
    schedule();
  });
  offDone = api.onSearchDone((e) => {
    if (resultsMulti.value && e.repoId && e.id === `${currentId}#${e.repoId}`) return onRepoDone(e);
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
  searches.value = loadHistory(props.repo.id);
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
const stateText = (r: Extract<Row, { kind: 'repo' }>): string => (r.state === 'noRevision' ? t('sw.mr.state.noRevision', { rev: prefs.revision.trim() }) : t(`sw.mr.state.${r.state}` as MessageKey));
const cutText = (r: Extract<Row, { kind: 'repo' }>): string => (r.cut ? t(`sw.mr.cut.${r.cut}` as MessageKey) : '');
const stateTone = (st: string): 'success' | 'danger' | 'warn' | 'neutral' => (st === 'done' ? 'success' : st === 'error' || st === 'unavailable' || st === 'noGit' ? 'danger' : st === 'noRevision' || st === 'cancelled' ? 'warn' : 'neutral');
const rowLabel = (r: Row): string => {
  if (r.kind === 'repo') return t('sw.mr.rowRepo', { name: r.name, n: r.count, state: stateText(r) }) + (r.collapsed ? ' ' + t('sw.collapsed') : '');
  if (r.kind === 'dir') return t('sw.rowFile', { file: plainPath(r.dir, resultsMulti.value) || t('sw.rootDir'), n: r.count }) + (r.collapsed ? ' ' + t('sw.collapsed') : '');
  if (r.kind === 'file') return t('sw.rowFile', { file: plainPath(r.file, resultsMulti.value), n: r.count }) + (r.collapsed ? ' ' + t('sw.collapsed') : '');
  if (r.kind === 'ctx') return t('sw.rowCtx', { line: r.line, text: r.text });
  if (r.kind === 'new') return t('sw.rp.rowNew', { line: r.line, text: r.text });
  return (r.showFile ? plainPath(r.file, resultsMulti.value) + ', ' : '') + t('sw.rowHit', { line: r.hit.line, text: r.hit.text });
};
const status = computed(() => (running.value ? '' : counter.value));
const emptyHint = computed(() => (!prefs.pattern.trim() ? t('sw.hint') : needsRevision(prefs) ? t('sw.revisionNeeded') : ''));
const splitPct = computed(() => Math.round(prefs.split * 100));
</script>

<template>
  <GnDialog width="min(1500px, 96vw)" max-height="90vh" :label="t('sw.label')" initial-focus="[data-testid='sf-input']" @close="requestClose">
    <div class="sw" data-testid="search-window" @keydown="onKey" @pointerdown="onPointer">
      <div class="sw__headwrap">
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
          @escape="onFieldEscape"
        />
        <GnIconButton
          class="sw__pastbtn"
          icon="history"
          :label="t('sw.past')"
          :title="t('sw.pastTip')"
          :aria-expanded="pastOpen"
          aria-controls="sw-past-list"
          data-testid="sw-past-toggle"
          @click="pastOpen ? closePast() : openPast()"
        />
        <label class="sw__masks">
          <span>{{ t('sw.masks') }}</span>
          <input v-model="prefs.include" data-testid="sw-masks" :placeholder="t('sw.masksPh')" spellcheck="false" autocomplete="off" />
        </label>
        <GnButton ref="filtersBtn" size="sm" :aria-expanded="filtersOpen" aria-controls="sw-filters" data-testid="sw-filters-toggle" @click="filtersOpen = !filtersOpen">
          {{ t('sw.filters') }}<GnBadge v-if="changed.length" tone="accent" data-testid="sw-filters-n">{{ changed.length }}</GnBadge>
        </GnButton>
        <GnButton ref="reposBtn" size="sm" :aria-expanded="reposOpen" aria-controls="sw-repos" data-testid="sw-repos-toggle" @click="toggleRepos">
          {{ t('sw.mr.toggle') }}<GnBadge v-if="multiOn" tone="accent" data-testid="sw-repos-n">{{ prefs.repoIds.length }}</GnBadge><GnTooltip :text="t('sw.mr.toggleTip')" />
        </GnButton>
        <GnButton size="sm" :aria-pressed="replaceOpen" data-testid="sw-replace-toggle" @click="toggleReplace">{{ t('sw.rp.toggle') }}<GnTooltip :text="t('sw.rp.toggleTip')" /></GnButton>
        <span class="sw__count" data-testid="sw-count" role="status" aria-live="polite">{{ running ? t('sw.searching', { n: live.hits }) : status }}</span>
        <GnButton v-if="running" size="sm" tone="warn" data-testid="sw-stop" @click="stop">{{ t('sw.stop') }}</GnButton>
        <GnIconButton icon="x" :label="t('sw.close')" data-testid="sw-close" @click="requestClose" />
      </header>
      <div v-if="pastOpen" class="sw__past" data-testid="sw-past">
        <ul id="sw-past-list" role="listbox" :aria-label="t('sw.pastLabel')" :aria-activedescendant="pastList.length ? 'sw-past-' + pastActive : undefined">
          <li
            v-for="(e, i) in pastList"
            :id="'sw-past-' + i"
            :key="i"
            class="sw__pastitem"
            :class="{ 'sw__pastitem--on': i === pastActive }"
            role="option"
            :aria-selected="i === pastActive"
            data-testid="sw-past-item"
            @click="applyPast(i)"
          >
            <span class="sw__pastpat">{{ e.pattern }}</span>
            <span class="sw__pastopts">{{ pastText(e) }}</span>
            <GnIconButton class="sw__pastx" icon="x" :label="t('sw.pastRemove')" tabindex="-1" aria-hidden="true" @click.stop="removePast(i)" />
          </li>
        </ul>
        <p v-if="!pastList.length" class="sw__hint" data-testid="sw-past-empty">{{ t('sw.pastEmpty') }}</p>
        <footer class="sw__pastfoot">
          <span>{{ t('sw.pastHint') }}</span>
          <GnButton v-if="searches.length" size="sm" variant="ghost" tone="danger" data-testid="sw-past-clear" @click="clearPast">{{ t('sw.pastClear') }}</GnButton>
        </footer>
      </div>
      <div v-if="replaceOpen" class="sw__repl" data-testid="sw-replace-row">
        <GnSearchField
          ref="replaceField"
          v-model="prefs.replaceText"
          variant="replace"
          class="sw__field"
          :label="t('find.replaceField')"
          :placeholder="t('find.replacePlaceholder')"
          :labels="fieldLabels"
          @enter="askApply"
        />
        <GnButton
          size="sm"
          :tone="prefs.preserveCase ? 'accent' : 'neutral'"
          :variant="prefs.preserveCase ? undefined : 'ghost'"
          :aria-pressed="prefs.preserveCase"
          data-testid="sw-preserve-case"
          @click="prefs.preserveCase = !prefs.preserveCase"
        >{{ t('find.preserveCase') }}<GnTooltip :text="t('find.preserveCaseTip')" /></GnButton>
        <label v-if="resultsMulti" class="sw__allow" data-testid="sw-allow-label">
          <input v-model="allowMultiReplace" type="checkbox" data-testid="sw-allow-multi" @change="allowMultiReplace ? schedulePlans(0) : (dropPlans(), rebuild())" />
          {{ t('sw.mr.allowReplace', { n: slots.length }) }}
        </label>
        <span class="sw__rsum" data-testid="sw-rsummary" role="status" aria-live="polite">{{ summaryText }}</span>
        <GnButton size="sm" variant="primary" :disabled="!canApply" data-testid="sw-apply" @click="askApply">{{ t('sw.rp.apply') }}</GnButton>
        <GnButton v-for="u in undoRepos" :key="u.id" size="sm" tone="warn" :disabled="!!applying" data-testid="sw-undo" :data-repo="u.name" @click="undoReplace(u.id)">{{ t('sw.rp.undo') }}<template v-if="resultsMulti"> · {{ u.name }}</template><GnTooltip :text="t('sw.rp.undoTip')" /></GnButton>
      </div>
      <p v-if="replaceOpen && refusedScope" class="sw__error" role="note" data-testid="sw-rscope">{{ t('sw.rp.scopeRefused') }}</p>
      <div v-if="result" class="sw__result" data-testid="sw-rresult">
        <p role="status">{{ resultText }}</p>
        <ul v-if="resultFiles.length" class="sw__resfiles" data-testid="sw-rresult-files">
          <li v-for="f in resultFiles" :key="f.file"><code>{{ f.file }}</code> — {{ t(('sw.rp.why.' + f.reason) as MessageKey) }}<template v-if="f.char"> ({{ f.char }})</template></li>
          <li v-if="(result.skipped.length ?? 0) > resultFiles.length">{{ t('sw.rp.andMore', { n: result.skipped.length - resultFiles.length }) }}</li>
        </ul>
        <GnButton size="sm" variant="ghost" data-testid="sw-rresult-close" @click="result = null">{{ t('sw.rp.dismiss') }}</GnButton>
      </div>
      <SearchRepos
        v-if="reposOpen"
        :catalog="catalog"
        :model-value="prefs.multi ? prefs.repoIds : [repo.id]"
        :active-id="repo.id"
        :open-ids="openIds"
        :sets="repoSets"
        @update:model-value="onRepos"
        @update:sets="onSets"
      />
      <div v-else-if="multiOn" class="sw__chips" data-testid="sw-repos-chip">
        <GnButton size="sm" variant="ghost" tone="accent" data-testid="sw-chip-repos" @click="toggleRepos">{{ t('sw.mr.chip', { n: prefs.repoIds.length }) }}</GnButton>
      </div>
      <SearchFilters v-if="filtersOpen" :model-value="filters" :repo-path="repo.path" @update:model-value="onFilters" />
      <div v-else-if="changed.length" class="sw__chips" data-testid="sw-chips">
        <GnButton v-for="k in changed" :key="k" size="sm" variant="ghost" tone="accent" :data-testid="'sw-chip-' + k" @click="filtersOpen = true">{{ chipText(k) }}</GnButton>
      </div>
      </div>
      <p v-if="searchError" class="sw__error" role="alert" data-testid="sw-error">{{ searchError }}</p>
      <div v-else-if="notes || canMore || hiddenCount" class="sw__notes" data-testid="sw-notes">
        <span v-if="notes">{{ notes }}</span>
        <GnButton v-if="canMore" size="sm" data-testid="sw-more" @click="loadMore">{{ t('sw.more') }}</GnButton>
        <template v-if="hiddenCount">
          <span data-testid="sw-hidden">{{ t('sw.hidden', { n: hiddenCount }) }}</span>
          <GnButton size="sm" variant="ghost" data-testid="sw-unhide" @click="unhide">{{ t('sw.unhide') }}</GnButton>
        </template>
      </div>

      <div ref="bodyEl" class="sw__body">
        <section class="sw__results" :style="{ flexBasis: splitPct + '%' }">
          <p v-if="emptyHint" class="sw__hint" data-testid="sw-hint">{{ emptyHint }}</p>
          <div v-else-if="done?.ok && !totalN" class="sw__hint sw__empty" data-testid="sw-empty">
            <p>{{ t('search.none') }}</p>
            <template v-if="suggestions.length">
              <p>{{ t('sw.try') }}</p>
              <ul class="sw__sg">
                <li v-for="sg in suggestions" :key="sg">
                  <GnButton size="sm" variant="ghost" tone="accent" :data-testid="'sw-sg-' + sg" @click="applySg(sg)">{{ t(('sw.sg.' + sg) as MessageKey) }}</GnButton>
                </li>
              </ul>
            </template>
          </div>
          <p v-else-if="done?.ok && !live.hits" class="sw__hint" data-testid="sw-allhidden">{{ t('sw.allHidden') }}</p>
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
                  :class="{ 'sw__row--new': v.row.kind === 'new', 'sw__row--old': v.row.kind === 'hit' && hasAfter(v.row.key), 'sw__row--file': v.row.kind === 'file' || v.row.kind === 'dir', 'sw__row--dir': v.row.kind === 'dir', 'sw__row--repo': v.row.kind === 'repo', 'sw__row--ctx': v.row.kind === 'ctx', 'sw__row--sel': v.row.key === selectedKey }"
                  :style="rowStyle(v.row)"
                  role="option"
                  :aria-selected="v.row.key === selectedKey"
                  :aria-label="rowLabel(v.row)"
                  :data-testid="rowTestId(v.row)"
                  @click="onRowClick(v.i, v.row)"
                >
                  <template v-if="v.row.kind === 'repo'">
                    <GnIcon :name="v.row.collapsed ? 'chevron-right' : 'chevron-down'" />
                    <span class="sw__fname sw__rname" data-testid="sw-repo-name">{{ v.row.name }}</span>
                    <GnBadge tone="neutral" data-testid="sw-repo-count">{{ v.row.count }}</GnBadge>
                    <GnBadge :tone="stateTone(v.row.state)" data-testid="sw-repo-state" :data-state="v.row.state">{{ stateText(v.row) }}</GnBadge>
                    <GnBadge v-if="v.row.cut" tone="warn" data-testid="sw-repo-cut">{{ cutText(v.row) }}</GnBadge>
                    <span v-if="v.row.message && v.row.state === 'error'" class="sw__rmsg">{{ v.row.message }}</span>
                    <GnButton v-if="isActive(v.row.state)" class="sw__rstop" size="sm" tone="warn" variant="ghost" tabindex="-1" :aria-label="t('sw.mr.stopRepo', { name: v.row.name })" data-testid="sw-repo-stop" @click.stop="stopRepo(v.row.alias)">{{ t('sw.stop') }}</GnButton>
                    <GnIconButton class="sw__hide" icon="x" :label="t('sw.hide')" :title="t('sw.hideTip')" tabindex="-1" aria-hidden="true" @click.stop="hide(v.i, 'dir')" />
                  </template>
                  <template v-else-if="v.row.kind === 'dir'">
                    <GnIcon :name="v.row.collapsed ? 'chevron-right' : 'chevron-down'" />
                    <span class="sw__fname">{{ plainPath(v.row.dir, resultsMulti) || t('sw.rootDir') }}</span>
                    <GnBadge tone="neutral">{{ v.row.count }}</GnBadge>
                    <GnIconButton class="sw__hide" icon="x" :label="t('sw.hide')" :title="t('sw.hideTip')" tabindex="-1" aria-hidden="true" @click.stop="hide(v.i, 'dir')" />
                  </template>
                  <template v-else-if="v.row.kind === 'file'">
                    <GnIcon :name="v.row.collapsed ? 'chevron-right' : 'chevron-down'" />
                    <span class="sw__fname">{{ plainPath(v.row.file, resultsMulti) }}</span>
                    <GnBadge tone="neutral">{{ v.row.count }}</GnBadge>
                    <GnBadge v-if="v.row.note" tone="warn" data-testid="sw-file-note">{{ t(('sw.rp.why.' + v.row.note) as MessageKey) }}</GnBadge>
                    <GnIconButton class="sw__hide" icon="x" :label="t('sw.hide')" :title="t('sw.hideTip')" tabindex="-1" aria-hidden="true" @click.stop="hide(v.i, 'file')" />
                  </template>
                  <template v-else-if="v.row.kind === 'new'">
                    <span class="sw__ln">+</span>
                    <span class="sw__text"><template v-for="(p, k) in pieces(v.row)" :key="k"><ins v-if="p.hit">{{ p.text }}</ins><template v-else>{{ p.text }}</template></template></span>
                    <GnIconButton class="sw__hide" icon="x" :label="t('sw.hide')" :title="t('sw.hideTip')" tabindex="-1" aria-hidden="true" @click.stop="hide(v.i, 'hit')" />
                  </template>
                  <template v-else-if="v.row.kind === 'ctx'">
                    <span class="sw__ln">{{ v.row.line }}</span>
                    <span class="sw__text">{{ v.row.text }}</span>
                  </template>
                  <template v-else>
                    <span v-if="v.row.showFile" class="sw__fp">{{ plainPath(v.row.file, resultsMulti) }}</span>
                    <span class="sw__ln">{{ v.row.hit.line }}</span>
                    <span class="sw__text"><template v-for="(p, k) in pieces(v.row.hit)" :key="k"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></span>
                    <GnIconButton class="sw__hide" icon="x" :label="t('sw.hide')" :title="t('sw.hideTip')" tabindex="-1" aria-hidden="true" @click.stop="hide(v.i, 'hit')" />
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
              <GnBadge v-if="resultsMulti" tone="accent" data-testid="sw-owner">{{ own(cur.file).repo.name }}</GnBadge>
              <span class="sw__path" data-testid="sw-path">{{ plainPath(cur.file, resultsMulti) }}</span>
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

    <GnDialog v-if="confirmApply && totals" role="alertdialog" width="min(480px, 92vw)" :label="t('sw.rp.confirmTitle')" initial-focus="[data-testid='sw-confirm-apply']" @close="confirmApply = false">
      <div class="sw__ask" data-testid="sw-confirm">
        <h2>{{ t('sw.rp.confirmTitle') }}</h2>
        <ul v-if="resultsMulti" class="sw__askrepos" data-testid="sw-confirm-repos">
          <li v-for="r in perRepoTotals" :key="r.alias">
            <label>
              <input type="checkbox" :checked="confirmRepos.has(r.alias)" :disabled="r.replacements === 0" :data-testid="'sw-confirm-repo-' + r.name" @change="toggleConfirmRepo(r.alias, ($event.target as HTMLInputElement).checked)" />
              <strong>{{ r.name }}</strong>
              <span>{{ r.replacements > 0 ? countText(r.replacements, r.files) : t('sw.rp.nothing') }}<template v-if="r.refused"> · {{ t('sw.rp.refused', { n: r.refused }) }}</template></span>
            </label>
          </li>
        </ul>
        <p>{{ t('sw.rp.confirmBody', { what: countText(confirmTotals?.replacements ?? 0, confirmTotals?.files ?? 0) }) }}</p>
        <p v-if="prefs.replaceText === ''" class="sw__warn" role="alert" data-testid="sw-confirm-empty">{{ t('sw.rp.confirmEmpty') }}</p>
        <div class="sw__ask-btns">
          <GnButton variant="primary" :disabled="resultsMulti && !confirmRepos.size" data-testid="sw-confirm-apply" @click="applyAll">{{ t('sw.rp.apply') }}</GnButton>
          <GnButton variant="ghost" data-testid="sw-confirm-cancel" @click="confirmApply = false">{{ t('sw.rp.cancel') }}</GnButton>
        </div>
      </div>
    </GnDialog>

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
.sw__headwrap { position: relative; flex: none; }
.sw__chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 12px 6px; }
.sw__past {
  position: absolute; z-index: 20; top: 46px; left: 12px; width: min(680px, calc(100% - 24px)); max-height: 320px; display: flex; flex-direction: column;
  background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: 8px; box-shadow: var(--gn-shadow-lg); overflow: hidden;
  ul { margin: 0; padding: 4px 0; list-style: none; overflow: auto; min-height: 0; }
}
.sw__pastitem {
  display: flex; align-items: center; gap: 10px; padding: 3px 12px; cursor: pointer; font: 12.5px var(--gn-mono);
  &:hover, &--on { background: color-mix(in srgb, var(--gn-accent) 16%, transparent); }
  &--on { box-shadow: inset 3px 0 0 var(--gn-accent); }
}
.sw__pastpat { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw__pastopts { flex: none; color: var(--gn-muted); font-size: 11.5px; }
.sw__pastx { opacity: 0; }
.sw__pastitem:hover .sw__pastx, .sw__pastitem--on .sw__pastx { opacity: 1; }
.sw__pastfoot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 12px; border-top: 1px solid var(--gn-border); color: var(--gn-muted); font-size: 11.5px; }
.sw__repl { display: flex; align-items: flex-start; gap: 8px; padding: 0 12px 6px; .sw__field { flex: 1 1 360px; } }
.sw__row--repo { background: color-mix(in srgb, var(--gn-accent) 8%, var(--gn-surface-2)); font-weight: 700; box-shadow: inset 0 -1px 0 var(--gn-border); }
.sw__rname { font-family: var(--gn-font-ui); }
.sw__rmsg { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--gn-muted); font-weight: 400; }
.sw__rstop { flex: none; margin-left: auto; height: 18px; min-height: 0; padding: 0 8px; font-size: 11px; }
.sw__allow { display: inline-flex; align-items: center; gap: 6px; align-self: center; font-size: 12.5px; cursor: pointer; }
.sw__askrepos { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 4px; label { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; span { color: var(--gn-muted); } } }
.sw__warn { margin: 0 0 12px; color: var(--gn-danger); font-weight: 600; }
.sw__rsum { align-self: center; flex: 0 1 auto; color: var(--gn-muted); font-size: 12.5px; }
.sw__result { display: flex; align-items: flex-start; gap: 12px; padding: 4px 14px 6px; font-size: 12.5px; background: color-mix(in srgb, var(--gn-success) 10%, transparent); border-top: 1px solid var(--gn-border); p { margin: 0; flex: 1; } }
.sw__resfiles { margin: 0; padding: 0 0 0 16px; font-size: 12px; color: var(--gn-muted); code { font: 12px var(--gn-mono); color: var(--gn-text); } }
.sw__row--new { background: color-mix(in srgb, var(--gn-success) 9%, transparent); ins { text-decoration: none; background: color-mix(in srgb, var(--gn-success) 35%, transparent); border-radius: 2px; } .sw__ln { color: var(--gn-success); } }
.sw__row--old mark { background: color-mix(in srgb, var(--gn-danger) 30%, transparent); text-decoration: line-through; }
.sw__empty { display: flex; flex-direction: column; gap: 4px; p { margin: 0; } }
.sw__sg { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; }
.sw__hide { margin-left: auto; opacity: 0; }
.sw__row:hover .sw__hide, .sw__row--sel .sw__hide { opacity: 1; }
.sw__row--ctx { color: var(--gn-muted); }
.sw__fp { flex: none; color: var(--gn-muted); }
.sw__head { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px 6px; }
.sw__field { flex: 1 1 360px; min-width: 0; }
.sw__masks { display: flex; align-items: center; gap: 6px; flex: 0 1 230px; min-width: 0; font-size: 12px; color: var(--gn-muted); input { flex: 1; min-width: 0; font-family: var(--gn-mono); } }
.sw__count { align-self: center; min-width: 8em; color: var(--gn-muted); font-size: 12.5px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.sw__error { margin: 0; padding: 2px 14px 6px; color: var(--gn-danger); font-size: 12px; white-space: pre-wrap; }
.sw__notes { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; padding: 0 14px 6px; color: var(--gn-warn); font-size: 12px; }
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
