#!/usr/bin/env node
// Grava a versão de uma release nos package.json do monorepo, para que o código-fonte diga a mesma versão da tag.
//
//   node scripts/bump-version.mjs --version 1.2.3 [--dry]
//
// O pipeline (workflow release-sync.yml, chamado pelo release.yml) roda isto depois de publicar uma release estável e faz o commit
// `chore(release): v1.2.3 [skip release]`. Quem compilar a partir da tag ou da main passa a ver a versão certa.

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeVersion } from './lib/version-files.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function main() {
  const version = arg('version')?.replace(/^v/, '');
  if (!version) {
    console.error('Uso: bump-version.mjs --version 1.2.3 [--dry]');
    process.exit(2);
  }
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const changed = writeVersion(root, version, { dry: process.argv.includes('--dry') });
  for (const c of changed) console.log(`${c.file}: ${c.from} -> ${c.to}`);
  if (!changed.length) console.log(`Nada a fazer: tudo já está na versão ${version}.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed.length ? 'true' : 'false'}\n`);
}

main();
