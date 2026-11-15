#!/usr/bin/env node
// Cria e atualiza as labels do repositório conforme .github/labels.json (nunca apaga).
//   node scripts/sync-labels.mjs --dry-run            só mostra o que mudaria
//   node scripts/sync-labels.mjs [--repo dono/repo]   aplica (usa o gh; em CI, GH_TOKEN)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planLabels, validateCatalog } from './lib/labels.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run');
  const repoIdx = argv.indexOf('--repo');
  const repo = repoIdx >= 0 ? argv[repoIdx + 1] : process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error('Informe --repo dono/repo (ou defina GITHUB_REPOSITORY).');
    process.exit(2);
  }

  const catalog = JSON.parse(readFileSync(join(root, '.github', 'labels.json'), 'utf8'));
  const problems = validateCatalog(catalog);
  if (problems.length) {
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }

  const existing = JSON.parse(gh('label', 'list', '--repo', repo, '--limit', '500', '--json', 'name,color,description'));
  const { create, update, same } = planLabels(existing, catalog);
  console.log(`Labels: ${create.length} a criar, ${update.length} a atualizar, ${same.length} em dia${dry ? ' (simulação)' : ''}.`);

  for (const l of create) {
    console.log(`  + ${l.name}`);
    if (!dry) gh('label', 'create', l.name, '--repo', repo, '--color', l.color, '--description', l.description);
  }
  for (const l of update) {
    console.log(`  ~ ${l.name}`);
    if (!dry) gh('label', 'edit', l.current, '--repo', repo, '--name', l.name, '--color', l.color, '--description', l.description);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
