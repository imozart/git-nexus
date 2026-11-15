// Regra para o nome da branch de um PR: "tipo/descricao-em-minusculas", com o mesmo tipo do título do PR.
// Núcleo PURO, sem dependências. Os tipos são os do Conventional Commits (mais `hotfix`, que vale como `fix`).

import { BRANCH_TYPE, parseTitle } from './pr-labels.mjs';

export const MAX_BRANCH = 60;

/** Branches de bots e de release não seguem a regra (o nome vem da ferramenta). */
const EXEMPT = /^(dependabot|renovate|release)\//;

/** Prefixos aceitos, na ordem em que aparecem na mensagem de erro. */
export const BRANCH_PREFIXES = Object.keys(BRANCH_TYPE);

const FORMAT = new RegExp(`^(${BRANCH_PREFIXES.join('|')})/([a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?)$`);

/** Devolve `{ ok, errors }`; cada erro é uma frase pronta para o autor do PR. `title` é opcional (liga o tipo da branch ao do título). */
export function checkBranchName(branch, title) {
  const name = (branch ?? '').trim();
  if (!name) return { ok: false, errors: ['O nome da branch está vazio.'] };
  if (EXEMPT.test(name)) return { ok: true, errors: [] };

  const errors = [];
  const m = FORMAT.exec(name);
  if (!m) {
    errors.push(`Use "tipo/descricao-curta" em minúsculas, com o tipo entre: ${BRANCH_PREFIXES.join(', ')} (ex.: "feat/painel-de-log"). Letras minúsculas, números, ".", "_", "-" e "/" são aceitos.`);
  } else if (/\/\/|\.\./.test(name)) {
    errors.push('O nome não pode ter "//" nem "..".');
  }
  if (name.length > MAX_BRANCH) errors.push(`O nome tem ${name.length} caracteres; o máximo é ${MAX_BRANCH}.`);

  const fromTitle = parseTitle(title);
  if (m && fromTitle && BRANCH_TYPE[m[1]] !== fromTitle.type) {
    errors.push(`A branch é "${m[1]}/" mas o título do PR é do tipo "${fromTitle.type}": use o mesmo tipo nos dois (renomeie a branch ou ajuste o título).`);
  }
  return { ok: errors.length === 0, errors };
}
