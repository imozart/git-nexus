<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, triggerRef, watch } from 'vue';
import { GnBadge, GnButton, GnDialog, GnIcon, GnIconButton, GnSegmented, GnTooltip } from '@git-nexus/ui-kit';
import { createGraphBuilder, filterBreaksGraph, type HistoryFilter, type CiStatus, type CommitDetail, type CommitInfo, type FileAtRevision, type GraphRow, type HistoryHit, type HistoryQuery, type RepoSummary, type RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { useWorkspaceStore } from '../stores/workspace';
import { dateLocale, t, type MessageKey } from '../i18n';
import { KIND_KEY, KIND_TONE, diffLines, kindNumbers, rangerFor } from '../history-search-core';
import {
  COLUMN_DEFAULT, COLUMN_IDS, COLUMN_MAX, COLUMN_MIN, LANE_COLORS, ROW_HEIGHT,
  abbreviateChips, avatarOf, clampWidth, commitState, fitColumns, gridTemplate, laneMetrics, nearEnd, parseColumnPrefs, parseDensity, parseRefs, scrollToRow, visibleRange,
  type ColumnId, type ColumnPrefs, type Density, type RefChip,
} from '../graph-core';
import { parseGraphFilter } from '../graph-filter-core';
import { agoText } from '../sync';
import { theme } from '../theme';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import CodeEditor from '../components/CodeEditor.vue';
import ContextMenu, { type MenuItem } from '../components/ContextMenu.vue';
import GraphFilters from '../components/GraphFilters.vue';
import HistorySearch from '../components/HistorySearch.vue';
import SyncIndicator from '../components/SyncIndicator.vue';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

// --- o histórico, página a página -----------------------------------------------------------------------------------------------------------------------------------
// A primeira página (200) aparece logo; o resto vem ao rolar. O traçado das lanes é calculado aos poucos (`createGraphBuilder`), nunca de uma vez.
const PAGE_FIRST = 200;
const PAGE = 2000;
const RELOAD_MAX = 4000;
const commits = shallowRef<CommitInfo[]>([]);
const rows = shallowRef<GraphRow[]>([]);
const lanes = ref(1);
const hasMore = ref(false);
const error = ref('');
const loading = ref(false);
const selectedHash = ref('');
/** O filtro do Grafo (branches, autor, período, pasta, merges...), lembrado por repositório. Vale no Git, não aqui: a lista é recarregada com ele. */
const FILTER_KEY = `gitnexus.graphFilter.${props.repo.id}`;
const filter = ref<HistoryFilter>(parseGraphFilter(localStorage.getItem(FILTER_KEY)));
/** Autor e "sem merges" tiram commits do meio sem religar os pais: a lista os mostra sem o traçado (como o resultado de uma busca). */
const broken = computed(() => filterBreaksGraph(filter.value));
/** Quantos commits o filtro mostra e quantos o repositório tem ("N de M"). */
const counts = ref<{ count: number; total: number } | null>(null);
/** O filtro como objeto simples (o IPC não leva o proxy reativo). */
const plainFilter = (): HistoryFilter => JSON.parse(JSON.stringify(filter.value)) as HistoryFilter;
let builder = createGraphBuilder();
let generation = 0;
let loadingMore = false;

/** Quem é remoto (origin...) para os chips, e o estado do branch atual em relação ao remoto (↑ ↓ na linha do HEAD). */
const remotes = ref<string[]>(['origin']);
const summary = ref<RepoSummary | null>(null);

async function load(reset = false): Promise<void> {
  const mine = ++generation;
  loading.value = true;
  error.value = '';
  try {
    // recarregar depois de uma ação não joga a pessoa de volta ao topo: refaz o que já estava carregado (até um limite), a primeira vez só a primeira página
    const want = reset ? PAGE_FIRST : Math.min(Math.max(commits.value.length, PAGE_FIRST), RELOAD_MAX);
    const page = await api.getHistory(props.repo.path, want, 0, plainFilter());
    if (mine !== generation) return;
    builder = createGraphBuilder();
    if (!broken.value) builder.append(page);
    commits.value = page;
    rows.value = builder.rows;
    lanes.value = builder.lanes;
    hasMore.value = page.length >= want;
    triggerRef(rows);
    void api.getHistoryCount(props.repo.path, plainFilter()).then((c) => mine === generation && (counts.value = c)).catch(() => (counts.value = null));
    void api.listBranches(props.repo.path).then((b) => b.remoteNames.length && (remotes.value = b.remoteNames)).catch(() => undefined);
    void api.getRepoSummary(props.repo.path).then((s) => (summary.value = s)).catch(() => (summary.value = null));
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    if (mine === generation) loading.value = false;
  }
}

/** Próxima página, quando a rolagem chega perto do fim do que está carregado. */
async function loadMore(): Promise<void> {
  if (loadingMore || !hasMore.value || hits.value) return;
  loadingMore = true;
  const mine = generation;
  try {
    const page = await api.getHistory(props.repo.path, PAGE, commits.value.length, plainFilter());
    if (mine !== generation) return;
    if (!page.length) {
      hasMore.value = false;
      return;
    }
    if (!broken.value) builder.append(page);
    for (const c of page) commits.value.push(c);
    lanes.value = builder.lanes;
    hasMore.value = page.length >= PAGE;
    triggerRef(commits);
    triggerRef(rows);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loadingMore = false;
  }
}

// --- busca na história (fase 9 da #233): o painel manda os commits achados, a lista os mostra ------------------------
/** Resultado da busca (sem o desenho do grafo: o conjunto filtrado não forma linhas contínuas). `null` = nenhuma busca na tela. */
const hits = ref<HistoryHit[] | null>(null);
/** O pedido da busca que está na tela: o destaque do diff usa o mesmo texto e as mesmas opções. */
const active = ref<HistoryQuery | null>(null);
const searching = ref(false);
/** Um pedido de fora (janela de pesquisa, editor, paleta) para este repositório. */
const target = computed(() => (ws.historyTarget && ws.historyTarget.repoId === props.repo.id ? ws.historyTarget : null));
const shown = computed<CommitInfo[]>(() => hits.value ?? commits.value);
const selected = computed(() => shown.value.find((c) => c.hash === selectedHash.value));
const selIndex = computed(() => (selectedHash.value ? shown.value.findIndex((c) => c.hash === selectedHash.value) : -1));
const hitOf = (c: CommitInfo | undefined): HistoryHit | undefined => (c && 'kind' in c ? (c as HistoryHit) : undefined);
const selectedHit = computed(() => hitOf(selected.value));
const ranger = computed(() => (active.value ? rangerFor(active.value) : null));
/** O selo só aparece quando a busca tem texto (uma busca só por autor ou período não tem "entrou/saiu"). */
const showKind = (h: HistoryHit): boolean => !!active.value?.text || active.value?.mode === 'range' || h.kind === 'message';
const kindText = (h: HistoryHit): string => `${t(KIND_KEY[h.kind])}${kindNumbers(h) ? ' ' + kindNumbers(h) : ''}`;
const KIND_TIP = { added: 'hs.kindTip.added', removed: 'hs.kindTip.removed', changed: 'hs.kindTip.changed', message: 'hs.kindTip.message', unknown: 'hs.kindTip.unknown' } as const;

// --- colunas, densidade e o traçado --------------------------------------------------------------------------------------------------------------------------------
const COLS_KEY = `gitnexus.graphCols.${props.repo.id}`;
const DENSITY_KEY = 'gitnexus.graphDensity';
const colPrefs = ref<ColumnPrefs>(parseColumnPrefs(localStorage.getItem(COLS_KEY)));
watch(colPrefs, (p) => localStorage.setItem(COLS_KEY, JSON.stringify(p)), { deep: true });
const density = ref<Density>(parseDensity(localStorage.getItem(DENSITY_KEY)));
watch(density, (d) => localStorage.setItem(DENSITY_KEY, d));
const rowH = computed(() => ROW_HEIGHT[density.value]);
const metrics = computed(() => laneMetrics(lanes.value));
/** Sem traçado numa busca (o conjunto achado não forma linhas contínuas): a coluna some. */
const graphW = computed(() => (hits.value || broken.value ? 0 : metrics.value.graphW));
/** Largura da área da lista (muda com a janela e com o detalhe aberto ao lado): as colunas que não cabem saem da direita para a esquerda. */
const mainW = ref(1000);
const visible = computed(() => fitColumns(colPrefs.value, graphW.value, mainW.value));
const grid = computed(() => gridTemplate(colPrefs.value, graphW.value, visible.value));
const COL_LABEL: Record<ColumnId, MessageKey> = { author: 'gv.col.author', date: 'gv.col.date', hash: 'gv.col.hash' };
const DENSITY_LABEL: Record<Density, MessageKey> = { compact: 'gv.density.compact', comfortable: 'gv.density.comfortable' };
const densityOptions = computed(() => (['compact', 'comfortable'] as Density[]).map((d) => ({ value: d, label: t(DENSITY_LABEL[d]) })));
const laneColor = (lane: number): string => LANE_COLORS[theme.value][lane % LANE_COLORS[theme.value].length]!;
const lx = (lane: number): number => lane * metrics.value.colW + metrics.value.colW / 2 + 2;
/** Curva suave entre dois pontos de lanes (cruzamentos sem quina). */
const curve = (x1: number, y1: number, x2: number, y2: number): string => (x1 === x2 ? `M${x1} ${y1}L${x2} ${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`);

// redimensionar: arrastar a divisória, setas (com o foco nela) ou duplo clique (volta ao padrão)
let drag: { id: ColumnId; x: number; w: number } | null = null;
function gripDown(e: PointerEvent, id: ColumnId): void {
  drag = { id, x: e.clientX, w: colPrefs.value.widths[id] };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function gripMove(e: PointerEvent): void {
  if (drag) colPrefs.value.widths[drag.id] = clampWidth(drag.id, drag.w + (drag.x - e.clientX)); // a divisória fica à esquerda da coluna: arrastar para a esquerda alarga
}
const gripUp = (): void => {
  drag = null;
};
function gripKey(e: KeyboardEvent, id: ColumnId): void {
  const step = e.shiftKey ? 32 : 8;
  const d = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0;
  if (e.key === 'Home' || e.key === 'Enter') colPrefs.value.widths[id] = COLUMN_DEFAULT[id];
  else if (!d) return;
  else colPrefs.value.widths[id] = clampWidth(id, colPrefs.value.widths[id] + d);
  e.preventDefault();
}
const gripReset = (id: ColumnId): void => {
  colPrefs.value.widths[id] = COLUMN_DEFAULT[id];
};

// --- lista virtual -----------------------------------------------------------------------------------------------------------------------------------------------------
const listEl = ref<HTMLElement>();
const scrollTop = ref(0);
const viewportH = ref(600);
const range = computed(() => visibleRange(scrollTop.value, viewportH.value, rowH.value, shown.value.length));
const windowItems = computed(() => shown.value.slice(range.value.start, range.value.end));
const offsetY = computed(() => range.value.start * rowH.value);
let ro: ResizeObserver | undefined;
function onScroll(): void {
  // sem requestAnimationFrame: o evento de rolagem já vem no ritmo dos quadros, e a janela precisa acompanhar mesmo com a página em segundo plano
  scrollTop.value = listEl.value?.scrollTop ?? 0;
  if (!hits.value && nearEnd(range.value, commits.value.length)) void loadMore();
}
onMounted(() => {
  void load();
  if (typeof ResizeObserver !== 'undefined' && listEl.value) {
    ro = new ResizeObserver(() => {
      viewportH.value = listEl.value?.clientHeight ?? 600;
      mainW.value = listEl.value?.clientWidth ?? 1000;
    });
    ro.observe(listEl.value);
  }
});
onBeforeUnmount(() => {
  ro?.disconnect();
});
watch(() => ws.versions[props.repo.id], () => load());
// mudar o filtro: grava e recomeça da primeira página
watch(
  filter,
  (v) => {
    if (Object.keys(v).length) localStorage.setItem(FILTER_KEY, JSON.stringify(v));
    else localStorage.removeItem(FILTER_KEY);
    selectedHash.value = '';
    void load(true);
  },
  { deep: true },
);
// mudar a lista (busca na história ou voltar dela) começa do topo
watch(hits, () => {
  if (listEl.value) listEl.value.scrollTop = 0;
  scrollTop.value = 0;
});

function reveal(index: number): void {
  const el = listEl.value;
  if (!el || index < 0) return;
  const to = scrollToRow(index, el.scrollTop, el.clientHeight, rowH.value);
  if (to !== null) {
    el.scrollTop = to;
    scrollTop.value = to;
  }
}
async function select(index: number): Promise<void> {
  const c = shown.value[Math.max(0, Math.min(shown.value.length - 1, index))];
  if (!c) return;
  selectedHash.value = c.hash;
  await nextTick();
  reveal(selIndex.value);
  if (!hits.value && nearEnd(range.value, commits.value.length)) void loadMore();
}

/** Setas, Home, End, PgUp e PgDn movem a seleção; Enter leva o foco ao detalhe; Ctrl+C copia o hash; Menu / Shift+F10 abre o menu da linha. */
function onListKey(e: KeyboardEvent): void {
  const page = Math.max(1, Math.floor((listEl.value?.clientHeight ?? 400) / rowH.value) - 1);
  const i = selIndex.value;
  const move = (to: number) => {
    e.preventDefault();
    void select(to);
  };
  if (e.key === 'ArrowDown') move(i < 0 ? 0 : i + 1);
  else if (e.key === 'ArrowUp') move(i < 0 ? 0 : i - 1);
  else if (e.key === 'PageDown') move(i + page);
  else if (e.key === 'PageUp') move(i - page);
  else if (e.key === 'Home') move(0);
  else if (e.key === 'End') move(shown.value.length - 1);
  else if (e.key === 'Enter' && selected.value) {
    e.preventDefault();
    document.querySelector<HTMLElement>('[data-testid="gv-detail"]')?.focus();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selected.value && !window.getSelection()?.toString()) {
    e.preventDefault();
    void copyHashOf(selected.value);
  } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault();
    const row = listEl.value?.querySelector<HTMLElement>('.row--on');
    const r = (row ?? listEl.value)?.getBoundingClientRect();
    if (selected.value && r) menu.value = { x: r.left + 40, y: r.bottom, commit: selected.value };
  }
}

// --- o que cada linha mostra ---------------------------------------------------------------------------------------------------------------------------------------------
const chipsOf = (c: CommitInfo) => abbreviateChips(parseRefs(c.refs, remotes.value));
const hiddenText = (hidden: RefChip[]): string => hidden.map((x) => x.full).join('\n');
const isHeadRow = (c: CommitInfo): boolean => c.refs.some((r) => r === 'HEAD' || r.startsWith('HEAD -> '));
/** Data curta: relativa até uma semana ("há 3 h"), depois o dia; o tooltip leva a data inteira com o fuso. */
function whenText(sec: number): string {
  const ms = sec * 1000;
  return Date.now() - ms < 7 * 86_400_000 ? agoText(ms) : new Date(ms).toLocaleDateString(dateLocale.value, { day: '2-digit', month: '2-digit', year: '2-digit' }); // curta (19/11/26): cabe na coluna
}
const fullDate = (sec: number): string => new Date(sec * 1000).toLocaleString(dateLocale.value, { dateStyle: 'full', timeStyle: 'long' });
const stateText = (c: CommitInfo): string => {
  const st = commitState(c);
  return [st.merge ? t('gv.state.merge', { parents: c.parents.map((p) => p.slice(0, 7)).join(', ') }) : '', st.published === null ? '' : st.published ? t('gv.state.published') : t('gv.state.local')].filter(Boolean).join(' · ');
};
/** O nome da linha para o leitor de tela: assunto, autor, quando, referências e estado, tudo em texto. */
function rowAria(c: CommitInfo): string {
  const h = hitOf(c);
  const kind = h && showKind(h) ? `${t(KIND_KEY[h.kind])}${kindNumbers(h) ? ' ' + kindNumbers(h) : ''}. ` : '';
  const refs = parseRefs(c.refs, remotes.value).map((x) => x.full).join(', ');
  return `${kind}${c.subject}, ${c.author}, ${whenText(c.date)}${refs ? `, ${refs}` : ''}${stateText(c) ? `, ${stateText(c)}` : ''}`;
}
const avatarStyle = (c: CommitInfo) => ({ background: `hsl(${avatarOf(c.author, c.authorEmail).hue} 52% 36%)` });

// --- detalhe do commit: mensagem completa, arquivos e diff ---------------------------------------
const detail = ref<CommitDetail | null>(null);
/** Status de CI do commit selecionado (só aparece com uma conta GitHub/GitLab conectada em Ferramentas). */
const ci = ref<CiStatus | null>(null);
const CI_TEXT: Record<CiStatus['state'], MessageKey> = { success: 'gv.ci.success', failure: 'gv.ci.failure', pending: 'gv.ci.pending', none: 'gv.ci.none' };
const CI_TONE = { success: 'success', failure: 'danger', pending: 'warn', none: 'neutral' } as const;
let hostingReady: Promise<boolean> | null = null;
const canCi = () => (hostingReady ??= api.hostingInfo(props.repo.path).then((i) => i.supported && i.hasToken).catch(() => false));
const failUrl = computed(() => ci.value?.checks.find((c) => c.state === 'failure')?.url);
const diffFile = ref('');
const diffText = ref('');
/** O diff do arquivo escolhido, linha a linha, com o que a busca procurou marcado nas linhas + e −. */
const diffRows = computed(() => diffLines(diffText.value, ranger.value));
const patchRows = computed(() => (selectedHit.value?.patch ? diffLines(selectedHit.value.patch, null) : []));
watch(selectedHash, async (h) => {
  ci.value = null;
  if (h && (await canCi())) api.getCiStatus(props.repo.path, h).then((s) => h === selectedHash.value && (ci.value = s)).catch(() => undefined);
  detail.value = null;
  diffFile.value = '';
  diffText.value = '';
  if (!h) return;
  try {
    const d = await api.getCommitDetail(props.repo.path, h);
    if (h === selectedHash.value) detail.value = d;
  } catch (e) {
    error.value = errMsg(e);
  }
});
async function showFile(f: string): Promise<void> {
  diffFile.value = f;
  diffText.value = await api.getCommitFileDiff(props.repo.path, selectedHash.value, f);
}
const STATUS: Record<string, MessageKey> = { A: 'gv.st.A', M: 'gv.st.M', D: 'gv.st.D', T: 'gv.st.T' };
/** O que a busca contou neste arquivo do commit (`null` = a busca não tocou nele). */
const touched = (path: string) => selectedHit.value?.files.find((f) => f.path === path || f.oldPath === path) ?? null;
const countText = (f: { added: number; removed: number }) => [f.removed ? `−${f.removed}` : '', f.added ? `+${f.added}` : ''].filter(Boolean).join(' ');

// --- copiar ------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** Aviso curto ("Hash copiado ✓") que some sozinho. */
const note = ref('');
let noteTimer: ReturnType<typeof setTimeout> | undefined;
function say(key: MessageKey): void {
  note.value = t(key);
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => (note.value = ''), 1800);
}
onBeforeUnmount(() => clearTimeout(noteTimer));
async function copyHashOf(c: CommitInfo): Promise<void> {
  await api.copyText(c.hash).catch(() => undefined);
  say('gv.copiedHash');
}
async function copyHash(): Promise<void> {
  if (selected.value) await copyHashOf(selected.value);
}

