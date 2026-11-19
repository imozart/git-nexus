// Instalação automática do Git (processo principal), por sistema. Sem Electron aqui dentro: rede, processos e disco entram por parâmetro e o arquivo
// é testável com um `fetch` falso, um `exec` falso e uma pasta temporária. A escolha do arquivo, os argumentos e as verificações ficam em
// shared/git-install.ts (puro).
//
//  - Windows: instalador do Git for Windows (a release mais recente do GitHub, o mesmo para onde o git-scm.com aponta), em modo silencioso e POR
//    USUÁRIO (sem administrador). SHA-256 conferido antes de executar e assinatura digital, quando houver.
//  - macOS: Homebrew, se já estiver instalado (nunca o instalamos por conta própria); senão as Command Line Tools (diálogo do próprio sistema).
//  - Linux: código-fonte oficial (kernel.org), conferido pelo SHA-256 publicado, compilado e instalado POR USUÁRIO em `<dados>/git`. Se faltarem
//    compilador, make ou cabeçalhos, pede elevação (pkexec) só para instalá-los pelo gerenciador da distribuição.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { tm } from '@git-nexus/git-core';
import type { GitInstallMethod, GitInstallProgress } from '@git-nexus/git-core/pure';
import {
  BREW_PATHS,
  CLT_POLL_MS,
  CLT_TIMEOUT_MS,
  GIT_FOR_WINDOWS_LATEST,
  GIT_WINDOWS_ARGS,
  KERNEL_GIT_INDEX,
  KERNEL_SUMS_FILE,
  depsInstallCommand,
  detectPackageManager,
  installMethod,
  isAcceptableSignature,
  isAllowedGitWindowsUrl,
  isAllowedKernelUrl,
  makeArgs,
  missingBuildTools,
  pickGitWindowsAsset,
  pickLatestTarball,
  tarballSha256,
  windowsAssetSha256,
  type ReleaseAsset,
} from '../shared/git-install';
import { isSafeAssetName } from '../shared/update';
import { makeHas, type Detected, type Exec } from './git-detect';

/** Teto de segurança: o instalador do Git for Windows tem ~70 MB e o tarball do código-fonte ~25 MB. */
const MAX_BYTES = 400 * 1024 * 1024;

/** Roda um programa e entrega as linhas de saída; resolve com o código de saída (`-1` = não iniciou ou foi cancelado). */
export type RunStream = (file: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; onLine?: (line: string) => void; signal?: AbortSignal }) => Promise<number>;

export interface InstallDeps {
  platform: string;
  arch: string;
  env: Record<string, string | undefined>;
  /** Pasta de dados do app: a instalação do Linux vai para `<dados>/git` e os temporários para `<dados>/git-install`. */
  dataDir: string;
  fetchImpl: typeof fetch;
  exec: Exec;
  run: RunStream;
  exists: (path: string) => boolean;
  /** Procura o Git de novo (depois de instalar). */
  detect: () => Promise<Detected>;
  emit: (p: GitInstallProgress) => void;
  log: (line: string) => void;
  /** Cancela até o ponto em que a instalação propriamente dita começa. */
  signal: AbortSignal;
  /** Espera (padrão: `setTimeout`); os testes passam uma espera instantânea. */
  sleep?: (ms: number) => Promise<void>;
}

/** Falha esperada da instalação (o texto já é para a pessoa ler). */
export class GitInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitInstallError';
  }
}

const cancelled = () => new GitInstallError(tm('git.err.cancelled'));
const tooBig = () => new GitInstallError(tm('git.err.tooBig'));

function check(signal: AbortSignal): void {
  if (signal.aborted) throw cancelled();
}

// --- Rede ----------------------------------------------------------------------------------------------------------

