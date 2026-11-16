#!/usr/bin/env node
// Diz ao release.yml se o PR que acabou de entrar na main pediu para não publicar release (label "sem-release").
//   GITHUB_REPOSITORY=dono/repo SHA=<commit da main> node scripts/release-skip.mjs     (GH_TOKEN em CI; o job precisa de pull-requests: read)
// Escreve `skip=true|false` em $GITHUB_OUTPUT (e no stdout, para uso local). Regra em scripts/lib/skip-release.mjs.
//
// Se não conseguir consultar o GitHub, NÃO pula: publicar uma release a mais é recuperável, deixar de publicar sem ninguém perceber não é.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SKIP_LABEL, skipRequestedBy } from './lib/skip-release.mjs';

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.SHA;
  if (!repo || !sha) {
    console.error('Defina GITHUB_REPOSITORY e SHA.');
    process.exit(2);
  }

  let skip = false;
  try {
    // PRs ligados ao commit: o merge de um PR devolve esse PR; um push direto (como o chore(release) do pipeline) devolve lista vazia
    const out = execFileSync('gh', ['api', `repos/${repo}/commits/${sha}/pulls`, '--jq', '[.[] | {number, labels: [.labels[].name]}]'], { encoding: 'utf8' });
    const numbers = skipRequestedBy(JSON.parse(out));
    skip = numbers.length > 0;
    if (skip) console.log(`::notice title=Sem release::O PR ${numbers.map((n) => `#${n}`).join(', ')} tem a label "${SKIP_LABEL}". Os commits entram na próxima release.`);
    else console.log(`Nenhum PR de ${sha.slice(0, 7)} tem a label "${SKIP_LABEL}".`);
  } catch (e) {
    console.log(`::warning title=Label ${SKIP_LABEL}::Não consegui consultar os PRs do commit (${String(e.message).split('\n')[0]}); seguindo sem pular.`);
  }

  console.log(`skip=${skip}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
