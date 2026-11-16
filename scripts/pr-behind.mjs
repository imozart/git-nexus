#!/usr/bin/env node
// Marca com a label "desatualizada" os PRs abertos que não têm commits novos da branch de destino (e tira a label quando atualizam).
//   GITHUB_REPOSITORY=dono/repo node scripts/pr-behind.mjs [--dry-run]     (GH_TOKEN em CI)
// Regras de contagem em scripts/lib/pr-behind.mjs (merge commits e chore(release) não contam).

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BEHIND_LABEL, behindAction, behindCount } from './lib/pr-behind.mjs';

function gh(...args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function main() {
  const dry = process.argv.includes('--dry-run');
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.error('Defina GITHUB_REPOSITORY.');
    process.exit(2);
  }

  const prs = JSON.parse(gh('pr', 'list', '--repo', repo, '--state', 'open', '--limit', '100', '--json', 'number,headRefOid,baseRefName,labels'));
  for (const p of prs) {
    const labels = p.labels.map((l) => l.name);
    let count;
    try {
      // comparar "ponta do PR ... base" lista os commits da base que o PR não tem
      const lines = gh('api', '--paginate', `repos/${repo}/compare/${p.headRefOid}...${encodeURIComponent(p.baseRefName)}?per_page=100`, '--jq', '.commits[] | {parents: (.parents | length), subject: (.commit.message | split("\\n")[0])}')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      count = behindCount(lines);
    } catch (e) {
      console.warn(`#${p.number}: não consegui comparar com ${p.baseRefName} (${String(e.message).split('\n')[0]}); fica como está.`);
      continue;
    }
    const action = behindAction(count, labels);
    console.log(`#${p.number}: ${count} commit(s) novo(s) na ${p.baseRefName} -> ${action}`);
    if (dry || action === 'none') continue;
    gh('pr', 'edit', String(p.number), '--repo', repo, action === 'add' ? '--add-label' : '--remove-label', BEHIND_LABEL);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
