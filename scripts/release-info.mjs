#!/usr/bin/env node
// Calcula a próxima versão (SemVer via Conventional Commits) e gera as notas da release.
// Sem dependências: roda no GitHub Actions e localmente.
//
//   node scripts/release-info.mjs next  [--bump auto|major|minor|patch]
//   node scripts/release-info.mjs notes --version 1.2.3 [--repo dono/repo] [--assets pasta] [--out notas.md]
//
// Regras de versão (a cada merge na master sai uma release):
//   breaking (`!` ou "BREAKING CHANGE:")  -> major
//   feat                                  -> minor
//   qualquer outra coisa                  -> patch
// A tag `vX.Y.Z` é a fonte da verdade; sem tags, a primeira versão é a do package.json raiz.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const SUBJECT = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;

const SECTIONS = [
  { id: 'breaking', title: '⚠️ Mudanças que quebram compatibilidade' },
  { id: 'feat', title: '✨ Novidades' },
  { id: 'fix', title: '🐛 Correções' },
  { id: 'perf', title: '⚡ Performance' },
  { id: 'refactor', title: '♻️ Refatorações' },
  { id: 'docs', title: '📚 Documentação' },
  { id: 'test', title: '🧪 Testes' },
  { id: 'build', title: '📦 Build e dependências' },
  { id: 'ci', title: '🤖 CI/CD' },
  { id: 'style', title: '🎨 Estilo' },
  { id: 'chore', title: '🧹 Manutenção' },
  { id: 'other', title: '🔹 Outras alterações' },
];

// ---------------------------------------------------------------- git helpers
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

export function latestTag(tags) {
  return (
    tags
      .filter((t) => SEMVER_TAG.test(t))
      .sort((a, b) => {
        const pa = SEMVER_TAG.exec(a).slice(1).map(Number);
        const pb = SEMVER_TAG.exec(b).slice(1).map(Number);
        return pb[0] - pa[0] || pb[1] - pa[1] || pb[2] - pa[2];
      })[0] ?? null
  );
}

