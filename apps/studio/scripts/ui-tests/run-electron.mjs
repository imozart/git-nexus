#!/usr/bin/env node
// Testes na JANELA REAL do Electron: abre o app EMPACOTADO (o mesmo executável que vai para o usuário), com a porta de depuração do Chromium,
// e dirige a tela por CDP. Ao contrário do run.mjs (renderer num navegador headless, ligado a um harness), aqui roda tudo de verdade:
// processo principal, preload, ponte IPC, o worker (UtilityProcess) com o git real, o carregamento por file:// e a pasta de dados.
// O smoke test (GITNEXUS_SMOKE) só prova que a janela abre e que UMA chamada atravessa a ponte; estes testes usam o app de ponta a ponta.
//
//   pnpm --filter @git-nexus/studio pack:dir                 # empacota sem instalador (apps/studio/release/<sistema>-unpacked)
//   pnpm --filter @git-nexus/studio e2e [executável] [filtro]
//
// O executável é achado sozinho em release/ (ou via GN_APP_EXE). GN_APP_ARGS acrescenta argumentos do Chromium (no CI: "--no-sandbox --disable-gpu",
// porque o chrome-sandbox do build descompactado não tem o bit SUID). Capturas em GN_UI_OUT. Um arquivo que falha é repetido UMA vez.
// Cada teste (tests-electron/*.mjs) abre o app do zero, com uma pasta de dados nova.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkDir, defaultExe, killTree, sleep, waitFor } from './proc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const studio = resolve(here, '..', '..');
const CDP_PORT = Number(process.env.GN_UI_CDP_PORT ?? 9333);
const OUT = process.env.GN_UI_OUT ?? join(tmpdir(), 'gitnexus-e2e');

/** Roda um arquivo de teste com uma instância nova do app. Devolve `{ ok, checks, lines }`. */
async function runOne({ file, work, exe }) {
  const data = mkdtempSync(join(work, 'data-'));
  const detached = process.platform !== 'win32';
  const extra = (process.env.GN_APP_ARGS ?? '').split(/\s+/).filter(Boolean);
  // GITNEXUS_MIN_GIT_VERSION=0: o Git das máquinas de CI pode ser mais antigo que o mínimo do app, e o aviso de Git desatualizado bloquearia o teste
  const env = { ...process.env, GITNEXUS_MIN_GIT_VERSION: '0', GITNEXUS_DATA_DIR: data, GN_UI_REAL: '1', GN_UI_URL_MATCH: 'file:', GN_UI_CDP_PORT: String(CDP_PORT) };
  delete env.GITNEXUS_SMOKE; // o modo de fumaça encerra o app sozinho
  const app = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`, ...extra], { env, stdio: 'ignore', detached });
  // executável recém-gerado pode estar preso por um instante (antivírus no Windows: EPERM): vira falha desta tentativa, que o main repete
  let spawnError;
  app.on('error', (e) => (spawnError = e));
  try {
    await sleep(400);
    if (spawnError) throw new Error(`não consegui abrir o app (${spawnError.code ?? spawnError.message})`);
    await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, 'o app (CDP)', 45000);

    const r = await new Promise((done) => {
      const p = spawn(process.execPath, [join(here, 'tests-electron', file), OUT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      const timer = setTimeout(() => {
        p.kill('SIGKILL');
        err += '\nTempo esgotado (4 min).';
      }, 240_000);
      p.on('close', (code) => {
        clearTimeout(timer);
        done({ code, out, err });
      });
    });

    let report = {};
    try {
      report = JSON.parse(r.out.slice(r.out.indexOf('{')));
    } catch {
      /* sem relatório: o teste quebrou antes de terminar */
    }
    const checks = Object.keys(report).length;
    const bad = Object.entries(report).filter(([, v]) => v !== 'OK');
    const lines = bad.map(([k, v]) => `    ✘ ${k}: ${v}`);
    if (r.code !== 0 || bad.length || !checks) {
      const tail = (checks ? r.err : `${r.out}\n${r.err}`).trim().split('\n').slice(-8);
      lines.push(...tail.filter(Boolean).map((l) => '    ' + l));
    }
    return { ok: r.code === 0 && !bad.length && checks > 0, checks, lines };
  } catch (e) {
    return { ok: false, checks: 0, lines: [`    ${e instanceof Error ? e.message : e}`] };
  } finally {
    killTree(app);
    await sleep(1200);
  }
}

async function main() {
  const [a, b] = process.argv.slice(2);
  const exeArg = a && existsSync(a) ? a : undefined;
  const filter = exeArg ? b : a;
  const exe = exeArg ?? process.env.GN_APP_EXE ?? defaultExe(studio);
  if (!exe || !existsSync(exe)) {
    throw new Error('Executável do app não encontrado. Rode `pnpm --filter @git-nexus/studio pack:dir` ou informe o caminho (argumento ou GN_APP_EXE).');
  }
  const tests = readdirSync(join(here, 'tests-electron')).filter((f) => f.endsWith('.mjs') && (!filter || f.includes(filter))).sort();
  if (!tests.length) throw new Error(`Nenhum teste combina com "${filter}".`);

  const work = createWorkDir('gn-e2e-'); // o TEMP desta execução fica dentro dela e some no fim (ver proc.mjs)
  mkdirSync(OUT, { recursive: true });
  console.log(`App: ${exe}\nCapturas em: ${OUT}\n`);

  let failed = 0;
  for (const file of tests) {
    let r = await runOne({ file, work, exe });
    if (!r.ok) {
      console.log(`↻ ${file} falhou; repetindo uma vez (partida a frio dá falso negativo)`);
      for (const l of r.lines) console.log(l); // o motivo da 1ª tentativa também importa: uma falha que só a repetição esconde é instabilidade
      r = await runOne({ file, work, exe });
    }
    console.log(`${r.ok ? '✔' : '✘'} ${file} (${r.checks} verificações)`);
    for (const l of r.lines) console.log(l);
    if (!r.ok) failed++;
  }
  console.log(failed ? `\n${failed} de ${tests.length} arquivo(s) de teste falharam.` : `\nTodos os ${tests.length} arquivos de teste passaram.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
