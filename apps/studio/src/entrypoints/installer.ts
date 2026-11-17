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
import { describeError, noLog, type UpdateLog } from './update-log';

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
  /** Log da atualização (veja update-log.ts). */
  log?: UpdateLog;
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

/** Apaga de `dir` os restos de atualização (pacotes, preparo, backup). Não toca em mais nada; nunca lança. Devolve o que apagou. */
export async function cleanupUpdateFiles(dir: string): Promise<string[]> {
  const removed: string[] = [];
  for (const entry of await readdir(dir).catch(() => [] as string[])) {
    if (!UPDATE_ENTRY.test(entry)) continue;
    await rm(join(dir, entry), { force: true, recursive: true }).then(() => removed.push(entry), () => undefined);
  }
  return removed;
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
  const log = o.log ?? noLog;
  log(`download: pacote ${o.name} de ${o.url}`);
  if (!isSafeAssetName(o.name)) throw new Error('Nome de pacote inválido.');
  if (!isAllowedUpdateUrl(o.url, o.repo) || !isAllowedUpdateUrl(o.sumsUrl, o.repo)) throw new Error('Endereço de download não permitido.');

  log(`download: lendo os hashes em ${o.sumsUrl}`);
  const expected = findSha256(await getText(f, o.sumsUrl, MAX_SUMS_BYTES), o.name);
  if (!expected) throw new Error(`O SHA256SUMS.txt desta release não lista ${o.name}.`);
  log(`download: SHA-256 esperado ${expected}`);

  await mkdir(o.destDir, { recursive: true });
  // Limpa restos de atualizações anteriores. `destDir` pode ser a pasta do próprio app: só se toca no que tem o prefixo do updater.
  const removed = await cleanupUpdateFiles(o.destDir);
  log(`download: pasta de destino ${o.destDir}${removed.length ? `; restos antigos apagados: ${removed.join(', ')}` : ''}`);

  const part = join(o.destDir, `${updateFileName(o.name)}.part`);
  const final = join(o.destDir, updateFileName(o.name));
  try {
    const res = await f(o.url, { headers: { 'User-Agent': 'GitNexus-update' }, signal: AbortSignal.timeout(30 * 60_000) });
    log(`download: o GitHub respondeu ${res.status}${res.url && res.url !== o.url ? ` (redirecionado para ${new URL(res.url).host})` : ''}`);
    if (!res.ok || !res.body) throw new Error(`O GitHub respondeu ${res.status} ao baixar o pacote.`);
    const total = Number(res.headers.get('content-length') ?? 0) || 0;
    log(`download: tamanho informado ${total ? `${total} bytes` : '(não informado)'}`);
    if (total > MAX_BYTES) throw new Error('Pacote grande demais.');

    const hash = createHash('sha256');
    let done = 0;
    let loggedStep = -1;
    const out = createWriteStream(part);
    const source = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
    source.on('data', (chunk: Buffer) => {
      done += chunk.length;
      if (done > MAX_BYTES) source.destroy(new Error('Pacote grande demais.'));
      hash.update(chunk);
      o.onProgress?.({ done, total });
      // no log, só de 10 em 10 % (ou a cada 20 MB quando o tamanho não é informado)
      const step = total ? Math.floor((done / total) * 10) : Math.floor(done / (20 * 1024 * 1024));
      if (step !== loggedStep) {
        loggedStep = step;
        log(`download: ${done} bytes${total ? ` (${Math.floor((done / total) * 100)}%)` : ''}`);
      }
    });
    await new Promise<void>((resolve, reject) => {
      source.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      source.pipe(out);
    });

    const actual = hash.digest('hex');
    log(`download: concluído, ${done} bytes, SHA-256 ${actual}`);
    if (actual !== expected) throw new Error('O SHA-256 do pacote não confere com o da release: o download foi descartado.');
    await rename(part, final);
    log(`download: SHA-256 conferido; arquivo ${final}`);
    return { file: final, sha256: actual };
  } catch (e) {
    log(`download: FALHOU: ${describeError(e)}`);
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
export async function replaceAppImage(downloaded: string, target: string, log: UpdateLog = noLog): Promise<void> {
  const next = `${target}.new`;
  try {
    log(`appimage: copiando ${downloaded} para ${next}`);
    await copyFile(downloaded, next);
    await chmod(next, 0o755);
    await rename(next, target);
    await rm(downloaded, { force: true }); // o pacote já cumpriu seu papel
    log(`appimage: ${target} substituído`);
  } catch (e) {
    log(`appimage: FALHOU: ${describeError(e)}`);
    await rm(next, { force: true });
    throw new Error(`Não foi possível substituir o AppImage (${(e as Error).message}). Baixe manualmente pela página da release.`);
  }
}

// --- ZIP portátil (Windows) ---------------------------------------------------------------------------------------
// O pacote é extraído enquanto o app ainda roda (a pessoa continua trabalhando); ao confirmar o reinício só resta uma
// troca de pastas, que dura segundos. A troca é feita por um processo separado (o próprio executável em modo Node),
// porque o app não pode sobrescrever a si mesmo enquanto roda.

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, env: env ? { ...process.env, ...env } : process.env, maxBuffer: 1024 * 1024 }, (err, _out, stderr) =>
      err ? reject(new Error(String(stderr || err.message).trim().slice(0, 400))) : resolve(),
    );
  });
}

