#!/usr/bin/env node
// Confere o título de um PR (Conventional Commits). O título vem da variável PR_TITLE (nunca interpolado no shell) ou do 1º argumento.
//   PR_TITLE="feat: algo" node scripts/check-pr-title.mjs

import { fileURLToPath } from 'node:url';
import { checkPrTitle } from './lib/pr-title.mjs';

function main() {
  const title = process.env.PR_TITLE ?? process.argv[2] ?? '';
  const { ok, errors } = checkPrTitle(title);
  if (ok) {
    console.log(`Título válido: ${title}`);
    return;
  }
  console.error(`Título do PR inválido: "${title}"`);
  for (const e of errors) {
    console.error(`  - ${e}`);
    if (process.env.GITHUB_ACTIONS) console.error(`::error title=Título do PR inválido::${e}`);
  }
  console.error('\nCorrija o título do PR (botão Edit ao lado do título); a verificação roda de novo sozinha.');
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
