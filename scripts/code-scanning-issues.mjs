#!/usr/bin/env node
// Transforma os alertas abertos do code scanning (CodeQL) em issues: um marco, uma issue por regra e uma de acompanhamento.
//
//   node scripts/code-scanning-issues.mjs --repo dono/repo [--dry]
//
// Usa o `gh` (no Actions já vem com GH_TOKEN; precisa de security-events: read e issues: write). Pode rodar quantas vezes quiser:
// a issue de cada regra é achada pelo marcador no corpo, então não duplica; só o bloco gerenciado do corpo é reescrito.
// Type, sub-issue e "relates to" usam a API GraphQL e, se falharem, só avisam (o essencial é a issue existir no marco).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LABEL,
  LABEL_COLOR,
  LABEL_DESCRIPTION,
  MILESTONE_DESCRIPTION,
  findTrackingIssue,
  pickMilestone,
  planSync,
  readBlock,
  renderAlertBlock,
  renderTrackingBlock,
  replaceBlock,
  ruleIssueBody,
  ruleIssueTitle,
  ruleOf,
  trackingIssueBody,
} from './lib/code-scanning.mjs';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
const warn = (msg) => console.warn(`::warning::${msg}`);
const graphql = (query) => JSON.parse(gh('api', 'graphql', '-H', 'GraphQL-Features: sub_issues', '-f', `query=${query}`));

let seq = 0;
function bodyFile(text) {
  const file = join(tmpdir(), `code-scanning-issue-${process.pid}-${seq++}.md`);
  writeFileSync(file, text, 'utf8');
  return file;
}

/** Alertas abertos (a API pagina; `--jq '.[]'` devolve um objeto por linha). */
function openAlerts(repo) {
  const out = gh('api', '--paginate', `repos/${repo}/code-scanning/alerts?state=open&per_page=100`, '--jq', '.[]');
  return out ? out.split('\n').map((l) => JSON.parse(l)) : [];
}

const openIssues = (repo) => JSON.parse(gh('issue', 'list', '--repo', repo, '--label', LABEL, '--state', 'open', '--json', 'number,title,body', '--limit', '200'));

function ensureLabel(repo) {
  try {
    gh('label', 'create', LABEL, '--repo', repo, '--color', LABEL_COLOR, '--description', LABEL_DESCRIPTION);
  } catch {
    /* o rótulo já existe */
  }
}

function ensureMilestone(repo, today) {
  const milestones = JSON.parse(gh('api', '--paginate', `repos/${repo}/milestones?state=all&per_page=100`, '--jq', '[.[] | {number, title, state, html_url}]'));
  const pick = pickMilestone(milestones, today);
  if (pick.existing) return pick.existing;
  return JSON.parse(gh('api', `repos/${repo}/milestones`, '-f', `title=${pick.title}`, '-f', `description=${MILESTONE_DESCRIPTION}`, '-f', 'state=open'));
}

/** Type (Bug/Task), sub-issue e "relates to"; qualquer falha vira só um aviso. */
function decorate(repo, { tracking, rule }) {
  try {
    const [owner, name] = repo.split('/');
    const types = graphql(`{repository(owner:"${owner}",name:"${name}"){issueTypes(first:20){nodes{id name}}}}`).data.repository.issueTypes.nodes;
    const typeId = (n) => types.find((t) => t.name === n)?.id;
    const idOf = (n) => JSON.parse(gh('issue', 'view', String(n), '--repo', repo, '--json', 'id')).id;
    const parent = idOf(tracking);
    if (typeId('Task')) graphql(`mutation{updateIssue(input:{id:"${parent}",issueTypeId:"${typeId('Task')}"}){issue{number}}}`);
    for (const n of rule) {
      const child = idOf(n);
      if (typeId('Bug')) graphql(`mutation{updateIssue(input:{id:"${child}",issueTypeId:"${typeId('Bug')}"}){issue{number}}}`);
      for (const m of [`addSubIssue(input:{issueId:"${parent}",subIssueId:"${child}"})`, `addRelatesTo(input:{issueId:"${parent}",relatedIssueId:"${child}"})`]) {
        try {
          graphql(`mutation{${m}{issue{number}}}`); // já ligada de uma execução anterior? o erro é esperado
        } catch {
          /* já existe */
        }
      }
    }
  } catch (e) {
    warn(`Type, sub-issues e relates to não foram aplicados: ${String(e.message).split('\n')[0]}`);
  }
}

