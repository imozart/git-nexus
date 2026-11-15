// Pilhas de PRs: descobre de quais PRs abertos um PR depende e monta o comentário com a ordem de merge. Núcleo PURO, sem dependências.
//
// Em uma pilha, cada branch parte da anterior (todas com base na main). O PR P "depende" do PR Q quando o último commit de Q
// (a ponta da branch) está entre os commits de P em relação à base: mergear P antes de Q levaria os commits de Q junto.

export const STACK_LABEL = 'bloqueado';
/** Marca que identifica o comentário desta automação (para atualizar em vez de comentar de novo). */
export const MARKER = '<!-- git-nexus:pr-stack -->';

/**
 * `prs`: `[{ number, title, headSha }]` (PRs abertos). `commits`: `Map<number, Set<string>>` com os SHAs dos commits de cada PR em relação à base.
 * Devolve `Map<number, number[]>`: para cada PR, a ordem de merge (dependências primeiro, o próprio PR por último).
 * PRs sem dependência não aparecem. Dependências saem da menor para a maior pilha (quem tem menos commits vem antes).
 */
export function mergeOrders(prs, commits) {
  const size = (n) => commits.get(n)?.size ?? 0;
  const out = new Map();
  for (const p of prs) {
    const mine = commits.get(p.number);
    if (!mine) continue;
    const deps = prs.filter((q) => q.number !== p.number && q.headSha !== p.headSha && mine.has(q.headSha));
    if (!deps.length) continue;
    deps.sort((a, b) => size(a.number) - size(b.number) || a.number - b.number);
    out.set(p.number, [...deps.map((d) => d.number), p.number]);
  }
  return out;
}

/** Título de PR como texto inofensivo no comentário: uma linha só e sem @menção (o título é texto de quem abriu o PR). */
export const safeTitle = (t) => (t ?? '').replace(/\s+/g, ' ').trim().replace(/@/g, '@​');

/** Corpo do comentário: a ordem de merge, com o PR atual em destaque. */
export function commentBody(number, order, titles) {
  const lines = order.map((n, i) => `${i + 1}. ${n === number ? `**#${n} (este PR)**` : `#${n}`} — ${safeTitle(titles.get(n))}`.trimEnd());
  return [
    MARKER,
    '### ⛓️ PR empilhado',
    '',
    'Este PR contém commits de outros PRs ainda abertos. Faça o merge **nesta ordem**:',
    '',
    ...lines,
    '',
    '_Comentário e label `bloqueado` são atualizados sozinhos quando um PR da pilha é mergeado, fechado ou muda._',
  ].join('\n');
}

/** Compara texto ignorando fim de linha, para não reescrever o comentário à toa. */
export const sameBody = (a, b) => (a ?? '').replace(/\r\n/g, '\n').trim() === (b ?? '').replace(/\r\n/g, '\n').trim();
