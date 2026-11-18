// Pedidos de credencial do git/ssh (usuário, senha, token, frase-senha): fila de pedidos e a resposta de volta. A resposta só passa por aqui,
// em memória: nunca vai para log, localStorage nem para o histórico de comandos.
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AskpassRequest } from '@git-nexus/git-core/pure';
import { api } from '../api';

export const useAskpassStore = defineStore('askpass', () => {
  const queue = ref<AskpassRequest[]>([]);
  const current = computed(() => queue.value[0] ?? null);
  let off: (() => void) | undefined;

  /** Passa a ouvir os pedidos (uma vez só; sem a ponte, por exemplo nos testes de unidade, não faz nada). */
  function listen(): void {
    if (off || typeof api?.onAskpassRequest !== 'function') return;
    off = api.onAskpassRequest((r) => queue.value.push(r));
  }

  /** Responde ao pedido da vez (`null` = cancelou) e passa ao próximo. */
  async function answer(value: string | null): Promise<void> {
    const r = queue.value.shift();
    if (!r) return;
    await api.askpassAnswer(r.id, value).catch(() => undefined);
  }

  return { queue, current, listen, answer };
});
