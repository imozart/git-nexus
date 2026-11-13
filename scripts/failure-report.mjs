#!/usr/bin/env node
// Monta o relatório de falha de uma execução do GitHub Actions (jobs, passos e trecho do log do erro).
//   GH_TOKEN=... node scripts/failure-report.mjs --repo dono/repo --run 123 --out relatorio.txt
// Usado pelo job "notify-failure" do release.yml, que envia o texto por e-mail.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ERROR_LINE = /(⨯|\berror\b|\bERR_[A-Z_]+|\bfailed\b|\bfatal\b|exit code|EPERM|ENOENT|Cannot find|not found)/i;

/** Remove cores ANSI e o carimbo de data/hora que o Actions põe no começo de cada linha. */
export function cleanLog(text) {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ''))
    .filter((l) => !l.startsWith('##[group]') && !l.startsWith('##[endgroup]'));
}

/** Escolhe as linhas mais úteis: as que parecem erro (com 1 linha de contexto) e o final do log. */
export function excerpt(lines, { errors = 25, tail = 25 } = {}) {
  const keep = new Set();
  const hits = [];
  lines.forEach((l, i) => ERROR_LINE.test(l) && hits.push(i));
  for (const i of hits.slice(-errors)) {
    keep.add(i);
    if (i > 0) keep.add(i - 1);
  }
  for (let i = Math.max(0, lines.length - tail); i < lines.length; i++) keep.add(i);
  const out = [];
  let prev = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i !== prev + 1 && out.length) out.push('   […]');
    if (lines[i].trim()) out.push(lines[i]);
    prev = i;
  }
  return out.join('\n');
}

/** Texto final do e-mail. `logs` mapeia o id do job para o texto bruto do log. */
export function buildReport({ run, jobs, logs }) {
  const failed = jobs.filter((j) => j.conclusion === 'failure');
  const cancelled = jobs.filter((j) => j.conclusion === 'cancelled');
  const head = run.head_commit?.message?.split('\n')[0] ?? '';
  const out = [
    `A execução "${run.name}" falhou em ${run.repository?.full_name ?? ''}.`,
    '',
    `Workflow : ${run.name} (#${run.run_number}, tentativa ${run.run_attempt ?? 1})`,
    `Gatilho  : ${run.event}`,
    `Branch   : ${run.head_branch}`,
    `Commit   : ${String(run.head_sha).slice(0, 7)} ${head}`,
    `Execução : ${run.html_url}`,
    '',
    `Jobs com falha (${failed.length}):`,
  ];
  for (const j of failed) {
    const steps = (j.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => s.name);
    out.push('', `── ${j.name} ──`, `Passo que falhou: ${steps.join(', ') || '(não identificado)'}`, `Job: ${j.html_url}`);
    const text = logs[j.id];
    out.push('', text ? excerpt(cleanLog(text)) : '(log indisponível)');
  }
  if (cancelled.length) {
    out.push('', `Jobs cancelados em consequência (${cancelled.length}): ${cancelled.map((j) => j.name).join(', ')}`);
  }
  out.push('', 'Nenhuma release foi publicada.');
  return out.join('\n');
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function main() {
  const arg = (n) => process.argv[process.argv.indexOf(`--${n}`) + 1];
  const repo = arg('repo');
  const runId = arg('run');
  const out = arg('out');
  if (!repo || !runId || !out) {
    console.error('Uso: failure-report.mjs --repo dono/repo --run <id> --out <arquivo>');
    process.exit(2);
  }
  const run = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${runId}`]));
  run.repository ??= { full_name: repo };
  const jobs = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`])).flatMap((p) => p.jobs);
  const logs = {};
  for (const j of jobs.filter((x) => x.conclusion === 'failure')) {
    try {
      logs[j.id] = gh(['api', `repos/${repo}/actions/jobs/${j.id}/logs`]);
    } catch (e) {
      console.error(`Sem log do job ${j.id}: ${e.message}`);
    }
  }
  writeFileSync(out, buildReport({ run, jobs, logs }));
  console.log(`Relatório gravado em ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
