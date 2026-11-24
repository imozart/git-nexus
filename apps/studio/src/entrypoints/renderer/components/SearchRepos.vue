<script setup lang="ts">
// Escolher onde pesquisar (fase 8 da #233): os repositórios do CATÁLOGO do app (nunca um caminho digitado), com os atalhos Todos, Abertos nas abas e Só este,
// e os conjuntos salvos ("Backend", "Front"). É só o formulário: quem pesquisa é a janela, e a seleção e os conjuntos vivem nas preferências dela.
import { computed, ref } from 'vue';
import { GnBadge, GnButton, GnIconButton } from '@git-nexus/ui-kit';
import type { RepositoryMeta } from '@git-nexus/git-core/pure';
import { t } from '../i18n';
import { isWslPath, matchRepos, pickAll, pickOpen, removeSet, upsertSet, type RepoSet } from '../multi-search-core';

const props = defineProps<{ catalog: RepositoryMeta[]; modelValue: string[]; activeId: string; openIds: string[]; sets: RepoSet[] }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string[]): void; (e: 'update:sets', v: RepoSet[]): void }>();

const query = ref('');
const setName = ref('');
const shown = computed(() => matchRepos(props.catalog, query.value));
const picked = computed(() => new Set(props.modelValue));
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

function toggle(id: string, on: boolean): void {
  const next = new Set(props.modelValue);
  if (on) next.add(id);
  else next.delete(id);
  emit('update:modelValue', props.catalog.map((r) => r.id).filter((i) => next.has(i)));
}
const all = (): void => emit('update:modelValue', pickAll(props.catalog));
const open = (): void => emit('update:modelValue', pickOpen(props.catalog, props.openIds));
const onlyThis = (): void => emit('update:modelValue', [props.activeId]);
const applySet = (s: RepoSet): void => emit('update:modelValue', props.catalog.map((r) => r.id).filter((i) => s.ids.includes(i)));
function saveSet(): void {
  const name = setName.value.trim();
  if (!name || !props.modelValue.length) return;
  emit('update:sets', upsertSet(props.sets, name, props.modelValue));
  setName.value = '';
}
const dropSet = (s: RepoSet): void => emit('update:sets', removeSet(props.sets, s.name));
</script>

<template>
  <div id="sw-repos" class="sr" role="group" :aria-label="t('sw.mr.label')" data-testid="sw-repos">
    <div class="sr__row">
      <label class="sr__f sr__f--grow">
        <span>{{ t('sw.mr.filter') }}</span>
        <input v-model="query" class="sr__in" :placeholder="t('sw.mr.filterPh')" :aria-label="t('sw.mr.filter')" spellcheck="false" autocomplete="off" data-testid="sr-filter" />
      </label>
      <GnButton size="sm" :aria-pressed="same(modelValue, catalog.map((r) => r.id))" data-testid="sr-all" @click="all">{{ t('sw.mr.all') }}</GnButton>
      <GnButton size="sm" :aria-pressed="same(modelValue, pickOpen(catalog, openIds))" data-testid="sr-open" @click="open">{{ t('sw.mr.open') }}</GnButton>
      <GnButton size="sm" :aria-pressed="same(modelValue, [activeId])" data-testid="sr-this" @click="onlyThis">{{ t('sw.mr.onlyThis') }}</GnButton>
      <span class="sr__n" role="status" aria-live="polite" data-testid="sr-count">{{ t('sw.mr.selected', { n: modelValue.length, total: catalog.length }) }}</span>
    </div>
    <div class="sr__row" data-testid="sr-sets">
      <span class="sr__lbl">{{ t('sw.mr.sets') }}</span>
      <template v-for="s in sets" :key="s.name">
        <span class="sr__set">
          <GnButton size="sm" :aria-pressed="same(modelValue, s.ids.filter((i) => catalog.some((r) => r.id === i)))" data-testid="sr-set" @click="applySet(s)">{{ s.name }} · {{ s.ids.length }}</GnButton>
          <GnIconButton icon="x" :label="t('sw.mr.setRemove', { name: s.name })" data-testid="sr-set-remove" @click="dropSet(s)" />
        </span>
      </template>
      <span v-if="!sets.length" class="sr__muted" data-testid="sr-sets-none">{{ t('sw.mr.setNone') }}</span>
      <label class="sr__f">
        <input v-model="setName" class="sr__in sr__in--name" :placeholder="t('sw.mr.setNamePh')" :aria-label="t('sw.mr.setName')" spellcheck="false" autocomplete="off" maxlength="60" data-testid="sr-set-name" @keydown.enter.prevent="saveSet" />
      </label>
      <GnButton size="sm" :disabled="!setName.trim() || !modelValue.length" data-testid="sr-set-save" @click="saveSet">{{ t('sw.mr.setSave') }}</GnButton>
    </div>
    <ul class="sr__list" data-testid="sr-list">
      <li v-for="r in shown" :key="r.id" class="sr__item" data-testid="sr-item">
        <label>
          <input type="checkbox" :checked="picked.has(r.id)" :data-testid="'sr-chk-' + r.name" @change="toggle(r.id, ($event.target as HTMLInputElement).checked)" />
          <strong>{{ r.name }}</strong>
          <GnBadge v-if="isWslPath(r.path)" tone="neutral">{{ t('sw.mr.wsl') }}</GnBadge>
          <GnBadge v-if="r.id === activeId" tone="accent">{{ t('sw.mr.active') }}</GnBadge>
          <span class="sr__path">{{ r.path }}</span>
        </label>
      </li>
    </ul>
    <p v-if="!catalog.length" class="sr__muted" data-testid="sr-empty">{{ t('sw.mr.empty') }}</p>
    <p v-else-if="!shown.length" class="sr__muted" data-testid="sr-nomatch">{{ t('sw.mr.noMatch') }}</p>
  </div>
</template>

<style scoped lang="scss">
.sr { display: flex; flex-direction: column; gap: 8px; padding: 8px 14px 10px; background: var(--gn-surface-2); border-top: 1px solid var(--gn-border); border-bottom: 1px solid var(--gn-border); font-family: var(--gn-font-ui); }
.sr__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.sr__f { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--gn-muted); &--grow { flex: 1 1 240px; min-width: 0; } }
.sr__in { flex: 1; min-width: 0; font-family: var(--gn-mono); &--name { width: 150px; flex: none; } }
.sr__lbl { font-size: 12px; color: var(--gn-muted); }
.sr__n { margin-left: auto; font-size: 12px; color: var(--gn-muted); }
.sr__muted { font-size: 12px; color: var(--gn-muted); margin: 0; }
.sr__set { display: inline-flex; align-items: center; gap: 2px; }
.sr__list { list-style: none; margin: 0; padding: 0; max-height: 168px; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 2px 14px; }
.sr__item label { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 3px 4px; border-radius: var(--gn-radius-sm); cursor: pointer; font-size: 12.5px; &:hover { background: color-mix(in srgb, var(--gn-accent) 10%, transparent); } }
.sr__path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--gn-muted); font-family: var(--gn-mono); font-size: 11.5px; }
</style>
