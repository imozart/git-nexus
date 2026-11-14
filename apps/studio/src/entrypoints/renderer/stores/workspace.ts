import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { RepositoryMeta } from '@git-nexus/git-core/pure';

export type TabKind = 'home' | 'repo' | 'graph' | 'merge' | 'tools';

export interface WorkspaceTab {
  id: string;
  kind: TabKind;
  repo?: RepositoryMeta;
}

export const HOME_TAB = 'home';

export const useWorkspaceStore = defineStore('workspace', () => {
  const tabs = ref<WorkspaceTab[]>([{ id: HOME_TAB, kind: 'home' }]);
  const activeId = ref(HOME_TAB);
  /** Contador por repositório: incrementar força as abas daquele repo a recarregar. */
  const versions = ref<Record<string, number>>({});

  const active = computed(() => tabs.value.find((t) => t.id === activeId.value));

  function open(kind: Exclude<TabKind, 'home'>, repo: RepositoryMeta): void {
    const id = `${kind}:${repo.id}`;
    if (!tabs.value.some((t) => t.id === id)) tabs.value.push({ id, kind, repo });
    activeId.value = id;
  }

  function close(id: string): void {
    if (id === HOME_TAB) return;
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx === -1) return;
    tabs.value.splice(idx, 1);
    if (activeId.value === id) activeId.value = tabs.value[Math.min(idx, tabs.value.length - 1)]?.id ?? HOME_TAB;
  }

  /** Fecha todas as abas de um repositório (ex.: ao removê-lo do catálogo). */
  function closeRepo(repoId: string): void {
    for (const t of [...tabs.value]) if (t.repo?.id === repoId) close(t.id);
  }

  function bump(repoId: string): void {
    versions.value[repoId] = (versions.value[repoId] ?? 0) + 1;
  }

  return { tabs, activeId, active, versions, open, close, closeRepo, bump };
});
