// Versão e changelog dentro do app: o MESMO núcleo que o pipeline de release usa (scripts/lib/release-core.mjs).
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runGit, tm, type BumpChoice, type ReleaseInfo } from '@git-nexus/git-core';
import { computeNext, groupCommits, latestTag, parseCommit, renderSections, type ParsedCommit } from '../../../../scripts/lib/release-core.mjs';

const SEMVER = /^\d+\.\d+\.\d+$/;

async function readCommits(repoPath: string, range?: string): Promise<ParsedCommit[]> {
  const r = await runGit(repoPath, ['log', '--no-merges', '--format=%H%x1f%an%x1f%s%x1f%b%x1e', ...(range ? [range] : [])], { check: false });
  if (r.code !== 0) return []; // repositório sem commits
  return r.stdout
    .split('\x1e')
    .map((x) => x.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((rec) => {
      const [hash = '', author = '', subject = '', body = ''] = rec.split('\x1f');
      return parseCommit({ hash, author, subject, body });
    });
}

/** Versão inicial quando ainda não há tags: a do package.json da raiz (como no pipeline), senão 0.1.0. */
async function initialVersion(repoPath: string): Promise<{ version: string; fromPackage: boolean }> {
  try {
    const v = (JSON.parse(await readFile(join(repoPath, 'package.json'), 'utf8')) as { version?: string }).version;
    if (v && SEMVER.test(v)) return { version: v, fromPackage: true };
  } catch {
    /* sem package.json */
  }
  return { version: '0.1.0', fromPackage: false };
}

export async function getReleaseInfo(repoPath: string, bump: BumpChoice = 'auto'): Promise<ReleaseInfo> {
  const tags = (await runGit(repoPath, ['tag', '--list', 'v*'], { check: false })).stdout.split('\n').map((t) => t.trim()).filter(Boolean);
  const previous = latestTag(tags);
  const commits = await readCommits(repoPath, previous ? `${previous}..HEAD` : undefined);
  const init = await initialVersion(repoPath);
  const next = computeNext({ tags, commits, bumpOverride: bump, initialVersion: init.version });
  const branch = (await runGit(repoPath, ['branch', '--show-current'], { check: false })).stdout.trim();
  return {
    branch,
    previous,
    version: next.version,
    bump: next.bump,
    hasTags: tags.length > 0,
    tagExists: tags.includes(`v${next.version}`),
    initialFromPackage: !previous && init.fromPackage,
    commitCount: commits.length,
    sections: groupCommits(commits).map((s) => ({
      id: s.id,
      title: s.title,
      items: s.items.map((c) => ({ hash: c.hash, short: c.short, type: c.type, scope: c.scope, title: c.title, breaking: c.breaking, breakingNote: c.breakingNote, pr: c.pr, ticket: c.ticket, author: c.author })),
    })),
    markdown: renderSections(commits).join('\n').trim() + '\n',
  };
}

/** Cria a tag anotada vX.Y.Z no HEAD (local; o envio ao remoto é decisão sua). */
export async function createReleaseTag(repoPath: string, version: string, notes?: string): Promise<{ tag: string }> {
  if (!SEMVER.test(version)) throw new Error(tm(`Versão inválida: ${version}`, `Invalid version: ${version}`));
  const tag = `v${version}`;
  const exists = await runGit(repoPath, ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { check: false });
  if (exists.code === 0) throw new Error(tm(`A tag ${tag} já existe.`, `The tag ${tag} already exists.`));
  const msg = `GitNexus ${tag}${notes?.trim() ? `\n\n${notes.trim()}` : ''}`;
  await runGit(repoPath, ['tag', '-a', '--cleanup=verbatim', tag, '-m', msg]); // verbatim: não remove as linhas que começam com "#" (títulos do Markdown)
  return { tag };
}

/** Insere a versão no topo do CHANGELOG.md (cria o arquivo se não existir). Recusa duplicar a mesma versão. */
export async function writeChangelog(repoPath: string, version: string, markdown: string, date = new Date()): Promise<{ path: string }> {
  if (!SEMVER.test(version)) throw new Error(tm(`Versão inválida: ${version}`, `Invalid version: ${version}`));
  const file = join(repoPath, 'CHANGELOG.md');
  const current = await readFile(file, 'utf8').catch(() => '');
  const heading = `## [v${version}]`;
  if (current.includes(heading)) throw new Error(tm(`O CHANGELOG.md já tem a versão v${version}.`, `CHANGELOG.md already has version v${version}.`));
  const day = date.toISOString().slice(0, 10);
  // dentro do changelog cada seção desce um nível (### Novidades) para ficar abaixo do título da versão
  const body = markdown.replace(/^## /gm, '### ').trim();
  const block = `${heading} - ${day}\n\n${body}\n`;
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const text = current.replace(/\r\n/g, '\n');
  const m = /^# [^\n]*\n+/.exec(text);
  const next = m ? text.slice(0, m[0].length) + block + '\n' + text.slice(m[0].length) : `# Changelog\n\n${block}${text ? '\n' + text : ''}`;
  await writeFile(file, eol === '\r\n' ? next.replace(/\n/g, '\r\n') : next, 'utf8');
  return { path: 'CHANGELOG.md' };
}
