<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton, GnButtonGroup, GnIconButton, GnSegmented } from '@git-nexus/ui-kit';
import type { BaseComparison, FileEntry, FileSides, InProgressKind, RebaseState, RepoSummary, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { AUTO_FETCH_TICK_MS, autoFetch } from '../auto-fetch';
import { newCommitsFromFetch } from '../notifications-core';
import { notificationsEnabled, notifyUser } from '../notifications';
import { checkState, groupEntries, hasStaged, isUntracked, statusLabel, statusLetter } from '../changes';
import { t, type MessageKey } from '../i18n';
import { useCommandsStore, type Command } from '../stores/commands';
import { useFileEncodingStore } from '../stores/file-encoding';
import { useWorkspaceStore } from '../stores/workspace';
import BranchPicker from '../components/BranchPicker.vue';
import SyncButton from '../components/SyncButton.vue';
import ChangesTree from '../components/ChangesTree.vue';
import CommitForm from '../components/CommitForm.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import OperationBanner from '../components/OperationBanner.vue';
import ContextMenu, { type MenuItem } from '../components/ContextMenu.vue';
import DiffView from '../components/DiffView.vue';
import GitLogPanel from '../components/GitLogPanel.vue';
import ToolStripe, { type StripeItem } from '../components/ToolStripe.vue';
import SideBySideDiff from '../components/SideBySideDiff.vue';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();
const fileEnc = useFileEncodingStore();
const cmds = useCommandsStore();

const branch = ref('');
/** Adiante/atrás da branch atual em relação ao remoto (indicador do cabeçalho). Fica null até o primeiro resumo chegar. */
const sync = ref<RepoSummary | null>(null);
/** A branch atual em relação à base do remoto (origin/main); null quando não se aplica. */
const base = ref<BaseComparison | null>(null);
const syncBtn = ref<InstanceType<typeof SyncButton> | null>(null);
const rebase = ref<RebaseState | null>(null);
/** Merge, cherry-pick ou revert parado no meio (o rebase tem a faixa própria): a faixa compartilhada `OperationBanner` cuida de continuar e abortar. */
const inProgress = ref<InProgressKind | null>(null);
const entries = ref<FileEntry[]>([]);
const conflicted = ref<string[]>([]);
const error = ref('');
const loading = ref(false);
const rootEl = ref<HTMLElement>();

// --- preferências de layout (persistem no localStorage do diretório portátil) -------------
const MODE_KEY = 'gitnexus.diffMode';
const COMMIT_KEY = 'gitnexus.showCommitPanel';
const COLLAPSE_KEY = 'gitnexus.collapseUnchanged';
const SOURCE_KEY = 'gitnexus.diffSource';
const LOG_KEY = 'gitnexus.showGitLog';
const FILES_KEY = 'gitnexus.showFilesPanel';
/** O que comparar: tudo o que mudou (HEAD x disco), só o que falta incluir (índice x disco) ou o que vai no commit (HEAD x índice). */
type Source = 'head' | 'index' | 'staged';
const SOURCES: Array<{ id: Source; label: MessageKey; hint: MessageKey }> = [
  { id: 'head', label: 'rv.src.all', hint: 'rv.src.allHint' },
  { id: 'index', label: 'rv.src.pending', hint: 'rv.src.pendingHint' },
  { id: 'staged', label: 'rv.src.staged', hint: 'rv.src.stagedHint' },
];
const stored = localStorage.getItem(SOURCE_KEY);
const source = ref<Source>(stored === 'index' || stored === 'staged' ? stored : 'head');
const sourceOptions = computed(() => SOURCES.map((o) => ({ value: o.id, label: t(o.label), title: t(o.hint) })));
const viewMode = ref<'split' | 'unified'>(localStorage.getItem(MODE_KEY) === 'unified' ? 'unified' : 'split');
const viewOptions = computed(() => [
  { value: 'split' as const, label: t('rv.split') },
  { value: 'unified' as const, label: t('rv.unified') },
]);
const showCommit = ref(localStorage.getItem(COMMIT_KEY) !== '0');
const collapse = ref(localStorage.getItem(COLLAPSE_KEY) !== '0');
watch(viewMode, (m) => {
  localStorage.setItem(MODE_KEY, m);
  void loadDiff();
});
watch(source, (v) => {
  localStorage.setItem(SOURCE_KEY, v);
  void loadDiff();
});
watch(showCommit, (v) => localStorage.setItem(COMMIT_KEY, v ? '1' : '0'));
/** Lista de arquivos (esquerda): as duas faixas laterais mostram o NOME de cada painel e recolhem/abrem ao clicar. */
const showFiles = ref(localStorage.getItem(FILES_KEY) !== '0');
watch(showFiles, (v) => localStorage.setItem(FILES_KEY, v ? '1' : '0'));
const columns = computed(() => [showFiles.value && '300px', 'minmax(0, 1fr)', showCommit.value && '360px'].filter(Boolean).join(' '));
const leftStripe = computed<StripeItem[]>(() => [
  {
    id: 'files',
    label: t('rv.stripe.files'),
    active: showFiles.value,
    badge: entries.value.length + conflicted.value.length,
    title: showFiles.value ? t('rv.hideFilesPanel') : t('rv.showFilesPanel'),
  },
]);
const rightStripe = computed<StripeItem[]>(() => [
  {
    id: 'commit',
    label: t('rv.stripe.commit'),
    active: showCommit.value,
    badge: stagedCount.value,
    title: showCommit.value ? t('rv.hideCommitPanel') : t('rv.showCommitPanel'),
  },
]);
function onStripe(id: string): void {
  if (id === 'files') showFiles.value = !showFiles.value;
  else showCommit.value = !showCommit.value;
}
/** Log do Git (parte de baixo): aberto ou recolhido em uma barra. */
const showLog = ref(localStorage.getItem(LOG_KEY) === '1');
watch(showLog, (v) => localStorage.setItem(LOG_KEY, v ? '1' : '0'));
const labels = computed(() =>
  source.value === 'index'
    ? [t('rv.side.index'), t('rv.side.worktree')]
    : source.value === 'staged'
      ? [t('rv.side.head'), t('rv.side.staged')]
      : [t('rv.side.head'), t('rv.side.worktree')],
);
const stageAction = computed<'stage' | 'unstage' | null>(() => (source.value === 'index' ? 'stage' : source.value === 'staged' ? 'unstage' : null));
/** Argumento do diff textual do git para a origem escolhida. */
const textMode = computed<boolean | 'head'>(() => (source.value === 'head' ? 'head' : source.value === 'staged'));
watch(collapse, (v) => localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'));

// --- lista de arquivos -------------------------------------------------------------------
const byPath = computed(() => new Map(entries.value.map((e) => [e.path, e])));
const ordered = computed(() => {
  const g = groupEntries(entries.value);
  return [...g.changes, ...g.unversioned].map((e) => e.path);
});
const stagedCount = computed(() => entries.value.filter(hasStaged).length);

// --- arquivo ativo e diff ----------------------------------------------------------------
const active = ref<string | null>(null);
const activeEntry = computed(() => (active.value ? byPath.value.get(active.value) : undefined));
const activeIndex = computed(() => (active.value ? ordered.value.indexOf(active.value) : -1));
const sides = ref<FileSides | null>(null);
const diffText = ref('');
const stats = ref({ blocks: 0, added: 0, removed: 0 });
const splitRef = ref<InstanceType<typeof SideBySideDiff>>();
const unifiedRef = ref<InstanceType<typeof DiffView>>();

const showSplit = computed(
  () => viewMode.value === 'split' && sides.value !== null && !sides.value.binary && !sides.value.tooLarge && !sides.value.isDirectory,
);
const diffCount = computed(() =>
  showSplit.value ? stats.value.blocks : diffText.value.split('\n').filter((l) => l.startsWith('@@')).length,
);

async function refresh(keepError = false): Promise<void> {
  loading.value = true;
  if (!keepError) error.value = '';
  try {
    const [st, conflicts, rb, summary, cmp, op] = await Promise.all([
      api.getGitStatus(props.repo.path),
      api.getMergeConflicts(props.repo.path),
      api.getRebaseState(props.repo.path).catch(() => null),
      api.getRepoSummary(props.repo.path).catch(() => null), // o indicador é um extra: se falhar, a tela segue sem ele
      api.compareWithBase(props.repo.path).catch(() => null),
      api.getInProgress(props.repo.path).catch(() => null),
    ]);
    rebase.value = rb;
    inProgress.value = op;
    sync.value = summary;
    base.value = cmp;
    const bad = new Set(conflicts.map((c) => c.filePath));
    conflicted.value = [...bad];
    branch.value = st.branch;
    entries.value = st.entries.filter((e) => !bad.has(e.path));
    if (active.value && !byPath.value.has(active.value)) active.value = null;
    await loadDiff();
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function loadDiff(): Promise<void> {
  const path = active.value;
  if (!path) {
    sides.value = null;
    diffText.value = '';
    fileEnc.setOpen(props.repo.id, null);
    return;
  }
  const enc = fileEnc.choiceFor(props.repo.path, path); // a codificação que a pessoa escolheu no rodapé (ou 'auto')
  try {
    if (viewMode.value === 'split') {
      sides.value = await api.getFileSides(props.repo.path, path, source.value, enc);
      diffText.value = '';
      const s = sides.value;
      // binário/grande/pasta: cai para o diff textual do git
      if (s.binary || s.tooLarge || s.isDirectory) {
        diffText.value = s.isDirectory ? t('rv.untrackedDir') : await api.getFileDiff(props.repo.path, path, textMode.value, enc);
        fileEnc.setOpen(props.repo.id, null);
      } else {
        fileEnc.setOpen(props.repo.id, { repoPath: props.repo.path, path, encoding: s.encoding, detected: s.detectedEncoding, invalid: s.invalid });
      }
    } else {
      sides.value = null;
      diffText.value = await api.getFileDiff(props.repo.path, path, textMode.value, enc);
      fileEnc.setOpen(props.repo.id, { repoPath: props.repo.path, path, ...(await api.getFileEncoding(props.repo.path, path, textMode.value, enc)) });
    }
  } catch (e) {
    sides.value = null;
    diffText.value = errMsg(e);
    fileEnc.setOpen(props.repo.id, null);
  }
}

// Escolheu outra codificação no rodapé: relê o arquivo nela.
watch(
  () => (active.value ? fileEnc.choiceFor(props.repo.path, active.value) : 'auto'),
  () => void loadDiff(),
);
onBeforeUnmount(() => fileEnc.setOpen(props.repo.id, null));

type Landing = 'first' | 'last';

/** Abre o arquivo no diff e posiciona na primeira (ou última) diferença. */
async function open(path: string, landing: Landing = 'first'): Promise<void> {
  active.value = path;
  await loadDiff();
  await nextTick();
  await nextTick();
  const idx = landing === 'last' ? -1 : 0;
  if (showSplit.value) await splitRef.value?.goTo(idx);
  else await unifiedRef.value?.goTo(idx);
}

// --- navegação entre diferenças (cruza para o arquivo vizinho nas bordas) ----------------------
/** Posição da diferença atual dentro do arquivo aberto. */
const curDiff = ref(-1);

/** Há algo para navegar no arquivo aberto? (binário/grande/pasta contam como "um item", sem passos internos.) */
const hasSteps = () => (showSplit.value ? stats.value.blocks > 0 : diffCount.value > 0);

let navigating = false;
async function goDiff(delta: number): Promise<void> {
  if (navigating || !ordered.value.length) return;
  navigating = true;
  try {
    // Sem arquivo aberto: começa do primeiro (→) ou do último (←) arquivo pendente, sem precisar clicar.
    if (!active.value) {
      await open(ordered.value[delta > 0 ? 0 : ordered.value.length - 1]!, delta > 0 ? 'first' : 'last');
      if (hasSteps()) return;
    } else {
      const moved = showSplit.value ? splitRef.value?.go(delta) : unifiedRef.value?.go(delta);
      if (moved) return;
    }
    // Borda do arquivo: segue para o vizinho que tenha diferenças.
    let i = activeIndex.value;
    for (;;) {
      i += delta;
      const next = ordered.value[i];
      if (!next) {
        showNotice(delta > 0 ? t('rv.noMoreAhead') : t('rv.noMoreBehind'));
        return;
      }
      await open(next, delta > 0 ? 'first' : 'last');
      if (hasSteps() || !(showSplit.value || diffText.value.includes('@@'))) return;
    }
  } finally {
    navigating = false;
  }
}
function goFile(delta: number): void {
  const next = ordered.value[activeIndex.value + delta];
  if (next) void open(next);
}
const nav = computed(() => {
  const total = diffCount.value;
  const cur = curDiff.value;
  const hasPrev = activeIndex.value > 0;
  const hasNext = activeIndex.value >= 0 && activeIndex.value < ordered.value.length - 1;
  return {
    prevFile: hasPrev,
    nextFile: hasNext,
    // sem arquivo aberto, qualquer lado começa a navegação; com arquivo, vale a diferença ou o arquivo vizinho
    prevDiff: ordered.value.length > 0 && (!active.value || cur > 0 || hasPrev),
    nextDiff: ordered.value.length > 0 && (!active.value || (total > 0 && cur < total - 1) || hasNext),
  };
});

// --- comandos / atalhos (paleta Ctrl+K) -----------------------------------------------------------
/** Só vale na aba ativa deste repositório (as abas ficam montadas com v-show). */
const isActiveTab = () => ws.activeId === `repo:${props.repo.id}`;

function repoCommands(): Command[] {
  const when = isActiveTab;
  const withFile = () => isActiveTab() && !!active.value;
  const notIn = () => entries.value.filter((e) => checkState(e) !== 'checked').map((e) => e.path);
  const inCommit = () => entries.value.filter(hasStaged).map((e) => e.path);
  const gStaging = t('rv.group.staging');
  const gRepo = t('rv.group.repo');
  const gDiff = t('rv.group.diff');
  const gFile = t('rv.group.file');
  return [
    { id: 'rv.lfs', title: t('rv.cmd.lfs'), group: gStaging, keywords: 'lfs large file storage arquivos grandes ponteiro pointer', when, run: () => ws.openTools(props.repo, 'lfs') },
    { id: 'rv.submodules', title: t('rv.cmd.submodules'), group: gStaging, keywords: 'submódulos submodulos submodule init update', when, run: () => ws.openTools(props.repo, 'submodules') },
    { id: 'rv.search', title: t('rv.cmd.search'), group: gStaging, shortcut: 'Mod+Shift+F', keywords: 'buscar procurar grep conteudo código texto search find', when, run: () => ws.openTools(props.repo, 'search') },
    { id: 'rv.refresh', title: t('rv.cmd.refresh'), group: gStaging, shortcut: 'F5', when, run: () => refresh() },
    {
      id: 'rv.stageAll',
      title: t('rv.cmd.stageAll'),
      group: gStaging,
      shortcut: 'Mod+Shift+A',
      keywords: 'add todos all',
      when: () => isActiveTab() && notIn().length > 0,
      run: () => onToggle(notIn(), true),
    },
    {
      id: 'rv.unstageAll',
      title: t('rv.cmd.unstageAll'),
      group: gStaging,
      shortcut: 'Mod+Shift+U',
      keywords: 'reset todos all',
      when: () => isActiveTab() && inCommit().length > 0,
      run: () => onToggle(inCommit(), false),
    },
    {
      id: 'rv.focusCommit',
      title: t('rv.cmd.focusCommit'),
      group: gStaging,
      shortcut: 'Mod+Shift+C',
      keywords: 'mensagem escrever message write',
      when,
      run: async () => {
        showCommit.value = true;
        await nextTick();
        rootEl.value?.querySelector<HTMLInputElement>('.rv__commit input[data-focus="commit-subject"]')?.focus();
      },
    },
    { id: 'rv.toggleCommit', title: t('rv.cmd.toggleCommit'), group: gStaging, shortcut: 'Mod+Shift+B', when, run: () => (showCommit.value = !showCommit.value) },
    { id: 'rv.toggleFiles', title: t('rv.cmd.toggleFiles'), group: gStaging, shortcut: 'Mod+Shift+E', keywords: 'arquivos files lista list painel panel', when, run: () => (showFiles.value = !showFiles.value) },
    { id: 'rv.toggleLog', title: t('log.cmd.toggle'), group: gRepo, shortcut: 'Mod+Shift+L', keywords: 'log comandos commands console', when, run: () => (showLog.value = !showLog.value) },
    { id: 'rv.fetch', title: t('rv.cmd.fetch'), group: gRepo, keywords: 'remoto', when, run: () => syncBtn.value?.doFetch() },
    { id: 'rv.pull', title: t('rv.cmd.pull'), group: gRepo, keywords: 'remoto', when, run: () => syncBtn.value?.doUpdate('ff') },
    { id: 'rv.push', title: t('rv.cmd.push'), group: gRepo, keywords: 'remoto enviar publicar', when, run: () => syncBtn.value?.doPush() },
    { id: 'rv.nextDiff', title: t('rv.cmd.nextDiff'), group: gDiff, shortcut: 'F7', when, run: () => goDiff(1) },
    { id: 'rv.prevDiff', title: t('rv.cmd.prevDiff'), group: gDiff, shortcut: 'Shift+F7', when, run: () => goDiff(-1) },
    { id: 'rv.nextFile', title: t('rv.cmd.nextFile'), group: gDiff, shortcut: 'Alt+ArrowRight', when, run: () => goFile(1) },
    { id: 'rv.prevFile', title: t('rv.cmd.prevFile'), group: gDiff, shortcut: 'Alt+ArrowLeft', when, run: () => goFile(-1) },
    { id: 'rv.src.head', title: t('rv.cmd.srcHead'), group: gDiff, when, run: () => (source.value = 'head') },
    { id: 'rv.src.index', title: t('rv.cmd.srcIndex'), group: gDiff, keywords: 'stage linha line', when, run: () => (source.value = 'index') },
    { id: 'rv.src.staged', title: t('rv.cmd.srcStaged'), group: gDiff, keywords: 'unstage linha line', when, run: () => (source.value = 'staged') },
    { id: 'rv.view.split', title: t('rv.cmd.split'), group: gDiff, when, run: () => (viewMode.value = 'split') },
    { id: 'rv.view.unified', title: t('rv.cmd.unified'), group: gDiff, when, run: () => (viewMode.value = 'unified') },
    { id: 'rv.collapse', title: t('rv.cmd.collapse'), group: gDiff, when, run: () => (collapse.value = !collapse.value) },
    { id: 'rv.discard', title: t('rv.cmd.discard'), group: gFile, keywords: 'reverter revert', when: withFile, run: () => askDiscard([active.value!]) },
    { id: 'rv.copyPath', title: t('rv.cmd.copyPath'), group: gFile, when: withFile, run: () => api.copyText(active.value!) },
    { id: 'rv.fileHistory', title: t('rv.cmd.fileHistory'), group: gFile, when: withFile, run: () => ws.openTools(props.repo, 'file', active.value!, 'history') },
    { id: 'rv.blame', title: t('rv.cmd.blame'), group: gFile, keywords: 'autoria author', when: withFile, run: () => ws.openTools(props.repo, 'file', active.value!, 'blame') },
  ];
}

// --- incluir / remover do commit (stage) ---------------------------------------------------
async function act(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    error.value = errMsg(e);
  }
  await refresh(true);
}

/** Inclui os caminhos no commit (git add) ou os remove (git restore --staged). Cópias rasas: Proxy do Vue não passa pelo IPC. */
function onToggle(paths: string[], include: boolean): Promise<void> {
  return act(async () => {
    if (include) {
      await api.stageFiles(props.repo.path, [...paths]);
    } else {
      const all = paths.flatMap((p) => {
        const o = byPath.value.get(p)?.origPath;
        return o ? [p, o] : [p];
      });
      await api.unstageFiles(props.repo.path, all);
    }
  });
}

/** Soltar arquivos sobre um grupo: "Alterações" inclui no commit; "Não versionados" tira do stage os arquivos novos. */
function onMove(paths: string[], target: 'changes' | 'unversioned'): Promise<void> | void {
  if (target === 'changes') {
    const todo = paths.filter((p) => {
      const e = byPath.value.get(p);
      return e && checkState(e) !== 'checked';
    });
    return todo.length ? onToggle(todo, true) : undefined;
  }
  const added = paths.filter((p) => byPath.value.get(p)?.x === 'A');
  if (!added.length) {
    showNotice(t('rv.onlyNewBack'));
    return;
  }
  return onToggle(added, false);
}

async function onCommitted(): Promise<void> {
  ws.bump(props.repo.id); // atualiza também o grafo
}

// --- aviso com "Desfazer" -------------------------------------------------------------------
/** A branch mudou (troca, criação, merge, pull...): recarrega tudo e avisa o grafo e as ferramentas. */
async function onBranchChanged(): Promise<void> {
  await refresh();
  ws.bump(props.repo.id);
}
/** Merge, rebase ou pull parou por conflitos: o rebase em andamento tem a própria faixa; o merge vai para a tela de conflitos. */
async function onBranchConflict(): Promise<void> {
  await onBranchChanged();
  if (!rebase.value?.inProgress) ws.open('merge', props.repo);
}

const notice = ref<{ text: string; undo?: () => Promise<void> } | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function showNotice(text: string, undo?: () => Promise<void>): void {
  clearTimeout(noticeTimer);
  notice.value = { text, undo };
  noticeTimer = setTimeout(() => (notice.value = null), 20_000);
}
async function runUndo(): Promise<void> {
  const n = notice.value;
  notice.value = null;
  if (n?.undo) await act(n.undo);
}

// --- descarte por linha / bloco ---------------------------------------------------------------
async function onDiscardLines(p: { content: string; what: 'linha' | 'bloco' }): Promise<void> {
  const path = active.value;
  const before = sides.value?.newText;
  if (!path || before === undefined) return;
  const enc = sides.value?.encoding; // grava na MESMA codificação em que o arquivo foi lido
  await act(() => api.writeWorkingFile(props.repo.path, path, p.content, enc));
  showNotice(t(p.what === 'linha' ? 'rv.discardedLine' : 'rv.discardedBlock', { path }), () => api.writeWorkingFile(props.repo.path, path, before, enc));
}

// --- stage por linha / bloco (grava só o índice; o disco não muda) -------------------------------
async function onStageLines(p: { content: string; what: 'linha' | 'bloco'; direction: 'stage' | 'unstage' }): Promise<void> {
  const path = active.value;
  const s = sides.value;
  if (!path || !s) return;
  // versão do índice ANTES da mudança, para o "Desfazer": no stage é o lado esquerdo; no unstage, o direito
  const before = p.direction === 'stage' ? s.oldText : s.newText;
  const enc = s.encoding;
  await act(() => api.writeIndexContent(props.repo.path, path, p.content, enc));
  showNotice(
    t(p.what === 'linha' ? (p.direction === 'stage' ? 'rv.stagedLine' : 'rv.unstagedLine') : p.direction === 'stage' ? 'rv.stagedBlock' : 'rv.unstagedBlock', { path }),
    () => api.writeIndexContent(props.repo.path, path, before, enc),
  );
}

// --- descarte de arquivos inteiros -----------------------------------------------------------
const confirm = ref<{ title: string; lines: string[]; label: string; run: () => Promise<void> } | null>(null);

// --- merge / cherry-pick / revert parado: a faixa avisa o desfecho; aqui só se recarrega a tela ---------------
async function onOpDone(message: string): Promise<void> {
  showNotice(message);
  ws.bump(props.repo.id);
  await refresh();
}

function askDiscard(paths: string[]): void {
  const files = paths.map((p) => byPath.value.get(p)).filter((e): e is FileEntry => !!e);
  const n = files.length;
  if (!n) return;
  const anyNew = files.some(isUntracked);
  const anyTracked = files.some((e) => !isUntracked(e));
  const anyStaged = files.some(hasStaged);
  confirm.value = {
    title: n === 1 ? t('rv.discard.titleOne') : t('rv.discard.titleMany', { n }),
    lines: [
      n === 1 ? files[0]!.path : t('rv.discard.nFiles', { n }),
      ...(anyTracked ? [anyStaged ? t('rv.discard.backStaged') : t('rv.discard.back')] : []),
      ...(anyNew ? [t('rv.discard.newDeleted')] : []),
      t('rv.discard.backup'),
    ],
    label: t('rv.discard.label'),
    run: async () => {
      const done: { path: string; backup: string }[] = [];
      let failed = '';
      for (const f of files) {
        try {
          const r = await api.discardFile(props.repo.path, f.path, 'all');
          if (r.backup) done.push({ path: f.path, backup: r.backup });
        } catch (e) {
          failed = errMsg(e);
          break;
        }
      }
      if (failed) error.value = failed;
      showNotice(
        n === 1 ? t('rv.discard.doneOne') : t('rv.discard.doneMany', { n }),
        done.length
          ? async () => {
              for (const d of done) await api.restoreBackup(props.repo.path, d.path, d.backup);
            }
          : undefined,
      );
      await refresh(true);
    },
  };
}

async function runConfirm(): Promise<void> {
  const c = confirm.value;
  confirm.value = null;
  await c?.run();
}

// --- menu de contexto (botão do meio ou direito) --------------------------------------------
const menu = ref<{ x: number; y: number; paths: string[] } | null>(null);

const menuItems = computed<MenuItem[]>(() => {
  const m = menu.value;
  if (!m) return [];
  const files = m.paths.map((p) => byPath.value.get(p)).filter((e): e is FileEntry => !!e);
  const n = files.length;
  const allNew = files.every(isUntracked);
  const anyOut = files.some((e) => checkState(e) !== 'checked');
  const anyIn = files.some(hasStaged);
  const single = n === 1 ? files[0]! : null;
  const isDir = !!single?.path.endsWith('/');
  const ext = single && !isDir && single.path.includes('.') ? single.path.slice(single.path.lastIndexOf('.')) : '';
  const many = n > 1;
  const items: MenuItem[] = [
    {
      id: 'discard',
      danger: true,
      label: allNew
        ? many ? t('rv.menu.deleteNew', { n }) : t('rv.menu.discardNew')
        : many ? t('rv.discard.titleMany', { n }).replace(/\?$/, '…') : t('rv.menu.discard'),
    },
    { id: 's1', separator: true },
  ];
  if (anyOut) items.push({ id: 'include', label: many ? t('rv.menu.include') : t('rv.menu.includeOne') });
  if (anyIn) items.push({ id: 'exclude', label: many ? t('rv.menu.exclude') : t('rv.menu.excludeOne') });
  if (allNew) {
    items.push({ id: 's2', separator: true }, { id: 'ignore', label: t('rv.menu.ignore') });
    if (ext) items.push({ id: 'ignoreExt', label: t('rv.menu.ignoreExt', { ext }) });
  }
  items.push(
    { id: 's3', separator: true },
    { id: 'copyPath', label: many ? t('rv.menu.copyPaths') : t('rv.menu.copyPath') },
    { id: 'copyName', label: many ? t('rv.menu.copyNames') : t('rv.menu.copyName') },
  );
  if (single) {
    if (!allNew && !isDir) items.push({ id: 'history', label: t('rv.menu.history') }, { id: 'blame', label: t('rv.menu.blame') }, { id: 's4', separator: true });
    items.push({ id: 'reveal', label: t('rv.menu.reveal') }, { id: 'open', label: t('rv.menu.open'), disabled: isDir });
  }
  return items;
});

async function onMenu(id: string): Promise<void> {
  const m = menu.value;
  menu.value = null;
  if (!m) return;
  const paths = m.paths;
  const names = paths.map((p) => p.replace(/\/$/, '').split('/').pop() ?? p);
  try {
    switch (id) {
      case 'discard':
        return askDiscard(paths);
      case 'include':
        return await onToggle(paths.filter((p) => { const e = byPath.value.get(p); return e && checkState(e) !== 'checked'; }), true);
      case 'exclude':
        return await onToggle(paths.filter((p) => { const e = byPath.value.get(p); return e && hasStaged(e); }), false);
      case 'ignore':
        for (const p of paths) await api.addToGitignore(props.repo.path, '/' + p);
        return await refresh();
      case 'ignoreExt': {
        const p = paths[0]!;
        await api.addToGitignore(props.repo.path, '*' + p.slice(p.lastIndexOf('.')));
        return await refresh();
      }
      case 'copyPath':
        return await api.copyText(paths.join('\n'));
      case 'copyName':
        return await api.copyText(names.join('\n'));
      case 'history':
        return ws.openTools(props.repo, 'file', paths[0]!, 'history');
      case 'blame':
        return ws.openTools(props.repo, 'file', paths[0]!, 'blame');
      case 'reveal':
        return await api.showItemInFolder(props.repo.path, paths[0]!);
      case 'open': {
        const err = await api.openPath(props.repo.path, paths[0]!);
        if (err) error.value = err;
      }
    }
  } catch (e) {
    error.value = errMsg(e);
  }
}

/** Busca automática no remoto (se ligada e se já passou o intervalo). Só relê o resumo do indicador, não a tela toda, e só se trouxe resultado. */
async function maybeAutoFetch(): Promise<void> {
  const path = props.repo.path;
  const before = sync.value;
  if (!(await autoFetch(path, sync.value?.lastFetch))) return;
  const [fresh, cmp] = await Promise.all([api.getRepoSummary(path).catch(() => null), api.compareWithBase(path).catch(() => null)]);
  if (path !== props.repo.path) return;
  if (fresh) sync.value = fresh;
  base.value = cmp;
  // com o app em segundo plano, avisa que chegaram commits novos para a branch atual
  const n = newCommitsFromFetch(before, fresh);
  if (n > 0) void notifyUser({ title: t('notif.newCommitsTitle', { repo: props.repo.name }), body: t('notif.newCommits', { n, branch: fresh?.branch ?? '' }) });
}

const onFocus = () => void refresh().then(maybeAutoFetch);
let offCommands: (() => void) | undefined;
let autoFetchTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  void refresh().then(maybeAutoFetch);
  window.addEventListener('focus', onFocus);
  autoFetchTimer = setInterval(() => {
    // com as notificações ligadas a busca continua com a janela em segundo plano: é quando o aviso serve
    if (document.visibilityState === 'visible' || notificationsEnabled.value) void maybeAutoFetch();
  }, AUTO_FETCH_TICK_MS);
  offCommands = cmds.register(repoCommands);
});
onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus);
  clearInterval(autoFetchTimer);
  offCommands?.();
  clearTimeout(noticeTimer);
});
watch(() => ws.versions[props.repo.id], () => void refresh());
</script>

