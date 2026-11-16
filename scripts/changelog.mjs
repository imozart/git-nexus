#!/usr/bin/env node
// Mantém o CHANGELOG.md a partir das tags e dos commits (Conventional Commits).
//
//   node scripts/changelog.mjs --version 1.2.3 [--repo dono/repo] [--file CHANGELOG.md] [--dry]
//       acrescenta (ou refaz) a versão 1.2.3: commits entre a estável anterior e a tag v1.2.3. A tag precisa existir.
//   node scripts/changelog.mjs --version 1.2.3 --ref HEAD [--repo dono/repo] [--file CHANGELOG.md]
//       o mesmo, mas até um commit (--ref) em vez da tag, que ainda não existe: é o que a release usa ANTES de compilar, para o CHANGELOG
//       empacotado já trazer a entrada da própria versão. O resultado é igual ao gerado depois pela tag, se ela apontar para esse commit.
//   node scripts/changelog.mjs --backfill [--force] [--repo dono/repo] [--file CHANGELOG.md] [--dry]
//       monta o arquivo inteiro a partir de todas as tags estáveis (recusa sobrescrever um arquivo existente sem --force).
//
// O pipeline (workflow release-sync.yml) roda a 1ª forma depois de publicar uma release ESTÁVEL. Beta nunca entra.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHANGELOG_FILE, compareVersions, defaultPreamble, isStableVersion, parseChangelog, previousVersion, renderChangelog, renderEntryBody, stableVersions, upsertEntry } from './lib/changelog.mjs';
import { readCommits } from './release-info.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

function detectRepo() {
  const explicit = arg('repo') ?? process.env.GITHUB_REPOSITORY;
  if (explicit) return explicit;
  try {
    return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(git('remote', 'get-url', 'origin'))?.[1];
  } catch {
    return undefined;
  }
}

/** `{ version, date, body }` de uma versão: commits entre a estável anterior e a tag dela. */
function entryFor(version, tags, repo, ref = `v${version}`) {
  const prev = previousVersion(tags, version);
  const commits = readCommits(prev ? `v${prev}..${ref}` : ref);
  return { version, date: git('log', '-1', '--format=%cs', `${ref}^{commit}`), body: renderEntryBody(commits, repo), commits: commits.length };
}

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function main() {
  const file = arg('file') ?? CHANGELOG_FILE;
  const dry = flag('dry');
  const repo = detectRepo();
  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  let after;

  if (flag('backfill')) {
    if (before.trim() && !flag('force')) {
      console.error(`${file} já existe e tem conteúdo; use --force para refazer tudo (as edições à mão se perdem).`);
      process.exit(1);
    }
    const entries = stableVersions(tags).map((v) => entryFor(v, tags, repo));
    if (!entries.length) {
      console.error('Nenhuma tag estável (vX.Y.Z) encontrada: nada a fazer.');
      process.exit(1);
    }
    after = renderChangelog({ preamble: defaultPreamble(repo), entries }, repo);
    console.log(`Backfill: ${entries.length} versões (${entries.map((e) => e.version).join(', ')}).`);
  } else {
    const version = arg('version')?.replace(/^v/, '');
    if (!version) {
      console.error('Uso: changelog.mjs --version 1.2.3 | --backfill  [--repo dono/repo] [--file CHANGELOG.md] [--dry] [--force]');
      process.exit(2);
    }
    if (!isStableVersion(version)) {
      console.error(`"${version}" não é uma versão estável (X.Y.Z): beta e pré-lançamentos não entram no changelog.`);
      process.exit(1);
    }
    // Com --ref a tag ainda não existe (a release está sendo preparada): basta o commit existir.
    const ref = arg('ref');
    try {
      git('rev-parse', '-q', '--verify', ref ? `${ref}^{commit}` : `refs/tags/v${version}`);
    } catch {
      console.error(ref ? `O commit "${ref}" não existe neste clone.` : `A tag v${version} não existe neste clone (falta fetch-tags? a release ainda não foi publicada?).`);
      process.exit(1);
    }
    if (ref) tags.push(`v${version}`); // a versão ainda não tem tag, mas conta como a mais nova para o cálculo da anterior
    // Além de `version`, completa as versões estáveis mais antigas que ainda não estão no arquivo (uma release que saiu antes do
    // changelog existir, ou com o job desligado): o arquivo se conserta sozinho na próxima release. Versões já presentes ficam como estão.
    const present = new Set(parseChangelog(before).entries.map((e) => e.version));
    const todo = stableVersions(tags).filter((v) => v === version || (compareVersions(v, version) < 0 && !present.has(v)));
    after = before;
    for (const v of todo) {
      const e = entryFor(v, tags, repo, v === version ? ref : undefined);
      after = upsertEntry(after, e, repo);
      console.log(`v${v}: ${e.commits} commit(s) desde ${previousVersion(tags, v) ? `v${previousVersion(tags, v)}` : 'o início'}${v === version ? '' : ' (versão que faltava)'}.`);
    }
  }

  const changed = after !== before.replace(/\r\n/g, '\n');
  console.log(changed ? `${file}: ${dry ? 'mudaria' : 'atualizado'}.` : `${file}: já está em dia.`);
  if (changed && !dry) writeFileSync(file, after, 'utf8');
  setOutput('changed', changed ? 'true' : 'false');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
