// Log dos comandos git executados pelo app, por repositório (aba "Log" na parte de baixo da tela do repositório).
import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { GitCommandEvent } from '@git-nexus/git-core/pure';
import { api } from '../api';
import { appendEvents, isError, isMine, parseMax, repoKey } from '../gitlog-core';

export const MAX_KEY = 'gitnexus.gitLogMax';
import { useWorkspaceStore } from './workspace';

export const useGitLogStore = defineStore('gitlog', () => {
  const ws = useWorkspaceStore();
  const byRepo = shallowRef<Record<string, GitCommandEvent[]>>({});
  /** Total de AÇÕES da pessoa (e do que altera o repositório) por repositório (o contador do rodapé), mesmo depois de o limite descartar os antigos. */
  const totals = ref<Record<string, number>>({});
  /** Total do que o app fez por conta própria (consultas de segundo plano): o segundo número, discreto. */
  const bgTotals = ref<Record<string, number>>({});
  /** Erros que chegaram desde a última vez que o log foi aberto: o ponto no rodapé. */
  const unseen = ref<Record<string, number>>({});
  let off: (() => void) | undefined;

  /** Passa a ouvir o processo principal. Só guarda o que é de repositórios com aba aberta. */
  function start(): void {
    if (off || typeof api.onGitCommand !== 'function') return;
    off = api.onGitCommand((events) => {
      const open = new Set(ws.tabs.filter((t) => t.repo).map((t) => repoKey(t.repo!.path)));
      const next = { ...byRepo.value };
      const counts = { ...totals.value };
      const bg = { ...bgTotals.value };
      const errs = { ...unseen.value };
      let changed = false;
      for (const e of events) {
        const k = repoKey(e.repoPath);
        if (!open.has(k)) continue;
        next[k] = appendEvents(next[k] ?? [], [e], parseMax(localStorage.getItem(MAX_KEY)));
        if (isMine(e)) counts[k] = (counts[k] ?? 0) + 1;
        else bg[k] = (bg[k] ?? 0) + 1;
        if (isError(e)) errs[k] = (errs[k] ?? 0) + 1;
        changed = true;
      }
      if (changed) {
        byRepo.value = next;
        totals.value = counts;
        bgTotals.value = bg;
        unseen.value = errs;
      }
    });
  }

  const entries = (repoPath: string) => byRepo.value[repoKey(repoPath)] ?? [];
  const total = (repoPath: string) => totals.value[repoKey(repoPath)] ?? 0;
  const backgroundTotal = (repoPath: string) => bgTotals.value[repoKey(repoPath)] ?? 0;
  const unseenErrors = (repoPath: string) => unseen.value[repoKey(repoPath)] ?? 0;
  /** O log foi aberto: os erros que havia deixam de ser "novos". */
  function markSeen(repoPath: string): void {
    const k = repoKey(repoPath);
    if (unseen.value[k]) unseen.value = { ...unseen.value, [k]: 0 };
  }
  function clear(repoPath: string): void {
    const k = repoKey(repoPath);
    byRepo.value = { ...byRepo.value, [k]: [] };
    totals.value = { ...totals.value, [k]: 0 };
    bgTotals.value = { ...bgTotals.value, [k]: 0 };
    unseen.value = { ...unseen.value, [k]: 0 };
  }

  return { start, entries, total, backgroundTotal, unseenErrors, markSeen, clear };
});
