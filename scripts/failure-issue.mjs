#!/usr/bin/env node
// Abre (ou atualiza) a issue de falha da release, com o relatório montado por scripts/failure-report.mjs.
//
//   node scripts/failure-issue.mjs --repo dono/repo --run-url <url> --run-number 42 --report relatorio.txt [--sha <commit>] [--kind release|health] [--dry]
//
// Usa o `gh` (no Actions já vem com GH_TOKEN). Se já há uma issue aberta com o rótulo release-failure, comenta nela em vez de abrir outra.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEALTH, LABEL, LABEL_COLOR, LABEL_DESCRIPTION, failureBody, issueTitle, planIssue } from './lib/failure-issue.mjs';

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
  const kind = arg('kind') ?? 'release';
  if (kind !== 'release' && kind !== 'health') throw new Error('--kind deve ser release ou health');
  const health = kind === 'health';
  const label = health ? HEALTH.label : LABEL;
  const title = health ? HEALTH.title(runNumber) : issueTitle(runNumber);
  const body = failureBody({ report: readFileSync(reportFile, 'utf8'), runUrl, runNumber, sha: arg('sha'), ...(health ? { heading: HEALTH.heading, hint: HEALTH.hint } : {}) });
  const bodyFile = join(tmpdir(), `failure-issue-${process.pid}.md`);
  writeFileSync(bodyFile, body, 'utf8');

  const open = JSON.parse(gh('issue', 'list', '--repo', repo, '--label', label, '--state', 'open', '--json', 'number', '--limit', '1')).map((i) => i.number);
  const plan = planIssue(open);
  if (process.argv.includes('--dry')) {
    console.log(JSON.stringify({ ...plan, label, title, bodyChars: body.length }));
    return;
  }
  if (plan.action === 'comment') {
    gh('issue', 'comment', String(plan.number), '--repo', repo, '--body-file', bodyFile);
    console.log(`Comentário na issue #${plan.number}.`);
    return;
  }
  try {
    gh('label', 'create', label, '--repo', repo, '--color', health ? HEALTH.color : LABEL_COLOR, '--description', health ? HEALTH.description : LABEL_DESCRIPTION);
  } catch {
    /* o rótulo já existe */
  }
  console.log(gh('issue', 'create', '--repo', repo, '--title', title, '--label', label, '--body-file', bodyFile));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