function main() {
  const repo = arg('repo');
  if (!repo) {
    console.error('Uso: code-scanning-issues.mjs --repo dono/repo [--dry]');
    process.exit(2);
  }
  const dry = process.argv.includes('--dry');
  const today = new Date().toISOString().slice(0, 10);
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

  const issues = openIssues(repo);
  const plan = planSync(openAlerts(repo), issues);
  const summary = { alertas: plan.groups.reduce((n, g) => n + g.alerts.length, 0), criar: plan.create.map((g) => g.ruleId), atualizar: plan.update.map((u) => u.issue.number), resolver: plan.resolve.map((i) => i.number) };
  console.log(JSON.stringify(summary));
  if (dry || (!plan.create.length && !plan.update.length && !plan.resolve.length)) return;

  ensureLabel(repo);
  const tracking = findTrackingIssue(issues);
  // marco só quando há o que abrir (issue de regra nova ou acompanhamento ainda inexistente)
  const milestone = plan.create.length || (!tracking && plan.groups.length) ? ensureMilestone(repo, today) : null;
  const items = []; // { number, ruleId, open } de todas as regras desta execução

  for (const { issue, group } of plan.update) {
    const body = replaceBlock(issue.body, renderAlertBlock(group.alerts, readBlock(issue.body)));
    if (body !== issue.body) gh('issue', 'edit', String(issue.number), '--repo', repo, '--body-file', bodyFile(body));
    items.push({ number: issue.number, ruleId: group.ruleId, open: group.alerts.length });
  }
  for (const group of plan.create) {
    const url = gh('issue', 'create', '--repo', repo, '--title', ruleIssueTitle(group.ruleId), '--label', 'bug', '--label', LABEL, '--milestone', milestone.title, '--body-file', bodyFile(ruleIssueBody({ group, repo, version })));
    items.push({ number: Number(url.split('/').pop()), ruleId: group.ruleId, open: group.alerts.length });
    console.log(`Issue aberta: ${url}`);
  }
  for (const issue of plan.resolve) {
    const body = replaceBlock(issue.body, renderAlertBlock([], readBlock(issue.body)));
    gh('issue', 'edit', String(issue.number), '--repo', repo, '--body-file', bodyFile(body));
    gh('issue', 'close', String(issue.number), '--repo', repo, '--reason', 'completed', '--comment', 'Nenhum alerta aberto desta regra no code scanning (corrigidos ou dispensados). Fechada pela automação.');
    items.push({ number: issue.number, ruleId: ruleOf(issue), open: 0 });
  }

  // acompanhamento: uma issue por marco, com a lista das regras
  if (tracking) {
    const body = replaceBlock(tracking.body, renderTrackingBlock(items, readBlock(tracking.body)));
    if (body !== tracking.body) gh('issue', 'edit', String(tracking.number), '--repo', repo, '--body-file', bodyFile(body));
    if (!plan.groups.length) {
      gh('issue', 'close', String(tracking.number), '--repo', repo, '--reason', 'completed', '--comment', 'Nenhum alerta aberto no code scanning. O marco pode ser conferido e fechado por quem o mantém.');
    }
    decorate(repo, { tracking: tracking.number, rule: items.map((i) => i.number) });
  } else if (milestone) {
    const url = gh('issue', 'create', '--repo', repo, '--title', 'feat: corrigir os alertas do code scanning (acompanhamento)', '--label', 'enhancement', '--label', LABEL, '--milestone', milestone.title, '--body-file', bodyFile(trackingIssueBody({ milestoneUrl: milestone.html_url, block: renderTrackingBlock(items) })));
    console.log(`Acompanhamento: ${url}`);
    decorate(repo, { tracking: Number(url.split('/').pop()), rule: items.map((i) => i.number) });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