async function getText(f: typeof fetch, url: string, signal: AbortSignal, accept?: string): Promise<{ text: string; finalUrl: string }> {
  const res = await f(url, { headers: { 'User-Agent': 'GitNexus-git-install', ...(accept ? { Accept: accept } : {}) }, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
  if (!res.ok) throw new GitInstallError(tm('git.err.queryStatus', { status: res.status, host: new URL(url).host }));
  const text = await res.text();
  if (text.length > 4 * 1024 * 1024) throw tooBig();
  return { text, finalUrl: res.url || url };
}

export interface DownloadOptions {
  fetchImpl: typeof fetch;
  url: string;
  dest: string;
  /** SHA-256 esperado (hex): divergência apaga o arquivo e falha. */
  sha256: string;
  /** Aceita o endereço FINAL (depois dos redirecionamentos). */
  allowFinal: (url: string) => boolean;
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
}

/** Baixa para `dest`, calcula o SHA-256 enquanto grava e só entrega o arquivo se o hash bater. Em qualquer falha apaga o parcial. */
export async function downloadChecked(o: DownloadOptions): Promise<void> {
  const part = `${o.dest}.part`;
  try {
    const res = await o.fetchImpl(o.url, { headers: { 'User-Agent': 'GitNexus-git-install' }, signal: AbortSignal.any([o.signal, AbortSignal.timeout(30 * 60_000)]) });
    if (!res.ok || !res.body) throw new GitInstallError(tm('git.err.downloadStatus', { status: res.status }));
    if (res.url && !o.allowFinal(res.url)) throw new GitInstallError(tm('git.err.redirected'));
    const total = Number(res.headers.get('content-length') ?? 0) || 0;
    if (total > MAX_BYTES) throw tooBig();
    const hash = createHash('sha256');
    const out = createWriteStream(part);
    const source = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
    let done = 0;
    let last = 0;
    source.on('data', (chunk: Buffer) => {
      done += chunk.length;
      if (done > MAX_BYTES) source.destroy(tooBig());
      hash.update(chunk);
      const now = Date.now();
      if (now - last > 120) {
        last = now;
        o.onProgress(done, total);
      }
    });
    await new Promise<void>((resolve, reject) => {
      source.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      source.pipe(out);
    });
    o.onProgress(done, total || done);
    if (hash.digest('hex') !== o.sha256.toLowerCase()) throw new GitInstallError(tm('git.err.sha256Failed'));
    await rename(part, o.dest);
  } catch (e) {
    await rm(part, { force: true }).catch(() => undefined);
    await rm(o.dest, { force: true }).catch(() => undefined);
    if (o.signal.aborted) throw cancelled();
    throw e;
  }
}

// --- Windows ---------------------------------------------------------------------------------------------------------

interface GitHubRelease {
  tag_name?: string;
  body?: string;
  assets?: ReleaseAsset[];
}

export async function installWindows(d: InstallDeps, tmp: string): Promise<void> {
  d.emit({ step: 'finding', method: 'windows-installer' });
  const { text } = await getText(d.fetchImpl, GIT_FOR_WINDOWS_LATEST, d.signal, 'application/vnd.github+json');
  const rel = JSON.parse(text) as GitHubRelease;
  const asset = pickGitWindowsAsset(rel.assets ?? [], d.arch);
  if (!asset || !isAllowedGitWindowsUrl(asset.browser_download_url) || !isSafeAssetName(asset.name)) throw new GitInstallError(tm('git.err.noInstaller'));
  const sha256 = windowsAssetSha256(asset, rel.body);
  if (!sha256) throw new GitInstallError(tm('git.err.noSha256'));
  const version = /^v?(\d+\.\d+\.\d+)/.exec(rel.tag_name ?? '')?.[1];
  d.log(`git-install: ${asset.name} (${version ?? '?'}) sha256 ${sha256}`);

  const file = join(tmp, asset.name);
  d.emit({ step: 'downloading', version, done: 0, total: asset.size ?? 0, method: 'windows-installer' });
  await downloadChecked({
    fetchImpl: d.fetchImpl,
    url: asset.browser_download_url,
    dest: file,
    sha256,
    allowFinal: (u) => /^https:\/\/([a-z0-9-]+\.)?(github\.com|githubusercontent\.com)\//.test(u),
    signal: d.signal,
    onProgress: (done, total) => d.emit({ step: 'downloading', version, done, total, method: 'windows-installer' }),
  });

  check(d.signal);
  d.emit({ step: 'verifying', version, method: 'windows-installer' });
  const sig = await d.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '(Get-AuthenticodeSignature -LiteralPath $env:GN_GIT_FILE).Status'], { env: { ...d.env, GN_GIT_FILE: file }, timeoutMs: 60_000 });
  const status = sig.output.trim().split(/\r?\n/).pop() ?? '';
  d.log(`git-install: assinatura ${status || '(sem resposta)'}`);
  if (!isAcceptableSignature(status)) throw new GitInstallError(tm('git.err.badSignature'));

  check(d.signal);
  d.emit({ step: 'installing', version, method: 'windows-installer' });
  d.log(`git-install: executando ${asset.name} ${GIT_WINDOWS_ARGS.join(' ')}`);
  // depois daqui não se cancela: interromper o instalador no meio deixaria um Git pela metade
  const r = await d.exec(file, [...GIT_WINDOWS_ARGS], { timeoutMs: 15 * 60_000 });
  if (r.code !== 0) throw new GitInstallError(tm('git.err.installerExit', { code: r.code }));
}

