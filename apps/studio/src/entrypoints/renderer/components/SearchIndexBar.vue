<script setup lang="ts">
// O índice de busca do repositório (fase 10 da #233) na janela de pesquisa: uma linha que diz em que pé ele está ("pronto, atualizado há 3 min", "construindo 42 %",
// "pausado"), propõe "Acelerar as buscas neste repositório" quando a regra de ativação pede, e abre o diálogo para escolher o modo (Automático, Sempre, Nunca), o
// limite de disco e criar, pausar, continuar, reconstruir ou apagar. O índice só muda o tempo da busca, nunca o resultado.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GnBadge, GnButton, GnDialog, GnSegmented, GnTooltip } from '@git-nexus/ui-kit';
import type { RepositoryMeta, SearchDone, SearchIndexAction, SearchIndexInfo, SearchIndexMode } from '@git-nexus/git-core/pure';
import { api, errMsg } from '../api';
import { dateLocale, t } from '../i18n';
import { formatSize } from '../merge-choice-core';
import { formatDuration } from '../search-window-core';
import { ageText } from '../search-index-core';

const props = defineProps<{ repo: RepositoryMeta; /** O fim da última busca (diz se ela usou o índice). */ done?: SearchDone | null; /** Abre o diálogo logo (a paleta). */ openDialog?: boolean }>();
const emit = defineEmits<{ 'dialog-opened': [] }>();

const info = ref<SearchIndexInfo | null>(null);
const dialog = ref(false);
const busy = ref(false);
const error = ref('');
const limit = ref(2048);
let off: (() => void) | undefined;
let alive = true;

async function load(): Promise<void> {
  try {
    const i = await api.getSearchIndex(props.repo.path);
    if (alive) info.value = i;
  } catch (e) {
    error.value = errMsg(e);
  }
}
onMounted(() => {
  off = api.onSearchIndex((e) => {
    if (e.repoPath === props.repo.path) info.value = e;
  });
  void load();
  if (props.openDialog) openManage();
});
onBeforeUnmount(() => {
  alive = false;
  off?.();
});
watch(() => props.repo.path, () => {
  info.value = null;
  void load();
});
watch(() => props.openDialog, (v) => v && openManage());

const state = computed(() => info.value?.state ?? 'none');
const pct = computed(() => {
  const p = info.value?.progress;
  return p && p.total ? Math.min(100, Math.floor((p.done / p.total) * 100)) : 0;
});
const updating = computed(() => !!info.value?.builtAt && state.value === 'building');
const size = (n: number): string => formatSize(n, dateLocale.value);
const ago = computed(() => (info.value?.updatedAt ? ageText(info.value.updatedAt, Date.now(), dateLocale.value) : ''));

/** O porquê da proposta, em uma frase. */
const why = computed(() => {
  const i = info.value;
  if (!i?.suggest) return '';
  if (i.suggest === 'files') return t('si.why.files', { n: (i.measured.files ?? 0).toLocaleString(dateLocale.value) });
  if (i.suggest === 'size') return t('si.why.size', { size: size(i.measured.textBytes ?? 0) });
  return t('si.why.slow', { time: formatDuration(i.measured.medianMs ?? 0, dateLocale.value) });
});

/** A frase da linha. Só a mudança de situação vai para o leitor de tela (o andamento muda a cada instante e ficaria falando sem parar). */
const line = computed(() => {
  const i = info.value;
  if (!i) return '';
  if (i.mode === 'never') return t('si.line.never');
  switch (i.state) {
    case 'building':
      return i.progress ? t(updating.value ? 'si.line.updating' : 'si.line.building', { pct: pct.value, done: i.progress.done.toLocaleString(dateLocale.value), total: i.progress.total.toLocaleString(dateLocale.value) }) : t('si.line.starting');
    case 'paused':
      return t('si.line.paused', { pct: pct.value });
    case 'ready':
      return t('si.line.ready', { age: ago.value, files: i.files.toLocaleString(dateLocale.value), size: size(i.bytes) });
    case 'error':
      return i.message ?? t('si.line.error');
    default:
      return i.suggest ? `${why.value} ${t('si.ask')}` : t('si.line.none');
  }
});
const stateWord = computed(() => (info.value ? t(`si.state.${info.value.mode === 'never' ? 'never' : info.value.state}` as 'si.state.none') : ''));
const accelerated = computed(() => props.done?.ok && props.done.accelerated);

