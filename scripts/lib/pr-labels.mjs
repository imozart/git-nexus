// Labels de TIPO de um PR, deduzidas do título (Conventional Commits) e, se o título não ajudar, do prefixo da branch.
// Núcleo PURO, sem dependências. As labels em si vivem em .github/labels.json.

/** Tipo do Conventional Commits -> label do repositório. */
export const TYPE_LABEL = {
  feat: 'enhancement',
  fix: 'bug',
  docs: 'documentation',
  perf: 'performance',
  refactor: 'refatoração',
  test: 'testes',
  build: 'build',
  ci: 'ci',
  style: 'estilo',
  chore: 'chore',
  revert: 'reversão',
};

export const BREAKING_LABEL = 'breaking change';

/** Prefixo da branch -> tipo. `hotfix/` conta como correção. */
export const BRANCH_TYPE = { feat: 'feat', fix: 'fix', hotfix: 'fix', perf: 'perf', refactor: 'refactor', docs: 'docs', test: 'test', build: 'build', ci: 'ci', style: 'style', chore: 'chore', revert: 'revert' };

/** Todas as labels que esta automação gerencia: só estas são removidas quando deixam de valer. */
export const MANAGED = [...new Set(Object.values(TYPE_LABEL)), BREAKING_LABEL];

const TITLE = /^([a-z]+)(?:\([^()]*\))?(!)?:/;

/** `{ type, breaking }` do título, ou `null` se não segue o formato com um tipo conhecido. */
export function parseTitle(title) {
  const m = TITLE.exec((title ?? '').trim());
  if (!m || !(m[1] in TYPE_LABEL)) return null;
  return { type: m[1], breaking: Boolean(m[2]) };
}

/** Tipo pelo prefixo da branch (`feat/algo` -> `feat`), ou `null`. */
export function typeFromBranch(branch) {
  const prefix = /^([a-z]+)\//.exec(branch ?? '')?.[1];
  return prefix && prefix in BRANCH_TYPE ? BRANCH_TYPE[prefix] : null;
}

/** Labels de tipo que o PR deve ter: o título manda; sem tipo válido nele, vale o prefixo da branch. */
export function desiredTypeLabels({ title, branch, body }) {
  const fromTitle = parseTitle(title);
  const type = fromTitle?.type ?? typeFromBranch(branch);
  const labels = type ? [TYPE_LABEL[type]] : [];
  if (fromTitle?.breaking || /^BREAKING[ -]CHANGE:/m.test(body ?? '')) labels.push(BREAKING_LABEL);
  return labels;
}

/** O que adicionar e remover para o PR ficar com `desired` dentro do grupo `managed`; labels de fora do grupo nunca são tocadas. */
export function diffLabels(current, desired, managed = MANAGED) {
  const have = new Set(current);
  const want = new Set(desired);
  return {
    add: [...want].filter((l) => !have.has(l)),
    remove: [...have].filter((l) => managed.includes(l) && !want.has(l)),
  };
}