// ---------------------------------------------------------------- parsing
export function parseCommit({ hash, author, subject, body }) {
  const m = SUBJECT.exec(subject);
  let type = 'other';
  let scope = '';
  let breaking = false;
  let title = subject;
  if (m) {
    type = m[1].toLowerCase();
    scope = m[2] ?? '';
    breaking = Boolean(m[3]);
    title = m[4];
    if (!SECTIONS.some((s) => s.id === type)) type = 'other';
  }
  const breakingNote = /^BREAKING[ -]CHANGE:\s*(.+)$/ms.exec(body ?? '')?.[1]?.trim();
  if (breakingNote) breaking = true;
  const pr = /\(#(\d+)\)\s*$/.exec(title)?.[1] ?? null;
  if (pr) title = title.replace(/\s*\(#\d+\)\s*$/, '');
  const ticket = /^Refs?:\s*(\S+)/im.exec(body ?? '')?.[1] ?? null;
  return { hash, short: hash.slice(0, 7), author, type, scope, breaking, breakingNote: breakingNote ?? null, title, pr, ticket };
}

export function readCommits(range) {
  const raw = git('log', '--no-merges', '--format=%H%x1f%an%x1f%s%x1f%b%x1e', ...(range ? [range] : []));
  return raw
    .split('\x1e')
    .map((r) => r.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((rec) => {
      const [hash, author, subject, body] = rec.split('\x1f');
      return parseCommit({ hash, author, subject, body });
    });
}

// ---------------------------------------------------------------- versão
export function decideBump(commits) {
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  return 'patch';
}

export function bumpVersion(base, bump) {
  const [maj, min, pat] = base.split('.').map(Number);
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

export function computeNext({ tags, commits, bumpOverride = 'auto', initialVersion }) {
  const prev = latestTag(tags);
  if (!prev) return { previous: null, version: initialVersion, bump: 'initial' };
  const bump = bumpOverride === 'auto' ? decideBump(commits) : bumpOverride;
  return { previous: prev, version: bumpVersion(prev.slice(1), bump), bump };
}

// ---------------------------------------------------------------- notas
const fmtSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

const DOWNLOAD_ROWS = [
  { os: 'Windows', kind: 'Instalador', re: /-win-(x64|arm64)-setup\.exe$/ },
  { os: 'Windows', kind: 'Portátil (sem instalar)', re: /-win-(x64|arm64)-portable\.exe$/ },
  { os: 'Windows', kind: 'ZIP', re: /-win-(x64|arm64)\.zip$/ },
  { os: 'macOS', kind: 'DMG', re: /-mac-(x64|arm64)\.dmg$/ },
  { os: 'macOS', kind: 'ZIP', re: /-mac-(x64|arm64)\.zip$/ },
  { os: 'Linux', kind: 'AppImage (portátil)', re: /-linux-(x64|arm64)\.AppImage$/ },
  { os: 'Linux', kind: 'Debian/Ubuntu (.deb)', re: /-linux-(amd64|arm64)\.deb$/ },
  { os: 'Linux', kind: 'Fedora/RHEL (.rpm)', re: /-linux-(x86_64|aarch64)\.rpm$/ },
  { os: 'Linux', kind: 'tar.gz', re: /-linux-(x64|arm64)\.tar\.gz$/ },
];

const ARCH_LABEL = { x64: 'x64', amd64: 'x64', x86_64: 'x64', arm64: 'ARM64', aarch64: 'ARM64' };

export function renderDownloads({ assets, repo, tag }) {
  const rows = [];
  for (const def of DOWNLOAD_ROWS) {
    for (const a of assets) {
      const m = def.re.exec(a.name);
      if (!m) continue;
      const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(a.name)}`;
      rows.push(`| ${def.os} | ${def.kind} | ${ARCH_LABEL[m[1]] ?? m[1]} | [\`${a.name}\`](${url}) | ${fmtSize(a.size)} |`);
    }
  }
  if (!rows.length) return '';
  return ['## ⬇️ Downloads', '', '| Sistema | Pacote | Arquitetura | Arquivo | Tamanho |', '|---|---|---|---|---|', ...rows, ''].join('\n');
}

export function renderNotes({ version, previous, commits, repo, assets = [], stats = '', sha = '' }) {
  const tag = `v${version}`;
  const link = (c) => (repo ? `[\`${c.short}\`](https://github.com/${repo}/commit/${c.hash})` : `\`${c.short}\``);
  const prLink = (c) => (c.pr ? (repo ? ` ([#${c.pr}](https://github.com/${repo}/pull/${c.pr}))` : ` (#${c.pr})`) : '');
  const line = (c) =>
    `- ${c.scope ? `**${c.scope}:** ` : ''}${c.title}${prLink(c)}${c.ticket ? ` · \`${c.ticket}\`` : ''} — ${link(c)} · ${c.author}`;

  const out = [`# GitNexus ${tag}`, ''];
  out.push(
    previous
      ? `Esta versão reúne **${commits.length}** alteração(ões) desde a \`${previous}\`${stats ? ` (${stats})` : ''}.`
      : `Primeira release publicada, com **${commits.length}** alteração(ões).`,
    '',
  );

  const breaking = commits.filter((c) => c.breaking);
  if (breaking.length) {
    out.push(`## ${SECTIONS[0].title}`, '');
    for (const c of breaking) out.push(line(c), ...(c.breakingNote ? [`  > ${c.breakingNote.replace(/\n+/g, ' ')}`] : []));
    out.push('');
  }
  for (const s of SECTIONS.slice(1)) {
    const items = commits.filter((c) => c.type === s.id && !c.breaking); // breaking já listado acima
    if (!items.length) continue;
    out.push(`## ${s.title}`, '', ...items.map(line), '');
  }
  if (!commits.length) out.push('_Nenhuma alteração de código registrada (build manual)._', '');

  const downloads = renderDownloads({ assets, repo, tag });
  if (downloads) out.push(downloads);

  out.push(
    '## 🔐 Verificação',
    '',
    'O arquivo `SHA256SUMS.txt` lista o hash SHA-256 de cada pacote (`sha256sum -c SHA256SUMS.txt`).',
    '',
    '## ℹ️ Observações de instalação',
    '',
    '- **Windows:** os executáveis não têm assinatura de código; o SmartScreen pode avisar ("Mais informações" → "Executar assim mesmo"). O pacote *Portátil* não instala nada e guarda os dados em `GitNexusData/` ao lado do `.exe`.',
    '- **macOS:** os apps não são assinados/notarizados. Se o sistema disser que o app está "danificado", rode `xattr -cr /Applications/GitNexus.app` e abra novamente.',
    '- **Linux:** no AppImage, `chmod +x GitNexus-*.AppImage` antes de executar; os dados ficam em `GitNexusData/` ao lado do arquivo.',
    '',
  );

  if (previous && repo) out.push(`**Comparação completa:** https://github.com/${repo}/compare/${previous}...${tag}`, '');
  const authors = [...new Set(commits.map((c) => c.author))].sort((a, b) => a.localeCompare(b));
  if (authors.length) out.push(`**Contribuidores:** ${authors.join(', ')}`, '');
  if (sha) out.push(`<sub>Compilado a partir do commit \`${sha.slice(0, 7)}\` pelo GitHub Actions.</sub>`, '');
  return out.join('\n');
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
    const info = computeNext({ tags, commits, bumpOverride: arg('bump', 'auto'), initialVersion: initial });
    console.log(JSON.stringify({ ...info, commits: commits.length }, null, 2));
    setOutput('version', info.version);
    setOutput('tag', `v${info.version}`);
    setOutput('previous', info.previous ?? '');
    setOutput('bump', info.bump);
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
    writeFileSync(arg('out', 'RELEASE_NOTES.md'), md, 'utf8');
    console.log(`Notas geradas (${commits.length} commits).`);
    return;
  }

  console.error('Uso: release-info.mjs next|notes [opções]');
  process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