// --- arquivo nesta versão -----------------------------------------------------------------------
const fileAt = ref<{ hash: string; file: string; data: FileAtRevision | null; error: string } | null>(null);
async function openFileAt(file: string): Promise<void> {
  const hash = selectedHash.value;
  fileAt.value = { hash, file, data: null, error: '' };
  try {
    const data = await api.getFileAtRevision(props.repo.path, hash, file);
    if (fileAt.value?.hash === hash && fileAt.value.file === file) fileAt.value.data = data;
  } catch (e) {
    if (fileAt.value) fileAt.value.error = errMsg(e);
  }
}
/** Onde a busca casa no arquivo daquela versão (o editor marca; no máximo 3000 trechos). */
const fileAtMarks = computed(() => {
  const text = fileAt.value?.data?.text;
  const r = ranger.value;
  if (!text || !r) return [];
  const out: Array<{ line: number; from: number; to: number }> = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < 3000; i++) for (const [from, to] of r.ranges(lines[i]!.replace(/\r$/, ''))) out.push({ line: i + 1, from, to });
  return out;
});
const fileAtMessage = computed(() => {
  const d = fileAt.value?.data;
  if (!d) return '';
  if (!d.exists) return t('hs.fileAtGone');
  return d.tooBig || d.binary ? t('hs.fileAtBig') : '';
});

