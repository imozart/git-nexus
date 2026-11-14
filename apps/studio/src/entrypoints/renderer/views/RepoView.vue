<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import type { FileEntry, FileSides, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { STATUS_LABEL, checkState, groupEntries, hasStaged, isUntracked, statusLetter } from '../changes';
import { useWorkspaceStore } from '../stores/workspace';
import ChangesTree from '../components/ChangesTree.vue';
import CommitForm from '../components/CommitForm.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import ContextMenu, { type MenuItem } from '../components/ContextMenu.vue';
import DiffView from '../components/DiffView.vue';
import SideBySideDiff from '../components/SideBySideDiff.vue';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const branch = ref('');
const entries = ref<FileEntry[]>([]);
const conflicted = ref<string[]>([]);
const error = ref('');
const loading = ref(false);
const rootEl = ref<HTMLElement>();

// --- preferências de layout (persistem no localStorage do diretório portátil) -------------
const MODE_KEY = 'gitnexus.diffMode';
const COMMIT_KEY = 'gitnexus.showCommitPanel';
const COLLAPSE_KEY = 'gitnexus.collapseUnchanged';
const viewMode = ref<'split' | 'unified'>(localStorage.getItem(MODE_KEY) === 'unified' ? 'unified' : 'split');
const showCommit = ref(localStorage.getItem(COMMIT_KEY) !== '0');
const collapse = ref(localStorage.getItem(COLLAPSE_KEY) !== '0');
watch(viewMode, (m) => {
  localStorage.setItem(MODE_KEY, m);
  void loadDiff();
});
watch(showCommit, (v) => localStorage.setItem(COMMIT_KEY, v ? '1' : '0'));
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
    const [st, conflicts] = await Promise.all([api.getGitStatus(props.repo.path), api.getMergeConflicts(props.repo.path)]);
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
    return;
  }
  try {
    if (viewMode.value === 'split') {
      sides.value = await api.getFileSides(props.repo.path, path, 'head');
      diffText.value = '';
      // binário/grande/pasta: cai para o diff textual do git
      if (sides.value.binary || sides.value.tooLarge || sides.value.isDirectory) {
        diffText.value = sides.value.isDirectory ? '(pasta não rastreada)' : await api.getFileDiff(props.repo.path, path, 'head');
      }
    } else {
      sides.value = null;
      diffText.value = await api.getFileDiff(props.repo.path, path, 'head');
    }
  } catch (e) {
    sides.value = null;
    diffText.value = errMsg(e);
  }
}

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
        showNotice(delta > 0 ? 'Última diferença: não há mais arquivos à frente.' : 'Primeira diferença: não há arquivos anteriores.');
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

function onKeydown(ev: KeyboardEvent): void {
  if (!rootEl.value || rootEl.value.offsetParent === null) return; // aba oculta
  const t = ev.target as HTMLElement;
  if (t.closest('input, textarea, [contenteditable="true"], .cm-editor')) return;
  if (ev.key === 'F7') goDiff(ev.shiftKey ? -1 : 1);
  else if (ev.altKey && ev.key === 'ArrowRight') goFile(1);
  else if (ev.altKey && ev.key === 'ArrowLeft') goFile(-1);
  else return;
  ev.preventDefault();
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
    showNotice('Só arquivos novos (adicionados) podem voltar para “não versionados”.');
    return;
  }
  return onToggle(added, false);
}

async function onCommitted(): Promise<void> {
  ws.bump(props.repo.id); // atualiza também o grafo
}

// --- aviso com "Desfazer" -------------------------------------------------------------------
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
  await act(() => api.writeWorkingFile(props.repo.path, path, p.content));
  showNotice(`Descartada(o) ${p.what} em ${path}.`, () => api.writeWorkingFile(props.repo.path, path, before));
}

// --- descarte de arquivos inteiros -----------------------------------------------------------
const confirm = ref<{ title: string; lines: string[]; label: string; run: () => Promise<void> } | null>(null);

