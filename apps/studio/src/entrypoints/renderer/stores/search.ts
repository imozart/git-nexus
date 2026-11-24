import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { RepositoryMeta, SearchScope } from '@git-nexus/git-core/pure';

/** Onde procurar, vindo de quem abriu a janela ("Pesquisar neste arquivo / nesta pasta"): troca a máscara, a pasta e o escopo da janela. */
export interface SearchPreset {
  include?: string;
  folder?: string;
  scope?: SearchScope;
}

/** A janela "Pesquisar no repositório" (Ctrl+F): quem a abre diz o repositório e, se houver, o texto que vira a busca (a seleção). */
export const useSearchStore = defineStore('search', () => {
  const isOpen = ref(false);
  const repo = ref<RepositoryMeta | null>(null);
  const seed = ref('');
  const preset = ref<SearchPreset | null>(null);
  /** Sobe a cada pedido de abrir: abrir de novo com a janela aberta (Ctrl+F outra vez) refoca e troca o texto. */
  const n = ref(0);

  function open(r: RepositoryMeta, seedText = '', where: SearchPreset | null = null): void {
    repo.value = r;
    seed.value = seedText;
    preset.value = where;
    isOpen.value = true;
    n.value++;
  }
  function close(): void {
    isOpen.value = false;
  }
  return { isOpen, repo, seed, preset, n, open, close };
});
