#!/usr/bin/env node
// Aplica a label "tamanho: XS..XL" em um PR, pelo total de linhas alteradas (sem lockfiles e arquivos gerados).
//   PR_NUMBER=12 GITHUB_REPOSITORY=dono/repo node scripts/pr-size.mjs [--dry-run]     (GH_TOKEN em CI)

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diffLabels } from './lib/pr-labels.mjs';
import { SIZE_LABELS, countLines, sizeLabel } from './lib/pr-size.mjs';

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function main() {
  const dry = process.argv.includes('--dry-run');
  const { PR_NUMBER: number, GITHUB_REPOSITORY: repo } = process.env;
  if (!number || !repo) {
    console.error('Defina PR_NUMBER e GITHUB_REPOSITORY.');
    process.exit(2);
  }

  // a API pagina de 100 em 100 arquivos (até 3000); o --jq roda por página e imprime um objeto por linha
  const files = gh('api', '--paginate', `repos/${repo}/pulls/${number}/files?per_page=100`, '--jq', '.[] | {filename, additions, deletions}')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const lines = countLines(files);
  const want = sizeLabel(lines);

  const current = JSON.parse(gh('pr', 'view', number, '--repo', repo, '--json', 'labels')).labels.map((l) => l.name);
  const { add, remove } = diffLabels(current, [want], SIZE_LABELS);
  console.log(`PR #${number}: ${lines} linhas em ${files.length} arquivos -> ${want} (adicionar: ${add.join(', ') || '-'}; remover: ${remove.join(', ') || '-'})`);

  if (dry || (!add.length && !remove.length)) return;
  const args = ['pr', 'edit', number, '--repo', repo];
  for (const l of add) args.push('--add-label', l);
  for (const l of remove) args.push('--remove-label', l);
  gh(...args);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