function askDiscard(paths: string[]): void {
  const files = paths.map((p) => byPath.value.get(p)).filter((e): e is FileEntry => !!e);
  const n = files.length;
  if (!n) return;
  const anyNew = files.some(isUntracked);
  const anyTracked = files.some((e) => !isUntracked(e));
  const anyStaged = files.some(hasStaged);
  confirm.value = {
    title: n === 1 ? 'Descartar alterações do arquivo?' : `Descartar alterações de ${n} arquivos?`,
    lines: [
      n === 1 ? files[0]!.path : `${n} arquivos`,
      ...(anyTracked ? [`O arquivo volta ao último commit${anyStaged ? ' (inclusive o que está no stage)' : ''}.`] : []),
      ...(anyNew ? ['Arquivos novos (não versionados) serão excluídos do disco.'] : []),
      'Uma cópia de segurança fica em GitNexusData/discarded e você poderá desfazer logo em seguida.',
    ],
    label: 'Descartar',
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
        `${n === 1 ? 'Alterações descartadas' : `${n} arquivos descartados`}.`,
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
        ? many ? `Excluir ${n} arquivos novos…` : 'Descartar (excluir arquivo novo)…'
        : many ? `Descartar alterações de ${n} arquivos…` : 'Descartar alterações…',
    },
    { id: 's1', separator: true },
  ];
  if (anyOut) items.push({ id: 'include', label: many ? 'Incluir no commit' : 'Incluir no commit (stage)' });
  if (anyIn) items.push({ id: 'exclude', label: many ? 'Remover do commit' : 'Remover do commit (unstage)' });
  if (allNew) {
    items.push({ id: 's2', separator: true }, { id: 'ignore', label: many ? 'Adicionar ao .gitignore' : 'Adicionar ao .gitignore' });
    if (ext) items.push({ id: 'ignoreExt', label: `Ignorar todos os *${ext}` });
  }
  items.push(
    { id: 's3', separator: true },
    { id: 'copyPath', label: many ? 'Copiar caminhos relativos' : 'Copiar caminho relativo' },
    { id: 'copyName', label: many ? 'Copiar nomes dos arquivos' : 'Copiar nome do arquivo' },
  );
  if (single) {
    items.push({ id: 'reveal', label: 'Mostrar na pasta' }, { id: 'open', label: 'Abrir com o programa padrão', disabled: isDir });
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

const onFocus = () => void refresh();

onMounted(() => {
  void refresh();
  window.addEventListener('focus', onFocus);
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus);
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(noticeTimer);
});
watch(() => ws.versions[props.repo.id], () => void refresh());
</script>

