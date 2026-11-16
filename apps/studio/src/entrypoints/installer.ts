// Download verificado e instalação da atualização (processo principal). Sem Electron aqui dentro: o que precisa de
// `app`/`shell` fica em main.ts, e este arquivo é testável com um `fetch` falso e uma pasta temporária.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { UpdateProgress } from '@git-nexus/git-core/pure';
import { findSha256, isAllowedUpdateUrl, isSafeAssetName } from '../shared/update';

/** Teto de segurança: nenhum pacote do GitNexus chega perto disso. */
const MAX_BYTES = 600 * 1024 * 1024;
const MAX_SUMS_BYTES = 256 * 1024;

export interface DownloadOptions {
  /** Endereço do pacote (precisa ser do GitHub do projeto). */
  url: string;
  /** Nome do arquivo na release (é o que aparece no `SHA256SUMS.txt`). */
  name: string;
  sumsUrl: string;
  destDir: string;
  repo?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (p: UpdateProgress) => void;
}

export interface Downloaded {
  file: string;
  sha256: string;
}

/**
 * Tudo o que o updater grava (pacote, `.part`, pasta de preparo, backup da troca, script) começa com este prefixo.
 * É o que permite baixar na pasta do executável sem jamais confundir um arquivo temporário com o app ou com o AppImage atual.
 */
export const UPDATE_PREFIX = 'gnupdate-';
const UPDATE_ENTRY = /^\.?gnupdate-/;

/** Nome local do pacote baixado (na release continua sendo `name`). */
export const updateFileName = (name: string) => `${UPDATE_PREFIX}${name}`;

/** Apaga de `dir` os restos de atualização (pacotes, preparo, backup). Não toca em mais nada; nunca lança. */
export async function cleanupUpdateFiles(dir: string): Promise<void> {
  for (const entry of await readdir(dir).catch(() => [] as string[])) {
    if (UPDATE_ENTRY.test(entry)) await rm(join(dir, entry), { force: true, recursive: true }).catch(() => undefined);
  }
}

async function getText(f: typeof fetch, url: string, limit: number): Promise<string> {
  const res = await f(url, { headers: { 'User-Agent': 'GitNexus-update' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`O GitHub respondeu ${res.status} ao baixar ${url.split('/').pop()}.`);
  const text = await res.text();
  if (text.length > limit) throw new Error('Arquivo de hashes grande demais.');
  return text;
}

/**
 * Baixa o pacote para `destDir`, calcula o SHA-256 enquanto grava e só entrega o arquivo se o hash bater com o do
 * `SHA256SUMS.txt` da mesma release. Em qualquer falha o arquivo parcial é apagado.
 */
export async function downloadVerified(o: DownloadOptions): Promise<Downloaded> {
  const f = o.fetchImpl ?? fetch;
  if (!isSafeAssetName(o.name)) throw new Error('Nome de pacote inválido.');
  if (!isAllowedUpdateUrl(o.url, o.repo) || !isAllowedUpdateUrl(o.sumsUrl, o.repo)) throw new Error('Endereço de download não permitido.');

  const expected = findSha256(await getText(f, o.sumsUrl, MAX_SUMS_BYTES), o.name);
  if (!expected) throw new Error(`O SHA256SUMS.txt desta release não lista ${o.name}.`);

  await mkdir(o.destDir, { recursive: true });
  // Limpa restos de atualizações anteriores. `destDir` pode ser a pasta do próprio app: só se toca no que tem o prefixo do updater.
  await cleanupUpdateFiles(o.destDir);

  const part = join(o.destDir, `${updateFileName(o.name)}.part`);
  const final = join(o.destDir, updateFileName(o.name));
  try {
    const res = await f(o.url, { headers: { 'User-Agent': 'GitNexus-update' }, signal: AbortSignal.timeout(30 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`O GitHub respondeu ${res.status} ao baixar o pacote.`);
    const total = Number(res.headers.get('content-length') ?? 0) || 0;
    if (total > MAX_BYTES) throw new Error('Pacote grande demais.');

    const hash = createHash('sha256');
    let done = 0;
    const out = createWriteStream(part);
    const source = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
    source.on('data', (chunk: Buffer) => {
      done += chunk.length;
      if (done > MAX_BYTES) source.destroy(new Error('Pacote grande demais.'));
      hash.update(chunk);
      o.onProgress?.({ done, total });
    });
    await new Promise<void>((resolve, reject) => {
      source.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      source.pipe(out);
    });

    const actual = hash.digest('hex');
    if (actual !== expected) throw new Error('O SHA-256 do pacote não confere com o da release: o download foi descartado.');
    await rename(part, final);
    return { file: final, sha256: actual };
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
}

/** Argumentos do instalador NSIS: silencioso, marca como atualização e reabre o app ao terminar. */
export const WINDOWS_INSTALLER_ARGS = ['/S', '--updated', '--force-run'] as const;

/**
 * Troca o AppImage em uso pelo novo: copia ao lado e renomeia por cima (rename é atômico; o processo atual continua
 * usando o inode antigo até fechar). Falha, sem mexer no original, se a pasta não for gravável.
 */
export async function replaceAppImage(downloaded: string, target: string): Promise<void> {
  const next = `${target}.new`;
  try {
    await copyFile(downloaded, next);
    await chmod(next, 0o755);
    await rename(next, target);
    await rm(downloaded, { force: true }); // o pacote já cumpriu seu papel
  } catch (e) {
    await rm(next, { force: true });
    throw new Error(`Não foi possível substituir o AppImage (${(e as Error).message}). Baixe manualmente pela página da release.`);
  }
}

// --- ZIP portátil (Windows) ---------------------------------------------------------------------------------------
// O pacote é extraído enquanto o app ainda roda (a pessoa continua trabalhando); ao confirmar o reinício só resta uma
// troca de pastas, que dura segundos. A troca é feita por um script PowerShell separado, porque o app não pode
// sobrescrever o próprio executável em uso.

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, env: env ? { ...process.env, ...env } : process.env, maxBuffer: 1024 * 1024 }, (err, _out, stderr) =>
      err ? reject(new Error(String(stderr || err.message).trim().slice(0, 400))) : resolve(),
    );
  });
}

