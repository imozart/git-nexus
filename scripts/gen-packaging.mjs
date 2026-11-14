#!/usr/bin/env node
// Gera os manifestos de winget, Scoop e Homebrew Cask de uma release já publicada.
//   node scripts/gen-packaging.mjs --version 1.3.0 --repo imozart/git-nexus --sums dist/SHA256SUMS.txt --out packaging-out [--date 2026-11-14]
// Os arquivos são gravados em <out>/winget, <out>/scoop e <out>/homebrew (veja docs/PACKAGING.md para publicar).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackaging } from './lib/packaging.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

function main() {
  const version = arg('version');
  const repo = arg('repo', process.env.GITHUB_REPOSITORY);
  const sums = arg('sums');
  const out = arg('out', 'packaging-out');
  if (!version || !repo || !sums) {
    console.error('Uso: gen-packaging.mjs --version X.Y.Z --repo dono/repo --sums SHA256SUMS.txt [--out pasta] [--date AAAA-MM-DD]');
    process.exit(2);
  }
  const files = buildPackaging({ version, repo, sumsText: readFileSync(sums, 'utf8'), date: arg('date') });
  for (const [path, content] of Object.entries(files)) {
    const dest = join(out, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content, 'utf8');
    console.log(`gerado: ${dest}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
