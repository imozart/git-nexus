#!/usr/bin/env node
// Gera (ou confere) a região "Bibliotecas JavaScript embutidas" do THIRD_PARTY_NOTICES.md.
//   node scripts/third-party-notices.mjs           # reescreve o arquivo
//   node scripts/third-party-notices.mjs --check   # CI: reprova se estiver desatualizado ou se houver licença fora da lista permitida
//
// Quais bibliotecas: as dependências de todos os pacotes do monorepo (menos ferramentas de build/teste, veja isBuildTool) e, a partir delas, as
// `dependencies` transitivas, resolvidas no node_modules instalado (pnpm). `optionalDependencies` e `peerDependencies` não entram (peer já é dependência direta).

import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_LICENSES, isAllowed, isBuildTool, licenseOf, mergeGenerated, renderGenerated, sortUnique } from './lib/notices.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(root, 'THIRD_PARTY_NOTICES.md');
const WORKSPACES = ['apps', 'packages'];

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Acha a pasta de `name` subindo a partir de `from` (o que o `require` faria; no pnpm, cada pacote tem o próprio node_modules com links). */
function locate(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}

const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\.(md|txt))?$/i;
const licenseText = (dir) => {
  const names = readdirSync(dir).filter((n) => LICENSE_FILE.test(n));
  // LICENSE antes de NOTICE; no máximo os dois primeiros (um pacote com vários avisos não vira um livro)
  names.sort((a, b) => Number(/notice/i.test(a)) - Number(/notice/i.test(b)) || a.localeCompare(b));
  return names.slice(0, 2).map((n) => readFileSync(join(dir, n), 'utf8').replace(/\r\n/g, '\n').trim()).join('\n\n---\n\n');
};

function collect() {
  const workspaceDirs = WORKSPACES.flatMap((w) => (existsSync(join(root, w)) ? readdirSync(join(root, w)).map((n) => join(root, w, n)) : [])).filter((d) => existsSync(join(d, 'package.json')));
  const workspaceNames = new Set(workspaceDirs.map((d) => readJson(join(d, 'package.json')).name));
  const found = new Map(); // pasta real → item
  const missing = [];
  const visit = (name, from) => {
    const dir = locate(name, from);
    if (!dir) return void missing.push(`${name} (a partir de ${from})`);
    if (found.has(dir)) return;
    const pkg = readJson(join(dir, 'package.json'));
    found.set(dir, { name: pkg.name, version: pkg.version, license: licenseOf(pkg), homepage: typeof pkg.homepage === 'string' ? pkg.homepage : '', text: licenseText(dir) });
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir);
  };
  for (const wd of workspaceDirs) {
    const pkg = readJson(join(wd, 'package.json'));
    const direct = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const dep of Object.keys(direct)) if (!workspaceNames.has(dep) && !isBuildTool(dep)) visit(dep, wd);
  }
  return { items: sortUnique([...found.values()]), missing };
}

function main() {
  const check = process.argv.includes('--check');
  const { items, missing } = collect();
  const problems = [];
  if (missing.length) problems.push(`Dependências não instaladas (rode pnpm install): ${missing.join(', ')}`);
  for (const it of items) if (!isAllowed(it.license)) problems.push(`${it.name}@${it.version}: licença "${it.license ?? 'ausente'}" fora da lista permitida (${ALLOWED_LICENSES.join(', ')}). Avalie a compatibilidade com a GPL-3.0 e, se for o caso, acrescente em scripts/lib/notices.mjs.`);
  if (problems.length) {
    for (const p of problems) {
      console.error(`- ${p}`);
      if (process.env.GITHUB_ACTIONS) console.error(`::error title=Avisos de terceiros::${p}`);
    }
    process.exit(1);
  }
  const current = readFileSync(FILE, 'utf8');
  const next = mergeGenerated(current, renderGenerated(items));
  if (check) {
    if (current.replace(/\r\n/g, '\n') !== next) {
      const msg = 'THIRD_PARTY_NOTICES.md está desatualizado em relação às dependências. Rode `node scripts/third-party-notices.mjs` e inclua o arquivo no commit.';
      console.error(msg);
      if (process.env.GITHUB_ACTIONS) console.error(`::error title=Avisos de terceiros desatualizados::${msg}`);
      process.exit(1);
    }
    console.log(`THIRD_PARTY_NOTICES.md em dia (${items.length} bibliotecas, todas com licença permitida).`);
    return;
  }
  writeFileSync(FILE, next);
  console.log(`THIRD_PARTY_NOTICES.md atualizado: ${items.length} bibliotecas.`);
}

main();