const systemDir = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');

/** Extrai o ZIP em `dest` (que é recriada). Usa o `tar.exe` do Windows e, se faltar, o `Expand-Archive`. */
export async function extractZip(zip: string, dest: string): Promise<void> {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  try {
    await run(join(systemDir(), 'tar.exe'), ['-xf', zip, '-C', dest]);
  } catch {
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    await run(
      join(systemDir(), 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:GN_ZIP -DestinationPath $env:GN_DEST -Force'],
      { GN_ZIP: zip, GN_DEST: dest },
    );
  }
}

/** Pasta que realmente contém o executável: a própria extração ou, se o ZIP veio com uma pasta-raiz, essa pasta. */
async function findAppRoot(dir: string, exeName: string): Promise<string | null> {
  if ((await stat(join(dir, exeName)).catch(() => null))?.isFile()) return dir;
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  return entries.length === 1 && dirs[0] ? findAppRoot(join(dir, dirs[0].name), exeName) : null;
}

/**
 * Extrai o ZIP já conferido em `<destDir>/.gnupdate-stage` e confirma que ele é mesmo o app (tem o executável). Devolve
 * a pasta pronta para a troca. O ZIP é apagado pelo script de troca quando a atualização dá certo.
 */
export async function prepareStage(zip: string, destDir: string, exeName: string): Promise<string> {
  const stage = join(destDir, `.${UPDATE_PREFIX}stage`);
  await extractZip(zip, stage);
  const root = await findAppRoot(stage, exeName);
  if (!root) {
    await rm(stage, { recursive: true, force: true });
    throw new Error(`O pacote baixado não contém ${exeName}.`);
  }
  return root;
}

/**
 * Script da troca (só ASCII). Espera o app fechar, move para `.gnupdate-old` as entradas de primeiro nível que o pacote
 * novo substitui, coloca as novas no lugar e reabre o app. Qualquer falha desfaz tudo e reabre a versão anterior.
 * Nunca mexe em `GitNexusData` nem em arquivos que o pacote não traz.
 */
export const SWAP_SCRIPT = String.raw`param(
  [Parameter(Mandatory = $true)][int]$ProcId,
  [Parameter(Mandatory = $true)][string]$Stage,
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$Zip = '',
  [string]$Log = '',
  [int]$Retries = 40
)
$ErrorActionPreference = 'Stop'
function Write-Log([string]$m) { if ($Log) { try { Add-Content -LiteralPath $Log -Value ((Get-Date -Format s) + ' ' + $m) } catch {} } }
function Invoke-Retry([scriptblock]$Action) {
  for ($i = 1; $i -le $Retries; $i++) {
    try { & $Action; return } catch { if ($i -eq $Retries) { throw }; Start-Sleep -Milliseconds 500 }
  }
}
Write-Log ('waiting for process ' + $ProcId)
Wait-Process -Id $ProcId -Timeout 90 -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
$old = Join-Path $AppDir '.gnupdate-old'
$moved = New-Object System.Collections.ArrayList
$placed = New-Object System.Collections.ArrayList
$ok = $false
try {
  if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }
  New-Item -ItemType Directory -Path $old -Force | Out-Null
  foreach ($it in @(Get-ChildItem -LiteralPath $Stage -Force)) {
    $name = $it.Name
    if ($name -eq 'GitNexusData' -or $name -eq '.gnupdate-old') { continue }
    $cur = Join-Path $AppDir $name
    if (Test-Path -LiteralPath $cur) {
      Invoke-Retry { Move-Item -LiteralPath $cur -Destination $old -Force }
      [void]$moved.Add($name)
    }
    $src = $it.FullName
    Invoke-Retry { Move-Item -LiteralPath $src -Destination $AppDir -Force }
    [void]$placed.Add($name)
  }
  $ok = $true
  Write-Log 'swap ok'
} catch {
  Write-Log ('swap failed: ' + $_.Exception.Message)
  foreach ($n in $placed) { try { Remove-Item -LiteralPath (Join-Path $AppDir $n) -Recurse -Force } catch { Write-Log ('cleanup failed for ' + $n) } }
  foreach ($n in $moved) { try { Move-Item -LiteralPath (Join-Path $old $n) -Destination $AppDir -Force } catch { Write-Log ('rollback failed for ' + $n) } }
}
try { Start-Process -FilePath (Join-Path $AppDir $Exe) -WorkingDirectory $AppDir } catch { Write-Log ('start failed: ' + $_.Exception.Message) }
if ($ok) {
  try { Remove-Item -LiteralPath $old -Recurse -Force } catch {}
  try { Remove-Item -LiteralPath $Stage -Recurse -Force } catch {}
  if ($Zip) { try { Remove-Item -LiteralPath $Zip -Force } catch {} }
  exit 0
}
exit 1
`;

export interface PortableSwap {
  /** PID do app atual: o script espera esse processo terminar. */
  pid: number;
  /** Pasta devolvida por `prepareStage`. */
  stageDir: string;
  /** ZIP baixado: o script o apaga quando a troca dá certo. */
  zip: string;
  /** Pasta onde o app está instalado (a do executável). */
  appDir: string;
  /** Nome do executável (ex.: GitNexus.exe). */
  exe: string;
  /** Onde gravar o script e o log (a pasta de atualizações). */
  workDir: string;
}

/** Dispara a troca em um PowerShell oculto e independente do app (que deve fechar logo em seguida). */
export async function startPortableSwap(o: PortableSwap): Promise<ChildProcess> {
  const script = join(o.workDir, `${UPDATE_PREFIX}apply.ps1`);
  await writeFile(script, SWAP_SCRIPT, 'utf8');
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
    '-ProcId', String(o.pid), '-Stage', o.stageDir, '-AppDir', o.appDir, '-Exe', o.exe, '-Zip', o.zip, '-Log', join(o.workDir, 'update.log'),
  ];
  const child = spawn(join(systemDir(), 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args, { stdio: 'ignore', windowsHide: true });
  // Sem `detached`: no Windows o PowerShell sem console (DETACHED_PROCESS) sai com 0 sem rodar o script; o filho sobrevive ao app mesmo assim.
  child.unref();
  return child;
}

/** Existe e tem tamanho > 0 (conferência antes de executar). */
export async function isReadyFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}