<template>
  <div ref="rootEl" class="rv">
    <header class="rv__head">
      <div class="rv__id">
        <strong>{{ repo.name }}</strong>
        <BranchPicker :repo="repo" :branch="branch" :sync="sync" :base="base" @changed="onBranchChanged" @notice="showNotice($event)" @conflict="onBranchConflict" />
        <SyncButton ref="syncBtn" :repo="repo" :sync="sync" :base="base" @changed="onBranchChanged" @notice="showNotice($event)" @conflict="onBranchConflict" />
        <GnBadge v-if="repo.isWsl">WSL2</GnBadge>
        <span class="muted rv__path">{{ repo.path }}</span>
      </div>
      <div class="rv__btns">
        <GnButton size="sm" :disabled="loading" @click="refresh()">{{ t('rv.refresh') }}</GnButton>
        <GnButton size="sm" tone="accent" @click="ws.open('graph', repo)">{{ t('rv.graph') }}</GnButton>
        <GnButton size="sm" tone="accent" @click="ws.open('tools', repo)">{{ t('rv.tools') }}</GnButton>
        <GnButton size="sm" :tone="conflicted.length ? 'warn' : 'neutral'" :variant="conflicted.length ? 'primary' : 'ghost'" @click="ws.open('merge', repo)">
          {{ t('rv.conflicts') }}{{ conflicted.length ? ` (${conflicted.length})` : '' }}
        </GnButton>
      </div>
    </header>

    <div v-if="rebase?.inProgress" class="rv__rebase">
      <span>⇅ {{ t('rv.rebaseRunning', { step: rebase.step, total: rebase.total }) }}{{ rebase.conflicted.length ? t('rv.rebaseConflicts', { n: rebase.conflicted.length }) : '' }}.</span>
      <GnButton size="sm" variant="primary" tone="warn" @click="ws.openTools(repo, 'rebase')">{{ t('rv.openRebase') }}</GnButton>
    </div>
    <OperationBanner v-if="inProgress" :repo-path="repo.path" :kind="inProgress" :conflicts="conflicted.length" @done="onOpDone" @failed="error = $event" />
    <p v-if="error" class="rv__error">{{ error }}</p>
    <div v-if="notice" class="rv__notice">
      <span>{{ notice.text }}</span>
      <GnButton v-if="notice.undo" size="sm" tone="warn" @click="runUndo">{{ t('rv.undo') }}</GnButton>
      <GnIconButton icon="x" :label="t('home.close')" @click="notice = null" />
    </div>

    <div class="rv__main">
      <ToolStripe side="left" :items="leftStripe" @toggle="onStripe" />
      <div class="rv__body" :style="{ gridTemplateColumns: columns }">
        <aside v-show="showFiles" class="rv__files">
          <ChangesTree
            :entries="entries"
            :conflicted="conflicted"
            :active-path="active"
            @open="open"
            @toggle="onToggle"
            @move="onMove"
            @menu="menu = $event"
            @resolve="ws.open('merge', repo)"
          />
        </aside>

        <main class="rv__diff">
          <div class="rv__toolbar">
            <!-- cada contador junto do par que ele descreve: arquivo (← →) e, depois, diferença (↑ ↓) -->
            <GnButtonGroup :label="t('rv.navFiles')">
              <GnIconButton icon="left" :disabled="!nav.prevFile" :title="t('rv.prevFileTip')" :label="t('rv.cmd.prevFile')" @click="goFile(-1)" />
              <GnIconButton icon="right" :disabled="!nav.nextFile" :title="t('rv.nextFileTip')" :label="t('rv.cmd.nextFile')" @click="goFile(1)" />
            </GnButtonGroup>
            <span v-if="active" class="muted">{{ t('rv.fileOf', { i: activeIndex + 1, n: ordered.length }) }}</span>
            <span class="sepv" />
            <GnButtonGroup :label="t('rv.navDiffs')">
              <GnIconButton icon="up" :disabled="!nav.prevDiff" :title="t('rv.prevDiffTip')" :label="t('rv.cmd.prevDiff')" @click="goDiff(-1)" />
              <GnIconButton icon="down" :disabled="!nav.nextDiff" :title="t('rv.nextDiffTip')" :label="t('rv.cmd.nextDiff')" @click="goDiff(1)" />
            </GnButtonGroup>
            <template v-if="active">
              <span class="muted">{{ curDiff >= 0 ? t('rv.diffOf', { i: curDiff + 1, n: diffCount }) : t('rv.diffCount', { n: diffCount }) }}</span>
              <template v-if="showSplit">
                <span class="stat stat--add">+{{ stats.added }}</span>
                <span class="stat stat--del">−{{ stats.removed }}</span>
              </template>
            </template>
            <span class="spacer" />
            <label v-if="showSplit" class="muted opt"><input v-model="collapse" type="checkbox" /> {{ t('rv.collapseUnchanged') }}</label>
            <GnSegmented v-model="source" :options="sourceOptions" :aria-label="t('rv.whatToCompare')" :title="t('rv.whatToCompare')" />
            <GnSegmented v-model="viewMode" :options="viewOptions" :aria-label="t('rv.viewMode')" />
          </div>

          <div v-if="!active || !activeEntry" class="muted placeholder">{{ t('rv.selectFile') }}</div>
          <template v-else>
            <div class="rv__difftitle">
              <span class="rv__file">{{ activeEntry.path }}</span>
              <GnBadge :tone="isUntracked(activeEntry) ? 'warn' : 'accent'">{{ statusLabel(statusLetter(activeEntry)) }}</GnBadge>
              <GnBadge :tone="checkState(activeEntry) === 'checked' ? 'success' : 'neutral'">
                {{ checkState(activeEntry) === 'checked' ? t('tree.stateChecked') : checkState(activeEntry) === 'partial' ? t('tree.statePartial') : t('tree.statePending') }}
              </GnBadge>
            </div>
            <div class="rv__diffbody">
              <SideBySideDiff
                v-if="showSplit && sides"
                ref="splitRef"
                :old-text="sides.oldText"
                :new-text="sides.newText"
                :can-discard="source !== 'staged' && !sides.invalid"
                :stage-action="sides.invalid ? null : stageAction"
                :collapse="collapse"
                :old-label="labels[0]!"
                :new-label="labels[1]!"
                @discard="onDiscardLines"
                @stage-lines="onStageLines"
                @stats="stats = $event"
                @current="curDiff = $event"
              />
              <DiffView v-else ref="unifiedRef" :diff="diffText || t('rv.noDiff')" @current="curDiff = $event" />
            </div>
          </template>
        </main>

        <aside v-show="showCommit" class="rv__commit">
          <CommitForm :repo-path="repo.path" :branch="branch" :staged-count="stagedCount" @committed="onCommitted" />
        </aside>
      </div>
      <ToolStripe side="right" :items="rightStripe" @toggle="onStripe" />
    </div>

    <GitLogPanel v-model:open="showLog" :repo-path="repo.path" />

    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" @select="onMenu" @close="menu = null" />
    <ConfirmDialog
      v-if="confirm"
      :title="confirm.title"
      :lines="confirm.lines"
      :confirm-label="confirm.label"
      danger
      @confirm="runConfirm"
      @cancel="confirm = null"
    />
  </div>
