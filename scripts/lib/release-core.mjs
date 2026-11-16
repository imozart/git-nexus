// Núcleo PURO do cálculo de versão e das notas (Conventional Commits). Sem git, sem sistema de arquivos:
// usado pelo pipeline (scripts/release-info.mjs) e pelo app (painel "Versão", via esbuild).

const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const SUBJECT = /^(\w+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/;

export const SECTIONS = [
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

// ---------------------------------------------------------------- versão
export function decideBump(commits) {
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  return 'patch';
}

/**
 * Tipos de commit que mudam o que chega ao usuário (código do app, pacotes e dependências de produção). Os demais (docs, test, ci, style,
 * chore) só mexem em documentação, testes, pipelines e ferramentas: a versão não muda e não há o que baixar. `other` (commit fora do
 * padrão) conta, porque não dá para saber o que ele faz.
 */
export const RELEASE_TYPES = ['feat', 'fix', 'perf', 'refactor', 'build', 'other'];

/** Algum commit pede uma release? (breaking sempre pede.) Sem commits, não. */
export function shouldRelease(commits) {
  return commits.some((c) => c.breaking || RELEASE_TYPES.includes(c.type));
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

// Beta (pré-lançamento): a versão que SAIRIA como estável + "-beta.N". N conta os betas já publicados dessa mesma base.
// Ex.: estável prevista 1.3.0 e tag v1.3.0-beta.1 existente -> 1.3.0-beta.2. Tags beta nunca entram em latestTag/computeNext.
const BETA_TAG = /^v(\d+\.\d+\.\d+)-beta\.(\d+)$/;

export function computeBeta(opts) {
  const next = computeNext(opts);
  const n = opts.tags.reduce((max, t) => {
    const m = BETA_TAG.exec(t);
    return m && m[1] === next.version ? Math.max(max, Number(m[2])) : max;
  }, 0);
  return { ...next, stable: next.version, version: `${next.version}-beta.${n + 1}`, channel: 'beta' };
}

/** O beta mais recente (maior N) da base `X.Y.Z`, ou `null`. Serve para a agenda não publicar dois betas sem nada novo entre eles. */
export function latestBetaTag(tags, base) {
  let best = null;
  let bestN = 0;
  for (const t of tags) {
    const m = BETA_TAG.exec(t);
    if (m && m[1] === base && Number(m[2]) > bestN) {
      best = t;
      bestN = Number(m[2]);
    }
  }
  return best;
}

/** O commit é o que o pipeline grava depois de uma release (`chore(release): v1.2.3`)? Não entra em notas nem decide versão. */
export const isReleaseCommit = (c) => c.type === 'chore' && c.scope === 'release';

// ---------------------------------------------------------------- notas
const fmtSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

const DOWNLOAD_ROWS = [
  { os: 'Windows', kind: 'Instalador', re: /-win-(x64|arm64)-setup\.exe$/ },
  { os: 'Windows', kind: 'ZIP (portátil, sem instalar)', re: /-win-(x64|arm64)\.zip$/ },
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

/** Commits agrupados por seção (breaking primeiro, depois os tipos na ordem de SECTIONS). Seções vazias são omitidas. */
export function groupCommits(commits) {
  const out = [];
  const breaking = commits.filter((c) => c.breaking);
  if (breaking.length) out.push({ id: 'breaking', title: SECTIONS[0].title, items: breaking });
  for (const s of SECTIONS.slice(1)) {
    const items = commits.filter((c) => c.type === s.id && !c.breaking); // breaking já listado acima
    if (items.length) out.push({ id: s.id, title: s.title, items });
  }
  return out;
}

/** Uma linha de commit em Markdown. `repo` (dono/repo no GitHub) é opcional e só serve para os links. */
export function renderCommitLine(c, repo) {
  const link = repo ? `[\`${c.short}\`](https://github.com/${repo}/commit/${c.hash})` : `\`${c.short}\``;
  const pr = c.pr ? (repo ? ` ([#${c.pr}](https://github.com/${repo}/pull/${c.pr}))` : ` (#${c.pr})`) : '';
  return `- ${c.scope ? `**${c.scope}:** ` : ''}${c.title}${pr}${c.ticket ? ` · \`${c.ticket}\`` : ''} — ${link} · ${c.author}`;
}

/** Corpo do changelog (seções), sem cabeçalho de versão: reutilizado pelas notas da release e pelo app. */
export function renderSections(commits, repo) {
  const out = [];
  for (const s of groupCommits(commits)) {
    out.push(`## ${s.title}`, '');
    for (const c of s.items) {
      out.push(renderCommitLine(c, repo));
      if (s.id === 'breaking' && c.breakingNote) out.push(`  > ${c.breakingNote.replace(/\n+/g, ' ')}`);
    }
    out.push('');
  }
  return out;
}

export function renderNotes({ version, previous, commits, repo, assets = [], stats = '', sha = '' }) {
  const tag = `v${version}`;

  const out = [`# GitNexus ${tag}`, ''];
  out.push(
    previous
      ? `Esta versão reúne **${commits.length}** alteração(ões) desde a \`${previous}\`${stats ? ` (${stats})` : ''}.`
      : `Primeira release publicada, com **${commits.length}** alteração(ões).`,
    '',
  );

  out.push(...renderSections(commits, repo));
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
    '- **Windows:** os executáveis não têm assinatura de código; o SmartScreen pode avisar ("Mais informações" → "Executar assim mesmo"). O pacote *ZIP* é portátil: extraia, execute `GitNexus.exe` e os dados ficam em `GitNexusData/` ao lado dele. Todos os binários são de 64 bits (x64 ou ARM64).',
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
