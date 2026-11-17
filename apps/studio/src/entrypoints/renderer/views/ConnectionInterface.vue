<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { GnBadge, GnButton, GnIconButton } from '@git-nexus/ui-kit';
import { syncState, type RepoSummary, type RepositoryMeta } from '@git-nexus/git-core/pure';
import { dateLocale, t } from '../i18n';
import { useRepositoriesStore } from '../stores/repositories';
import { useWorkspaceStore } from '../stores/workspace';
import ChangelogDialog from '../components/ChangelogDialog.vue';
import SyncIndicator from '../components/SyncIndicator.vue';

const store = useRepositoriesStore();
const ws = useWorkspaceStore();
const manualPath = ref('');
const showChangelog = ref(false);

onMounted(() => store.load());

async function open(repo: RepositoryMeta): Promise<void> {
  ws.open('repo', repo);
  await store.touch(repo.id);
}

async function remove(repo: RepositoryMeta): Promise<void> {
  ws.closeRepo(repo.id);
  await store.remove(repo.id);
}

async function pullOne(r: RepositoryMeta): Promise<void> {
  const res = await store.syncOne(r, 'pull');
  store.message = { kind: res.ok ? 'info' : 'error', text: `${r.name}: ${res.message}` };
}

async function addManual(): Promise<void> {
  const p = manualPath.value.trim();
  if (!p) return;
  await store.addPath(p);
  if (store.message?.kind === 'info') manualPath.value = '';
}

/** Resumo pronto do repositório (ou `null` enquanto carrega / se deu erro). */
const sum = (r: RepositoryMeta): RepoSummary | null => {
  const s = store.summaries[r.id];
  return s && !('error' in s) ? s : null;
};
const sumError = (r: RepositoryMeta): string => {
  const s = store.summaries[r.id];
  return s && 'error' in s ? s.error : '';
};
const changes = (s: RepoSummary) => s.staged + s.unstaged + s.untracked;

const fmt = (ts: number) => (ts ? new Date(ts).toLocaleString(dateLocale.value) : t('home.neverOpened'));
</script>