const systemDir = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');

/** Extrai o ZIP em `dest` (que é recriada). Usa o `tar.exe` do Windows e, se faltar, o `Expand-Archive`. */
export async function extractZip(zip: string, dest: string, log: UpdateLog = noLog): Promise<void> {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const tar = join(systemDir(), 'tar.exe');
  try {
    log(`extração: tar.exe (${tar}) -xf ${zip} -C ${dest}`);
    await run(tar, ['-xf', zip, '-C', dest]);
    log('extração: tar.exe concluiu');
  } catch (e) {
    log(`extração: tar.exe FALHOU: ${describeError(e)}; tentando o Expand-Archive`);
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    try {
      await run(
        join(systemDir(), 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:GN_ZIP -DestinationPath $env:GN_DEST -Force'],
        { GN_ZIP: zip, GN_DEST: dest },
      );
      log('extração: Expand-Archive concluiu');
    } catch (e2) {
      log(`extração: Expand-Archive FALHOU: ${describeError(e2)}`);
      throw e2;
    }
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
export async function prepareStage(zip: string, destDir: string, exeName: string, log: UpdateLog = noLog): Promise<string> {
  const stage = join(destDir, `.${UPDATE_PREFIX}stage`);
  log(`preparo: extraindo ${zip} em ${stage}`);
  await extractZip(zip, stage, log);
  const top = await readdir(stage).catch(() => [] as string[]);
  log(`preparo: itens na raiz da extração (${top.length}): ${top.slice(0, 30).join(', ')}${top.length > 30 ? ', …' : ''}`);
  const root = await findAppRoot(stage, exeName);
  if (!root) {
    log(`preparo: FALHOU: o pacote não contém ${exeName}`);
    await rm(stage, { recursive: true, force: true });
    throw new Error(`O pacote baixado não contém ${exeName}.`);
  }
  log(`preparo: pronto, pasta do app novo ${root}`);
  return root;
}

/**
 * Script da troca, em JavaScript puro (CommonJS), executado pelo PRÓPRIO executável do app em modo Node
 * (`ELECTRON_RUN_AS_NODE=1`). Não depende de PowerShell/cmd, que políticas de segurança (execution policy, AppLocker,
 * antivírus) costumam bloquear, e o executável do app, por definição, pode rodar.
 *
 * Espera o app fechar, move para `.gnupdate-old` as entradas de primeiro nível que o pacote novo substitui, coloca as
 * novas no lugar e reabre o app. Qualquer falha desfaz tudo e reabre a versão anterior. Nunca mexe em `GitNexusData`
 * nem em arquivos que o pacote não traz. No Windows um executável em uso pode ser RENOMEADO (não apagado): é por isso
 * que o script consegue trocar o próprio executável que o está rodando.
 */
export const SWAP_SCRIPT = String.raw`'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const o = JSON.parse(process.argv[2]);
const log = (m) => { try { fs.appendFileSync(o.log, new Date().toISOString() + ' [atualizador] ' + m + '\n'); } catch (e) { /* sem log não é motivo para parar */ } };
const why = (e) => (e && e.code ? '[' + e.code + '] ' : '') + (e && e.message ? e.message : String(e));
const list = (dir) => { try { return fs.readdirSync(dir).join(', '); } catch (e) { return '(não leu: ' + why(e) + ')'; } };
// Aperto de mão: o app só fecha depois de ver este arquivo (prova de que o atualizador realmente iniciou).
try { fs.writeFileSync(o.started, String(process.pid)); } catch (e) { log('não gravou o aperto de mão: ' + e.message); }
log('atualizador iniciado (pid ' + process.pid + ', node ' + process.version + '), esperando o app ' + o.pid + ' fechar');
log('pasta do app: ' + o.appDir + ' | executável: ' + o.exe + ' | preparo: ' + o.stage);
log('conteúdo do app atual: ' + list(o.appDir));
log('conteúdo do pacote novo: ' + list(o.stage));

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);
function retry(fn) {
  for (let i = 1; ; i++) {
    try { return fn(); } catch (e) {
      if (!TRANSIENT.has(e.code) || i >= o.retries) throw e;
      if (i === 1 || i % 10 === 0) log('arquivo preso por outro processo (tentativa ' + i + ' de ' + o.retries + '): ' + why(e));
      sleep(500);
    }
  }
}
function move(src, dst) {
  try { fs.renameSync(src, dst); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(src, dst, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

const t0 = Date.now();
const end = t0 + 90000;
while (alive(o.pid) && Date.now() < end) sleep(200);
log(alive(o.pid) ? 'o app ' + o.pid + ' continua aberto após 90 s: seguindo mesmo assim' : 'o app fechou após ' + (Date.now() - t0) + ' ms');
sleep(800); // processos auxiliares (renderer, GPU) soltam os arquivos logo depois

const old = path.join(o.appDir, '.gnupdate-old');
const moved = [];
const placed = [];
let ok = false;
try {
  fs.rmSync(old, { recursive: true, force: true });
  fs.mkdirSync(old, { recursive: true });
  for (const name of fs.readdirSync(o.stage)) {
    if (name === 'GitNexusData' || name === '.gnupdate-old') continue;
    const cur = path.join(o.appDir, name);
    if (fs.existsSync(cur)) {
      log('guardando ' + name + ' em .gnupdate-old');
      retry(() => move(cur, path.join(old, name)));
      moved.push(name);
    }
    log('colocando ' + name + ' do pacote novo');
    retry(() => move(path.join(o.stage, name), cur));
    placed.push(name);
  }
  ok = true;
  log('troca concluída');
} catch (e) {
  log('troca FALHOU: ' + why(e) + (e && e.path ? ' | arquivo: ' + e.path : '') + ' | desfazendo');
  for (const n of placed) { try { fs.rmSync(path.join(o.appDir, n), { recursive: true, force: true }); } catch (e2) { log('não removeu ' + n + ': ' + e2.message); } }
  for (const n of moved) { try { move(path.join(old, n), path.join(o.appDir, n)); } catch (e2) { log('não restaurou ' + n + ': ' + e2.message); } }
}

try {
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE; // senão o app reaberto também subiria em modo Node, sem janela
  const target = path.join(o.appDir, o.exe);
  log('reabrindo ' + target + (fs.existsSync(target) ? '' : ' (ATENÇÃO: o executável não existe)'));
  const child = spawn(target, o.relaunchArgs || [], { cwd: o.appDir, detached: true, stdio: 'ignore', env });
  child.on('error', (e) => log('não reabriu o app: ' + why(e)));
  child.unref();
  log(ok ? 'app reaberto (versão nova), pid ' + child.pid : 'app reaberto (versão anterior, restaurada), pid ' + child.pid);
} catch (e) {
  log('não reabriu o app: ' + why(e));
}
if (ok) {
  // O executável antigo (este processo) ainda está em uso: o que não der para apagar agora sai na próxima abertura do app.
  for (const p of [old].concat(o.cleanup || [])) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { log('não apagou ' + p + ' (fica para a próxima abertura): ' + why(e)); } }
}
log('atualizador terminou, código ' + (ok ? 0 : 1));
setTimeout(() => process.exit(ok ? 0 : 1), 500);
`;

export interface PortableSwap {
  /** PID do app atual: o script espera esse processo terminar. */
  pid: number;
  /** Pasta devolvida por `prepareStage` (conteúdo do pacote novo). */
  stageDir: string;
  /** Tudo o que deve ser apagado quando a troca dá certo (ZIP baixado, pasta de preparo). */
  cleanup: string[];
  /** Pasta onde o app está instalado (a do executável). */
  appDir: string;
  /** Nome do executável (ex.: GitNexus.exe). */
  exe: string;
  /** Onde gravar o script e o aperto de mão (a pasta de atualizações). */
  workDir: string;
  /** Arquivo de log da atualização, o mesmo do app (o script de troca escreve nele). Padrão: `update.log` em `workDir`. */
  logFile?: string;
  /** Log do app (quem chama); o do script de troca vai para `logFile`. */
  log?: UpdateLog;
  /** Quem roda o script em modo Node. Padrão: o próprio app (`process.execPath`). */
  runner?: string;
  /** Argumentos ao reabrir o app (só testes). */
  relaunchArgs?: string[];
  /** Tentativas por arquivo preso por outro processo, 500 ms entre elas (só testes). */
  retries?: number;
  /** Quanto esperar o atualizador provar que iniciou, em ms. */
  startTimeoutMs?: number;
}

/**
 * Dispara a troca num processo independente e SÓ DEVOLVE quando ele provou que iniciou (aperto de mão). Se não iniciar
 * (bloqueado, sem permissão…) lança: o app continua aberto e a pessoa é avisada, em vez de fechar e não voltar.
 */
export async function startPortableSwap(o: PortableSwap): Promise<ChildProcess> {
  const log = o.log ?? noLog;
  const script = join(o.workDir, `${UPDATE_PREFIX}apply.cjs`);
  const started = join(o.workDir, `${UPDATE_PREFIX}started`);
  await rm(started, { force: true });
  await writeFile(script, SWAP_SCRIPT, 'utf8');
  log(`troca: script gravado em ${script}`);
  const options = {
    pid: o.pid,
    stage: o.stageDir,
    appDir: o.appDir,
    exe: o.exe,
    cleanup: o.cleanup,
    log: o.logFile ?? join(o.workDir, 'update.log'),
    started,
    retries: o.retries ?? 40,
    relaunchArgs: o.relaunchArgs ?? [],
  };
  const runner = o.runner ?? process.execPath;
  log(`troca: iniciando o atualizador (${runner} em modo Node), esperando o app ${o.pid} fechar; pasta do app ${o.appDir}, preparo ${o.stageDir}`);
  const child = spawn(runner, [script, JSON.stringify(options)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  let spawnError: Error | null = null;
  let exitCode: number | null | undefined;
  child.once('error', (e) => (spawnError = e));
  child.once('exit', (c) => (exitCode = c));
  const limit = Date.now() + (o.startTimeoutMs ?? 10_000);
  while (!(await stat(started).catch(() => null))) {
    if (spawnError || exitCode !== undefined || Date.now() > limit) {
      child.kill();
      const why = (spawnError as Error | null) ? describeError(spawnError) : exitCode !== undefined ? `saiu com código ${exitCode}` : `sem resposta em ${o.startTimeoutMs ?? 10_000} ms`;
      log(`troca: o atualizador NÃO iniciou (${why})`);
      throw new Error(`O atualizador não iniciou (${why}).`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  child.unref();
  log(`troca: o atualizador iniciou (pid ${child.pid}); o app vai fechar`);
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