<template>
  <div ref="rootEl" class="rv">
    <header class="rv__head">
      <div class="rv__id">
        <strong>{{ repo.name }}</strong>
        <GnBadge tone="accent">⎇ {{ branch || '…' }}</GnBadge>
        <GnBadge v-if="repo.isWsl">WSL2</GnBadge>
        <span class="muted rv__path">{{ repo.path }}</span>
      </div>
      <div class="rv__btns">
        <GnButton size="sm" :disabled="loading" @click="refresh()">Atualizar</GnButton>
        <GnButton size="sm" @click="ws.open('graph', repo)">Grafo / Histórico</GnButton>
        <GnButton size="sm" :variant="conflicted.length ? 'primary' : 'ghost'" @click="ws.open('merge', repo)">
          Conflitos{{ conflicted.length ? ` (${conflicted.length})` : '' }}
        </GnButton>
      </div>
    </header>

    <p v-if="error" class="rv__error">{{ error }}</p>
    <div v-if="notice" class="rv__notice">
      <span>{{ notice.text }}</span>
      <GnButton v-if="notice.undo" size="sm" variant="primary" @click="runUndo">Desfazer</GnButton>
      <GnButton size="sm" @click="notice = null">×</GnButton>
    </div>

    <div class="rv__body" :style="{ gridTemplateColumns: `300px minmax(0, 1fr) ${showCommit ? '360px' : '0px'}` }">
      <aside class="rv__files">
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
          <GnButton size="sm" :disabled="!nav.prevDiff" title="Diferença anterior (Shift+F7)" aria-label="Diferença anterior" @click="goDiff(-1)">↑</GnButton>
          <GnButton size="sm" :disabled="!nav.nextDiff" title="Próxima diferença (F7)" aria-label="Próxima diferença" @click="goDiff(1)">↓</GnButton>
          <span class="sepv" />
          <GnButton size="sm" :disabled="!nav.prevFile" title="Comparar arquivo anterior (Alt+←)" aria-label="Comparar arquivo anterior" @click="goFile(-1)">←</GnButton>
          <GnButton size="sm" :disabled="!nav.nextFile" title="Comparar próximo arquivo (Alt+→)" aria-label="Comparar próximo arquivo" @click="goFile(1)">→</GnButton>
          <span v-if="active" class="muted">arquivo {{ activeIndex + 1 }} de {{ ordered.length }}</span>
          <template v-if="active">
            <span class="sepv" />
            <span class="muted">{{ curDiff >= 0 ? `diferença ${curDiff + 1} de ${diffCount}` : `${diffCount} diferenças` }}</span>
            <template v-if="showSplit">
              <span class="stat stat--add">+{{ stats.added }}</span>
              <span class="stat stat--del">−{{ stats.removed }}</span>
            </template>
          </template>
          <span class="spacer" />
          <label v-if="showSplit" class="muted opt"><input v-model="collapse" type="checkbox" /> Recolher inalteradas</label>
          <span class="seg">
            <button type="button" :class="{ on: viewMode === 'split' }" @click="viewMode = 'split'">Lado a lado</button>
            <button type="button" :class="{ on: viewMode === 'unified' }" @click="viewMode = 'unified'">Unificado</button>
          </span>
          <GnButton size="sm" :title="showCommit ? 'Ocultar painel de commit' : 'Mostrar painel de commit'" @click="showCommit = !showCommit">
            {{ showCommit ? 'Ocultar commit ▸' : '◂ Commit' }}
          </GnButton>
        </div>

        <div v-if="!active || !activeEntry" class="muted placeholder">Selecione um arquivo para ver o diff.</div>
        <template v-else>
          <div class="rv__difftitle">
            <span class="rv__file">{{ activeEntry.path }}</span>
            <GnBadge :tone="isUntracked(activeEntry) ? 'warn' : 'accent'">{{ STATUS_LABEL[statusLetter(activeEntry)] }}</GnBadge>
            <GnBadge :tone="checkState(activeEntry) === 'checked' ? 'success' : 'neutral'">
              {{ checkState(activeEntry) === 'checked' ? 'no commit' : checkState(activeEntry) === 'partial' ? 'parcialmente no commit' : 'pendente' }}
            </GnBadge>
          </div>
          <div class="rv__diffbody">
            <SideBySideDiff
              v-if="showSplit && sides"
              ref="splitRef"
              :old-text="sides.oldText"
              :new-text="sides.newText"
              :can-discard="true"
              :collapse="collapse"
              old-label="Último commit (HEAD)"
              new-label="Working tree (atual)"
              @discard="onDiscardLines"
              @stats="stats = $event"
              @current="curDiff = $event"
            />
            <DiffView v-else ref="unifiedRef" :diff="diffText || '(sem diferenças a exibir)'" @current="curDiff = $event" />
          </div>
        </template>
      </main>

      <aside v-show="showCommit" class="rv__commit">
        <CommitForm :repo-path="repo.path" :branch="branch" :staged-count="stagedCount" @committed="onCommitted" />
      </aside>
    </div>

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
  &__body { flex: 1; min-height: 0; display: grid; }
  &__files { border-right: 1px solid var(--gn-border); min-width: 0; min-height: 0; overflow: hidden; }
  &__diff { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  &__toolbar {
    display: flex; align-items: center; gap: 6px; padding: 5px 10px;
    border-bottom: 1px solid var(--gn-border); background: var(--gn-surface);
    :deep(.gn-btn) { min-width: 28px; justify-content: center; font-weight: 700; }
  }
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
.seg {
  display: inline-flex; border: 1px solid var(--gn-border); border-radius: var(--gn-radius); overflow: hidden;
  button {
    padding: 2px 10px; font: inherit; font-size: 12px; color: var(--gn-muted);
    background: none; border: none; cursor: pointer;
    &.on { background: var(--gn-accent); color: #fff; }
    &:not(.on):hover { color: var(--gn-text); }
  }
}
.spacer { flex: 1; }
.muted { color: var(--gn-muted); font-size: 12px; }
.placeholder { padding: 40px; text-align: center; }
</style>
