#!/usr/bin/env node
// Aplica as labels de tipo (título/branch) em um PR. Os dados do PR vêm por variáveis de ambiente, nunca interpolados no shell:
//   PR_NUMBER, PR_TITLE, PR_BRANCH, PR_BODY, GITHUB_REPOSITORY (+ GH_TOKEN). `--dry-run` só imprime.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { desiredTypeLabels, diffLabels } from './lib/pr-labels.mjs';

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function main() {
  const dry = process.argv.includes('--dry-run');
  const { PR_NUMBER: number, PR_TITLE: title = '', PR_BRANCH: branch = '', PR_BODY: body = '', GITHUB_REPOSITORY: repo } = process.env;
  if (!number || !repo) {
    console.error('Defina PR_NUMBER e GITHUB_REPOSITORY.');
    process.exit(2);
  }

  const current = JSON.parse(gh('pr', 'view', number, '--repo', repo, '--json', 'labels')).labels.map((l) => l.name);
  const desired = desiredTypeLabels({ title, branch, body });
  const { add, remove } = diffLabels(current, desired);
  console.log(`PR #${number}: ${desired.length ? desired.join(', ') : 'sem tipo identificado'} (adicionar: ${add.join(', ') || '-'}; remover: ${remove.join(', ') || '-'})`);

  if (dry || (!add.length && !remove.length)) return;
  const args = ['pr', 'edit', number, '--repo', repo];
  for (const l of add) args.push('--add-label', l);
  for (const l of remove) args.push('--remove-label', l);
  gh(...args);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
