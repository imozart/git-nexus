<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton, GnTooltip } from '@git-nexus/ui-kit';
import { buildMerge, type InProgressKind, type MergeConflictBlock, type RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { useWorkspaceStore } from '../stores/workspace';
import MergeConflictResolver from '../components/MergeConflictResolver.vue';
import MergeResolver from '../components/MergeResolver.vue';
import OperationBanner from '../components/OperationBanner.vue';
import ToolStripe, { type StripeItem } from '../components/ToolStripe.vue';
import { newConflictResolver } from '../conflict-resolver-pref';
import { clearDraft, draftKey, loadDraft } from '../merge-draft';
import { draftSignature, fileSummary, orient } from '../merge-resolver-core';
import { t } from '../i18n';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const conflicts = ref<MergeConflictBlock[]>([]);
/** Arquivos já marcados como resolvidos que o Git ainda deixa reabrir (a operação não terminou). */
const resolvedFiles = ref<string[]>([]);
/** Merge, cherry-pick ou revert parado: dá para abortá-lo daqui sem ir ao terminal. */
const inProgress = ref<InProgressKind | null>(null);
/** Rebase parado: o Git inverte os lados (a "ours" é o branch de destino e a "theirs" é o commit do usuário). */
const rebasing = ref(false);
const current = ref('');
const filter = ref('');
const error = ref('');
const info = ref('');
const loading = ref(false);
const saving = ref(false);
/** Posição do arquivo recém-resolvido na lista: a tela segue para o arquivo que ocupa o lugar dele. */
let advanceTo: number | null = null;

const PANEL_KEY = 'gitnexus.showConflictList';
const showList = ref(localStorage.getItem(PANEL_KEY) !== '0');
watch(showList, (v) => localStorage.setItem(PANEL_KEY, v ? '1' : '0'));
const stripe = computed<StripeItem[]>(() => [
  { id: 'list', label: t('mv.stripe'), active: showList.value, badge: conflicts.value.length, title: showList.value ? t('mv.hidePanel') : t('mv.showPanel') },
]);

/** Arquivos grandes demais ficam sem a contagem na lista (calcular a fusão de todos custaria caro). */
const SUMMARY_MAX_CHARS = 2_000_000;
const summaries = ref<Record<string, { conflicts: number | null; resolved: number }>>({});
function refreshSummaries(): void {
  const out: typeof summaries.value = {};
  for (const c of conflicts.value) {
    if (c.base.length + c.ours.length + c.theirs.length > SUMMARY_MAX_CHARS) {
      out[c.filePath] = fileSummary(null, null);
      continue;
    }
    const o = orient(c, rebasing.value);
    const model = buildMerge(o);
    const draft = loadDraft(draftKey(props.repo.id, c.filePath), draftSignature(o), model);
    out[c.filePath] = fileSummary(model, draft.status === 'ok' ? draft.choices : null);
  }
  summaries.value = out;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    conflicts.value = await api.getMergeConflicts(props.repo.path);
    inProgress.value = await api.getInProgress(props.repo.path).catch(() => null);
    rebasing.value = !!(await api.getRebaseState(props.repo.path).catch(() => null))?.inProgress;
    const left = new Set(conflicts.value.map((c) => c.filePath));
    resolvedFiles.value = (await api.getResolvedConflictFiles(props.repo.path).catch(() => [] as string[])).filter((f) => !left.has(f));
    if (!left.has(current.value)) current.value = conflicts.value[Math.min(advanceTo ?? 0, conflicts.value.length - 1)]?.filePath ?? '';
    advanceTo = null;
    refreshSummaries();
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function resolve(block: MergeConflictBlock, merged: string): Promise<void> {
  saving.value = true;
  error.value = '';
  info.value = '';
  try {
    const ok = await api.resolveConflictFile(props.repo.path, block.filePath, merged);
    if (!ok) {
      error.value = t('mv.refused');
      return;
    }
    clearDraft(draftKey(props.repo.id, block.filePath));
    info.value = t('mv.resolved', { file: block.filePath });
    advanceTo = Math.max(0, conflicts.value.findIndex((c) => c.filePath === block.filePath));
    ws.bump(props.repo.id);
    await load();
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    saving.value = false;
  }
}

/** Recria o conflito original de um arquivo já resolvido (`git checkout -m`), enquanto a operação continua. */
async function reopen(file: string): Promise<void> {
  error.value = '';
  info.value = '';
  try {
    if (!(await api.reopenConflict(props.repo.path, file))) {
      error.value = t('mv.reopenFailed', { file });
      return;
    }
    info.value = t('mv.reopened', { file });
    current.value = file;
    ws.bump(props.repo.id);
    await load();
  } catch (e) {
    error.value = errMsg(e);
  }
}

async function onOpDone(message: string): Promise<void> {
  info.value = message;
  ws.bump(props.repo.id);
  await load();
}

const shown = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return q ? conflicts.value.filter((c) => c.filePath.toLowerCase().includes(q)) : conflicts.value;
});
const shownResolved = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return q ? resolvedFiles.value.filter((f) => f.toLowerCase().includes(q)) : resolvedFiles.value;
});

