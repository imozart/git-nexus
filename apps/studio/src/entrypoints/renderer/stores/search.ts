import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { RepositoryMeta, SearchScope } from '@git-nexus/git-core/pure';

/** Onde procurar, vindo de quem abriu a janela ("Pesquisar neste arquivo / nesta pasta"): troca a máscara, a pasta e o escopo da janela. */
export interface SearchPreset {
  include?: string;
  folder?: string;
  scope?: SearchScope;
}

/** O arquivo aberto na janela e a seleção dele, para a paleta ("Quando isto entrou ou saiu?", "Histórico destas linhas"). `dirty`: há edição não salva (as linhas não valem na história). */
export interface SearchFileContext {
  repo: RepositoryMeta;
  /** Caminho relativo à raiz do repositório dono. */
  file: string;
  text: string;
  startLine: number;
  endLine: number;
  dirty: boolean;
}

/** A janela "Pesquisar no repositório" (Ctrl+F): quem a abre diz o repositório e, se houver, o texto que vira a busca (a seleção). */
export const useSearchStore = defineStore('search', () => {
  const isOpen = ref(false);
  const repo = ref<RepositoryMeta | null>(null);
  const seed = ref('');
  const preset = ref<SearchPreset | null>(null);
  /** Abriu pelo atalho de substituir (Ctrl+Shift+H): a janela já mostra a linha "Substituir por". */
  const replace = ref(false);
  /** Sobe a cada pedido de abrir: abrir de novo com a janela aberta (Ctrl+F outra vez) refoca e troca o texto. */
  const n = ref(0);
  /** Quem mostra um arquivo (a janela de pesquisa) registra aqui como ler o arquivo e a seleção do momento; sai quando a janela fecha. */
  const fileContext = ref<(() => SearchFileContext | null) | null>(null);

  function open(r: RepositoryMeta, seedText = '', where: SearchPreset | null = null, withReplace = false): void {
    repo.value = r;
    seed.value = seedText;
    preset.value = where;
    replace.value = withReplace;
    isOpen.value = true;
    n.value++;
  }
  function close(): void {
    isOpen.value = false;
  }
  return { isOpen, repo, seed, preset, replace, n, fileContext, open, close };
});
