// Quem pediu cada comando git (#289): o Log do Git separa "Minhas ações" do que o app faz por conta própria.
// Toda chamada do renderer entra por um método do worker; aqui se decide a origem dele, e o runner a leva até cada comando (AsyncLocalStorage).
import { withGitOrigin } from '@git-nexus/git-core';
import type { GitOrigin } from '@git-nexus/git-core/pure';

/**
 * Métodos que o app chama SOZINHO para manter a tela em dia ou para responder enquanto se digita (status, listas dos painéis, resumo da tela inicial,
 * buscas, o que o repositório usa). Tudo o mais (commit, checkout, o diff de um arquivo que se clicou, blame, detalhe de commit...) é ação da pessoa.
 * Um comando que ALTERA o repositório aparece em "Minhas ações" de qualquer jeito, qualquer que seja a origem.
 */
export const BACKGROUND_METHODS: ReadonlySet<string> = new Set([
  'getGitStatus', 'getInProgress', 'getRebaseState', 'getRepoSummary', 'listBranches', 'compareWithBase', 'getSyncCommits', 'getAmendInfo',
  'getHistory', 'getHistoryCount', 'getAuthors', 'listStashes', 'listTags', 'getOperations', 'getRepoPolicy', 'getReleaseInfo', 'getMergeConflicts', 'getResolvedConflictFiles', 'getRerereState',
  'getSigningInfo', 'getGitConfig', 'getLfsInfo', 'getToolsUsage', 'getSubmodules', 'getFileEncoding', 'listTrackedFiles',
  'startSearch', 'startMultiSearch', 'startHistorySearch', 'searchHistory', 'getSearchIndex', 'controlSearchIndex', 'configureSearchIndex',
]);

/** De quem é a chamada: a busca/atualização automática (`silent`) é de segundo plano; os métodos de `BACKGROUND_METHODS` também. */
export function originOf(method: string, args: readonly unknown[]): GitOrigin {
  if (BACKGROUND_METHODS.has(method)) return 'background';
  if ((method === 'fetchRepo' || method === 'pullRepo') && args[1] === true) return 'background';
  return 'user';
}

/** Os mesmos métodos, cada um rodando com a origem certa para os comandos git que dispara. */
export function withOrigins<T extends Record<string, (...args: any[]) => any>>(methods: T): T {
  const out: Record<string, (...args: any[]) => any> = {};
  for (const [name, fn] of Object.entries(methods)) out[name] = (...args: any[]) => withGitOrigin(originOf(name, args), () => fn(...args));
  return out as T;
}