async function act(action: SearchIndexAction): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    info.value = await api.controlSearchIndex(props.repo.path, action);
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    busy.value = false;
  }
}
async function setMode(mode: SearchIndexMode): Promise<void> {
  try {
    info.value = await api.configureSearchIndex(props.repo.path, { mode });
  } catch (e) {
    error.value = errMsg(e);
  }
}
async function setLimit(): Promise<void> {
  try {
    info.value = await api.configureSearchIndex(props.repo.path, { limitMB: limit.value });
    limit.value = Math.round(info.value.limitBytes / 1024 / 1024);
  } catch (e) {
    error.value = errMsg(e);
  }
}
function openManage(): void {
  limit.value = Math.round((info.value?.limitBytes ?? 2048 * 1024 * 1024) / 1024 / 1024);
  dialog.value = true;
  emit('dialog-opened');
}
watch(info, (i) => {
  if (i && !dialog.value) limit.value = Math.round(i.limitBytes / 1024 / 1024);
});

const modes = computed(() => [
  { value: 'auto' as const, label: t('si.mode.auto'), title: t('si.modeHint.auto') },
  { value: 'always' as const, label: t('si.mode.always'), title: t('si.modeHint.always') },
  { value: 'never' as const, label: t('si.mode.never'), title: t('si.modeHint.never') },
]);
const modeHint = computed(() => t(`si.modeHint.${info.value?.mode ?? 'auto'}` as 'si.modeHint.auto'));
const canBuild = computed(() => state.value === 'none' || state.value === 'error');
const measured = computed(() => {
  const m = info.value?.measured;
  if (!m) return '';
  const parts: string[] = [];
  if (m.files !== undefined) parts.push(t('si.measured.files', { n: m.files.toLocaleString(dateLocale.value) }));
  if (m.textBytes !== undefined) parts.push(t('si.measured.text', { size: size(m.textBytes) }));
  if (m.medianMs !== undefined) parts.push(t('si.measured.median', { time: formatDuration(m.medianMs, dateLocale.value), n: m.samples }));
  return parts.join(' · ');
});
</script>

