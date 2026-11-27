<script setup lang="ts">
// A lista de arquivos de um commit ou de uma comparação (#293/#295): estado (A, M, D, R com o nome antigo), contagem em TEXTO (+3 −1) com a barra proporcional só como reforço,
// filtro por nome e agrupamento por pasta. É um listbox (uma tabulação; ↑ ↓ trocam o arquivo, Enter abre o diff).
import { computed, ref } from 'vue';
import { GnBadge, GnIconButton, GnTooltip } from '@git-nexus/ui-kit';
import type { CommitFile } from '@git-nexus/git-core/pure';
import { t, type MessageKey } from '../i18n';
import { baseName, barOf, countLabel, groupFiles, maxChanges, totalsOf } from '../commit-detail-core';

const props = defineProps<{ files: readonly CommitFile[]; selected: string; actions?: boolean; touched?: (path: string) => { added: number; removed: number; binary?: boolean } | null }>();
const emit = defineEmits<{ select: [path: string]; 'file-at': [path: string]; history: [path: string]; blame: [path: string] }>();

const filter = ref('');
const byFolder = ref(false);
const groups = computed(() => groupFiles(props.files, filter.value, byFolder.value));
const flat = computed(() => groups.value.flatMap((g) => g.files));
const max = computed(() => maxChanges(props.files));
const totals = computed(() => totalsOf(props.files));
const STATUS: Record<string, MessageKey> = { A: 'gv.st.A', M: 'gv.st.M', D: 'gv.st.D', T: 'gv.st.T', R: 'cd.st.R', C: 'cd.st.C' };
const tone = (s: string) => (s === 'D' ? 'danger' : s === 'A' ? 'success' : 'accent');
const statusText = (s: string): string => (STATUS[s] ? t(STATUS[s]!) : s);
const countOf = (f: CommitFile): string => (f.binary ? t('hs.binary') : countLabel(f));
const idOf = (p: string): string => `cf-${props.files.findIndex((f) => f.path === p)}`;
const labelOf = (f: CommitFile): string => [statusText(f.status), f.path, f.oldPath ? t('cd.renamedFrom', { old: f.oldPath }) : '', countOf(f)].filter(Boolean).join(', ');

function onKey(e: KeyboardEvent): void {
  const list = flat.value;
  if (!list.length) return;
  const i = list.findIndex((f) => f.path === props.selected);
  const to = e.key === 'ArrowDown' ? Math.min(list.length - 1, i + 1) : e.key === 'ArrowUp' ? Math.max(0, i < 0 ? 0 : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1;
  if (to >= 0) {
    e.preventDefault();
    emit('select', list[to]!.path);
  } else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) {
    e.preventDefault();
    emit('select', list[i]!.path);
  }
}
const ul = ref<HTMLElement>();
defineExpose({ focus: () => ul.value?.focus() });
</script>

