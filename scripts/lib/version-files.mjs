// Gravação da versão nos package.json do monorepo (raiz, apps/* e packages/*). Sem dependências.
// Mexe só no texto do campo "version" (regex), para não reformatar o arquivo nem mudar a ordem das chaves.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** SemVer com pré-release opcional (1.2.3, 1.2.3-beta.4). Não aceita metadado de build (+abc), que o npm ignora. */
export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

// Só o campo do primeiro nível (2 espaços de recuo): um "version" aninhado em outro objeto não conta.
const FIELD = /^( {2}"version": ")([^"]*)(")/m;

/** Devolve o texto com a versão trocada. `changed` = false quando já estava igual. Lança se não houver campo "version". */
export function setPackageVersion(text, version) {
  if (!SEMVER.test(version)) throw new Error(`Versão inválida: ${version}`);
  const m = FIELD.exec(text);
  if (!m) throw new Error('package.json sem campo "version"');
  const previous = m[2];
  if (previous === version) return { text, changed: false, previous };
  const out = text.replace(FIELD, (_all, a, _old, c) => `${a}${version}${c}`);
  if (JSON.parse(out).version !== version) throw new Error('A troca de versão gerou um package.json inesperado');
  return { text: out, changed: true, previous };
}

/** Caminhos (relativos) dos package.json do monorepo que têm "version": raiz, apps/* e packages/*. */
export function versionManifests(root) {
  const out = [];
  const add = (rel) => {
    const abs = join(root, rel);
    if (existsSync(abs) && FIELD.test(readFileSync(abs, 'utf8'))) out.push(rel);
  };
  add('package.json');
  for (const dir of ['apps', 'packages']) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base, { withFileTypes: true })) if (name.isDirectory()) add(`${dir}/${name.name}/package.json`);
  }
  return out;
}

/** Aplica a versão a todos os package.json. Mantém quebras de linha (CRLF/LF). Com `dry`, não grava. */
export function writeVersion(root, version, { dry = false } = {}) {
  const changed = [];
  for (const rel of versionManifests(root)) {
    const abs = join(root, rel);
    const raw = readFileSync(abs, 'utf8');
    const r = setPackageVersion(raw, version);
    if (!r.changed) continue;
    if (!dry) writeFileSync(abs, r.text, 'utf8');
    changed.push({ file: rel, from: r.previous, to: version });
  }
  return changed;
}