<template>
  <div class="conn">
    <header class="conn__head">
      <div>
        <h1>{{ t('home.title') }}</h1>
        <p class="muted">{{ t('home.subtitle') }}</p>
      </div>
      <div class="conn__actions">
        <GnButton variant="primary" :disabled="store.busy" @click="store.addRepository()">{{ t('home.add') }}</GnButton>
        <GnButton :disabled="store.busy" @click="store.scanRoots()">{{ t('home.scan') }}</GnButton>
        <GnButton :title="t('home.changelogTitle')" @click="showChangelog = true">{{ t('home.changelog') }}</GnButton>
      </div>
    </header>

    <form class="conn__manual" @submit.prevent="addManual">
      <input v-model="manualPath" :placeholder="t('home.pathPlaceholder')" />
      <GnButton type="submit" :disabled="store.busy || !manualPath.trim()">{{ t('home.addPath') }}</GnButton>
    </form>

    <div class="conn__bar">
      <input v-model="store.query" class="conn__search" :placeholder="t('home.search')" />
      <label class="muted opt"><input v-model="store.onlyPending" type="checkbox" /> {{ t('home.onlyPending') }}</label>
      <GnButton size="sm" :disabled="!!store.progress" @click="store.refreshSummaries()">{{ t('home.refreshStatus') }}</GnButton>
      <GnButton size="sm" tone="accent" :disabled="!!store.progress" :title="t('home.fetchAllTitle')" @click="store.fetchAll()">{{ t('home.fetchAll') }}</GnButton>
      <GnButton size="sm" variant="primary" :disabled="!!store.progress" :title="t('home.pullSafeTitle')" @click="store.pullSafe()">
        {{ t('home.pullSafe') }}
      </GnButton>
    </div>
    <p v-if="store.progress" class="muted">{{ t('home.progress', { label: store.progress.label, done: store.progress.done, total: store.progress.total }) }}</p>
    <div v-if="store.report" class="report">
      <div class="report__head">
        <strong>{{ store.report.title }}</strong>
        <GnButton size="sm" @click="store.report = null">{{ t('home.close') }}</GnButton>
      </div>
      <p v-if="!store.report.items.length" class="muted">{{ t('home.nothingToDo') }}</p>
      <ul>
        <li v-for="it in store.report.items" :key="it.name" :class="it.ok ? 'ok' : 'bad'">
          {{ it.ok ? '✔' : '✖' }} <strong>{{ it.name }}</strong> — {{ it.text }}
        </li>
      </ul>
    </div>

    <p v-if="store.busy" class="muted">{{ t('home.busy') }}</p>
    <p v-if="store.message" :class="['msg', `msg--${store.message.kind}`]">{{ store.message.text }}</p>

    <p v-if="!store.filtered.length && !store.busy" class="muted empty">
      {{ store.repos.length ? t('home.noMatch') : t('home.empty') }}
    </p>

    <ul class="conn__list">
      <li v-for="r in store.filtered" :key="r.id" class="repo" @dblclick="open(r)">
        <div class="repo__main" @click="open(r)">
          <strong>{{ r.name }}</strong>
          <GnBadge v-if="r.isWsl" tone="accent">WSL2</GnBadge>
          <div class="repo__state">
            <template v-if="sum(r)">
              <GnBadge tone="accent" :title="sum(r)!.upstream ? t('home.upstream', { name: sum(r)!.upstream ?? '' }) : t('home.noUpstream')">⎇ {{ sum(r)!.branch }}</GnBadge>
              <SyncIndicator :sync="sum(r)!" hide-no-upstream />
              <GnBadge v-if="changes(sum(r)!)" tone="warn" :title="t('home.changesTitle')">{{ t('home.changes', { n: changes(sum(r)!) }) }}</GnBadge>
              <GnBadge v-if="sum(r)!.conflicted" tone="danger">{{ t('home.conflicts', { n: sum(r)!.conflicted }) }}</GnBadge>
              <GnBadge v-if="!sum(r)!.upstream && !sum(r)!.detached" tone="neutral">{{ t('home.noUpstreamBadge') }}</GnBadge>
              <GnBadge v-if="syncState(sum(r)!) === 'in-sync' && !changes(sum(r)!) && !sum(r)!.conflicted" tone="success">{{ t('home.upToDate') }}</GnBadge>
            </template>
            <span v-else-if="sumError(r)" class="state-err" :title="sumError(r)">{{ t('home.noStatus') }}</span>
            <span v-else class="muted">{{ t('home.loadingStatus') }}</span>
            <span v-if="store.working[r.id]" class="muted">{{ store.working[r.id] === 'fetch' ? t('home.fetching') : t('home.updating') }}</span>
          </div>
          <div class="muted repo__path">{{ r.path }}</div>
          <div class="muted repo__time">{{ fmt(r.lastOpenedAt) }}</div>
        </div>
        <div class="repo__btns">
          <GnButton size="sm" tone="accent" @click="open(r)">{{ t('home.open') }}</GnButton>
          <GnButton size="sm" :disabled="!!store.working[r.id]" :title="t('home.fetchTitle')" @click="store.syncOne(r, 'fetch')">{{ t('home.fetch') }}</GnButton>
          <GnButton size="sm" tone="accent" :disabled="!!store.working[r.id] || !sum(r)?.upstream" :title="t('home.pullTitle')" @click="pullOne(r)">{{ t('home.pull') }}</GnButton>
          <GnIconButton icon="trash" tone="danger" :label="t('home.remove')" :title="t('home.removeTitle')" @click="remove(r)" />
        </div>
      </li>
    </ul>
    <ChangelogDialog v-if="showChangelog" @close="showChangelog = false" />
  </div>
</template>

<style scoped lang="scss">
.conn {
  padding: 20px 28px;
  max-width: 1100px;
  margin: 0 auto;
  h1 { margin: 0 0 4px; font-size: 20px; }
  &__head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 14px; }
  &__actions { display: flex; gap: 8px; flex-shrink: 0; }
  &__manual { display: flex; gap: 8px; margin-bottom: 10px; input { flex: 1; } }
  &__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
  &__search { flex: 1; min-width: 220px; }
  &__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
}
.muted { color: var(--gn-muted); margin: 0; }
.opt { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; }
.state-err { color: var(--gn-danger); font-size: 12px; }
.report {
  border: 1px solid var(--gn-border); border-radius: var(--gn-radius); padding: 8px 12px; margin-bottom: 12px; background: var(--gn-bg);
  &__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-size: 12px; max-height: 180px; overflow: auto; }
  .ok { color: var(--gn-success); }
  .bad { color: var(--gn-danger); }
}
.empty { padding: 30px 0; text-align: center; }
.msg {
  padding: 7px 10px;
  border-radius: var(--gn-radius);
  margin: 0 0 10px;
  white-space: pre-wrap;
  &--info { background: rgba(79, 181, 106, 0.12); color: var(--gn-success); }
  &--error { background: rgba(239, 106, 98, 0.12); color: var(--gn-danger); }
}
.repo {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--gn-surface-2);
  border: 1px solid var(--gn-border);
  border-radius: var(--gn-radius);
  &:hover { border-color: var(--gn-accent); }
  &__main { flex: 1; min-width: 0; cursor: pointer; }
  &__path { font-family: var(--gn-mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__time { font-size: 11px; }
  &__state { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 3px 0; }
  &__btns { display: flex; gap: 6px; }
}
</style>
