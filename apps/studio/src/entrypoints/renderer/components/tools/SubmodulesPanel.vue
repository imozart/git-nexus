<script setup lang="ts">
// Submódulos do repositório: estado de cada um (inicializado, desatualizado, com alterações locais, conflito) e as ações de inicializar e atualizar.
// "Atualizar" leva o submódulo ao commit que o repositório registra e se recusa a mexer no que tem alterações locais ou commits próprios.
import { computed, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton, GnTooltip } from '@git-nexus/ui-kit';
import type { RepositoryMeta, SubmoduleInfo, SubmoduleState } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../../api';
import { t } from '../../i18n';
import { useWorkspaceStore } from '../../stores/workspace';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

const subs = ref<SubmoduleInfo[]>([]);
const loading = ref(false);
const busy = ref('');
const error = ref('');
const done = ref('');

const tone = (s: SubmoduleState) => (s === 'ok' ? 'success' : s === 'conflict' ? 'danger' : s === 'outdated' ? 'warn' : 'neutral');
const label = (s: SubmoduleState) => t(`sub.state.${s}`);
const canInit = computed(() => subs.value.some((s) => s.state === 'uninitialized'));
const canUpdate = computed(() => subs.value.some((s) => s.state === 'outdated'));

async function load(): Promise<void> {
  loading.value = true;
  try {
    subs.value = await api.getSubmodules(props.repo.path);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}

async function act(kind: 'init' | 'update', paths?: string[]): Promise<void> {
  busy.value = paths?.[0] ?? '*';
  error.value = '';
  done.value = '';
  try {
    const r = await (kind === 'init' ? api.initSubmodules(props.repo.path, paths) : api.updateSubmodules(props.repo.path, paths));
    ws.bump(props.repo.id); // o status do repositório muda (o commit do submódulo)
    await load(); // a lista já nova quando a mensagem aparece
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
  <section class="sm" data-testid="submodules-panel">
    <header class="sm__head">
      <p class="sm__intro">{{ t('sub.intro') }}</p>
      <div class="sm__btns">
        <GnButton size="sm" :disabled="loading || !!busy" @click="load">{{ t('sub.reload') }}</GnButton>
        <GnButton size="sm" tone="accent" data-testid="sub-init-all" :disabled="!canInit || !!busy" @click="act('init')">{{ busy === '*' ? t('sub.working') : t('sub.initAll') }}</GnButton>
        <GnButton size="sm" tone="accent" data-testid="sub-update-all" :disabled="!canUpdate || !!busy" @click="act('update')">{{ t('sub.updateAll') }}<GnTooltip :text="t('sub.updateTip')" /></GnButton>
      </div>
    </header>

    <p v-if="error" class="sm__err" role="alert" data-testid="sub-error">{{ error }}</p>
    <p v-if="done" class="sm__ok" role="status" data-testid="sub-done">{{ done }}</p>
    <p v-if="!loading && !subs.length" class="sm__muted" data-testid="sub-empty">{{ t('sub.none') }}</p>

    <ul class="sm__list">
      <li v-for="s in subs" :key="s.path" class="sm__row" data-testid="sub-row">
        <div class="sm__main">
          <strong class="sm__path">{{ s.path }}</strong>
          <GnBadge :tone="tone(s.state)" :data-testid="`sub-state-${s.state}`">{{ label(s.state) }}</GnBadge>
          <GnBadge v-if="s.dirty" tone="warn">{{ t('sub.dirty') }}<GnTooltip :text="t('sub.dirtyTip')" /></GnBadge>
          <div class="sm__meta">
            <span class="sm__url">{{ s.url || t('sub.noUrl') }}</span>
            <span v-if="s.state !== 'uninitialized'" class="sm__sha">{{ s.sha.slice(0, 8) }}<template v-if="s.describe"> ({{ s.describe }})</template></span>
            <span v-if="s.branch" class="sm__sha">⎇ {{ s.branch }}</span>
          </div>
        </div>
        <div class="sm__row-btns">
          <GnButton v-if="s.state === 'uninitialized'" size="sm" tone="accent" :disabled="!!busy" @click="act('init', [s.path])">{{ busy === s.path ? t('sub.working') : t('sub.init') }}</GnButton>
          <GnButton v-else-if="s.state === 'outdated'" size="sm" tone="accent" :disabled="!!busy" @click="act('update', [s.path])">{{ busy === s.path ? t('sub.working') : t('sub.update') }}<GnTooltip :text="t('sub.updateTip')" /></GnButton>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped lang="scss">
.sm {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  &__head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  &__intro { margin: 0; font-size: 12px; color: var(--gn-muted); max-width: 70ch; }
  &__btns { display: flex; gap: 6px; flex-shrink: 0; }
  &__muted { margin: 4px 0; color: var(--gn-muted); }
  &__err { margin: 0; color: var(--gn-danger); white-space: pre-wrap; word-break: break-word; }
  &__ok { margin: 0; color: var(--gn-success); }
  &__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  &__row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 12px; background: var(--gn-surface-2); border: 1px solid var(--gn-border); border-radius: var(--gn-radius); }
  &__main { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  &__path { font-family: var(--gn-mono); }
  &__meta { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 10px; font: 12px var(--gn-mono); color: var(--gn-muted); }
  &__url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60ch; }
  &__row-btns { display: flex; gap: 6px; }
}
</style>
