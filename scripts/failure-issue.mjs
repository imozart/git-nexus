#!/usr/bin/env node
// Abre (ou atualiza) a issue de falha da release, com o relatório montado por scripts/failure-report.mjs.
//
//   node scripts/failure-issue.mjs --repo dono/repo --run-url <url> --run-number 42 --report relatorio.txt [--sha <commit>] [--dry]
//
// Usa o `gh` (no Actions já vem com GH_TOKEN). Se já há uma issue aberta com o rótulo release-failure, comenta nela em vez de abrir outra.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABEL, LABEL_COLOR, LABEL_DESCRIPTION, failureBody, issueTitle, planIssue } from './lib/failure-issue.mjs';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function main() {
  const repo = arg('repo');
  const runUrl = arg('run-url');
  const runNumber = arg('run-number');
  const reportFile = arg('report');
  if (!repo || !runUrl || !runNumber || !reportFile) {
    console.error('Uso: failure-issue.mjs --repo dono/repo --run-url <url> --run-number N --report arquivo.txt [--sha commit] [--dry]');
    process.exit(2);
  }
  const body = failureBody({ report: readFileSync(reportFile, 'utf8'), runUrl, runNumber, sha: arg('sha') });
  const bodyFile = join(tmpdir(), `failure-issue-${process.pid}.md`);
  writeFileSync(bodyFile, body, 'utf8');

  const open = JSON.parse(gh('issue', 'list', '--repo', repo, '--label', LABEL, '--state', 'open', '--json', 'number', '--limit', '1')).map((i) => i.number);
  const plan = planIssue(open);
  if (process.argv.includes('--dry')) {
    console.log(JSON.stringify({ ...plan, title: issueTitle(runNumber), bodyChars: body.length }));
    return;
  }
  if (plan.action === 'comment') {
    gh('issue', 'comment', String(plan.number), '--repo', repo, '--body-file', bodyFile);
    console.log(`Comentário na issue #${plan.number}.`);
    return;
  }
  try {
    gh('label', 'create', LABEL, '--repo', repo, '--color', LABEL_COLOR, '--description', LABEL_DESCRIPTION);
  } catch {
    /* o rótulo já existe */
  }
  console.log(gh('issue', 'create', '--repo', repo, '--title', issueTitle(runNumber), '--label', LABEL, '--body-file', bodyFile));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