// --- cherry-pick e revert do commit selecionado ---------------------------------------------
const ask = ref<{ kind: 'cherry-pick' | 'revert'; hash: string; subject: string } | null>(null);
const opBusy = ref(false);
const opNotice = ref<{ ok: boolean; text: string } | null>(null);

async function runCommitOp(): Promise<void> {
  const a = ask.value;
  ask.value = null;
  if (!a) return;
  opBusy.value = true;
  opNotice.value = null;
  try {
    const r = await (a.kind === 'cherry-pick' ? api.cherryPickCommit : api.revertCommit)(props.repo.path, a.hash);
    opNotice.value = { ok: r.ok, text: r.message };
    ws.bump(props.repo.id); // a tela do repositório e o grafo recarregam
    if (r.conflicted) ws.open('merge', props.repo); // parou por conflitos: leva a pessoa até eles
  } catch (e) {
    opNotice.value = { ok: false, text: errMsg(e) };
  } finally {
    opBusy.value = false;
  }
}

// --- menu da linha (botão direito, tecla Menu ou Shift+F10) e o menu das colunas -------------------------------------------------
const menu = ref<{ x: number; y: number; commit: CommitInfo } | null>(null);
const colMenu = ref<{ x: number; y: number } | null>(null);
const menuItems = computed<MenuItem[]>(() => [
  { id: 'copyHash', label: t('hs.copyHash') },
  { id: 'copyMessage', label: t('gv.menu.copyMessage') },
  { id: 'sep1', separator: true },
  { id: 'branch', label: t('gv.menu.branchHere') },
  { id: 'tag', label: t('gv.tagHere') },
  { id: 'rebase', label: t('gv.rebaseHere') },
  { id: 'sep2', separator: true },
  { id: 'cherry', label: t('gv.cherryPick') },
  { id: 'revert', label: t('gv.revert') },
]);
const colMenuItems = computed<MenuItem[]>(() => [
  ...COLUMN_IDS.map((id) => ({ id: `col:${id}`, label: `${colPrefs.value.hidden.includes(id) ? '    ' : '✓  '}${t(COL_LABEL[id])}` })),
  { id: 'sep', separator: true },
  { id: 'reset', label: t('gv.col.reset') },
]);
function openRowMenu(e: MouseEvent, c: CommitInfo): void {
  selectedHash.value = c.hash;
  menu.value = { x: e.clientX, y: e.clientY, commit: c };
}
function openColMenu(e: MouseEvent): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  colMenu.value = { x: Math.max(8, r.right - 220), y: r.bottom + 4 };
}
async function onMenu(id: string): Promise<void> {
  const c = menu.value?.commit;
  menu.value = null;
  if (!c) return;
  if (id === 'copyHash') await copyHashOf(c);
  else if (id === 'copyMessage') {
    await api.copyText(c.subject).catch(() => undefined);
    say('gv.copiedMessage');
  } else if (id === 'branch') branchAsk.value = { commit: c, name: '', error: '', busy: false };
  else if (id === 'tag') ws.openTools(props.repo, 'tags', c.hash);
  else if (id === 'rebase') ws.openTools(props.repo, 'rebase', c.hash);
  else if (id === 'cherry') ask.value = { kind: 'cherry-pick', hash: c.hash, subject: c.subject };
  else if (id === 'revert') ask.value = { kind: 'revert', hash: c.hash, subject: c.subject };
}
function onColMenu(id: string): void {
  colMenu.value = null;
  if (id === 'reset') colPrefs.value = parseColumnPrefs(null);
  else if (id.startsWith('col:')) {
    const col = id.slice(4) as ColumnId;
    const hidden = colPrefs.value.hidden;
    colPrefs.value.hidden = hidden.includes(col) ? hidden.filter((x) => x !== col) : [...hidden, col];
  }
}

