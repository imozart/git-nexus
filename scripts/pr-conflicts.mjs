#!/usr/bin/env node
// Marca com a label "conflito" os PRs abertos que não dão merge limpo na branch de destino (e tira a label quando o conflito some).
//   GITHUB_REPOSITORY=dono/repo node scripts/pr-conflicts.mjs [--dry-run]     (GH_TOKEN em CI)
// O GitHub calcula `mergeable` sob demanda: logo depois de um push na main vem UNKNOWN; consultar de novo dispara/espera o cálculo.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFLICT_LABEL, conflictAction } from './lib/pr-conflicts.mjs';

const ATTEMPTS = 6;
const WAIT_MS = 5000;

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function listOpen(repo) {
  return JSON.parse(gh('pr', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number,mergeable,labels')).map((p) => ({
    number: p.number,
    mergeable: p.mergeable,
    labels: p.labels.map((l) => l.name),
  }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dry = process.argv.includes('--dry-run');
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error('Defina GITHUB_REPOSITORY.');
    process.exit(2);
  }

  let prs = listOpen(repo);
  for (let attempt = 1; attempt < ATTEMPTS && prs.some((p) => conflictAction(p.mergeable, p.labels) === 'retry'); attempt++) {
    await sleep(WAIT_MS);
    const fresh = new Map(listOpen(repo).map((p) => [p.number, p]));
    prs = prs.map((p) => (conflictAction(p.mergeable, p.labels) === 'retry' ? (fresh.get(p.number) ?? p) : p));
  }

  for (const p of prs) {
    const action = conflictAction(p.mergeable, p.labels);
    console.log(`#${p.number}: ${p.mergeable} -> ${action === 'retry' ? 'sem resposta do GitHub, fica como está' : action}`);
    if (dry || action === 'none' || action === 'retry') continue;
    gh('pr', 'edit', String(p.number), '--repo', repo, action === 'add' ? '--add-label' : '--remove-label', CONFLICT_LABEL);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
