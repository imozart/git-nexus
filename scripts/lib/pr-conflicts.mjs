// Decide a label "conflito" de um PR a partir do campo `mergeable` do GitHub. Núcleo PURO, sem dependências.
//   MERGEABLE   -> sem conflito
//   CONFLICTING -> conflito com a branch de destino
//   UNKNOWN     -> o GitHub ainda está calculando (acontece logo depois de um push na main): tentar de novo

export const CONFLICT_LABEL = 'conflito';

/** `'add'` | `'remove'` | `'none'` | `'retry'` para um PR com o `mergeable` e as labels atuais. */
export function conflictAction(mergeable, labels) {
  const has = labels.includes(CONFLICT_LABEL);
  if (mergeable === 'CONFLICTING') return has ? 'none' : 'add';
  if (mergeable === 'MERGEABLE') return has ? 'remove' : 'none';
  return 'retry';
}
