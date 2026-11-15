<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import type { MergeConflictBlock, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { useWorkspaceStore } from '../stores/workspace';
import MergeConflictResolver from '../components/MergeConflictResolver.vue';
import ToolStripe, { type StripeItem } from '../components/ToolStripe.vue';
import { t } from '../i18n';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const conflicts = ref<MergeConflictBlock[]>([]);
const current = ref('');
const error = ref('');
const info = ref('');
const loading = ref(false);
const saving = ref(false);

const PANEL_KEY = 'gitnexus.showConflictList';
const showList = ref(localStorage.getItem(PANEL_KEY) !== '0');
watch(showList, (v) => localStorage.setItem(PANEL_KEY, v ? '1' : '0'));
const stripe = computed<StripeItem[]>(() => [
  { id: 'list', label: t('mv.stripe'), active: showList.value, badge: conflicts.value.length, title: showList.value ? t('mv.hidePanel') : t('mv.showPanel') },
]);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    conflicts.value = await api.getMergeConflicts(props.repo.path);
    if (!conflicts.value.some((c) => c.filePath === current.value)) current.value = conflicts.value[0]?.filePath ?? '';
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
    info.value = t('mv.resolved', { file: block.filePath });
    ws.bump(props.repo.id);
    await load();
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
watch(() => ws.versions[props.repo.id], load);
</script>

<template>
  <div class="mv">
    <ToolStripe side="left" :items="stripe" @toggle="showList = !showList" />
    <aside v-show="showList" class="mv__side">
      <div class="mv__sidehead">
        <strong>{{ t('mv.files') }}</strong>
        <GnButton size="sm" :disabled="loading" @click="load">{{ t('rv.refresh') }}</GnButton>
      </div>
      <p v-if="!conflicts.length && !loading" class="muted empty">
        {{ t('mv.none') }}<br />{{ t('mv.noneHint') }}
      </p>
      <div
        v-for="c in conflicts"
        :key="c.filePath"
        class="item"
        :class="{ 'item--on': c.filePath === current }"
        @click="current = c.filePath"
      >
        <span class="item__name" :title="c.filePath">{{ c.filePath }}</span>
        <GnBadge :tone="c.hasUnresolvedMarkers ? 'warn' : 'success'">{{ c.hasUnresolvedMarkers ? t('tree.statePending') : t('mcr.noMarkers') }}</GnBadge>
      </div>
      <p v-if="!conflicts.length && info" class="ok">{{ info }}</p>
      <div v-if="!conflicts.length && info" class="next">
        <GnButton variant="primary" size="sm" @click="ws.open('repo', repo)">{{ t('mv.goCommit') }}</GnButton>
      </div>
    </aside>

    <main class="mv__main">
      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="info && conflicts.length" class="ok pad">{{ info }}</p>
      <template v-for="c in conflicts" :key="c.filePath">
        <MergeConflictResolver
          v-if="c.filePath === current"
          :block="c"
          :busy="saving"
          @resolve="(m: string) => resolve(c, m)"
        />
      </template>
    </main>
  </div>
</template>

<style scoped lang="scss">
.mv {
  display: flex; height: 100%;
  &__side { flex: none; width: 270px; border-right: 1px solid var(--gn-border); overflow: auto; }
  &__sidehead { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--gn-border); }
  &__main { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; > :deep(.mcr) { flex: 1; } }
}
.item {
  display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 6px 12px; cursor: pointer;
  &:hover { background: var(--gn-surface-2); }
  &--on { background: rgba(79, 134, 247, 0.18); }
  &__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
}
.muted { color: var(--gn-muted); }
.empty { padding: 20px 14px; margin: 0; }
.err { margin: 0; padding: 8px 12px; color: var(--gn-danger); background: rgba(239, 106, 98, 0.1); white-space: pre-wrap; }
.ok { color: var(--gn-success); padding: 10px 12px; margin: 0; }
.pad { padding: 6px 12px; }
.next { padding: 0 12px; }
</style>