// --- macOS -------------------------------------------------------------------------------------------------------------

export async function installMac(d: InstallDeps): Promise<void> {
  d.emit({ step: 'finding', method: 'homebrew' });
  const brew = BREW_PATHS.find((p) => d.exists(p)) ?? null;
  const method = installMethod('darwin', d.arch, { brew });
  if (method === 'homebrew' && brew) {
    d.emit({ step: 'installing', method, detail: 'brew install git' });
    d.log(`git-install: ${brew} install git`);
    const code = await d.run(brew, ['install', 'git'], {
      env: { ...d.env, HOMEBREW_NO_ENV_HINTS: '1', NONINTERACTIVE: '1' },
      onLine: (line) => d.emit({ step: 'installing', method, detail: line }),
      signal: d.signal,
    });
    if (code !== 0) throw new GitInstallError(tm('git.err.brewExit', { code }));
    return;
  }
  // Command Line Tools: o próprio macOS mostra o diálogo; aqui só se acompanha até o git responder
  d.emit({ step: 'installing', method: 'command-line-tools', detail: tm('git.err.confirmMac') });
  d.log('git-install: xcode-select --install');
  await d.exec('xcode-select', ['--install']);
  const until = Date.now() + CLT_TIMEOUT_MS;
  while (Date.now() < until) {
    check(d.signal);
    await (d.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(CLT_POLL_MS);
    if ((await d.detect()).status !== 'missing') return;
  }
  throw new GitInstallError(tm('git.err.cltTimeout'));
}

// --- Linux -------------------------------------------------------------------------------------------------------------

export async function installLinux(d: InstallDeps, tmp: string): Promise<void> {
  const method: GitInstallMethod = 'source-build';
  d.emit({ step: 'finding', method });
  const index = await getText(d.fetchImpl, KERNEL_GIT_INDEX, d.signal);
  if (!isAllowedKernelUrl(index.finalUrl)) throw new GitInstallError(tm('git.err.indexRedirected'));
  const tar = pickLatestTarball(index.text);
  if (!tar || !isSafeAssetName(tar.name)) throw new GitInstallError(tm('git.err.noSource'));
  const sums = await getText(d.fetchImpl, `${KERNEL_GIT_INDEX}${KERNEL_SUMS_FILE}`, d.signal);
  const sha256 = tarballSha256(sums.text, tar.name);
  if (!sha256) throw new GitInstallError(tm('git.err.noSourceSha'));
  d.log(`git-install: ${tar.name} sha256 ${sha256}`);

  const file = join(tmp, tar.name);
  d.emit({ step: 'downloading', version: tar.version, done: 0, total: 0, method });
  await downloadChecked({
    fetchImpl: d.fetchImpl,
    url: `${KERNEL_GIT_INDEX}${tar.name}`,
    dest: file,
    sha256,
    allowFinal: isAllowedKernelUrl,
    signal: d.signal,
    onProgress: (done, total) => d.emit({ step: 'downloading', version: tar.version, done, total, method }),
  });
  d.emit({ step: 'verifying', version: tar.version, method });
  check(d.signal);

  // dependências de compilação
  const has = makeHas(d.env, d.exists, 'linux');
  const zlib = ['/usr/include/zlib.h', '/usr/include/x86_64-linux-gnu/zlib.h', '/usr/include/aarch64-linux-gnu/zlib.h'].some((p) => d.exists(p));
  const missing = missingBuildTools(has, zlib);
  if (missing.length) {
    d.emit({ step: 'dependencies', version: tar.version, detail: missing.join(', '), method });
    const pm = detectPackageManager(has);
    if (!pm || !has('pkexec')) {
      throw new GitInstallError(tm('git.err.missingTools', { missing: missing.join(', ') }));
    }
    const c = depsInstallCommand(pm);
    d.log(`git-install: pkexec ${c.file} ${c.args.join(' ')}`);
    const code = await d.run('pkexec', [c.file, ...c.args], { onLine: (line) => d.emit({ step: 'dependencies', version: tar.version, detail: line, method }), signal: d.signal });
    if (code !== 0) throw new GitInstallError(tm('git.err.depsFailed'));
    check(d.signal);
  }

  // compilar
  const src = join(tmp, 'src');
  await mkdir(src, { recursive: true });
  d.emit({ step: 'building', version: tar.version, detail: tm('git.err.extracting'), method });
  if ((await d.exec('tar', ['-xzf', file, '-C', src], { timeoutMs: 5 * 60_000 })).code !== 0) throw new GitInstallError(tm('git.err.extractFailed'));
  const dir = join(src, `git-${tar.version}`);
  const prefix = join(d.dataDir, 'git');
  const jobs = Math.max(1, cpus().length);
  const onLine = (line: string) => d.emit({ step: 'building', version: tar.version, detail: line, method });
  d.log(`git-install: make ${makeArgs(prefix, 'all', jobs).join(' ')}`);
  if ((await d.run('make', makeArgs(prefix, 'all', jobs), { cwd: dir, onLine, signal: d.signal })) !== 0) {
    check(d.signal);
    throw new GitInstallError(tm('git.err.buildFailed'));
  }

  // instalar (a partir daqui não se cancela)
  check(d.signal);
  d.emit({ step: 'installing', version: tar.version, method });
  await rm(prefix, { recursive: true, force: true });
  if ((await d.run('make', makeArgs(prefix, 'install', jobs), { cwd: dir, onLine: (line) => d.emit({ step: 'installing', version: tar.version, detail: line, method }) })) !== 0) {
    throw new GitInstallError(tm('git.err.installFailed'));
  }
}

// --- Orquestração --------------------------------------------------------------------------------------------------------

/** Instala o Git pelo método do sistema e confirma que ele passou a responder. Devolve o que a detecção achou. */
export async function installGit(d: InstallDeps): Promise<Detected> {
  const tmp = join(d.dataDir, 'git-install');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  try {
    if (d.platform === 'win32') await installWindows(d, tmp);
    else if (d.platform === 'darwin') await installMac(d);
    else if (d.platform === 'linux') await installLinux(d, tmp);
    else throw new GitInstallError(tm('git.err.noAuto'));
    d.emit({ step: 'validating' });
    const found = await d.detect();
    if (found.status === 'missing') throw new GitInstallError(tm('git.err.notResponding'));
    if (found.status === 'outdated') throw new GitInstallError(tm('git.err.outdatedAfter', { version: found.version ?? '?' }));
    d.emit({ step: 'done', version: found.version });
    return found;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** `spawn` com as linhas de saída entregues uma a uma; sem shell; cancelável. */
export const realRun: RunStream = (file, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(file, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let pending = '';
    const feed = (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) opts.onLine?.(l.trim().slice(0, 200));
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', () => resolve(-1));
    child.on('close', (code) => resolve(code ?? -1));
    opts.signal?.addEventListener('abort', () => child.kill(), { once: true });
  });
