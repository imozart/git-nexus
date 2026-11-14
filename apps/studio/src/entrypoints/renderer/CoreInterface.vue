<script setup lang="ts">
import { computed } from 'vue';
import { GnTabs, type GnTab } from '@git-nexus/ui-kit';
import { HOME_TAB, useWorkspaceStore } from './stores/workspace';
import ConnectionInterface from './views/ConnectionInterface.vue';
import RepoView from './views/RepoView.vue';
import GraphView from './views/GraphView.vue';
import MergeView from './views/MergeView.vue';
import ToolsView from './views/ToolsView.vue';

const ws = useWorkspaceStore();

const LABEL = { repo: 'Staging', graph: 'Grafo', merge: 'Conflitos', tools: 'Ferramentas' } as const;

const tabs = computed<GnTab[]>(() =>
  ws.tabs.map((t) =>
    t.kind === 'home'
      ? { id: t.id, title: 'Repositórios' }
      : { id: t.id, title: t.repo?.name ?? '?', subtitle: LABEL[t.kind], closable: true },
  ),
);
</script>

<template>
  <div class="core">
    <GnTabs :tabs="tabs" :model-value="ws.activeId" @update:model-value="ws.activeId = $event" @close="ws.close" />
    <div class="core__panes">
      <!-- v-show: mantém o estado (editor, seleção, rascunho do commit) ao alternar entre abas -->
      <section v-for="t in ws.tabs" v-show="t.id === ws.activeId" :key="t.id" class="core__pane">
        <ConnectionInterface v-if="t.id === HOME_TAB" />
        <RepoView v-else-if="t.kind === 'repo' && t.repo" :repo="t.repo" />
        <GraphView v-else-if="t.kind === 'graph' && t.repo" :repo="t.repo" />
        <MergeView v-else-if="t.kind === 'merge' && t.repo" :repo="t.repo" />
        <ToolsView v-else-if="t.kind === 'tools' && t.repo" :repo="t.repo" />
      </section>
    </div>
  </div>
</template>

<style scoped lang="scss">
.core {
  display: flex;
  flex-direction: column;
  height: 100%;
  &__panes { flex: 1; min-height: 0; background: var(--gn-surface); }
  &__pane { height: 100%; overflow: auto; }
}
</style>
