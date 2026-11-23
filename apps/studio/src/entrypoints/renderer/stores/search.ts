import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { RepositoryMeta } from '@git-nexus/git-core/pure';

/** A janela "Pesquisar no repositório" (Ctrl+F): quem a abre diz o repositório e, se houver, o texto que vira a busca (a seleção). */
export const useSearchStore = defineStore('search', () => {
  const isOpen = ref(false);
  const repo = ref<RepositoryMeta | null>(null);
  const seed = ref('');
  /** Sobe a cada pedido de abrir: abrir de novo com a janela aberta (Ctrl+F outra vez) refoca e troca o texto. */
  const n = ref(0);

  function open(r: RepositoryMeta, seedText = ''): void {
    repo.value = r;
    seed.value = seedText;
    isOpen.value = true;
    n.value++;
  }
  function close(): void {
    isOpen.value = false;
  }
  return { isOpen, repo, seed, n, open, close };
});
