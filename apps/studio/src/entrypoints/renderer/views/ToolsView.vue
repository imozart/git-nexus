<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { GnTabs, type GnTab } from '@git-nexus/ui-kit';
import type { RepositoryMeta } from '@git-nexus/git-core/pure';
import OperationsPanel from '../components/tools/OperationsPanel.vue';
import StashPanel from '../components/tools/StashPanel.vue';
import FilePanel from '../components/tools/FilePanel.vue';
import RebasePanel from '../components/tools/RebasePanel.vue';
import VersionPanel from '../components/tools/VersionPanel.vue';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ repo: RepositoryMeta }>();
const ws = useWorkspaceStore();

/** Seções da aba "Ferramentas". Cada painel recebe `repo` e se atualiza sozinho ao ficar visível. */
const SECTIONS: Array<{ id: string; title: string; component: Component }> = [
  { id: 'ops', title: 'Operações', component: OperationsPanel },
  { id: 'stash', title: 'Stash', component: StashPanel },
  { id: 'file', title: 'Arquivo (histórico e blame)', component: FilePanel },
  { id: 'rebase', title: 'Rebase interativo', component: RebasePanel },
  { id: 'version', title: 'Versão e changelog', component: VersionPanel },
];

const KEY = 'gitnexus.toolsSection';
const current = ref(SECTIONS.some((s) => s.id === localStorage.getItem(KEY)) ? localStorage.getItem(KEY)! : SECTIONS[0]!.id);
const tabs = computed<GnTab[]>(() => SECTIONS.map((s) => ({ id: s.id, title: s.title })));
const section = computed(() => SECTIONS.find((s) => s.id === current.value)!);
// pedido externo (menu "Histórico do arquivo" / "Blame"): troca de seção
watch(
  () => ws.toolsTarget,
  (t) => {
    if (t && t.repoId === props.repo.id && SECTIONS.some((s) => s.id === t.section)) select(t.section);
  },
  { immediate: true },
);
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
