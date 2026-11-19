#!/usr/bin/env node
// Ciclo de atualização do ZIP portátil com o app EMPACOTADO de verdade (Windows). Os testes unitários rodam em Node puro e não pegam o que só existe
// dentro do Electron: ali o fs trata todo `app.asar` como pasta virtual (a atualização 1.12 → 1.13 falhou com EBUSY ao apagar .gnupdate-stage\resources\app.asar).
//
//   node apps/studio/scripts/update-cycle/run.mjs apps/studio/release/win-unpacked
//
// O que faz: copia o app para uma pasta de trabalho, monta um ZIP de uma "versão nova" (o mesmo app + new-version.txt), deixa restos de uma tentativa
// anterior (.gnupdate-stage e .gnupdate-old, cada um com um resources\app.asar real) e roda, com o executável empacotado em modo Node
// (ELECTRON_RUN_AS_NODE=1, como o app faz), o preparo (prepareStage) e o script de troca (SWAP_SCRIPT). Confere: troca concluída, restos apagados,
// arquivos novos no lugar, dados preservados e, no fim, o app trocado ABRE (GITNEXUS_SMOKE=1 → GITNEXUS_SMOKE_OK). Saída 0 = tudo certo.
//
// GN_CYCLE_SKIP_SMOKE=1 pula só a abertura da janela (máquina sem display que abra o Electron); o resto continua valendo.

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const unpacked = resolve(process.argv[2] ?? '');
const exeName = process.argv[3] ?? 'GitNexus.exe';
if (process.platform !== 'win32') {
  console.error('Este teste é do Windows (tar.exe, .exe e a troca do executável em uso).');
  process.exit(2);
}
if (!process.argv[2] || !existsSync(join(unpacked, exeName))) {
  console.error(`Uso: node run.mjs <pasta do app descompactado (win-unpacked)> [executável]\nNão achei ${exeName} em ${unpacked || '(sem pasta)'}.`);
  process.exit(2);
}

const failures = [];
const check = (name, ok, extra) => {
  console.log(`${ok ? '✔' : '✘'} ${name}${ok || extra === undefined ? '' : `\n    ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (pid) => spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });

/** O antivírus examina um executável recém-gravado e o segura (EPERM/EBUSY ao abrir ou executar; no relato real, 47 s). Espera até dar para LER o arquivo inteiro. */
async function waitReadable(file, limitMs = 240_000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const fd = openSync(file, 'r');
      try {
        const buf = Buffer.alloc(1024 * 1024);
        while (readSync(fd, buf, 0, buf.length, null) > 0);
      } finally {
        closeSync(fd);
      }
      return Date.now() - t0;
    } catch (e) {
      if (Date.now() - t0 > limitMs) throw e;
      await sleep(2000);
    }
  }
}

/** spawnSync que repete quando o antivírus ainda segura o executável (EPERM/EBUSY/EACCES ao iniciar o processo; o relato real teve 47 s disso). */
async function runRetrying(exe, args, options, tries = 12) {
  let r;
  for (let i = 1; i <= tries; i++) {
    r = spawnSync(exe, args, options);
    if (!(r.error && ['EPERM', 'EBUSY', 'EACCES'].includes(r.error.code))) return r;
    console.log(`- o sistema não deixou iniciar ${basename(exe)} (${r.error.code}), tentativa ${i} de ${tries}`);
    await sleep(5000);
  }
  return r;
}

const work = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'gn-cycle-'));
const appDir = join(work, 'app');
const newDir = join(work, 'new');
const zip = join(appDir, 'gnupdate-GitNexus-new-win-x64-portable.zip');
const logFile = join(appDir, 'GitNexusData', 'logs', 'gitnexus-update.log');
const readLog = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');
const cleanup = () => rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });

