<script setup lang="ts">
// Os filtros da janela de pesquisa (recolhidos por padrão): onde procurar (repositório, versionados, alterados, stage, branch/tag/commit), pasta,
// submódulos, ignorados, novos, linhas de contexto e como agrupar o resultado. É só o formulário: quem pesquisa é a janela.
import { computed, ref, watch } from 'vue';
import { GnSegmented } from '@git-nexus/ui-kit';
import { api } from '../api';
import { t } from '../i18n';
import type { Filters } from '../search-filters-core';
import ComboBox from './ComboBox.vue';

const props = defineProps<{ modelValue: Filters; repoPath: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: Filters): void }>();

const set = <K extends keyof Filters>(k: K, v: Filters[K]): void => emit('update:modelValue', { ...props.modelValue, [k]: v });
const f = computed(() => props.modelValue);

const scopeOptions = computed(() => (['worktree', 'tracked', 'changed', 'staged', 'revision'] as const).map((value) => ({ value, label: t(`sw.scope.${value}`) })));
const groupOptions = computed(() => (['file', 'folder', 'flat'] as const).map((value) => ({ value, label: t(`sw.group.${value}`) })));
const contextOptions = [0, 1, 2, 3, 4, 5].map((value) => ({ value, label: String(value) }));

/** Branches e tags para sugerir na revisão (lidos só quando o escopo "branch, tag ou commit" é escolhido). */
const refs = ref<string[]>([]);
let loaded = '';
watch(
  () => f.value.scope === 'revision',
  async (on) => {
    if (!on || loaded === props.repoPath) return;
    loaded = props.repoPath;
    try {
      const [b, tags] = await Promise.all([api.listBranches(props.repoPath), api.listTags(props.repoPath)]);
      refs.value = [...b.locals.map((x) => x.name), ...b.remotes.map((x) => x.name), ...tags.map((x) => x.name)];
    } catch {
      refs.value = []; // sem sugestões: a pessoa digita o nome ou o hash
    }
  },
  { immediate: true },
);
</script>

<template>
  <div id="sw-filters" class="sf" role="group" :aria-label="t('sw.filtersLabel')" data-testid="sw-filters">
    <div class="sf__row">
      <div class="sf__f">
        <span>{{ t('sw.where') }}</span>
        <ComboBox :model-value="f.scope" :options="scopeOptions" :aria-label="t('sw.where')" data-testid="sw-scope" @update:model-value="set('scope', $event as Filters['scope'])" />
      </div>
      <div v-if="f.scope === 'revision'" class="sf__f sf__f--grow">
        <span>{{ t('sw.revision') }}</span>
        <ComboBox :model-value="f.revision" searchable mono :options="refs" :placeholder="t('sw.revisionPh')" :aria-label="t('sw.revision')" data-testid="sw-revision" @update:model-value="set('revision', $event)" />
      </div>
      <label class="sf__f sf__f--grow">
        <span>{{ t('sw.folder') }}</span>
        <input class="sf__in" :value="f.folder" :placeholder="t('sw.folderPh')" :aria-label="t('sw.folder')" spellcheck="false" autocomplete="off" data-testid="sw-folder" @input="set('folder', ($event.target as HTMLInputElement).value)" />
      </label>
    </div>
    <div class="sf__row">
      <label class="sf__chk"><input type="checkbox" :checked="f.includeUntracked" data-testid="sw-untracked" @change="set('includeUntracked', ($event.target as HTMLInputElement).checked)" /> {{ t('sw.untracked') }}</label>
      <label class="sf__chk"><input type="checkbox" :checked="f.includeIgnored" data-testid="sw-ignored" @change="set('includeIgnored', ($event.target as HTMLInputElement).checked)" /> {{ t('sw.ignored') }}</label>
      <label class="sf__chk"><input type="checkbox" :checked="f.includeSubmodules" data-testid="sw-submodules" @change="set('includeSubmodules', ($event.target as HTMLInputElement).checked)" /> {{ t('sw.submodules') }}</label>
    </div>
    <div class="sf__row">
      <div class="sf__f">
        <span>{{ t('sw.context') }}</span>
        <GnSegmented :model-value="f.context" :options="contextOptions" :aria-label="t('sw.context')" data-testid="sw-context" @update:model-value="set('context', $event)" />
      </div>
      <div class="sf__f">
        <span>{{ t('sw.group') }}</span>
        <GnSegmented :model-value="f.group" :options="groupOptions" :aria-label="t('sw.group')" data-testid="sw-group" @update:model-value="set('group', $event)" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.sf { display: flex; flex-direction: column; gap: 8px; padding: 8px 14px 10px; background: var(--gn-surface-2); border-top: 1px solid var(--gn-border); border-bottom: 1px solid var(--gn-border); font-family: var(--gn-font-ui); }
.sf__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; }
.sf__f { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--gn-muted); &--grow { flex: 1 1 240px; min-width: 0; } }
.sf__in { flex: 1; min-width: 0; font-family: var(--gn-mono); }
.sf__chk { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--gn-text); cursor: pointer; }
</style>
