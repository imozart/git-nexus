<script setup lang="ts">
// O seletor de visão de um repositório (uma aba por repositório): Staging, Grafo / Histórico, Ferramentas e Conflitos. É um `tablist`: setas, Home e End
// trocam de visão e levam o foco; só a visão ativa entra na ordem do Tab. A contagem de conflitos aparece em texto, não só em cor.
import { computed } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import type { RepositoryMeta } from '@git-nexus/git-core/pure';
import { t } from '../i18n';
import { REPO_VIEWS, type RepoViewKind } from '../stores/workspace';

const props = defineProps<{ repo: RepositoryMeta; view: RepoViewKind; conflicts: number }>();
const emit = defineEmits<{ select: [view: RepoViewKind] }>();

/** O id do painel de cada visão (o `aria-controls` do botão e o `aria-labelledby` do painel usam o mesmo). */
const panelId = (v: RepoViewKind): string => `rvp-${props.repo.id}-${v}`;
const tabId = (v: RepoViewKind): string => `rvt-${props.repo.id}-${v}`;

const items = computed(() =>
  REPO_VIEWS.map((v) => ({
    view: v,
    label: v === 'repo' ? t('tab.staging') : v === 'graph' ? t('rv.graph') : v === 'tools' ? t('rv.tools') : t('rv.conflicts'),
  })),
);

function onKey(e: KeyboardEvent, i: number): void {
  const n = items.value.length;
  const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  emit('select', items.value[to]!.view);
  ((e.currentTarget as HTMLElement).parentElement?.children[to] as HTMLElement | undefined)?.focus();
}
defineExpose({ panelId });
</script>

<template>
  <div class="rvs" role="tablist" :aria-label="t('rvs.label')" data-testid="repo-views">
    <GnButton
      v-for="(it, i) in items"
      :id="tabId(it.view)"
      :key="it.view"
      size="sm"
      variant="ghost"
      role="tab"
      class="rvs__tab"
      :class="{ 'rvs__tab--on': it.view === view, 'rvs__tab--warn': it.view === 'merge' && conflicts > 0 }"
      :aria-selected="it.view === view"
      :aria-controls="panelId(it.view)"
      :tabindex="it.view === view ? 0 : -1"
      :data-view="it.view"
      data-testid="repo-view-tab"
      @click="emit('select', it.view)"
      @keydown="onKey($event, i)"
    >
      {{ it.label }}<span v-if="it.view === 'merge' && conflicts > 0" class="rvs__n"> ({{ conflicts }})</span>
    </GnButton>
  </div>
</template>

<style scoped lang="scss">
.rvs { display: flex; gap: 2px; padding: 4px 10px 0; background: var(--gn-bg); border-bottom: 1px solid var(--gn-border); }
// .gn-btn junto: ganha do estilo do botão sem !important
.rvs .rvs__tab.gn-btn {
  font: inherit;
  font-size: 12.5px;
  padding: 5px 12px;
  color: var(--gn-muted);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  // a ativa não depende só de cor: fundo, borda e uma barra por baixo
  &:hover { color: var(--gn-text); background: var(--gn-surface-2); }
  &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: -2px; }
}
.rvs .rvs__tab--warn.gn-btn { color: var(--gn-warn, #d6a23a); }
.rvs .rvs__tab--on.gn-btn { color: var(--gn-text); font-weight: 600; background: var(--gn-surface); border-color: var(--gn-border); box-shadow: inset 0 -2px 0 var(--gn-accent); margin-bottom: -1px; }
</style>