<template>
  <section class="cf" :aria-label="t('gv.filesChanged', { n: files.length })">
    <h4 class="cf__title" data-testid="cf-title">
      {{ t('gv.filesChanged', { n: files.length }) }}
      <span v-if="totals.added || totals.removed" class="cf__tot" data-testid="cf-totals">{{ countLabel(totals) }}</span>
    </h4>
    <div v-if="files.length > 1" class="cf__tools">
      <input v-model="filter" type="text" class="cf__filter" :placeholder="t('cd.filter')" :aria-label="t('cd.filter')" spellcheck="false" data-testid="cf-filter" />
      <label class="cf__grp"><input v-model="byFolder" type="checkbox" data-testid="cf-group" /> {{ t('cd.group') }}</label>
    </div>
    <p v-if="!files.length" class="muted cf__none">{{ t('cd.noFiles') }}</p>
    <p v-else-if="!flat.length" class="muted cf__none" role="status">{{ t('cd.noMatch') }}</p>
    <ul v-else ref="ul" class="cf__list" role="listbox" tabindex="0" :aria-label="t('gv.filesChanged', { n: files.length })" :aria-activedescendant="selected ? idOf(selected) : undefined" data-testid="cf-list" @keydown="onKey">
      <template v-for="g in groups" :key="g.dir">
        <li v-if="byFolder" class="cf__dir" role="presentation">{{ g.dir || t('cd.root') }}</li>
        <li
          v-for="f in g.files"
          :id="idOf(f.path)"
          :key="f.path"
          role="option"
          :aria-selected="selected === f.path"
          :aria-label="labelOf(f)"
          :class="{ on: selected === f.path, touched: !!touched?.(f.path) }"
          data-testid="gv-file"
          :data-path="f.path"
          @click="emit('select', f.path)"
        >
          <GnBadge :tone="tone(f.status)" class="cf__st" :data-status="f.status">{{ statusText(f.status) }}</GnBadge>
          <span class="cf__path">
            <span v-if="byFolder">{{ baseName(f.path) }}</span><span v-else>{{ f.path }}</span>
            <span v-if="f.oldPath" class="cf__old muted" data-testid="cf-old">← {{ f.oldPath }}</span>
            <GnTooltip :text="f.oldPath ? `${f.oldPath} → ${f.path}` : f.path" />
          </span>
          <span v-if="touched?.(f.path)" class="cf__cnt" data-testid="gv-file-count">{{ touched(f.path)!.binary ? t('hs.binary') : countLabel(touched(f.path)!) }}</span>
          <span v-else-if="countOf(f)" class="cf__cnt" data-testid="cf-count">{{ countOf(f) }}</span>
          <span v-if="!f.binary && (f.added || f.removed)" class="cf__bar" aria-hidden="true">
            <i class="cf__bar-a" :style="{ width: barOf(f, max).add + 'px' }" /><i class="cf__bar-d" :style="{ width: barOf(f, max).del + 'px' }" />
          </span>
          <template v-if="actions">
            <GnIconButton icon="external" :label="t('hs.fileAt')" data-testid="gv-file-at" @click.stop="emit('file-at', f.path)" />
            <GnIconButton icon="history" :label="t('gv.fileHistory')" @click.stop="emit('history', f.path)" />
            <GnIconButton icon="person" :label="t('gv.blame')" @click.stop="emit('blame', f.path)" />
          </template>
        </li>
      </template>
    </ul>
  </section>
</template>

<style scoped lang="scss">
.cf {
  &__title { margin: 10px 0 4px; font-size: 12px; display: flex; gap: 8px; align-items: baseline; }
  &__tot { font-family: var(--gn-mono); font-size: 11px; font-weight: 400; color: var(--gn-muted); }
  &__tools { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  &__filter { flex: 1; min-width: 0; }
  &__grp { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  &__none { margin: 6px 0; font-size: 12px; }
  &__list { list-style: none; margin: 0; padding: 0; outline: none; max-height: 260px; overflow: auto; &:focus-visible { box-shadow: 0 0 0 2px var(--gn-accent); border-radius: 4px; }
    li[role='option'] { display: flex; align-items: center; gap: 6px; padding: 3px 4px; cursor: pointer; font-size: 12px; border-radius: 4px; &:hover, &.on { background: var(--gn-surface-2); } &.on { box-shadow: inset 3px 0 0 var(--gn-accent); } &.touched .cf__path { font-weight: 600; } } }
  &__dir { padding: 6px 4px 2px; font-size: 11px; color: var(--gn-muted); font-family: var(--gn-mono); }
  &__path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--gn-mono); }
  &__old { margin-left: 6px; font-size: 11px; }
  &__cnt { font-family: var(--gn-mono); font-size: 11px; color: var(--gn-muted); white-space: nowrap; }
  &__bar { display: inline-flex; width: 100px; flex: none; i { display: block; height: 6px; } &-a { background: var(--gn-success); } &-d { background: var(--gn-danger); } }
}
.muted { color: var(--gn-muted); }
</style>
