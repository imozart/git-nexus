// Dicas contextuais (#288): no máximo UMA por sessão (do app aberto), cada uma com "Não mostrar mais" (para sempre) e fechar (só esta vez).
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { RepositoryMeta } from '@git-nexus/git-core/pure';
import { api } from '../api';
import type { MessageKey } from '../i18n';
import { TIPS_DISMISSED_KEY, canShowTip, isStashForgotten, oldestStashDays, parseDismissed } from '../tips-core';

export interface Tip {
  id: string;
  /** Em que repositório a dica aparece (ela é sobre ele). */
  repoId: string;
  text: MessageKey;
  vars?: Record<string, string | number>;
  /** O que a dica sugere fazer (um botão), se houver. */
  action?: { label: MessageKey; run: () => void };
}

export const useTipsStore = defineStore('tips', () => {
  const dismissed = ref<string[]>(parseDismissed(typeof localStorage === 'undefined' ? null : localStorage.getItem(TIPS_DISMISSED_KEY)));
  const shownThisSession = ref(false);
  const current = ref<Tip | null>(null);
  /** Repositórios já avaliados nesta sessão (não consulta o Git de novo a cada aba). */
  const checked = new Set<string>();

  /** Mostra a dica se as regras deixam; devolve se mostrou. */
  function offer(tip: Tip): boolean {
    if (!canShowTip(tip.id, dismissed.value, shownThisSession.value)) return false;
    shownThisSession.value = true;
    current.value = tip;
    return true;
  }
  /** Fechar: some agora e não volta nesta sessão (a de uma por sessão já está gasta); numa próxima vez, volta. */
  const close = (): void => {
    current.value = null;
  };
  /** "Não mostrar mais": nunca mais esta dica. */
  function dismissForever(): void {
    if (current.value && !dismissed.value.includes(current.value.id)) {
      dismissed.value = [...dismissed.value, current.value.id];
      try {
        localStorage.setItem(TIPS_DISMISSED_KEY, JSON.stringify(dismissed.value));
      } catch {
        /* sem armazenamento: vale só nesta sessão */
      }
    }
    current.value = null;
  }

  /** Avalia as situações do repositório (uma vez por sessão) e oferece a dica que couber. Só consulta o Git se há stash (a contagem sai de um arquivo). */
  async function evaluate(repo: RepositoryMeta, openStash: () => void, now = Date.now()): Promise<void> {
    if (checked.has(repo.id) || shownThisSession.value) return;
    checked.add(repo.id);
    try {
      const usage = await api.getToolsUsage(repo.path);
      if (!usage.stash) return;
      const days = oldestStashDays(await api.listStashes(repo.path), now);
      if (isStashForgotten(days)) offer({ id: 'stash-forgotten', repoId: repo.id, text: 'tip.stash', vars: { days: days! }, action: { label: 'tip.stashOpen', run: openStash } });
    } catch {
      /* uma dica nunca atrapalha: sem a informação, não há dica */
    }
  }

  return { current, dismissed, shownThisSession, offer, close, dismissForever, evaluate };
});