// --- criar branch aqui ---------------------------------------------------------------------------------------------------------------------------------------------------
const branchAsk = ref<{ commit: CommitInfo; name: string; error: string; busy: boolean } | null>(null);
async function createBranchHere(): Promise<void> {
  const a = branchAsk.value;
  if (!a || !a.name.trim() || a.busy) return;
  a.busy = true;
  a.error = '';
  try {
    const r = await api.createBranch(props.repo.path, { name: a.name.trim(), base: a.commit.hash, checkout: false });
    if (!r.ok) {
      a.error = r.message;
      return;
    }
    opNotice.value = { ok: true, text: r.message };
    branchAsk.value = null;
    ws.bump(props.repo.id);
  } catch (e) {
    a.error = errMsg(e);
  } finally {
    if (branchAsk.value) branchAsk.value.busy = false;
  }
}
</script>

<template>
  <div class="gv">
    <header class="gv__head">
      <strong>{{ repo.name }}</strong>
      <span class="muted" data-testid="gv-count">{{ hits ? t('gv.results', { n: hits.length }) : counts ? t('gv.commitsOf', { n: counts.count, total: counts.total }) : t('gv.commitsAll', { n: commits.length }) }}{{ !hits && !counts && hasMore ? '+' : '' }}</span>
      <GraphFilters v-model="filter" :repo-path="repo.path" :repo-id="repo.id" />
      <span v-if="note" class="gv__note" role="status">{{ note }}</span>
      <span class="spacer" />
      <GnSegmented v-model="density" :options="densityOptions" :aria-label="t('gv.density')" :title="t('gv.density')" data-testid="gv-density" />
      <GnButton size="sm" :disabled="loading" @click="load">{{ t('rv.refresh') }}</GnButton>
      <GnButton size="sm" tone="accent" @click="ws.open('repo', repo)">{{ t('gv.backToStaging') }}</GnButton>
    </header>
    <HistorySearch v-model:hits="hits" v-model:active="active" v-model:running="searching" :repo="repo" :target="target" :selected="selectedHash" @select="(h: string) => (selectedHash = h)" @consumed="ws.historyTarget = null" />
    <p v-if="error" class="err">{{ error }}</p>
    <p v-else-if="hits && !hits.length && !searching" class="muted empty" data-testid="gv-nomatch">{{ t('gv.noMatch') }}</p>
    <p v-else-if="!commits.length && !loading && !hits" class="muted empty">{{ t('gv.noCommits') }}</p>

    <div class="gv__body">
      <div class="gv__main">
        <!-- cabeçalho das colunas: as divisórias redimensionam (arrastar, setas, duplo clique) e o menu liga e desliga colunas -->
        <div class="gv__cols" :style="{ gridTemplateColumns: grid }" data-testid="gv-cols" @contextmenu.prevent="openColMenu">
          <span class="gv__colh">{{ hits ? '' : t('gv.col.graph') }}</span>
          <span class="gv__colh">{{ t('gv.col.message') }}</span>
          <span v-for="id in visible" :key="id" class="gv__colh gv__colh--r" :data-col="id">
            <span
              class="gv__grip"
              role="separator"
              aria-orientation="vertical"
              tabindex="0"
              :aria-label="t('gv.col.resize', { col: t(COL_LABEL[id]) })"
              :aria-valuenow="colPrefs.widths[id]"
              :aria-valuemin="COLUMN_MIN[id]"
              :aria-valuemax="COLUMN_MAX[id]"
              :data-grip="id"
              @pointerdown.prevent="gripDown($event, id)"
              @pointermove="gripMove"
              @pointerup="gripUp"
              @pointercancel="gripUp"
              @keydown="gripKey($event, id)"
              @dblclick="gripReset(id)"
            />
            {{ t(COL_LABEL[id]) }}
          </span>
          <GnIconButton class="gv__colmenu" icon="more" :label="t('gv.col.menu')" data-testid="gv-colmenu" @click="openColMenu" />
        </div>

        <div
          ref="listEl"
          class="gv__list"
          role="listbox"
          tabindex="0"
          :aria-label="t('gv.list')"
          :aria-activedescendant="selected && windowItems.includes(selected) ? `gv-opt-${selected.hash}` : undefined"
          data-testid="gv-list"
          @scroll.passive="onScroll"
          @keydown="onListKey"
        >
          <div class="gv__spacer" :style="{ height: shown.length * rowH + 'px' }">
            <div class="gv__win" :style="{ transform: `translateY(${offsetY}px)` }">
              <div
                v-for="(c, k) in windowItems"
                :id="`gv-opt-${c.hash}`"
                :key="c.hash"
                class="row"
                :class="{ 'row--on': c.hash === selectedHash, 'row--head': isHeadRow(c), 'row--local': commitState(c).published === false }"
                :style="{ height: rowH + 'px', gridTemplateColumns: grid }"
                role="option"
                :aria-selected="c.hash === selectedHash"
                :aria-label="rowAria(c)"
                data-testid="gv-row"
                :data-hash="c.hash"
                @click="selectedHash = c.hash"
                @contextmenu.prevent="openRowMenu($event, c)"
              >
                <span class="row__g">
                  <svg v-if="!hits && rows[range.start + k]" class="row__graph" :width="graphW" :height="rowH" aria-hidden="true">
                    <g fill="none" :stroke-width="c.hash === selectedHash ? 3 : 2">
                      <path v-for="lane in rows[range.start + k]!.through" :key="'t' + lane" :d="`M${lx(lane)} 0L${lx(lane)} ${rowH}`" :stroke="laneColor(lane)" />
                      <path v-for="(s, j) in rows[range.start + k]!.incoming" :key="'i' + j" :d="curve(lx(s.from), 0, lx(s.to), rowH / 2)" :stroke="laneColor(s.from)" />
                      <path v-for="(s, j) in rows[range.start + k]!.outgoing" :key="'o' + j" :d="curve(lx(s.from), rowH / 2, lx(s.to), rowH)" :stroke="laneColor(s.to)" />
                    </g>
                    <!-- o merge é um anel (dois pais), o commit comum é um disco cheio; o selecionado cresce -->
                    <circle
                      v-if="commitState(c).merge"
                      :cx="lx(rows[range.start + k]!.lane)" :cy="rowH / 2" :r="c.hash === selectedHash ? 6.5 : 5"
                      fill="var(--gn-surface)" :stroke="laneColor(rows[range.start + k]!.lane)" stroke-width="2.2"
                    />
                    <circle
                      v-else
                      :cx="lx(rows[range.start + k]!.lane)" :cy="rowH / 2" :r="c.hash === selectedHash ? 6 : 4.5"
                      :fill="laneColor(rows[range.start + k]!.lane)" stroke="var(--gn-surface)" stroke-width="1.5"
                    />
                  </svg>
                </span>
                <span class="row__text">
                  <GnBadge v-if="hitOf(c) && showKind(hitOf(c)!)" :tone="KIND_TONE[hitOf(c)!.kind]" class="row__kind" data-testid="gv-kind" :data-kind="hitOf(c)!.kind">
                    {{ kindText(hitOf(c)!) }}<GnTooltip :text="t(KIND_TIP[hitOf(c)!.kind])" />
                  </GnBadge>
                  <span v-for="chip in chipsOf(c).shown" :key="chip.kind + chip.label" class="chip" :class="`chip--${chip.kind}`" :data-chip="chip.kind">
                    <GnIcon v-if="chip.kind === 'tag'" name="tag" class="chip__ic" />
                    <span v-else-if="chip.kind === 'local'" class="chip__ic" aria-hidden="true">⎇</span>
                    <span v-else-if="chip.kind === 'head'" class="chip__head">HEAD</span>
                    {{ chip.label }}<GnTooltip :text="chip.full" />
                  </span>
                  <span v-if="chipsOf(c).hidden.length" class="chip chip--more" data-testid="gv-chip-more">+{{ chipsOf(c).hidden.length }}<GnTooltip :text="hiddenText(chipsOf(c).hidden)" /></span>
                  <SyncIndicator v-if="isHeadRow(c) && summary && !hits" :sync="summary" hide-no-upstream />
                  <span v-if="commitState(c).merge" class="row__merge">merge<GnTooltip :text="stateText(c)" /></span>
                  <span class="row__subject">{{ c.subject }}</span>
                </span>
                <span v-if="visible.includes('author')" class="row__author muted">
                  <span class="avatar" :style="avatarStyle(c)" aria-hidden="true">{{ avatarOf(c.author, c.authorEmail).initials }}</span>
                  <span class="row__name">{{ c.author }}</span>
                </span>
                <span v-if="visible.includes('date')" class="row__meta muted" data-testid="gv-date">{{ whenText(c.date) }}<GnTooltip :text="fullDate(c.date)" /></span>
                <span v-if="visible.includes('hash')" class="row__hash muted" data-testid="gv-hash" @click.stop="copyHashOf(c)">
                  <GnIcon v-if="commitState(c).published === false" name="up" class="row__st row__st--local" />
                  <GnIcon v-else-if="commitState(c).published === true" name="check" class="row__st" />
                  {{ c.shortHash }}<GnTooltip :text="[stateText(c), t('gv.hashCopy')].filter(Boolean).join(' · ')" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside v-if="selected" class="gv__detail" data-testid="gv-detail" tabindex="-1">
        <h3>{{ selected.subject }}</h3>
        <dl>
          <dt>{{ t('gv.hash') }}</dt><dd class="mono">{{ selected.hash }}</dd>
          <dt>{{ t('gv.author') }}</dt><dd>{{ selected.author }}</dd>
          <dt>{{ t('gv.date') }}</dt><dd>{{ fullDate(selected.date) }}</dd>
          <dt>{{ t('gv.parents') }}</dt><dd class="mono">{{ selected.parents.map((p) => p.slice(0, 7)).join(', ') || '—' }}</dd>
        </dl>
        <div v-if="selectedHit && showKind(selectedHit)" class="gv__hit" data-testid="gv-hit">
          <GnBadge :tone="KIND_TONE[selectedHit.kind]">{{ kindText(selectedHit) }}<GnTooltip :text="t(KIND_TIP[selectedHit.kind])" /></GnBadge>
        </div>
        <GnButton size="sm" class="gv__rb" data-testid="gv-copy-hash" @click="copyHash">{{ t('hs.copyHash') }}</GnButton>
        <div v-if="ci" class="gv__ci">
          <GnBadge :tone="CI_TONE[ci.state]">{{ t(CI_TEXT[ci.state]) }}<GnTooltip :text="ci.checks.map((c) => `${c.name}: ${c.state}`).join('\n')" /></GnBadge>
          <GnButton v-if="failUrl" size="sm" tone="danger" @click="api.hostingOpen(repo.path, failUrl!)">{{ t('gv.seeFailure') }}</GnButton>
        </div>
        <GnButton size="sm" tone="warn" class="gv__rb" @click="ws.openTools(repo, 'rebase', selected.hash)">
          {{ t('gv.rebaseHere') }}
          <GnTooltip :text="t('gv.rebaseTip')" />
        </GnButton>
        <GnButton size="sm" class="gv__rb" data-testid="tag-here" @click="ws.openTools(repo, 'tags', selected.hash)">{{ t('gv.tagHere') }}<GnTooltip :text="t('gv.tagHereTip')" /></GnButton>
        <div class="gv__ops">
          <GnButton size="sm" tone="accent" :disabled="opBusy" data-testid="cherry-pick" @click="ask = { kind: 'cherry-pick', hash: selected.hash, subject: selected.subject }">
            {{ t('gv.cherryPick') }}
            <GnTooltip :text="t('gv.cherryPickTip')" />
          </GnButton>
          <GnButton size="sm" tone="warn" :disabled="opBusy" data-testid="revert" @click="ask = { kind: 'revert', hash: selected.hash, subject: selected.subject }">
            {{ t('gv.revert') }}
            <GnTooltip :text="t('gv.revertTip')" />
          </GnButton>
        </div>
        <p v-if="opNotice" class="gv__opnote" :class="opNotice.ok ? 'gv__opnote--ok' : 'gv__opnote--err'" role="status" data-testid="gv-op-notice">{{ opNotice.text }}</p>
        <pre v-if="detail && detail.message.includes('\n')" class="gv__msg">{{ detail.message }}</pre>
        <template v-if="patchRows.length">
          <h4>{{ t('hs.showPatch') }}</h4>
          <pre class="gv__diff" data-testid="gv-patch"><template v-for="(l, i) in patchRows" :key="i"><span :class="l.kind === 'add' ? 'a' : l.kind === 'del' ? 'd' : l.kind === 'hunk' ? 'h' : ''">{{ l.segments.map((s) => s.text).join('') }}{{ '\n' }}</span></template></pre>
        </template>
        <h4 v-if="detail">{{ t('gv.filesChanged', { n: detail.files.length }) }}</h4>
        <ul v-if="detail" class="gv__files">
          <li v-for="f in detail.files" :key="f.path" :class="{ on: diffFile === f.path, touched: !!touched(f.path) }" data-testid="gv-file" @click="showFile(f.path)">
            <GnBadge :tone="f.status === 'D' ? 'danger' : f.status === 'A' ? 'success' : 'accent'">{{ STATUS[f.status] ? t(STATUS[f.status]!) : f.status }}</GnBadge>
            <span class="gv__fpath">{{ f.path }}<GnTooltip :text="f.path" /></span>
            <span v-if="touched(f.path)" class="gv__cnt" data-testid="gv-file-count">{{ touched(f.path)!.binary ? t('hs.binary') : countText(touched(f.path)!) }}</span>
            <GnIconButton icon="external" :label="t('hs.fileAt')" data-testid="gv-file-at" @click.stop="openFileAt(f.path)" />
            <GnIconButton icon="history" :label="t('gv.fileHistory')" @click.stop="ws.openTools(repo, 'file', f.path, 'history')" />
            <GnIconButton icon="person" :label="t('gv.blame')" @click.stop="ws.openTools(repo, 'file', f.path, 'blame')" />
          </li>
        </ul>
        <pre v-if="diffFile" class="gv__diff" data-testid="gv-diff"><template v-for="(l, i) in diffRows" :key="i"><span :class="l.kind === 'add' ? 'a' : l.kind === 'del' ? 'd' : l.kind === 'hunk' ? 'h' : ''"><template v-for="(s, j) in l.segments" :key="j"><mark v-if="s.hit" class="gv__m">{{ s.text }}</mark><template v-else>{{ s.text }}</template></template>{{ '\n' }}</span></template></pre>
      </aside>
    </div>
    <ContextMenu v-if="menu" focus-first :x="menu.x" :y="menu.y" :items="menuItems" @select="onMenu" @close="menu = null" />
    <ContextMenu v-if="colMenu" focus-first :x="colMenu.x" :y="colMenu.y" :items="colMenuItems" @select="onColMenu" @close="colMenu = null" />
    <GnDialog v-if="branchAsk" width="min(420px, 92vw)" labelledby="gv-branch-title" initial-focus='[data-testid="gv-branch-name"]' @close="branchAsk = null">
      <form class="gv__bd" data-testid="gv-branch-dialog" @submit.prevent="createBranchHere">
        <h3 id="gv-branch-title">{{ t('gv.branchTitle') }}</h3>
        <p class="muted">{{ branchAsk.commit.shortHash }} — {{ branchAsk.commit.subject }}</p>
        <input v-model="branchAsk.name" type="text" :placeholder="t('gv.branchName')" :aria-label="t('gv.branchName')" data-testid="gv-branch-name" />
        <p v-if="branchAsk.error" class="err" role="alert">{{ branchAsk.error }}</p>
        <div class="gv__bd-btns">
          <GnButton type="button" @click="branchAsk = null">{{ t('home.close') }}</GnButton>
          <GnButton type="submit" variant="primary" :disabled="!branchAsk.name.trim() || branchAsk.busy" data-testid="gv-branch-create">{{ t('gv.branchCreate') }}</GnButton>
        </div>
      </form>
    </GnDialog>
    <ConfirmDialog
      v-if="ask"
      :title="t(ask.kind === 'cherry-pick' ? 'gv.cherryPickTitle' : 'gv.revertTitle')"
      :lines="[`${ask.hash.slice(0, 7)} — ${ask.subject}`, t(ask.kind === 'cherry-pick' ? 'gv.cherryPickBody' : 'gv.revertBody')]"
      :confirm-label="t(ask.kind === 'cherry-pick' ? 'gv.cherryPick' : 'gv.revert')"
      @confirm="runCommitOp"
      @cancel="ask = null"
    />
    <GnDialog v-if="fileAt" width="min(1100px, 94vw)" max-height="88vh" :label="t('hs.fileAtTitle', { file: fileAt.file, hash: fileAt.hash.slice(0, 7) })" @close="fileAt = null">
      <div class="gv__fa" data-testid="gv-file-at-dialog">
        <header class="gv__fa-head">
          <strong class="mono">{{ t('hs.fileAtTitle', { file: fileAt.file, hash: fileAt.hash.slice(0, 7) }) }}</strong>
          <span class="spacer" />
          <GnButton size="sm" data-testid="gv-file-at-close" @click="fileAt = null">{{ t('hs.close') }}</GnButton>
        </header>
        <p v-if="fileAt.error" class="err" role="alert">{{ fileAt.error }}</p>
        <p v-else-if="fileAtMessage" class="muted empty" role="status">{{ fileAtMessage }}</p>
        <div v-else-if="fileAt.data" class="gv__fa-body">
          <CodeEditor :model-value="fileAt.data.text" read-only :filename="fileAt.file" :marks="fileAtMarks" />
        </div>
      </div>
    </GnDialog>
  </div>
