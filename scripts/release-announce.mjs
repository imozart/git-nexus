#!/usr/bin/env node
// Depois de publicar uma release (beta ou estável), comenta nos PRs e nas issues dela a versão em que a mudança chegou: um comentário só por alvo,
// atualizado a cada release (a beta vira "Em homologação" e, quando a estável sai, o mesmo comentário vira "Publicado"). Veja scripts/lib/release-announce.mjs
// e docs/AUTOMATION.md.
//
//   GH_TOKEN=... node scripts/release-announce.mjs --tag v1.21.0 --repo dono/repo [--sha <commit>] [--prerelease true|false] [--date AAAA-MM-DD] [--dry-run]
//
// Nunca falha a release: o job do workflow é `continue-on-error` e cada comentário que não der para escrever só vira um aviso no log.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MARKER, MAX_COMMITS, MAX_PRS, buildModel, isBetaTag, parseState, previousStable, renderIssueComment, renderPrComment, sameBody } from './lib/release-announce.mjs';

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const gh = (...args) => run('gh', args);
const git = (...args) => run('git', args).trim();
const jsonLines = (text) => text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

function main() {
  const tag = arg('tag');
  const repo = arg('repo', process.env.GITHUB_REPOSITORY);
  if (!tag || !repo) {
    console.error('Uso: release-announce.mjs --tag vX.Y.Z[-beta.N] --repo dono/repo [--sha commit] [--prerelease true|false] [--date AAAA-MM-DD] [--dry-run]');
    process.exit(2);
  }
  const dry = process.argv.includes('--dry-run');
  const sha = arg('sha', 'HEAD');
  const prerelease = arg('prerelease', String(isBetaTag(tag))) === 'true';
  const date = arg('date', new Date().toISOString().slice(0, 10));

  const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
  const previous = previousStable(tags, tag);
  const range = previous ? `${previous}..${sha}` : sha;
  const shas = git('log', '--format=%H', `--max-count=${MAX_COMMITS}`, range).split('\n').filter(Boolean);
  console.log(`${tag}${prerelease ? ' (beta)' : ''}: ${shas.length} commits em ${range}${dry ? ' [dry-run]' : ''}`);

  // PRs da release: os que têm o commit de merge OU o commit de ponta (head) entre os commits dela. Só a API "commits/{sha}/pulls" não serve: ela devolve
  // apenas o PR que INTRODUZIU o commit na main, então os PRs de origem de um PR agregador não apareceriam.
  const inRange = new Set(shas);
  const listed = jsonLines(
    gh('pr', 'list', '--repo', repo, '--state', 'all', '--limit', '200', '--json', 'number,title,state,mergedAt,headRefOid,mergeCommit', '--jq', '.[] | {number, title, state, merged: (.mergedAt != null), head: .headRefOid, merge: (.mergeCommit.oid // "")}'),
  );
  const candidates = listed
    .filter((p) => (p.merged || p.state === 'OPEN') && (inRange.has(p.head) || (p.merge && inRange.has(p.merge))))
    .sort((a, b) => b.number - a.number)
    .slice(0, MAX_PRS);

  // commits (para achar o PR agregador) e issues (Closes) de cada um
  const prs = [];
  for (const p of candidates) {
    try {
      const info = JSON.parse(gh('pr', 'view', String(p.number), '--repo', repo, '--json', 'commits,closingIssuesReferences'));
      prs.push({
        number: p.number,
        title: p.title,
        state: p.merged ? 'merged' : 'open',
        commits: (info.commits ?? []).map((c) => c.oid),
        issues: (info.closingIssuesReferences ?? []).map((i) => i.number),
      });
    } catch (e) {
      console.warn(`aviso: não consegui os commits e issues do PR #${p.number} (${firstLine(e)})`);
    }
  }
  const model = buildModel({ repo, tag, previous, prerelease, date, prs });
  console.log(`${model.prs.length} PRs, ${model.issues.length} issues${model.omitted ? `, ${model.omitted} PRs fora do teto de ${MAX_PRS}` : ''}`);

  const existingOf = (n) => {
    const out = gh('api', '--paginate', `repos/${repo}/issues/${n}/comments?per_page=100`, '--jq', `.[] | select(.body | startswith("${MARKER}")) | {id, body}`);
    return jsonLines(out)[0] ?? null;
  };
  const upsert = (label, n, render) => {
    try {
      const existing = existingOf(n);
      const out = render(existing ? parseState(existing.body) : null);
      if (!out) return console.log(`${label} #${n}: já publicado numa estável, nada a atualizar`);
      if (existing && sameBody(existing.body, out.body)) return console.log(`${label} #${n}: sem mudança`);
      if (dry) return console.log(`${label} #${n}: ${existing ? 'atualizaria' : 'comentaria'}\n${out.body}`);
      if (!existing) gh('api', '-X', 'POST', `repos/${repo}/issues/${n}/comments`, '-f', `body=${out.body}`);
      else {
        try {
          gh('api', '-X', 'PATCH', `repos/${repo}/issues/comments/${existing.id}`, '-f', `body=${out.body}`);
        } catch {
          // comentário de outra pessoa com a mesma marca: não dá para editar, então comenta de novo
          gh('api', '-X', 'POST', `repos/${repo}/issues/${n}/comments`, '-f', `body=${out.body}`);
        }
      }
      console.log(`${label} #${n}: ${existing ? 'atualizado' : 'comentado'}`);
    } catch (e) {
      console.warn(`aviso: ${label} #${n} não recebeu o comentário (${firstLine(e)})`);
    }
  };

  for (const pr of model.prs) upsert('PR', pr.number, (prev) => renderPrComment(model, pr, prev));
  for (const issue of model.issues) upsert('issue', issue.number, (prev) => renderIssueComment(model, issue, prev));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
