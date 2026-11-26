import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { HistoryQuery, InProgressKind, RepositoryMeta } from '@git-nexus/git-core/pure';

/** A operação parada no meio de um repositório (a tela do repositório publica depois de cada leitura do status). */
export interface RepoOp {
  kind: InProgressKind | 'rebase' | null;
  /** Arquivos em conflito agora. */
  conflicts: number;
  step?: number;
  total?: number;
  branch?: string;
}

/** Uma aba é a tela inicial ou UM repositório; as visões do repositório ficam dentro da aba (`RepoViewKind`). */
export type TabKind = 'home' | 'repo';
/** As visões de um repositório: Staging (`repo`), Grafo / Histórico, Conflitos (`merge`) e Ferramentas. */
export type RepoViewKind = 'repo' | 'graph' | 'merge' | 'tools';
export const REPO_VIEWS: readonly RepoViewKind[] = ['repo', 'graph', 'tools', 'merge'];

export interface WorkspaceTab {
  id: string;
  kind: TabKind;
  repo?: RepositoryMeta;
  /** A visão que está na tela (só nas abas de repositório). */
  view?: RepoViewKind;
  /** A visão de antes da atual (para onde voltar quando "Conflitos" some). */
  prev?: RepoViewKind;
  /** As visões já abertas nesta aba: cada uma só é montada na primeira visita e depois mantém o estado (v-show). */
  visited?: RepoViewKind[];
}

export const HOME_TAB = 'home';
const VIEW_KEY = 'gitnexus.repoView.';

/** A visão que o repositório tinha na última vez (lembrada entre aberturas do app); `repo` (Staging) se não houver. */
export function rememberedView(repoId: string): RepoViewKind {
  try {
    const v = localStorage.getItem(VIEW_KEY + repoId);
    return v === 'graph' || v === 'tools' ? v : 'repo'; // "Conflitos" só existe enquanto há operação ou conflito: nunca é a visão lembrada
  } catch {
    return 'repo';
  }
}

export const tabIdOf = (repoId: string): string => `repo:${repoId}`;

export const useWorkspaceStore = defineStore('workspace', () => {
  const tabs = ref<WorkspaceTab[]>([{ id: HOME_TAB, kind: 'home' }]);
  const activeId = ref(HOME_TAB);
  /** Contador por repositório: incrementar força as abas daquele repo a recarregar. */
  const versions = ref<Record<string, number>>({});
  /** Operação em andamento e conflitos por repositório (a tela do repositório publica; o seletor, a faixa e o título da aba leem). */
  const ops = ref<Record<string, RepoOp>>({});
  /** A visão "Conflitos" existe só enquanto há operação parada (merge, rebase, cherry-pick, revert) ou arquivo em conflito. */
  const hasConflictView = (repoId: string): boolean => !!ops.value[repoId]?.kind || (ops.value[repoId]?.conflicts ?? 0) > 0;

  /** Pedido para a aba Ferramentas abrir numa seção (e arquivo) específicos, ex.: "Blame" a partir do menu. */
  const toolsTarget = ref<{ repoId: string; section: string; file?: string; mode?: string; n: number } | null>(null);

  /** Pedido para o grafo abrir já com uma busca na história (da janela de pesquisa, do editor ou da paleta); `n` sobe a cada pedido. */
  const historyTarget = ref<{ repoId: string; query: HistoryQuery; n: number } | null>(null);

  const active = computed(() => tabs.value.find((t) => t.id === activeId.value));
  /** A visão do repositório da aba ativa (`undefined` na tela inicial). */
  const activeView = computed(() => active.value?.view);

  /** Está na tela agora a visão `view` do repositório `repoId`? (as telas que reagem só quando visíveis usam isto) */
  const isViewActive = (repoId: string, view: RepoViewKind): boolean => activeId.value === tabIdOf(repoId) && tabs.value.find((t) => t.id === activeId.value)?.view === view;

  /** Põe a visão na tela da aba do repositório (cria a aba se preciso). Uma aba por repositório: trocar de visão nunca abre outra aba. */
  function open(view: RepoViewKind, repo: RepositoryMeta): void {
    const id = tabIdOf(repo.id);
    // a visão Staging sempre monta (mesmo escondida): é ela que lê o status e publica a operação em andamento, então um conflito criado fora do app aparece já na abertura
    if (!tabs.value.some((t) => t.id === id)) tabs.value.push({ id, kind: 'repo', repo, view, visited: ['repo'] });
    const tab = tabs.value.find((t) => t.id === id)!; // a versão reativa
    if (tab.view && tab.view !== view) tab.prev = tab.view;
    tab.view = view;
    if (!tab.visited!.includes(view)) tab.visited!.push(view);
    activeId.value = id;
    try {
      localStorage.setItem(VIEW_KEY + repo.id, view);
    } catch {
      /* sem armazenamento: só não lembra */
    }
  }

  /** Abre o repositório (da tela inicial ou da paleta) na visão em que ele estava da última vez. */
  function openRepo(repo: RepositoryMeta): void {
    const existing = tabs.value.find((t) => t.id === tabIdOf(repo.id));
    open(existing?.view ?? rememberedView(repo.id), repo);
  }

  function openTools(repo: RepositoryMeta, section?: string, file?: string, mode?: string): void {
    if (section) toolsTarget.value = { repoId: repo.id, section, file, mode, n: (toolsTarget.value?.n ?? 0) + 1 };
    open('tools', repo);
  }

  /** Abre o histórico do repositório já buscando `query` (texto, opções, máscaras, escopo, ou o trecho de um arquivo). */
  function openHistory(repo: RepositoryMeta, query: HistoryQuery): void {
    historyTarget.value = { repoId: repo.id, query, n: (historyTarget.value?.n ?? 0) + 1 };
    open('graph', repo);
  }

  /** Troca a visão dentro da aba ativa (atalhos e seletor). */
  function setView(view: RepoViewKind): void {
    const repo = active.value?.repo;
    if (repo) open(view, repo);
  }

  function close(id: string): void {
    if (id === HOME_TAB) return;
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx === -1) return;
    delete ops.value[tabs.value[idx]!.repo?.id ?? ''];
    tabs.value.splice(idx, 1);
    if (activeId.value === id) activeId.value = tabs.value[Math.min(idx, tabs.value.length - 1)]?.id ?? HOME_TAB;
  }

  /** Fecha a aba de um repositório (ex.: ao removê-lo do catálogo). */
  function closeRepo(repoId: string): void {
    close(tabIdOf(repoId));
  }

  function bump(repoId: string): void {
    versions.value[repoId] = (versions.value[repoId] ?? 0) + 1;
  }

  return { tabs, activeId, active, activeView, versions, ops, hasConflictView, toolsTarget, historyTarget, isViewActive, open, openRepo, openTools, openHistory, setView, close, closeRepo, bump };
});