try {
  console.log(`Pasta de trabalho: ${work}`);
  // 1. o app "instalado" e o pacote da versão nova (o mesmo app + um arquivo que só a nova tem)
  cpSync(unpacked, appDir, { recursive: true });
  writeFileSync(join(appDir, 'old-version.txt'), 'antiga');
  mkdirSync(join(appDir, 'GitNexusData'), { recursive: true });
  writeFileSync(join(appDir, 'GitNexusData', 'preferencias.json'), '{"keep":true}');
  cpSync(unpacked, newDir, { recursive: true });
  writeFileSync(join(newDir, 'new-version.txt'), 'nova');
  console.log(`- antivírus liberou os executáveis copiados após ${(await waitReadable(join(appDir, exeName)) + (await waitReadable(join(newDir, exeName)))) / 1000} s`);
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const z = spawnSync(tar, ['-a', '-cf', zip, '-C', newDir, '.'], { encoding: 'utf8' });
  check('o ZIP da versão nova foi criado', z.status === 0 && existsSync(zip), z.stderr);

  // 2. restos de uma tentativa anterior, cada um com um app.asar de verdade (o caso que quebrou)
  const asar = join(unpacked, 'resources', 'app.asar');
  check('o app empacotado tem resources/app.asar (é um build de produção, com asar)', existsSync(asar));
  for (const d of ['.gnupdate-stage', '.gnupdate-old']) {
    mkdirSync(join(appDir, d, 'resources'), { recursive: true });
    copyFileSync(asar, join(appDir, d, 'resources', 'app.asar'));
    writeFileSync(join(appDir, d, 'resto.txt'), 'de uma tentativa anterior');
  }

  // 3. roda o EXECUTÁVEL EMPACOTADO como PROCESSO PRINCIPAL do Electron (é onde o app roda prepareStage e onde o fs trata app.asar como pasta virtual):
  //    o gancho GITNEXUS_UPDATE_CYCLE (cycle.ts) prepara o pacote, dispara a troca e sai; o atualizador sobe em modo Node, como no app.
  const exe = join(appDir, exeName);
  const env = { ...process.env, GITNEXUS_UPDATE_CYCLE: JSON.stringify({ zip, logFile }) };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GITNEXUS_SMOKE;
  const drv = await runRetrying(exe, ['--disable-gpu', '--no-sandbox'], { env, encoding: 'utf8', timeout: 240_000, windowsHide: true });
  check('o preparo (extração com app.asar) e o início da troca, no processo principal do Electron, terminaram sem erro', drv.status === 0 && readLog().includes('PROCESSO PRINCIPAL do Electron'), { status: drv.status, signal: drv.signal, error: drv.error?.message, stderr: (drv.stderr ?? '').slice(0, 400), log: readLog().split('\n').slice(-8) });

  // 4. espera o atualizador terminar (ele escreve "atualizador terminou, código N")
  const t0 = Date.now();
  while (!/atualizador terminou, código \d/.test(readLog()) && Date.now() - t0 < 180_000) await sleep(500);
  await sleep(1500); // a reabertura (--version) e a limpeza acontecem logo depois
  const log = readLog();
  check('a troca concluiu ("troca concluída") e sem falha', log.includes('troca concluída') && !/FALHOU/.test(log), log.split('\n').filter((l) => /FALHOU|EBUSY|EPERM|não apagou/.test(l)).slice(0, 6));
  check('o atualizador terminou com código 0', /atualizador terminou, código 0/.test(log));
  const names = new Set(readdirSync(appDir));
  check('o preparo antigo (.gnupdate-stage com app.asar) foi removido', !names.has('.gnupdate-stage'), [...names].filter((n) => n.startsWith('.gnupdate')));
  check('o ZIP baixado foi apagado', !existsSync(zip));
  // o .gnupdate-old pode sobrar na hora (o executável antigo, que roda o atualizador, ainda está em uso): a próxima abertura do app o apaga
  console.log(`- .gnupdate-old logo após a troca: ${names.has('.gnupdate-old') ? 'sobrou (esperado quando o executável antigo estava em uso)' : 'já apagado'}`);
  await sleep(1500);
  const next = await runRetrying(exe, ['--disable-gpu', '--no-sandbox'], { env: { ...env, GITNEXUS_UPDATE_CYCLE: JSON.stringify({ zip, logFile, mode: 'cleanup' }) }, encoding: 'utf8', timeout: 120_000, windowsHide: true });
  check('a abertura seguinte limpa o que sobrou, inclusive o app.asar do backup (.gnupdate-old)', next.status === 0 && ![...readdirSync(appDir)].some((n) => n.startsWith('.gnupdate')), { status: next.status, stderr: (next.stderr ?? '').slice(0, 300), sobras: readdirSync(appDir).filter((n) => n.startsWith('.gnupdate')) });
  check('o arquivo da versão nova está no lugar', readFileSync(join(appDir, 'new-version.txt'), 'utf8') === 'nova');
  check('o que o pacote não traz (e os dados do usuário) ficou intacto', existsSync(join(appDir, 'old-version.txt')) && readFileSync(join(appDir, 'GitNexusData', 'preferencias.json'), 'utf8') === '{"keep":true}');
  check('o app foi reaberto pelo atualizador', /app reaberto \(versão nova\)/.test(log));
  check('o app.asar novo está inteiro', existsSync(join(appDir, 'resources', 'app.asar')) && readFileSync(join(appDir, 'resources', 'app.asar')).equals(readFileSync(asar)));

  // 5. o app trocado abre de verdade (janela, interface e ponte com o worker)
  if (process.env.GN_CYCLE_SKIP_SMOKE === '1') {
    console.log('- abertura do app trocado pulada (GN_CYCLE_SKIP_SMOKE=1)');
  } else {
    const smokeEnv = { ...process.env, GITNEXUS_SMOKE: '1', GITNEXUS_DATA_DIR: join(work, 'smoke-data') };
    delete smokeEnv.ELECTRON_RUN_AS_NODE;
    const out = await new Promise((resolveRun) => {
      let text = '';
      const child = spawn(exe, ['--disable-gpu'], { env: smokeEnv, windowsHide: true });
      child.stdout.on('data', (d) => (text += d));
      child.stderr.on('data', (d) => (text += d));
      const timer = setTimeout(() => { killTree(child.pid); resolveRun({ code: 'tempo', text }); }, 120_000);
      child.on('exit', (code) => { clearTimeout(timer); resolveRun({ code, text }); });
    });
    check('o app trocado abre e responde (GITNEXUS_SMOKE_OK)', out.code === 0 && out.text.includes('GITNEXUS_SMOKE_OK'), { code: out.code, saida: out.text.slice(-400) });
  }
} catch (e) {
  check(`erro inesperado: ${e instanceof Error ? e.stack : String(e)}`, false);
} finally {
  if (failures.length) {
    console.log('\n--- log da atualização ---');
    console.log(readLog().slice(-4000));
  }
  // o app reaberto pode estar de pé segurando arquivos: derruba tudo que roda desta pasta antes de apagar
  spawnSync('powershell', ['-NoProfile', '-Command', `Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${work.replace(/'/g, "''")}') } | Stop-Process -Force`], { windowsHide: true });
  cleanup();
}
console.log(failures.length ? `\n${failures.length} verificação(ões) falharam.` : '\nCiclo de atualização OK.');
process.exit(failures.length ? 1 : 0);
