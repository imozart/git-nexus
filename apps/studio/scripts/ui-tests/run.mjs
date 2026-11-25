#!/usr/bin/env node
// Testes de interface SEM Electron: serve o renderer compilado (dist/renderer) pelo harness, ligado ao mesmo código de Git do app,
// abre num Chrome/Edge headless e dirige a tela por CDP. Cada arquivo de tests/*.mjs roda com harness e navegador novos (estado limpo).
//
//   pnpm --filter @git-nexus/studio build        # gera dist/renderer
//   pnpm --filter @git-nexus/studio ui-test      # todos os testes
//   pnpm --filter @git-nexus/studio ui-test git-log   # só os que têm "git-log" no nome
//
// Variáveis: CHROME_PATH (navegador), GN_UI_OUT (pasta das capturas de tela), GN_UI_APP_PORT / GN_UI_CDP_PORT.
// Um arquivo que falha é repetido UMA vez (partida a frio de navegador em máquina lenta dá falso negativo); falhou duas vezes, falhou.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createWorkDir, killByProfile, killTree, rmDir, sleep, waitFor } from './proc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const studio = resolve(here, '..', '..');
const APP_PORT = Number(process.env.GN_UI_APP_PORT ?? 5199);
const CDP_PORT = Number(process.env.GN_UI_CDP_PORT ?? 9400);
const OUT = process.env.GN_UI_OUT ?? join(tmpdir(), 'gitnexus-ui-tests');

// O git bloqueia submódulos a partir de pastas locais (protocol.file) desde 2022; os testes montam submódulos assim. Vale só para os processos
// deste teste (o harness e os testes herdam o ambiente), e soma às variáveis GIT_CONFIG_* que já existirem.
const gitCfg = Number(process.env.GIT_CONFIG_COUNT ?? 0) || 0;
process.env[`GIT_CONFIG_KEY_${gitCfg}`] = 'protocol.file.allow';
process.env[`GIT_CONFIG_VALUE_${gitCfg}`] = 'always';
process.env.GIT_CONFIG_COUNT = String(gitCfg + 1);

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Nenhum Chrome/Edge encontrado. Defina CHROME_PATH com o caminho do executável.');
  return found;
}

/** Variáveis só de um teste (valem para o harness e para o próprio teste). `search-indice`: a regra de ativação do índice baixa para 100 arquivos, senão a proposta exigiria 50 mil. */
const TEST_ENV = { 'search-indice.mjs': { GN_INDEX_RULE: '{"files":100}' } };

/** Roda um arquivo de teste com harness e navegador novos. Devolve `{ ok, checks, lines }`. */
async function runOne({ file, work, harness, dist, browser }) {
  const data = mkdtempSync(join(work, 'data-'));
  const profile = mkdtempSync(join(work, 'profile-'));
  const detached = process.platform !== 'win32';
  const env = { ...process.env, ...(TEST_ENV[file] ?? {}) };
  const server = spawn(process.execPath, [harness, dist, data, String(APP_PORT)], { stdio: 'ignore', detached, env });
  let chrome;
  try {
    await waitFor(`http://127.0.0.1:${APP_PORT}/`, 'harness');
    chrome = spawn(
      browser,
      [
        '--headless=new',
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profile}`,
        '--window-size=1500,900',
        '--no-first-run',
        '--disable-gpu',
        ...(process.env.CI ? ['--no-sandbox'] : []),
        `http://127.0.0.1:${APP_PORT}/`,
      ],
      { stdio: 'ignore', detached },
    );
    await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, 'navegador (CDP)');

    const r = await new Promise((done) => {
      const p = spawn(process.execPath, [join(here, 'tests', file), OUT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
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
    killTree(chrome);
    killByProfile(profile); // o navegador de verdade não é o PID do lançador (ver proc.mjs)
    killTree(server);
    await sleep(800);
    rmDir(profile); // já agora, sem esperar o fim da execução inteira
  }
}

async function main() {
  const dist = join(studio, 'dist', 'renderer');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/renderer não existe: rode `pnpm --filter @git-nexus/studio build` antes.');
  const filter = process.argv[2];
  const tests = readdirSync(join(here, 'tests')).filter((f) => f.endsWith('.mjs') && (!filter || f.includes(filter))).sort();
  if (!tests.length) throw new Error(`Nenhum teste combina com "${filter}".`);

  const work = createWorkDir('gn-ui-'); // o TEMP desta execução fica dentro dela e some no fim (ver proc.mjs)
  const harness = join(work, 'harness.mjs');
  await build({
    entryPoints: [join(studio, 'scripts', 'ui-harness', 'server.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outfile: harness,
    // dependências CommonJS (iconv-lite) pedem módulos do Node com require(): num bundle ESM ele não existe sem isto
    banner: { js: "import { createRequire as __gnRequire } from 'node:module'; const require = __gnRequire(import.meta.url);" },
    logLevel: 'warning',
  });
  const browser = findBrowser();
  mkdirSync(OUT, { recursive: true });
  console.log(`Navegador: ${browser}\nCapturas em: ${OUT}\n`);

  let failed = 0;
  for (const file of tests) {
    let r = await runOne({ file, work, harness, dist, browser });
    if (!r.ok) {
      console.log(`↻ ${file} falhou; repetindo uma vez (partida a frio dá falso negativo)`);
      for (const l of r.lines) console.log(l); // o motivo da 1ª tentativa também importa: uma falha que só a repetição esconde é instabilidade
      r = await runOne({ file, work, harness, dist, browser });
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