<template>
  <div class="six" role="group" :aria-label="t('si.label')" data-testid="six">
    <span class="six__sr" role="status" data-testid="six-state">{{ stateWord }}</span>
    <span class="six__line" :class="{ 'six__line--warn': state === 'error' }" data-testid="six-line">{{ line }}</span>
    <span v-if="state === 'building' || state === 'paused'" class="six__bar" role="progressbar" :aria-label="t('si.label')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="pct" data-testid="six-bar"><i :style="{ width: pct + '%' }" /></span>
    <GnBadge v-if="accelerated" tone="success" data-testid="six-accelerated">{{ t('si.accelerated', { n: accelerated.candidates }) }}</GnBadge>
    <template v-if="info && info.mode !== 'never'">
      <GnButton v-if="info.suggest" size="sm" variant="primary" :disabled="busy" data-testid="six-accelerate" @click="act('build')">{{ t('si.accelerate') }}</GnButton>
      <GnButton v-if="info.suggest" size="sm" variant="ghost" :disabled="busy" data-testid="six-dismiss" @click="act('dismiss')">{{ t('si.notNow') }}</GnButton>
      <GnButton v-if="state === 'building'" size="sm" variant="ghost" :disabled="busy" data-testid="six-pause" @click="act('pause')">{{ t('si.pause') }}</GnButton>
      <GnButton v-if="state === 'paused'" size="sm" variant="ghost" :disabled="busy" data-testid="six-resume" @click="act('resume')">{{ t('si.resume') }}</GnButton>
    </template>
    <GnButton size="sm" variant="ghost" data-testid="six-manage" @click="openManage">{{ t('si.manage') }}<GnTooltip :text="t('si.manageTip')" /></GnButton>
    <span v-if="error" class="six__err" role="alert" data-testid="six-error">{{ error }}</span>

    <GnDialog v-if="dialog" width="min(640px, 94vw)" :label="t('si.title')" initial-focus="[data-testid='sid-close']" @close="dialog = false">
      <div class="sid" data-testid="sid">
        <h2 class="sid__title">{{ t('si.title') }}</h2>
        <p class="sid__intro">{{ t('si.intro') }}</p>
        <div class="sid__row">
          <span id="sid-mode-label" class="sid__lbl">{{ t('si.mode') }}</span>
          <GnSegmented :model-value="info?.mode ?? 'auto'" :options="modes" :aria-label="t('si.mode')" data-testid="sid-mode" @update:model-value="setMode" />
        </div>
        <p class="sid__hint" data-testid="sid-hint">{{ modeHint }}</p>
        <dl v-if="info" class="sid__stats" data-testid="sid-stats">
          <dt>{{ t('si.row.state') }}</dt>
          <dd data-testid="sid-state">{{ stateWord }}<template v-if="state === 'building' || state === 'paused'"> · {{ pct }} %</template></dd>
          <template v-if="info.state !== 'none'">
            <dt>{{ t('si.row.files') }}</dt>
            <dd data-testid="sid-files">{{ info.files.toLocaleString(dateLocale) }}</dd>
            <dt>{{ t('si.row.always') }}<GnTooltip :text="t('si.row.alwaysTip')" /></dt>
            <dd data-testid="sid-always">{{ info.alwaysChecked.toLocaleString(dateLocale) }}</dd>
            <dt>{{ t('si.row.size') }}</dt>
            <dd data-testid="sid-size">{{ size(info.bytes) }}</dd>
            <dt v-if="info.updatedAt">{{ t('si.row.updated') }}</dt>
            <dd v-if="info.updatedAt" data-testid="sid-updated">{{ ago }}</dd>
          </template>
          <dt>{{ t('si.row.measured') }}</dt>
          <dd data-testid="sid-measured">{{ measured || t('si.row.notMeasured') }}</dd>
        </dl>
        <p v-if="info?.message" class="sid__msg" role="note" data-testid="sid-message">{{ info.message }}</p>
        <label class="sid__limit">
          <span>{{ t('si.limit') }}</span>
          <input v-model.number="limit" type="number" min="16" step="256" data-testid="sid-limit" @change="setLimit" />
          <span>{{ t('si.limitUnit') }}</span>
        </label>
        <div class="sid__actions">
          <GnButton v-if="canBuild" variant="primary" size="sm" :disabled="busy || info?.mode === 'never'" data-testid="sid-build" @click="act('build')">{{ t('si.build') }}</GnButton>
          <GnButton v-if="state === 'building'" size="sm" :disabled="busy" data-testid="sid-pause" @click="act('pause')">{{ t('si.pause') }}</GnButton>
          <GnButton v-if="state === 'paused'" variant="primary" size="sm" :disabled="busy" data-testid="sid-resume" @click="act('resume')">{{ t('si.resume') }}</GnButton>
          <GnButton v-if="state === 'building' || state === 'paused'" size="sm" tone="warn" :disabled="busy" data-testid="sid-cancel" @click="act('cancel')">{{ t('si.cancel') }}</GnButton>
          <GnButton v-if="state === 'ready' || state === 'paused' || state === 'error'" size="sm" :disabled="busy || info?.mode === 'never'" data-testid="sid-rebuild" @click="act('rebuild')">{{ t('si.rebuild') }}</GnButton>
          <GnButton v-if="state !== 'none'" size="sm" tone="danger" :disabled="busy" data-testid="sid-delete" @click="act('delete')">{{ t('si.delete') }}</GnButton>
          <GnButton size="sm" variant="ghost" data-testid="sid-close" @click="dialog = false">{{ t('si.close') }}</GnButton>
        </div>
        <p v-if="error" class="sid__msg" role="alert">{{ error }}</p>
      </div>
    </GnDialog>
  </div>
</template>

<style scoped lang="scss">
.six { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 2px 14px 6px; font-size: 12.5px; color: var(--gn-muted); }
.six__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.six__line { min-width: 0; }
.six__line--warn { color: var(--gn-danger); }
.six__bar { flex: 0 0 120px; height: 6px; border-radius: 3px; background: var(--gn-border); overflow: hidden; i { display: block; height: 100%; background: var(--gn-accent); } }
.six__err { color: var(--gn-danger); }
.sid { padding: 16px 20px 18px; display: flex; flex-direction: column; gap: 10px; }
.sid__title { margin: 0; font-size: 16px; }
.sid__intro, .sid__hint { margin: 0; color: var(--gn-muted); font-size: 13px; }
.sid__row { display: flex; align-items: center; gap: 10px; }
.sid__lbl { font-weight: 600; }
.sid__stats { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 0; dt { color: var(--gn-muted); } dd { margin: 0; font-variant-numeric: tabular-nums; } }
.sid__msg { margin: 0; color: var(--gn-danger); white-space: pre-wrap; }
.sid__limit { display: flex; align-items: center; gap: 8px; input { width: 7em; } }
.sid__actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
</style>
