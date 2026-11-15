#!/usr/bin/env node
// Lê coverage/coverage-summary.json (gerado por `pnpm test:coverage`) e imprime o resumo em Markdown.
//   node scripts/coverage-summary.mjs >> "$GITHUB_STEP_SUMMARY"

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCoverage } from './lib/coverage-summary.mjs';

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const file = resolve(root, 'coverage', 'coverage-summary.json');
  if (!existsSync(file)) {
    console.error('coverage/coverage-summary.json não existe: rode `pnpm test:coverage` antes.');
    process.exit(1);
  }
  process.stdout.write(renderCoverage(JSON.parse(readFileSync(file, 'utf8')), root));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
