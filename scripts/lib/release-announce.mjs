// Comentários de release nos PRs e issues: a parte pura (sem rede nem git), para testar. O script scripts/release-announce.mjs junta isto com a API do GitHub.
//
// Um comentário só por PR e por issue, atualizado a cada release (marcador + estado escondido): a beta vira "🧪 Em homologação" e acumula as betas por
// que o item passou; quando a estável sai, o MESMO comentário vira "🚀 Publicado". PR agregador (um PR de release que reúne os commits de outros PRs)
// recebe a tabela dos agregados; os PRs de origem recebem um comentário curto apontando para ele.

import { latestTag } from './release-core.mjs';
import { safeTitle } from './pr-stack.mjs';

/** Primeira linha dos comentários desta automação: é como o script os reencontra para editar em vez de repetir. */
export const MARKER = '<!-- git-nexus:release -->';
const STATE_PREFIX = '<!-- git-nexus:release-state ';
const STATE_RE = /<!-- git-nexus:release-state (\{.*?\}) -->/;

/** Teto de PRs por execução (os mais recentes) e de commits examinados. */
export const MAX_PRS = 60;
export const MAX_COMMITS = 300;
/** Quantas betas anteriores o comentário lista (as mais recentes). */
const MAX_BETAS_SHOWN = 6;

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

export const isBetaTag = (tag) => /-beta\.\d+$/.test(tag);
export const tagUrl = (repo, tag) => `https://github.com/${repo}/releases/tag/${tag}`;
export const compareUrl = (repo, from, to) => `https://github.com/${repo}/compare/${from}...${to}`;

/** `2026-11-19` ou um ISO completo → `19/11/2026`. Qualquer outra coisa volta como veio. */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? '');
}

const base = (tag) => {
  const m = TAG_RE.exec(tag ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * A tag ESTÁVEL anterior à release: a maior estável com versão menor que a base da tag atual (a base de `v1.21.0-beta.2` é 1.21.0). Serve para a
 * estável e para a beta, e não muda se a release for reexecutada depois de uma versão mais nova existir.
 */
export function previousStable(tags, current) {
  const cur = base(current);
  if (!cur) return null;
  return latestTag(tags.filter((t) => !isBetaTag(t) && base(t) && cmp(base(t), cur) < 0));
}

// ---------------------------------------------------------------- estado do comentário

/** Estado guardado no comentário: `{ stable: {tag, date} | null, betas: [tag...] }`. Valida tudo (o comentário pode ter sido editado à mão). */
export function parseState(body) {
  const m = STATE_RE.exec(body ?? '');
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1]);
    const betas = Array.isArray(raw.betas) ? raw.betas.filter((t) => typeof t === 'string' && TAG_RE.test(t) && isBetaTag(t)) : [];
    const s = raw.stable;
    const stable = s && typeof s.tag === 'string' && TAG_RE.test(s.tag) && !isBetaTag(s.tag) ? { tag: s.tag, date: typeof s.date === 'string' ? s.date.slice(0, 10) : '' } : null;
    return { stable, betas };
  } catch {
    return null;
  }
}

/** Soma esta release ao estado: beta entra na lista (sem repetir); estável fixa a versão. Beta depois de uma estável não desfaz nada. */
export function mergeState(prev, { tag, prerelease, date }) {
  const s = { stable: prev?.stable ?? null, betas: [...(prev?.betas ?? [])] };
  if (prerelease) {
    if (!s.stable && !s.betas.includes(tag)) s.betas.push(tag);
  } else {
    s.stable = { tag, date };
  }
  return s;
}

// ---------------------------------------------------------------- modelo

const cleanTitle = (t) =>
  safeTitle(t)
    .replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '')
    // célula de tabela: a barra invertida e o pipe são escapados JUNTOS (escapar só o pipe deixaria `\|` virar pipe sem escape)
    .replace(/[\\|]/g, (c) => `\\${c}`)
    .slice(0, 90);

/**
 * Do que a API devolveu ao que vai nos comentários. `prs`: `{ number, title, state: 'merged'|'open'|'closed', commits: string[], issues: number[] }`.
 * Fechado sem merge fica de fora. Um PR é AGREGADOR de outro quando os commits do outro estão todos nele (e ele tem mais): o agregador mais próximo
 * (o de menos commits) vira o "pai". Cada issue aponta para quem a implementou (um PR que não agrega ninguém, se houver) e, se for o caso, para o pai.
 */
export function buildModel({ repo, tag, previous, prerelease, date, prs }) {
  const eligible = prs.filter((p) => p.state === 'merged' || p.state === 'open').sort((a, b) => b.number - a.number);
  const kept = eligible.slice(0, MAX_PRS).sort((a, b) => a.number - b.number);
  const omitted = eligible.length - kept.length;

  const sets = new Map(kept.map((p) => [p.number, new Set(p.commits)]));
  const parentOf = new Map();
  for (const y of kept) {
    if (!y.commits.length) continue;
    let best = null;
    for (const x of kept) {
      if (x.number === y.number) continue;
      const sx = sets.get(x.number);
      if (sx.size > y.commits.length && y.commits.every((c) => sx.has(c)) && (!best || sx.size < sets.get(best).size)) best = x.number;
    }
    if (best !== null) parentOf.set(y.number, best);
  }
  const childrenOf = new Map();
  for (const [child, parent] of parentOf) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), child].sort((a, b) => a - b));

  const prModels = kept.map((p) => ({
    number: p.number,
    title: p.title,
    state: p.state,
    issues: [...new Set(p.issues)].sort((a, b) => a - b),
    parent: parentOf.get(p.number) ?? null,
    children: childrenOf.get(p.number) ?? [],
  }));

  const byIssue = new Map();
  for (const p of prModels) for (const n of p.issues) byIssue.set(n, [...(byIssue.get(n) ?? []), p]);
  const issues = [...byIssue.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, listed]) => {
      const leaves = listed.filter((p) => !p.children.length);
      const implementers = (leaves.length ? leaves : listed).map((p) => p.number);
      const via = new Set((leaves.length ? leaves : []).map((p) => p.parent).filter((n) => n !== null));
      // se só o agregador cita a issue, ele é o implementador e não há "por quem entrou"
      return { number, implementers, via: [...via].sort((a, b) => a - b) };
    });

  return { repo, tag, previous: previous ?? null, prerelease: !!prerelease, date, prs: prModels, issues, omitted };
}