</template>

<style scoped lang="scss">
.gv {
  display: flex; flex-direction: column; height: 100%;
  &__head { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--gn-border); }
  &__note { font-size: 11px; color: var(--gn-success); }
  &__body { flex: 1; min-height: 0; display: flex; }
  &__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  // o cabeçalho tem a mesma grade da linha: as colunas alinham sem somar larguras na mão
  &__cols { position: relative; display: grid; align-items: center; column-gap: 8px; padding: 0 12px 0 0; height: 26px; flex: none; font-size: 11px; color: var(--gn-muted); background: var(--gn-surface); border-bottom: 1px solid var(--gn-border); }
  &__colh { position: relative; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; &:nth-child(2) { padding-left: 4px; } }
  &__colmenu { position: absolute; right: 2px; top: 0; }
  // a divisória redimensiona: fica no limite esquerdo da coluna (arrastar para a esquerda alarga) e acende no foco e ao passar o mouse
  &__grip { position: absolute; left: -7px; top: 0; bottom: 0; width: 10px; cursor: col-resize; touch-action: none; &::after { content: ''; position: absolute; left: 4px; top: 5px; bottom: 5px; width: 2px; border-radius: 1px; background: var(--gn-border); } &:hover::after, &:focus-visible::after { background: var(--gn-accent); } &:focus-visible { outline: none; } }
  &__list { flex: 1; overflow: auto; min-width: 0; outline: none; &:focus-visible { box-shadow: inset 0 0 0 2px var(--gn-accent); } }
  &__spacer { position: relative; }
  &__win { position: absolute; left: 0; right: 0; top: 0; will-change: transform; }
  &__rb { margin-top: 10px; }
  &__hit { margin-top: 10px; }
  &__ci { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  &__msg { white-space: pre-wrap; font-family: var(--gn-mono); font-size: 12px; background: var(--gn-bg); padding: 8px 10px; border-radius: var(--gn-radius); margin: 10px 0 0; }
  &__files { list-style: none; margin: 6px 0 0; padding: 0; li { display: flex; align-items: center; gap: 6px; padding: 3px 4px; cursor: pointer; font-size: 12px; border-radius: 4px; &:hover, &.on { background: var(--gn-surface-2); } &.touched .gv__fpath { font-weight: 600; } } }
  &__fpath { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--gn-mono); }
  &__cnt { font-family: var(--gn-mono); font-size: 11px; color: var(--gn-muted); white-space: nowrap; }
  &__diff { margin: 8px 0 0; padding: 8px 10px; background: var(--gn-bg); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); font-family: var(--gn-mono); font-size: 11.5px; overflow: auto; max-height: 340px; .a { color: var(--gn-success); } .d { color: var(--gn-danger); } .h { color: var(--gn-accent); } }
  /* o que a busca procurou: fundo E sublinhado (nunca só cor) */
  &__m { background: color-mix(in srgb, var(--gn-warn) 38%, transparent); color: inherit; text-decoration: underline; text-underline-offset: 2px; border-radius: 2px; }
  &__ops { display: flex; gap: 8px; margin-top: 8px; }
  &__opnote { margin: 8px 0 0; padding: 6px 10px; font-size: 12px; border-radius: var(--gn-radius); border: 1px solid var(--gn-border); &--ok { color: var(--gn-success); border-color: var(--gn-success); } &--err { color: var(--gn-warn); border-color: var(--gn-warn); } }
  &__detail { width: 420px; border-left: 1px solid var(--gn-border); padding: 14px; overflow: auto; outline: none; h3 { margin: 0 0 10px; font-size: 14px; } &:focus-visible { box-shadow: inset 0 0 0 2px var(--gn-accent); } }
  &__fa { display: flex; flex-direction: column; height: 76vh; min-height: 0; }
  &__fa-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--gn-border); }
  &__fa-body { flex: 1; min-height: 0; }
  &__bd { display: grid; gap: 10px; padding: 16px 18px; h3 { margin: 0; font-size: 15px; } p { margin: 0; } &-btns { display: flex; justify-content: flex-end; gap: 8px; } }
}
.spacer { flex: 1; }
.muted { color: var(--gn-muted); }
.err { color: var(--gn-danger); padding: 8px 14px; margin: 0; }
.empty { padding: 30px; text-align: center; }
// uma linha = uma grade com as mesmas colunas do cabeçalho
.row {
  display: grid; align-items: center; column-gap: 8px; padding-right: 12px; cursor: pointer; box-sizing: border-box;
  &:hover { background: var(--gn-surface-2); }
  &--on { background: color-mix(in srgb, var(--gn-accent) 20%, transparent); box-shadow: inset 3px 0 0 var(--gn-accent); }
  &--head .row__subject { font-weight: 600; }
  &__g { display: block; overflow: hidden; height: 100%; }
  &__graph { display: block; }
  &__text { min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; }
  &__kind { flex-shrink: 0; font-family: var(--gn-mono); }
  &__subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  &__merge { flex-shrink: 0; font-size: 10px; padding: 0 5px; border: 1px solid var(--gn-muted); border-radius: 999px; color: var(--gn-muted); }
  &__author { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; }
  &__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__meta { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  &__hash { display: flex; align-items: center; gap: 4px; font-family: var(--gn-mono); font-size: 11.5px; white-space: nowrap; cursor: copy; &:hover { color: var(--gn-text); } }
  &__st { width: 12px; height: 12px; flex-shrink: 0; &--local { color: var(--gn-warn); } }
}
.avatar { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; font-size: 9px; font-weight: 700; color: #fff; }
// chips: o tipo se lê pela FORMA e por um sinal em texto, nunca só pela cor (cheio = local, tracejado = remoto, etiqueta = tag, HEAD em destaque forte)
.chip {
  display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; max-width: 180px; padding: 0 6px; font-size: 11px; line-height: 17px; border-radius: 999px; border: 1px solid var(--gn-border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  &__ic { width: 11px; height: 11px; font-size: 10px; }
  &__head { font-size: 9px; font-weight: 800; letter-spacing: 0.04em; padding-right: 3px; border-right: 1px solid rgba(255, 255, 255, 0.5); margin-right: 1px; }
  &--head { background: var(--gn-accent-solid); border-color: var(--gn-accent-solid); color: #fff; font-weight: 600; }
  &--local { background: color-mix(in srgb, var(--gn-accent) 18%, transparent); border-color: var(--gn-accent); color: var(--gn-text); }
  &--remote { background: transparent; border-style: dashed; border-color: var(--gn-muted); color: var(--gn-muted); }
  &--tag { background: color-mix(in srgb, var(--gn-warn) 16%, transparent); border-color: var(--gn-warn); color: var(--gn-text); }
  &--more { background: var(--gn-surface-2); color: var(--gn-muted); }
}
dl { display: grid; grid-template-columns: 60px 1fr; gap: 6px 10px; margin: 0; }
dt { color: var(--gn-muted); }
dd { margin: 0; word-break: break-all; }
.mono { font-family: var(--gn-mono); font-size: 12px; }
</style>
