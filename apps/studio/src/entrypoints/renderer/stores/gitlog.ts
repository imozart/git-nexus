// Log dos comandos git executados pelo app, por repositório (aba "Log" na parte de baixo da tela do repositório).
import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { GitCommandEvent } from '@git-nexus/git-core/pure';
import { api } from '../api';
import { appendEvents, repoKey } from '../gitlog-core';
import { useWorkspaceStore } from './workspace';

export const useGitLogStore = defineStore('gitlog', () => {
  const ws = useWorkspaceStore();
  const byRepo = shallowRef<Record<string, GitCommandEvent[]>>({});
  /** Total de comandos recebidos por repositório (o badge do botão), mesmo depois de o limite descartar os antigos. */
  const totals = ref<Record<string, number>>({});
  let off: (() => void) | undefined;

  /** Passa a ouvir o processo principal. Só guarda o que é de repositórios com aba aberta. */
  function start(): void {
    if (off || typeof api.onGitCommand !== 'function') return;
    off = api.onGitCommand((events) => {
      const open = new Set(ws.tabs.filter((t) => t.repo).map((t) => repoKey(t.repo!.path)));
      const next = { ...byRepo.value };
      const counts = { ...totals.value };
      let changed = false;
      for (const e of events) {
        const k = repoKey(e.repoPath);
        if (!open.has(k)) continue;
        next[k] = appendEvents(next[k] ?? [], [e]);
        counts[k] = (counts[k] ?? 0) + 1;
        changed = true;
      }
      if (changed) {
        byRepo.value = next;
        totals.value = counts;
      }
    });
  }

  const entries = (repoPath: string) => byRepo.value[repoKey(repoPath)] ?? [];
  const total = (repoPath: string) => totals.value[repoKey(repoPath)] ?? 0;
  function clear(repoPath: string): void {
    const k = repoKey(repoPath);
    byRepo.value = { ...byRepo.value, [k]: [] };
    totals.value = { ...totals.value, [k]: 0 };
  }

  return { start, entries, total, clear };
});
