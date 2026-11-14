<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { GnTabs, type GnTab } from '@git-nexus/ui-kit';
import type { RepositoryMeta } from '@git-nexus/git-core/pure';
import OperationsPanel from '../components/tools/OperationsPanel.vue';

defineProps<{ repo: RepositoryMeta }>();

/** Seções da aba "Ferramentas". Cada painel recebe `repo` e se atualiza sozinho ao ficar visível. */
const SECTIONS: Array<{ id: string; title: string; component: Component }> = [
  { id: 'ops', title: 'Operações', component: OperationsPanel },
];

const KEY = 'gitnexus.toolsSection';
const current = ref(SECTIONS.some((s) => s.id === localStorage.getItem(KEY)) ? localStorage.getItem(KEY)! : SECTIONS[0]!.id);
const tabs = computed<GnTab[]>(() => SECTIONS.map((s) => ({ id: s.id, title: s.title })));
const section = computed(() => SECTIONS.find((s) => s.id === current.value)!);
function select(id: string): void {
  current.value = id;
  localStorage.setItem(KEY, id);
}
</script>

<template>
  <div class="tools">
    <GnTabs :tabs="tabs" :model-value="current" @update:model-value="select" />
    <div class="tools__body">
      <component :is="section.component" :key="section.id" :repo="repo" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.tools {
  display: flex;
  flex-direction: column;
  height: 100%;
  &__body { flex: 1; min-height: 0; overflow: auto; }
}
</style>
