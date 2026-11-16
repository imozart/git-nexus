// Utilitários de processo dos runners de teste de interface (run.mjs: navegador headless; run-electron.mjs: janela real do Electron).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