/** Vai para o próximo arquivo ainda em conflito (dá a volta na lista). */
function nextFile(): void {
  const list = conflicts.value;
  if (list.length < 2) return;
  const i = list.findIndex((c) => c.filePath === current.value);
  current.value = list[(i + 1) % list.length]!.filePath;
}

const summaryText = (file: string): string => {
  const s = summaries.value[file];
  return s && s.conflicts !== null ? t('mv.fileSummary', { n: s.conflicts, done: s.resolved }) : '';
};

watch(current, refreshSummaries);
onMounted(load);
watch(() => ws.versions[props.repo.id], load);
</script>

<template>
  <div class="mv">
    <ToolStripe side="left" :items="stripe" @toggle="showList = !showList" />
    <aside v-show="showList" class="mv__side">
      <div class="mv__sidehead">
        <strong>{{ t('mv.files') }}</strong>
        <span class="mv__headbtns">
          <GnButton v-if="conflicts.length > 1" size="sm" data-testid="mv-next-file" @click="nextFile">{{ t('mv.nextFile') }}</GnButton>
          <GnButton size="sm" :disabled="loading" @click="load">{{ t('rv.refresh') }}</GnButton>
        </span>
      </div>
      <OperationBanner v-if="inProgress && conflicts.length" :repo-path="repo.path" :kind="inProgress" :conflicts="conflicts.length" @done="onOpDone" @failed="error = $event" />
      <input v-if="conflicts.length + resolvedFiles.length > 3" v-model="filter" class="mv__filter" type="text" :placeholder="t('mv.filter')" :aria-label="t('mv.filter')" data-testid="mv-filter" />
      <p v-if="!conflicts.length && !resolvedFiles.length && !loading" class="muted empty">
        {{ t('mv.none') }}<br />{{ t('mv.noneHint') }}
      </p>
      <div
        v-for="c in shown"
        :key="c.filePath"
        class="item"
        :class="{ 'item--on': c.filePath === current }"
        data-testid="mv-file"
        @click="current = c.filePath"
      >
        <span class="item__main">
          <span class="item__name">{{ c.filePath }}<GnTooltip :text="c.filePath" /></span>
          <small v-if="newConflictResolver && summaryText(c.filePath)" class="item__sum" data-testid="mv-file-summary">{{ summaryText(c.filePath) }}</small>
        </span>
        <GnBadge :tone="c.hasUnresolvedMarkers ? 'warn' : 'success'">{{ c.hasUnresolvedMarkers ? t('tree.statePending') : t('mcr.noMarkers') }}</GnBadge>
      </div>
      <template v-if="shownResolved.length">
        <div class="mv__group">{{ t('mv.resolvedList') }}</div>
        <div v-for="f in shownResolved" :key="f" class="item item--resolved" data-testid="mv-resolved-file">
          <span class="item__main"><span class="item__name">{{ f }}<GnTooltip :text="f" /></span></span>
          <GnBadge tone="success">{{ t('mv.resolvedFile') }}</GnBadge>
          <GnButton size="sm" variant="ghost" data-testid="mv-reopen" @click.stop="reopen(f)">{{ t('mv.reopen') }}<GnTooltip :text="t('mv.reopenTip')" /></GnButton>
        </div>
      </template>
      <p v-if="filter && !shown.length && !shownResolved.length" class="muted empty">{{ t('mv.noMatch') }}</p>
      <p v-if="!conflicts.length && info" class="ok">{{ info }}</p>
      <div v-if="!conflicts.length && info && !inProgress && !rebasing" class="next">
        <GnButton variant="primary" size="sm" @click="ws.open('repo', repo)">{{ t('mv.goCommit') }}</GnButton>
      </div>
    </aside>

    <main class="mv__main">
      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="info && conflicts.length" class="ok pad">{{ info }}</p>
      <template v-for="c in conflicts" :key="c.filePath">
        <template v-if="c.filePath === current">
          <MergeResolver
            v-if="newConflictResolver"
            :block="c"
            :busy="saving"
            :rebase="rebasing"
            :repo-id="repo.id"
            :draft-key="draftKey(repo.id, c.filePath)"
            @resolve="(m: string) => resolve(c, m)"
          />
          <MergeConflictResolver v-else :block="c" :busy="saving" @resolve="(m: string) => resolve(c, m)" />
        </template>
      </template>
      <!-- sem arquivo pendente: o passo seguinte da operação em andamento -->
      <div v-if="!conflicts.length && !loading && (inProgress || rebasing || resolvedFiles.length)" class="done" data-testid="mv-done">
        <h3>{{ t('mv.allDone') }}</h3>
        <p class="muted">{{ rebasing ? t('mv.allDoneRebase') : t('mv.allDoneHint') }}</p>
        <OperationBanner v-if="inProgress" :repo-path="repo.path" :kind="inProgress" :conflicts="0" @done="onOpDone" @failed="error = $event" />
        <GnButton v-if="rebasing" variant="primary" data-testid="mv-go-rebase" @click="ws.open('repo', repo)">{{ t('mv.goRebase') }}</GnButton>
      </div>
    </main>
  </div>
