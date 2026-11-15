// Catálogo de labels do repositório (.github/labels.json) e o plano de sincronização. Núcleo PURO, sem dependências.
// A sincronização só CRIA e ATUALIZA: nunca apaga uma label (as que não estão no catálogo continuam valendo).

const HEX = /^[0-9a-f]{6}$/i;
/** Limites da API do GitHub. */
export const MAX_NAME = 50;
export const MAX_DESCRIPTION = 100;

/** Confere o catálogo; devolve a lista de problemas (vazia = válido). */
export function validateCatalog(catalog) {
  const problems = [];
  if (!Array.isArray(catalog)) return ['O catálogo precisa ser uma lista.'];
  const seen = new Set();
  for (const [i, l] of catalog.entries()) {
    const at = `Item ${i + 1}${l?.name ? ` ("${l.name}")` : ''}`;
    if (typeof l?.name !== 'string' || !l.name.trim()) {
      problems.push(`${at}: falta o nome.`);
      continue;
    }
    if (l.name.length > MAX_NAME) problems.push(`${at}: o nome passa de ${MAX_NAME} caracteres.`);
    const key = l.name.toLowerCase();
    if (seen.has(key)) problems.push(`${at}: nome repetido (o GitHub ignora maiúsculas e minúsculas).`);
    seen.add(key);
    if (typeof l.color !== 'string' || !HEX.test(l.color)) problems.push(`${at}: a cor precisa ter 6 dígitos hexadecimais, sem "#".`);
    if (typeof l.description !== 'string' || !l.description.trim()) problems.push(`${at}: falta a descrição.`);
    else if (l.description.length > MAX_DESCRIPTION) problems.push(`${at}: a descrição passa de ${MAX_DESCRIPTION} caracteres.`);
  }
  return problems;
}

/**
 * Compara o que existe no repositório com o catálogo.
 * `existing`: `[{ name, color, description }]` (saída do `gh label list`). Devolve `{ create, update, same }`.
 */
export function planLabels(existing, desired) {
  const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l]));
  const create = [];
  const update = [];
  const same = [];
  for (const want of desired) {
    const have = byName.get(want.name.toLowerCase());
    if (!have) create.push(want);
    else if (have.color.toLowerCase() !== want.color.toLowerCase() || (have.description ?? '') !== want.description) update.push({ ...want, current: have.name });
    else same.push(want);
  }
  return { create, update, same };
}