// ---------------------------------------------------------------- texto

const refs = (nums) => nums.map((n) => `#${n}`).join(', ');
const link = (repo, tag) => `[${tag}](${tagUrl(repo, tag)})`;

function head(model, state) {
  const { repo, tag, prerelease, date } = model;
  return prerelease
    ? [`### 🧪 Em homologação na ${link(repo, tag)}`, `\`${formatDate(date)}\` · pré-lançamento`]
    : [`### 🚀 Publicado na ${link(repo, tag)}`, `\`${formatDate(state.stable?.date || date)}\` · versão estável`];
}

function betasLine(model, state) {
  const shown = state.betas.filter((t) => t !== model.tag);
  if (!shown.length) return null;
  const last = shown.slice(-MAX_BETAS_SHOWN);
  const more = shown.length > last.length ? `… e ${shown.length - last.length} antes, ` : '';
  const label = model.prerelease ? 'Betas anteriores' : 'Passou pelas betas';
  return `- 🧪 ${label}: ${more}${last.map((t) => link(model.repo, t)).join(', ')}`;
}

const compareLine = (model) => (model.previous ? `- 🔎 [O que mudou desde a ${model.previous}](${compareUrl(model.repo, model.previous, model.tag)})` : null);
const finalLine = (model) => (model.prerelease ? '- ⏳ _A versão estável aparece aqui quando for publicada._' : null);

const assemble = (state, lines) => [MARKER, `${STATE_PREFIX}${JSON.stringify(state)} -->`, '', ...lines.filter((l) => l !== null)].join('\n') + '\n';

/** Comentário de um PR da versão (agregador, de origem ou comum). Devolve `{ body, state }`, ou null se não há o que atualizar. */
export function renderPrComment(model, pr, prevState = null) {
  if (prevState?.stable && model.prerelease) return null; // já publicado numa estável: uma beta posterior não reescreve
  const state = mergeState(prevState, model);
  const verb = model.prerelease ? ['Vai entregar', 'Agregado no PR'] : ['Entregou', 'Entrou na `main` pelo PR de release'];
  const lines = [...head(model, state), ''];

  if (pr.children.length) {
    const byNumber = new Map(model.prs.map((p) => [p.number, p]));
    lines.push(`**📦 PRs agregados (${pr.children.length})**`, '', '| PR | Entrega | 🎯 |', '|---|---|---|');
    for (const n of pr.children) {
      const c = byNumber.get(n);
      lines.push(`| #${n} | ${cleanTitle(c.title)} | ${c.issues.length ? refs(c.issues) : '—'} |`);
    }
    lines.push('');
    const all = [...new Set([...pr.issues, ...pr.children.flatMap((n) => byNumber.get(n).issues)])].sort((a, b) => a - b);
    if (all.length) lines.push(`- 🎯 ${model.prerelease ? 'Issues que serão entregues' : 'Issues entregues'} (${all.length}): ${refs(all)}`);
  } else {
    if (pr.parent !== null) lines.push(`- 🧩 ${verb[1]} #${pr.parent}`);
    if (pr.issues.length) lines.push(`- 🎯 ${verb[0]} ${pr.issues.length === 1 ? 'a issue' : 'as issues'} ${refs(pr.issues)}`);
    if (pr.parent === null && !pr.issues.length) lines.push(`- 🧩 ${model.prerelease ? 'Faz parte desta beta' : 'Faz parte desta versão'}`);
  }
  lines.push(betasLine(model, state), compareLine(model), finalLine(model));
  return { body: assemble(state, lines), state };
}

/** Comentário de uma issue: qual PR implementou, por qual PR entrou na `main` e em qual versão. */
export function renderIssueComment(model, issue, prevState = null) {
  if (prevState?.stable && model.prerelease) return null;
  const state = mergeState(prevState, model);
  const title = model.prerelease ? `### 🧪 Em homologação na ${link(model.repo, model.tag)}` : `### ✅ Entregue na ${link(model.repo, model.tag)}`;
  const meta = model.prerelease ? `\`${formatDate(model.date)}\` · pré-lançamento` : `\`${formatDate(state.stable?.date || model.date)}\` · versão estável`;
  const rows = [['🔧 Implementação', refs(issue.implementers)]];
  if (issue.via.length) rows.push([model.prerelease ? '📦 Agregado em' : '📦 Entrou na `main` por', refs(issue.via)]);
  rows.push([model.prerelease ? '🏷️ Beta' : '🏷️ Release', link(model.repo, model.tag)]);
  const shown = state.betas.filter((t) => t !== model.tag).slice(-MAX_BETAS_SHOWN);
  if (shown.length) rows.push(['🧪 Betas', shown.map((t) => link(model.repo, t)).join(', ')]);
  const lines = [title, meta, '', '| | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v} |`)];
  if (model.prerelease) lines.push('', '⏳ _A versão estável aparece aqui quando for publicada._');
  return { body: assemble(state, lines), state };
}

export const sameBody = (a, b) => (a ?? '').replace(/\r\n/g, '\n').trim() === (b ?? '').replace(/\r\n/g, '\n').trim();