</template>

<style scoped lang="scss">
.mv {
  display: flex; height: 100%;
  &__side { flex: none; width: 270px; border-right: 1px solid var(--gn-border); overflow: auto; }
  &__sidehead { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--gn-border); }
  &__headbtns { display: flex; gap: 6px; }
  &__filter { width: calc(100% - 24px); margin: 8px 12px; }
  &__group { padding: 8px 12px 4px; color: var(--gn-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  &__main { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; > :deep(.mcr), > :deep(.mr) { flex: 1; } }
}
.item {
  display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 6px 12px; cursor: pointer;
  &:hover { background: var(--gn-surface-2); }
  &--on { background: rgba(79, 134, 247, 0.18); }
  &--resolved { cursor: default; flex-wrap: wrap; &:hover { background: none; } .item__main { flex-basis: 100%; } }
  &__main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  &__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
  &__sum { color: var(--gn-muted); font-size: 11px; }
}
.muted { color: var(--gn-muted); }
.empty { padding: 20px 14px; margin: 0; }
.err { margin: 0; padding: 8px 12px; color: var(--gn-danger); background: rgba(239, 106, 98, 0.1); white-space: pre-wrap; }
.ok { color: var(--gn-success); padding: 10px 12px; margin: 0; }
.pad { padding: 6px 12px; }
.next { padding: 0 12px; }
.done { padding: 24px 20px; display: flex; flex-direction: column; align-items: flex-start; gap: 10px; max-width: 560px; h3 { margin: 0; } p { margin: 0; } }
</style>