</template>

<style scoped lang="scss">
.rv {
  display: flex;
  flex-direction: column;
  height: 100%;
  &__head {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    padding: 8px 14px; border-bottom: 1px solid var(--gn-border);
  }
  &__id { display: flex; align-items: center; gap: 8px; min-width: 0; }
  &__path { font-family: var(--gn-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__btns { display: flex; gap: 6px; flex-shrink: 0; }
  &__error { margin: 0; padding: 6px 14px; color: var(--gn-danger); background: rgba(239, 106, 98, 0.1); white-space: pre-wrap; }
  &__notice {
    display: flex; align-items: center; gap: 8px; padding: 5px 14px;
    background: rgba(79, 134, 247, 0.14); border-bottom: 1px solid var(--gn-border);
    > span { flex: 1; }
  }
  &__main { flex: 1; min-height: 0; display: flex; }
  &__body { flex: 1; min-width: 0; min-height: 0; display: grid; }
  &__files { border-right: 1px solid var(--gn-border); min-width: 0; min-height: 0; overflow: hidden; }
  &__diff { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  &__toolbar {
    display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; padding: 5px 10px; white-space: nowrap;
    border-bottom: 1px solid var(--gn-border); background: var(--gn-surface);
    :deep(.gn-btn) { min-width: 28px; justify-content: center; font-weight: 700; }
  }
  &__rebase { display: flex; align-items: center; gap: 12px; padding: 7px 14px; background: rgba(224, 169, 59, 0.14); border-bottom: 1px solid var(--gn-warn); color: var(--gn-warn); }
  &__difftitle {
    display: flex; align-items: center; gap: 8px; padding: 5px 12px;
    border-bottom: 1px solid var(--gn-border); background: var(--gn-bg);
  }
  &__file { font-family: var(--gn-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__diffbody { flex: 1; min-height: 0; overflow: auto; }
  &__commit { border-left: 1px solid var(--gn-border); overflow: auto; min-width: 0; }
}
.sepv { width: 1px; height: 18px; background: var(--gn-border); margin: 0 4px; }
.stat { font-family: var(--gn-mono); font-size: 12px; &--add { color: var(--gn-success); } &--del { color: var(--gn-danger); } }
.opt { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; }
.spacer { flex: 1; }
.muted { color: var(--gn-muted); font-size: 12px; }
.placeholder { padding: 40px; text-align: center; }
</style>
