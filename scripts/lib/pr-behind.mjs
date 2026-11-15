// Label "desatualizada": o PR não tem commits que já estão na main. Núcleo PURO, sem dependências.
//
// Contam só os commits que trazem conteúdo novo. Ficam de fora:
//   - commits de merge: o conteúdo deles já aparece nos commits que eles juntaram (e, em uma pilha de PRs, o merge do PR de baixo
//     deixaria todos os de cima "atrasados" por causa de um commit que não traz nada que eles não tenham);
//   - o commit `chore(release)` que o pipeline grava depois de cada release (versão e changelog): sem isto todo PR ficaria
//     marcado a cada release.

export const BEHIND_LABEL = 'desatualizada';

const RELEASE_SUBJECT = /^chore\(release\):/;

/** `commits`: `[{ parents: número de pais, subject: primeira linha da mensagem }]` dos commits da main que o PR não tem. */
export function behindCount(commits) {
  return commits.filter((c) => c.parents <= 1 && !RELEASE_SUBJECT.test(c.subject)).length;
}

/** `'add'` | `'remove'` | `'none'` para a label, dado quantos commits novos a main tem que o PR não tem. */
export function behindAction(count, labels) {
  const has = labels.includes(BEHIND_LABEL);
  if (count > 0) return has ? 'none' : 'add';
  return has ? 'remove' : 'none';
}
