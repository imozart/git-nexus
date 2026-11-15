// CHANGELOG.md: montagem, leitura e atualização do arquivo. Núcleo PURO, sem git nem sistema de arquivos
// (a parte que fala com o git e grava o arquivo está em scripts/changelog.mjs).
//
// Formato: o do "Keep a Changelog" (versões do mais novo para o mais antigo, `## [1.2.0] - 2026-01-31`, links de comparação no fim),
// em português, com as mesmas seções das notas da release (scripts/lib/release-core.mjs).

import { groupCommits } from './release-core.mjs';

export const CHANGELOG_FILE = 'CHANGELOG.md';

/**
 * Seções que entram no changelog. Ficam de fora o que não muda nada para quem usa o app e já está nas notas completas de cada
 * release: testes, CI, estilo e manutenção interna. `other` (commit fora do padrão) entra para nada sumir sem querer.
 */
export const VISIBLE = ['breaking', 'feat', 'fix', 'perf', 'refactor', 'docs', 'build', 'other'];

export const EMPTY_ENTRY = '_Só manutenção interna: nenhuma mudança visível para quem usa o app. A lista completa está nas notas da release._';

const STABLE = /^\d+\.\d+\.\d+$/;
const HEADING = /^## \[(\d+\.\d+\.\d+)\](?: - (\d{4}-\d{2}-\d{2}))?[ \t]*$/;
const REF_LINE = /^\[\d+\.\d+\.\d+\]: \S+[ \t]*$/;

export const isStableVersion = (v) => STABLE.test(v ?? '');

/** Compara versões `X.Y.Z` (negativo se a < b). */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

/** Versões estáveis (`vX.Y.Z`, sem beta) de uma lista de tags, da mais antiga para a mais nova, sem o `v`. */
export function stableVersions(tags) {
  return tags
    .map((t) => /^v(\d+\.\d+\.\d+)$/.exec(t)?.[1])
    .filter(Boolean)
    .sort(compareVersions);
}

/** A estável imediatamente anterior a `version` entre as tags (ou `null`). */
export function previousVersion(tags, version) {
  const lower = stableVersions(tags).filter((v) => compareVersions(v, version) < 0);
  return lower.at(-1) ?? null;
}

export function defaultPreamble(repo) {
  const releases = repo ? ` em cada [release](https://github.com/${repo}/releases)` : ' em cada release';
  return [
    '# Changelog',
    '',
    'Todas as mudanças relevantes do GitNexus, por versão. As versões seguem o [SemVer](https://semver.org/lang/pt-BR/) e o formato é inspirado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).',
    '',
    `Este arquivo é **gerado a partir dos commits (Conventional Commits)** a cada release estável, no mesmo commit \`chore(release)\` que grava a versão: não é preciso editá-lo à mão. Ficam fora da lista os commits de testes, CI, estilo e manutenção interna; a lista completa, com os pacotes para baixar, está${releases}.`,
  ].join('\n');
}

/** Corpo de uma versão: as seções visíveis (`### título`) com os commits, ou o aviso de "só manutenção". */
export function renderEntryBody(commits, repo) {
  const out = [];
  for (const s of groupCommits(commits)) {
    if (!VISIBLE.includes(s.id)) continue;
    out.push(`### ${s.title}`, '');
    for (const c of s.items) {
      const pr = c.pr ? (repo ? ` ([#${c.pr}](https://github.com/${repo}/pull/${c.pr}))` : ` (#${c.pr})`) : '';
      const hash = repo ? `[\`${c.short}\`](https://github.com/${repo}/commit/${c.hash})` : `\`${c.short}\``;
      out.push(`- ${c.scope ? `**${c.scope}:** ` : ''}${c.title}${pr} (${hash})`);
      if (s.id === 'breaking' && c.breakingNote) out.push(`  > ${c.breakingNote.replace(/\n+/g, ' ')}`);
    }
    out.push('');
  }
  return out.length ? out.join('\n').trim() : EMPTY_ENTRY;
}

/** Lê o arquivo: o que vem antes da primeira versão (`preamble`) e cada versão com seu texto exatamente como está (edições à mão são preservadas). */
export function parseChangelog(text) {
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n').filter((l) => !REF_LINE.test(l));
  const preamble = [];
  const entries = [];
  let current = null;
  for (const line of lines) {
    const m = HEADING.exec(line);
    if (m) {
      current = { version: m[1], date: m[2] ?? '', body: [] };
      entries.push(current);
    } else if (current) current.body.push(line);
    else preamble.push(line);
  }
  return {
    preamble: preamble.join('\n').trim(),
    entries: entries.map((e) => ({ version: e.version, date: e.date, body: e.body.join('\n').trim() })),
  };
}

/** Monta o arquivo: preâmbulo, versões da mais nova para a mais antiga e, com `repo`, os links `[1.2.0]: …/compare/v1.1.0...v1.2.0`. */
export function renderChangelog({ preamble, entries }, repo) {
  const sorted = [...entries].sort((a, b) => compareVersions(b.version, a.version));
  const out = [preamble.trim(), ''];
  for (const e of sorted) out.push(`## [${e.version}]${e.date ? ` - ${e.date}` : ''}`, '', e.body.trim(), '');
  if (repo && sorted.length) {
    sorted.forEach((e, i) => {
      const older = sorted[i + 1];
      out.push(`[${e.version}]: https://github.com/${repo}/${older ? `compare/v${older.version}...v${e.version}` : `releases/tag/v${e.version}`}`);
    });
    out.push('');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/**
 * Acrescenta (ou refaz) a versão `entry` no texto do changelog. Refazer a mesma versão com os mesmos commits devolve o MESMO texto,
 * então reexecutar o pipeline não gera commit à toa. Nunca mexe nas outras versões.
 */
export function upsertEntry(text, entry, repo) {
  const parsed = text?.trim() ? parseChangelog(text) : { preamble: defaultPreamble(repo), entries: [] };
  const rest = parsed.entries.filter((e) => e.version !== entry.version);
  return renderChangelog({ preamble: parsed.preamble || defaultPreamble(repo), entries: [...rest, entry] }, repo);
}
