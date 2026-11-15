// Parte PURA do log do Git (sem Vue nem `window`), para poder ser testada.
import type { GitCommandEvent } from '@git-nexus/git-core/pure';

/** Máximo de comandos guardados por repositório (os mais antigos saem primeiro). */
export const MAX_ENTRIES = 500;

/** Mesmo repositório com barras/maiúsculas diferentes (C:\x\ e c:/x) cai na mesma chave. */
export const repoKey = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Junta eventos novos aos existentes, respeitando o limite. */
export function appendEvents(current: readonly GitCommandEvent[], incoming: readonly GitCommandEvent[], max = MAX_ENTRIES): GitCommandEvent[] {
  const all = [...current, ...incoming];
  return all.length > max ? all.slice(all.length - max) : all;
}
