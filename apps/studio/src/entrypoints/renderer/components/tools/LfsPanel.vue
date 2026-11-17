<script setup lang="ts">
// Git LFS: se o repositório usa, quais arquivos são do LFS e em que estado estão (só o ponteiro × conteúdo baixado), e o botão de baixar.
// A leitura funciona mesmo sem o git-lfs instalado; baixar precisa dele (o painel avisa).
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton } from '@git-nexus/ui-kit';
import type { LfsFile, LfsInfo, RepositoryMeta } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { t } from '../../i18n';
import { useWorkspaceStore } from '../../stores/workspace';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const info = ref<LfsInfo | null>(null);
const loading = ref(false);
const busy = ref('');
const error = ref('');
const done = ref('');
const filter = ref('');

const shown = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const all = info.value?.files ?? [];
  return q ? all.filter((f) => f.path.toLowerCase().includes(q)) : all;
});
const downloaded = computed(() => (info.value?.files ?? []).filter((f) => f.state === 'downloaded').length);

/** Tamanho legível (KB, MB, GB). */
function size(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
const tone = (f: LfsFile) => (f.state === 'downloaded' ? 'success' : f.state === 'pointer' ? 'warn' : 'neutral');

async function load(): Promise<void> {
  loading.value = true;
  try {
    info.value = await api.getLfsInfo(props.repo.path);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function pull(paths?: string[]): Promise<void> {
  busy.value = paths?.[0] ?? '*';
  error.value = '';
  done.value = '';
  try {
    const r = await api.pullLfs(props.repo.path, paths);
    ws.bump(props.repo.id); // os arquivos mudaram na pasta
    await load();
    if (r.ok) done.value = r.message;
    else error.value = r.message;
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    busy.value = '';
  }
}

onMounted(load);
watch(() => props.repo.id, load);
</script>

<template>
  <section class="lf" data-testid="lfs-panel">
    <header class="lf__head">
      <p class="lf__intro">{{ t('lfs.intro') }}</p>
      <div class="lf__btns">
        <GnButton size="sm" :disabled="loading || !!busy" @click="load">{{ t('sub.reload') }}</GnButton>
        <GnButton size="sm" tone="accent" data-testid="lfs-pull-all" :disabled="!info?.enabled || !info.installed || !info.pointers || !!busy" @click="pull()">
          {{ busy === '*' ? t('lfs.downloading') : t('lfs.pullAll') }}
        </GnButton>
      </div>
    </header>

    <p v-if="error" class="lf__err" role="alert" data-testid="lfs-error">{{ error }}</p>
    <p v-if="done" class="lf__ok" role="status" data-testid="lfs-done">{{ done }}</p>
    <p v-if="info && !info.enabled" class="lf__muted" data-testid="lfs-off">{{ t('lfs.off') }}</p>

    <template v-if="info?.enabled">
      <p v-if="!info.installed" class="lf__warn" data-testid="lfs-missing">{{ t('lfs.notInstalled') }}</p>
      <p class="lf__sum" data-testid="lfs-summary">
        {{ t('lfs.summary', { total: info.total, pointers: info.pointers, downloaded }) }}
        <span v-if="info.version" class="lf__ver">{{ info.version }}</span>
      </p>
      <div class="lf__patterns">
        <GnBadge v-for="p in info.patterns" :key="p" tone="accent" data-testid="lfs-pattern">{{ p }}</GnBadge>
      </div>
      <input v-model="filter" class="lf__filter" :placeholder="t('lfs.filter')" spellcheck="false" />
      <p v-if="info.truncated" class="lf__muted">{{ t('lfs.truncated', { n: info.files.length }) }}</p>
      <ul class="lf__list">
        <li v-for="f in shown" :key="f.path" class="lf__row" data-testid="lfs-row">
          <span class="lf__path">{{ f.path }}</span>
          <span class="lf__size">{{ size(f.size) }}</span>
          <GnBadge :tone="tone(f)" :data-testid="`lfs-state-${f.state}`">{{ t(`lfs.state.${f.state}`) }}</GnBadge>
          <GnButton v-if="f.state !== 'downloaded' && info.installed" size="sm" tone="accent" :disabled="!!busy" @click="pull([f.path])">
            {{ busy === f.path ? t('lfs.downloading') : t('lfs.pull') }}
          </GnButton>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped lang="scss">
.lf {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  &__head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  &__intro { margin: 0; font-size: 12px; color: var(--gn-muted); max-width: 70ch; }
  &__btns { display: flex; gap: 6px; flex-shrink: 0; }
  &__muted { margin: 4px 0; color: var(--gn-muted); }
  &__err { margin: 0; color: var(--gn-danger); white-space: pre-wrap; word-break: break-word; }
  &__ok { margin: 0; color: var(--gn-success); }
  &__warn { margin: 0; padding: 7px 10px; color: var(--gn-text); background: color-mix(in srgb, var(--gn-warn) 16%, transparent); border: 1px solid var(--gn-warn); border-radius: var(--gn-radius); }
  &__sum { margin: 0; font-size: 12px; color: var(--gn-muted); }
  &__ver { margin-left: 10px; font-family: var(--gn-mono); }
  &__patterns { display: flex; flex-wrap: wrap; gap: 4px; }
  &__filter { width: 100%; }
  &__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  &__row { display: flex; align-items: center; gap: 10px; padding: 5px 10px; background: var(--gn-surface-2); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); }
  &__path { flex: 1; min-width: 0; font: 12px var(--gn-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &__size { font-size: 12px; color: var(--gn-muted); min-width: 64px; text-align: right; }
}
</style>
