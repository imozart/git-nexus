#!/usr/bin/env node
// Calcula a próxima versão (SemVer via Conventional Commits) e gera as notas da release.
// Sem dependências: roda no GitHub Actions e localmente.
//
//   node scripts/release-info.mjs next  [--bump auto|major|minor|patch] [--channel stable|beta]
//   node scripts/release-info.mjs notes --version 1.2.3 [--repo dono/repo] [--assets pasta] [--out notas.md]
//
// Regras de versão (a cada merge na main sai uma release):
//   breaking (`!` ou "BREAKING CHANGE:")  -> major
//   feat                                  -> minor
//   qualquer outra coisa                  -> patch
// A tag `vX.Y.Z` é a fonte da verdade; sem tags, a primeira versão é a do package.json raiz.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeBeta, computeNext, isReleaseCommit, latestTag, parseCommit, renderNotes } from './lib/release-core.mjs';

// A lógica pura (versão e notas) vive em lib/release-core.mjs; reexportada aqui para manter a API.
export * from './lib/release-core.mjs';

// ---------------------------------------------------------------- git helpers
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

export function readCommits(range) {
  const raw = git('log', '--no-merges', '--format=%H%x1f%an%x1f%s%x1f%b%x1e', ...(range ? [range] : []));
  return raw
    .split('\x1e')
    .map((r) => r.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((rec) => {
      const [hash, author, subject, body] = rec.split('\x1f');
      return parseCommit({ hash, author, subject, body });
    })
    .filter((c) => !isReleaseCommit(c)); // o commit de "registrar a versão" não é mudança do produto
}

// ---------------------------------------------------------------- CLI
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function main() {
  const cmd = process.argv[2];
  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
  const prev = latestTag(tags);
  const range = prev ? `${prev}..HEAD` : undefined;
  const commits = readCommits(range);

  if (cmd === 'next') {
    const initial = JSON.parse(readFileSync('package.json', 'utf8')).version;
    const channel = arg('channel', 'stable');
    if (channel !== 'stable' && channel !== 'beta') throw new Error('--channel deve ser stable ou beta');
    const info = (channel === 'beta' ? computeBeta : computeNext)({ tags, commits, bumpOverride: arg('bump', 'auto'), initialVersion: initial });
    console.log(JSON.stringify({ ...info, commits: commits.length }, null, 2));
    setOutput('version', info.version);
    setOutput('tag', `v${info.version}`);
    setOutput('previous', info.previous ?? '');
    setOutput('bump', info.bump);
    setOutput('channel', channel);
    setOutput('prerelease', channel === 'beta' ? 'true' : 'false');
    return;
  }

  if (cmd === 'notes') {
    const version = arg('version');
    if (!version) throw new Error('Informe --version');
    const assetsDir = arg('assets');
    const assets = assetsDir
      ? readdirSync(assetsDir)
          .filter((f) => statSync(join(assetsDir, f)).isFile())
          .map((f) => ({ name: basename(f), size: statSync(join(assetsDir, f)).size }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];
    let stats = '';
    if (prev) {
      try {
        stats = git('diff', '--shortstat', `${prev}..HEAD`)
          .replace(/ files? changed/, ' arquivo(s) alterado(s)')
          .replace(/ insertions?\(\+\)/, ' inserções(+)')
          .replace(/ deletions?\(-\)/, ' remoções(-)');
      } catch {
        /* sem estatística */
      }
    }
    const md = renderNotes({
      version,
      previous: prev,
      commits,
      repo: arg('repo', process.env.GITHUB_REPOSITORY),
      assets,
      stats,
      sha: git('rev-parse', 'HEAD'),
    });
    const beta = /-beta\.\d+$/.test(version);
    const banner = beta ? '> ⚠️ **Versão beta (pré-lançamento).** Serve para testar o que vem aí e pode ter defeitos. Quem quer estabilidade deve usar a última versão estável; esta não aparece como atualização no app.\n\n' : '';
    writeFileSync(arg('out', 'RELEASE_NOTES.md'), banner + md, 'utf8');
    console.log(`Notas geradas (${commits.length} commits).`);
    return;
  }

  console.error('Uso: release-info.mjs next|notes [opções]');
  process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
