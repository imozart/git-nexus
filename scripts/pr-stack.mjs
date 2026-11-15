#!/usr/bin/env node
// Detecta PRs empilhados (um contém os commits de outro PR aberto), marca com a label "bloqueado" e comenta a ordem de merge.
//   GITHUB_REPOSITORY=dono/repo node scripts/pr-stack.mjs [--dry-run]     (GH_TOKEN em CI)
// Reavalia TODOS os PRs abertos a cada execução: quando um PR da pilha é mergeado ou fechado, os de cima ficam livres sozinhos.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MARKER, STACK_LABEL, commentBody, mergeOrders, sameBody } from './lib/pr-stack.mjs';

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const lines = (text) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));

function main() {
  const dry = process.argv.includes('--dry-run');
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error('Defina GITHUB_REPOSITORY.');
    process.exit(2);
  }

  const prs = JSON.parse(gh('pr', 'list', '--repo', repo, '--state', 'open', '--limit', '100', '--json', 'number,title,headRefOid,baseRefName,labels')).map((p) => ({
    number: p.number,
    title: p.title,
    headSha: p.headRefOid,
    base: p.baseRefName,
    labels: p.labels.map((l) => l.name),
  }));

  // commits de cada PR em relação à base (a API de comparação pagina de 100 em 100)
  const commits = new Map();
  for (const p of prs) {
    try {
      const shas = gh('api', '--paginate', `repos/${repo}/compare/${encodeURIComponent(p.base)}...${p.headSha}?per_page=100`, '--jq', '.commits[].sha').split('\n').filter(Boolean);
      commits.set(p.number, new Set(shas));
    } catch (e) {
      console.warn(`#${p.number}: não consegui comparar com ${p.base} (${String(e.message).split('\n')[0]}); ignorado nesta rodada.`);
    }
  }

  const orders = mergeOrders(prs, commits);
  const titles = new Map(prs.map((p) => [p.number, p.title]));

  for (const p of prs) {
    if (!commits.has(p.number)) continue; // sem comparação confiável, não mexe
    const order = orders.get(p.number);
    const hasLabel = p.labels.includes(STACK_LABEL);
    console.log(`#${p.number}: ${order ? `empilhado (${order.map((n) => `#${n}`).join(' -> ')})` : 'independente'}`);

    // comentário desta automação, se já existir
    const existing = lines(gh('api', '--paginate', `repos/${repo}/issues/${p.number}/comments?per_page=100`, '--jq', `.[] | select(.body | startswith("${MARKER}")) | {id, body}`))[0];

    if (order) {
      const body = commentBody(p.number, order, titles);
      if (dry) continue;
      if (!hasLabel) gh('pr', 'edit', String(p.number), '--repo', repo, '--add-label', STACK_LABEL);
      if (!existing) gh('api', '-X', 'POST', `repos/${repo}/issues/${p.number}/comments`, '-f', `body=${body}`);
      else if (!sameBody(existing.body, body)) {
        try {
          gh('api', '-X', 'PATCH', `repos/${repo}/issues/comments/${existing.id}`, '-f', `body=${body}`);
        } catch {
          // comentário de outra pessoa com a mesma marca: não dá para editar, então comenta de novo
          gh('api', '-X', 'POST', `repos/${repo}/issues/${p.number}/comments`, '-f', `body=${body}`);
        }
      }
    } else if (!dry) {
      if (hasLabel) gh('pr', 'edit', String(p.number), '--repo', repo, '--remove-label', STACK_LABEL);
      if (existing) {
        try {
          gh('api', '-X', 'DELETE', `repos/${repo}/issues/comments/${existing.id}`);
        } catch {
          // sem permissão para apagar (comentário de outra pessoa): deixa
        }
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
