#!/usr/bin/env node
// Confere o nome da branch de um PR. Os valores vêm das variáveis BRANCH_NAME e PR_TITLE (nunca interpolados no shell) ou dos argumentos.
//   BRANCH_NAME="feat/algo" PR_TITLE="feat: algo" node scripts/check-branch-name.mjs

import { fileURLToPath } from 'node:url';
import { checkBranchName } from './lib/branch-name.mjs';

function main() {
  const branch = process.env.BRANCH_NAME ?? process.argv[2] ?? '';
  const title = process.env.PR_TITLE ?? process.argv[3];
  const { ok, errors } = checkBranchName(branch, title);
  if (ok) {
    console.log(`Nome de branch válido: ${branch}`);
    return;
  }
  console.error(`Nome de branch inválido: "${branch}"`);
  for (const e of errors) {
    console.error(`  - ${e}`);
    if (process.env.GITHUB_ACTIONS) console.error(`::error title=Nome de branch inválido::${e}`);
  }
  console.error('\nRenomeie a branch (git branch -m / gh) e abra o PR de novo, ou ajuste o título do PR; a verificação roda de novo sozinha.');
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
