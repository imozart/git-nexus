// Utilitários de processo dos runners de teste de interface (run.mjs: navegador headless; run-electron.mjs: janela real do Electron).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Apaga a pasta com tentativas: no Windows o navegador morto ainda segura arquivos do perfil por alguns segundos. */
export const rmDir = (dir) => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 });
  } catch {
    /* o Windows às vezes ainda segura um arquivo (perfil do navegador); a próxima execução varre o que sobrar */
  }
};

/**
 * Pasta de trabalho de uma execução dos testes, que NÃO deixa lixo: o TEMP de tudo o que a execução cria (testes, harness, navegador, git) aponta para
 * dentro dela, e ela é apagada ao terminar, ao dar erro e em Ctrl+C/SIGTERM. Se a execução for morta à força (SIGKILL, `timeout`, queda de energia), a próxima
 * mata o navegador que sobrou e apaga a pasta. Nada é criado fora do TEMP do sistema.
 */
export function createWorkDir(prefix) {
  const base = tmpdir();
  // Só existe UMA execução por vez (as portas do harness e do navegador são fixas): qualquer pasta do mesmo prefixo que já exista é de uma execução que
  // morreu sem limpar (um `timeout` externo, uma queda). Mata o navegador que ainda segura o perfil dela e apaga, sem esperar envelhecer.
  for (const name of readdirSync(base)) {
    if (!name.startsWith(prefix)) continue;
    const dir = join(base, name);
    killByProfile(dir);
    rmDir(dir);
  }
  const work = mkdtempSync(join(base, prefix));
  const scratch = join(work, 'tmp');
  mkdirSync(scratch);
  Object.assign(process.env, { TEMP: scratch, TMP: scratch, TMPDIR: scratch });
  process.on('exit', () => rmDir(work));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
  return work;
}

/** Encerra o processo e os filhos (o Chrome, o Edge e o Electron criam vários processos). */
export function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/**
 * Encerra o navegador que usa este perfil (`--user-data-dir`). No Windows o `spawn` devolve o PID de um lançador que sai logo: o navegador de verdade
 * sobrevive ao `killTree` desse PID, fica preso ao perfil e à porta de depuração e vira lixo. Achar pelo perfil pega todos, e só os desta execução.
 */
export function killByProfile(profileDir) {
  if (process.platform !== 'win32') return;
  const script = "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'msedge.exe' -or $_.Name -eq 'chrome.exe') -and $_.CommandLine -like ('*' + $env:GN_KILL_DIR + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', env: { ...process.env, GN_KILL_DIR: profileDir } });
}

/** Espera uma URL responder 2xx (até `ms`). */
export async function waitFor(url, what, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* ainda subindo */
    }
    await sleep(300);
  }
  throw new Error(`${what} não respondeu em ${ms / 1000}s (${url})`);
}

/**
 * Onde o `electron-builder --dir` deixa o executável do app, por sistema. `studio` é a pasta apps/studio.
 * Devolve o primeiro caminho que existe, ou `null`.
 */
export function defaultExe(studio, platform = process.platform) {
  const rel = {
    win32: ['release/win-unpacked/GitNexus.exe'],
    linux: ['release/linux-unpacked/gitnexus'],
    darwin: ['release/mac/GitNexus.app/Contents/MacOS/GitNexus', 'release/mac-arm64/GitNexus.app/Contents/MacOS/GitNexus'],
  }[platform] ?? [];
  return rel.map((r) => join(studio, ...r.split('/'))).find((p) => existsSync(p)) ?? null;
}
