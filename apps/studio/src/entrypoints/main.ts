import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { BrowserWindow, Menu, Notification, app, clipboard, dialog, ipcMain, screen, shell, utilityProcess, type UtilityProcess } from 'electron';
import { setMessageLocale, tm } from '@git-nexus/git-core';
import { WORKER_METHODS, channel, type UtilityEvent, type UtilityRequest, type UtilityResponse } from '../shared/channels';
import { isAllowedUpdateUrl } from '../shared/update';
import { GIT_UNAVAILABLE } from '@git-nexus/git-core/pure';
import { BREW_PATHS, GIT_DOWNLOAD_URL, GIT_FREE_WORKER_METHODS, effectiveMinGitVersion, installMethod } from '../shared/git-install';
import { detectGit, gitEnvFor, realDetectDeps, realExec } from './git-detect';
import { installGit, realRun } from './git-install';
import { GitManager } from './git-manager';
import { checkForUpdate } from './update';
import { WINDOWS_INSTALLER_ARGS, cleanupUpdateFiles, downloadVerified, isReadyFile, prepareStage, replaceAppImage, startPortableSwap } from './installer';
import { editorLaunches, launchFirst, terminalLaunches, type SpawnFn } from './external-tools';
import { fitWindowState, readWindowState, writeWindowState } from './window-state';
import { clampZoom, isZoomAction, stepZoom, zoomActionForKey } from './zoom';
import { TITLE_BAR_ARG, TITLE_BAR_COLORS, overlayHeight, parseTitleBarColors, titleBarMode, titleBarWindowOptions } from '../shared/title-bar';
import { APP_LOG_NAME, UPDATE_LOG_NAME, createUpdateLog, describeError } from './update-log';
import { HostingService } from '../worker/hosting-service';
import { SecureTokenStore } from './hosting-store';
import { attachSmoke, smokeEnabled } from './smoke';
import { cycleArgs, runUpdateCycle } from './cycle';

// --- Portabilidade: dados ao lado do executável, nada no registro/AppData ---------------
// Modo portátil: AppImage e ZIP/tar.gz (descompactados em pasta gravável).
// Versões instaladas (instalador NSIS, .deb/.rpm, .app em /Applications) usam o diretório padrão do SO.
function isWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveDataDir(): string | null {
  if (process.env.GITNEXUS_DATA_DIR) return process.env.GITNEXUS_DATA_DIR; // override explícito
  if (!app.isPackaged) return join(__dirname, '..', '.dev-data'); // desenvolvimento
  if (process.env.APPIMAGE) {
    const dir = dirname(process.env.APPIMAGE);
    return isWritable(dir) ? join(dir, 'GitNexusData') : null;
  }

  const exe = app.getPath('exe');
  // Pasta que contém o executável (no macOS, a pasta que contém o .app).
  const base = process.platform === 'darwin' ? resolve(exe, '..', '..', '..', '..') : dirname(exe);
  const installed =
    process.platform === 'win32'
      ? existsSync(join(base, `Uninstall ${app.getName()}.exe`)) // gerado pelo instalador NSIS
      : process.platform === 'darwin'
        ? base === '/Applications' || base === join(homedir(), 'Applications')
        : /^\/(usr|opt)(\/|$)/.test(base); // .deb / .rpm
  if (existsSync(join(base, 'GitNexusData'))) return join(base, 'GitNexusData'); // opt-in explícito
  return !installed && isWritable(base) ? join(base, 'GitNexusData') : null;
}
const portableDir = resolveDataDir();
const dataDir = portableDir ?? app.getPath('userData');
/** Rodando como app portátil (dados ao lado do executável): a atualização sugerida é o ZIP/AppImage, não o instalador. */
const isPortable = app.isPackaged && portableDir !== null;
app.setPath('userData', dataDir);

// Log geral de erros (`<dados>/logs/gitnexus-app.log`): exceções não tratadas do main, do worker e da interface, e processos que caíram.
// Antes elas viravam silêncio ou o diálogo nativo, sem rastro para diagnosticar.
const appLog = createUpdateLog(join(dataDir, 'logs', APP_LOG_NAME));
const crashText = (e: unknown) => `${describeError(e)}${e instanceof Error && e.stack ? `\n${e.stack}` : ''}`;
process.on('uncaughtException', (e) => appLog(`main: exceção não tratada: ${crashText(e)}`));
process.on('unhandledRejection', (e) => appLog(`main: promessa rejeitada sem tratamento: ${crashText(e)}`));
app.on('render-process-gone', (_e, _wc, d) => appLog(`interface encerrou: ${d.reason} (código ${d.exitCode})`));
app.on('child-process-gone', (_e, d) => appLog(`processo ${d.type}${d.name ? ` (${d.name})` : ''} encerrou: ${d.reason} (código ${d.exitCode})`));

// --- UtilityProcess: todo trabalho pesado de Git ----------------------------------------
let worker: UtilityProcess | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function startWorker(): UtilityProcess {
  const w = utilityProcess.fork(join(__dirname, 'utility.cjs'), [], {
    env: { ...process.env, GITNEXUS_DATA_DIR: dataDir },
    serviceName: 'gitnexus-git-worker',
  });
  w.on('message', (msg: UtilityResponse | UtilityEvent) => {
    if ('event' in msg) {
      if (msg.event === 'appError') return void appLog(`${msg.data.source}: ${msg.data.message}${msg.data.stack ? `\n${msg.data.stack}` : ''}`);
      // eventos espontâneos do worker, repassados a todas as janelas: comandos git (aba "Log") e andamento de fetch/pull/push
      const ch = msg.event === 'gitProgress' ? 'gitProgress' : msg.event === 'askpass' ? 'askpass' : 'gitCommands';
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel(ch), msg.data);
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  });
  w.on('exit', (code) => {
    if (code !== 0) appLog(`worker do git encerrou com código ${code}; as chamadas pendentes falharam`);
    for (const p of pending.values()) p.reject(new Error('Processo utilitário encerrou.'));
    pending.clear();
    worker = null;
  });
  return w;
}

function callWorker(method: UtilityRequest['method'], args: unknown[]): Promise<unknown> {
  worker ??= startWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, method, args } satisfies UtilityRequest);
  });
}

// --- Git do computador: sem ele o app inteiro fica bloqueado (a interface mostra o aviso e a instalação; veja git-manager.ts) ---
const gitManager = new GitManager({
  detect: () => detectGit(realDetectDeps(dataDir)),
  method: () => installMethod(process.platform, process.arch, { brew: BREW_PATHS.find((p) => existsSync(p)) ?? null, flatpak: Boolean(process.env.FLATPAK_ID) }),
  min: effectiveMinGitVersion(process.env),
  log: appLog,
  onFound: (found) => {
    // o worker (e o que o git chama) passa a usar o Git encontrado; um worker já aberto é reiniciado na próxima chamada
    const env = gitEnvFor(found.path, process.env);
    const changed = Object.entries(env).some(([k, v]) => process.env[k] !== v);
    Object.assign(process.env, env);
    if (changed) worker?.kill();
  },
  install: (emit, signal) =>
    installGit({
      platform: process.platform,
      arch: process.arch,
      env: process.env,
      dataDir,
      fetchImpl: fetch,
      exec: realExec,
      run: realRun,
      exists: existsSync,
      detect: () => detectGit(realDetectDeps(dataDir)),
      emit,
      log: appLog,
      signal,
    }),
});

/** Recusa a chamada enquanto o Git faltar. O bloqueio é AQUI (e não só na sobreposição): atalho, arrastar e soltar e a linha de comando não furam. */
async function requireGit(): Promise<void> {
  await gitManager.ready;
  if (gitManager.isBlocked()) throw new Error(`${GIT_UNAVAILABLE}: ${tm('git.err.unavailable')}`);
}
const needsGit =
  <A extends unknown[], R>(fn: (...a: A) => R) =>
  async (...a: A): Promise<Awaited<R>> => {
    await requireGit();
    return await fn(...a);
  };

ipcMain.handle(channel('getGitAvailability'), async () => {
  await gitManager.ready;
  return gitManager.availability();
});
ipcMain.handle(channel('recheckGit'), () => gitManager.refresh());
ipcMain.handle(channel('installGit'), async (e) => {
  try {
    return await gitManager.install((p) => {
      if (!e.sender.isDestroyed()) e.sender.send(channel('gitInstallProgress'), p);
    });
  } catch (err) {
    appLog(`git-install: ERRO: ${describeError(err)}${err instanceof Error && err.stack ? `\n${err.stack}` : ''}`);
    throw new Error(`${err instanceof Error ? err.message : String(err)} ${tm('git.err.logHint')}${appLog.file}`);
  }
});
ipcMain.handle(channel('cancelGitInstall'), () => gitManager.cancel());
ipcMain.handle(channel('openGitDownloadPage'), () => shell.openExternal(GIT_DOWNLOAD_URL)); // endereço fixo, sem parâmetro da interface

for (const m of WORKER_METHODS) {
  ipcMain.handle(channel(m), async (_e, ...args: unknown[]) => {
    if (m === 'setLocale') setMessageLocale(String(args[0])); // o processo principal tem as próprias mensagens
    if (!GIT_FREE_WORKER_METHODS.has(m)) await requireGit();
    return callWorker(m, args);
  });
}

ipcMain.handle(channel('pickDirectories'), async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = { title: 'Selecionar pastas', properties: ['openDirectory', 'multiSelections'] as ('openDirectory' | 'multiSelections')[] };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? [] : r.filePaths;
});

// --- GitHub / GitLab: tokens criptografados pelo sistema (safeStorage); as chamadas à API acontecem aqui, nunca no renderer ---
const hosting = new HostingService(new SecureTokenStore(join(dataDir, 'hosting.json')));
ipcMain.handle(channel('hostingInfo'), needsGit((_e: unknown, repoPath: string) => hosting.hostingInfo(String(repoPath))));
ipcMain.handle(
  channel('hostingSaveToken'),
  needsGit((_e: unknown, repoPath: string, token: string, kind?: 'github' | 'gitlab') => hosting.saveToken(String(repoPath), String(token), kind === 'github' || kind === 'gitlab' ? kind : undefined)),
);
ipcMain.handle(channel('hostingRemoveToken'), needsGit((_e: unknown, repoPath: string) => hosting.removeToken(String(repoPath))));
ipcMain.handle(
  channel('listChangeRequests'),
  needsGit((_e: unknown, repoPath: string, state: 'open' | 'merged' | 'closed') => hosting.listChangeRequests(String(repoPath), state === 'merged' || state === 'closed' ? state : 'open')),
);
ipcMain.handle(channel('getCiStatus'), needsGit((_e: unknown, repoPath: string, sha: string) => hosting.getCiStatus(String(repoPath), String(sha))));
ipcMain.handle(channel('suggestChangeRequest'), needsGit((_e: unknown, repoPath: string, base: string) => hosting.suggestChangeRequest(String(repoPath), String(base))));
ipcMain.handle(
  channel('createChangeRequest'),
  needsGit((_e: unknown, repoPath: string, input: Parameters<HostingService['createChangeRequest']>[1]) => hosting.createChangeRequest(String(repoPath), input)),
);
ipcMain.handle(
  channel('hostingOpen'),
  needsGit(async (_e: unknown, repoPath: string, url: string) => {
    if (!(await hosting.isAllowedUrl(String(repoPath), String(url)))) throw new Error(tm('Endereço não permitido.', 'Address not allowed.'));
    await shell.openExternal(String(url));
  }),
);

/** Pasta do executável (no AppImage, a pasta do arquivo .AppImage). */
const exeDir = process.env.APPIMAGE ? dirname(process.env.APPIMAGE) : dirname(process.execPath);
/**
 * Onde a atualização é baixada e preparada: na MESMA pasta do executável (assim a troca é só renomear, no mesmo volume, e
 * nada fica espalhado). Se ela não for gravável, cai na pasta de dados. Tudo o que o updater cria tem o prefixo `gnupdate-`.
 */
const updateDir = app.isPackaged && isWritable(exeDir) ? exeDir : join(dataDir, 'updates');

// Log da atualização, para TODAS as instalações (instalador, ZIP portátil, AppImage…): `<dados>/logs/gitnexus-update.log`.
// No modo portátil isso é `GitNexusData/logs/`, ao lado do executável. O script de troca (que roda depois que o app fecha) escreve no mesmo arquivo.
const updateLog = createUpdateLog(join(dataDir, 'logs', UPDATE_LOG_NAME));

function updateContext() {
  return {
    current: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    portable: isPortable,
    appImage: Boolean(process.env.APPIMAGE),
    writable: app.isPackaged && isWritable(exeDir),
  };
}

/** Linha de contexto: o que mais ajuda a entender por que a atualização de uma máquina se comporta diferente da de outra. */
function describeContext(): string {
  const c = updateContext();
  return [
    `versão ${c.current}`,
    `${c.platform}/${c.arch}`,
    `instalação: ${isPortable ? 'portátil' : c.appImage ? 'AppImage' : 'instalada'}`,
    `pasta do app gravável: ${c.writable}`,
    `executável: ${process.execPath}`,
    `pasta de atualização: ${updateDir}`,
    `dados: ${dataDir}`,
    `electron ${process.versions.electron}, node ${process.versions.node}`,
  ].join(' | ');
}

/** Registra a falha (com o código do sistema e a pilha) e a devolve já apontando para o arquivo de log. */
function failWithLog(step: string, e: unknown): Error {
  updateLog(`${step}: ERRO: ${describeError(e)}${e instanceof Error && e.stack ? `\n${e.stack}` : ''}`);
  const base = e instanceof Error ? e.message : String(e);
  return new Error(`${base} ${tm('Detalhes no log: ', 'Details in the log: ')}${updateLog.file}`);
}

// Restos de uma atualização anterior (pacote baixado, pasta de preparo, backup da troca) saem a cada abertura do app.
// O registro desta abertura mostra, depois de uma troca, em que versão o app subiu (compare com o fim do atualizador).
// (No ciclo de teste do CI, GITNEXUS_UPDATE_CYCLE, os restos ficam para o próprio teste: veja cycle.ts.)
if (app.isPackaged && !cycleArgs()) {
  updateLog(`app iniciado: ${describeContext()}`);
  void Promise.all([cleanupUpdateFiles(exeDir, updateLog), cleanupUpdateFiles(join(dataDir, 'updates'), updateLog)]).then(([a, b]) => {
    const removed = [...a, ...b];
    if (removed.length) updateLog(`limpeza ao abrir: removidos ${removed.join(', ')}`);
  });
}

ipcMain.handle(channel('checkForUpdate'), () => {
  // Em desenvolvimento a versão do app não é a de uma release: não faz sentido comparar (a menos que se force por variável).
  if (!app.isPackaged && !process.env.GITNEXUS_UPDATE_REPO) {
    return { status: 'unavailable', current: app.getVersion(), message: tm('Verificação desativada em desenvolvimento.', 'Update check is disabled in development.') };
  }
  return checkForUpdate(updateContext()).then(
    (r) => {
      updateLog(`verificação: ${r.status}${r.latest ? `, última ${r.latest}` : ''}${r.assetName ? `, pacote ${r.assetName}` : ''}${r.install ? `, instalação ${r.install}` : ''}${r.message ? `, ${r.message}` : ''}`);
      return r;
    },
    (e: unknown) => {
      updateLog(`verificação: ERRO: ${describeError(e)}`);
      throw e;
    },
  );
});

// Atualização sem sair do app. O renderer não informa endereço nenhum: o processo principal consulta a release de novo,
// baixa só o pacote que ele mesmo escolheu e confere o SHA-256 contra o SHA256SUMS.txt da mesma release.
let downloadedUpdate: { file: string; kind: 'installer' | 'appimage' | 'portable'; version: string; stage?: string } | null = null;
ipcMain.handle(channel('downloadUpdate'), async (e) => {
  updateLog(`==== atualização: baixar ==== ${describeContext()}`);
  try {
    const info = await checkForUpdate(updateContext());
    updateLog(`release: status ${info.status}, última ${info.latest ?? '?'}, pacote ${info.assetName ?? '?'}, instalação ${info.install ?? '?'}`);
    if (info.status !== 'available' || !info.downloadUrl || !info.assetName || !info.sumsUrl || !info.latest) throw new Error(tm('Não há atualização para baixar.', 'There is no update to download.'));
    if (info.install !== 'installer' && info.install !== 'appimage' && info.install !== 'portable') throw new Error(tm('Este pacote precisa ser instalado manualmente.', 'This package must be installed manually.'));
    const r = await downloadVerified({
      url: info.downloadUrl,
      name: info.assetName,
      sumsUrl: info.sumsUrl,
      destDir: updateDir,
      log: updateLog,
      onProgress: (p) => {
        if (!e.sender.isDestroyed()) e.sender.send(channel('updateProgress'), p);
      },
    });
    let stage: string | undefined;
    if (info.install === 'portable') {
      // Pacote conferido: extrai agora, com o app aberto, para que o reinício seja só a troca de pastas.
      if (!e.sender.isDestroyed()) e.sender.send(channel('updateProgress'), { done: 0, total: 0, stage: 'prepare' });
      stage = await prepareStage(r.file, updateDir, basename(process.execPath), updateLog);
    }
    downloadedUpdate = { file: r.file, kind: info.install, version: info.latest, stage };
    updateLog(`atualização ${info.latest} baixada e conferida; aguardando a confirmação para instalar`);
    return { version: info.latest, assetName: info.assetName, sha256: r.sha256 };
  } catch (err) {
    throw failWithLog('baixar', err);
  }
});
async function installDownloadedUpdate(): Promise<void> {
  const u = downloadedUpdate;
  if (!u || !(await isReadyFile(u.file))) throw new Error(tm('Baixe a atualização antes de instalar.', 'Download the update before installing.'));
  updateLog(`==== atualização: instalar ${u.version} (${u.kind}) ==== pacote ${u.file}`);
  if (u.kind === 'installer') {
    // Instalador NSIS em modo silencioso (por usuário, sem administrador): atualiza no mesmo lugar e reabre o app.
    // Espera o processo realmente nascer: se não nascer (bloqueio, arquivo sumido), o app NÃO fecha e a pessoa é avisada.
    updateLog(`instalador: executando ${u.file} ${WINDOWS_INSTALLER_ARGS.join(' ')}`);
    const child = spawn(u.file, [...WINDOWS_INSTALLER_ARGS], { detached: true, stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    updateLog(`instalador: iniciado (pid ${child.pid}); o app vai fechar e o instalador reabre a versão nova`);
    app.quit();
    return;
  }
  if (u.kind === 'portable') {
    if (!u.stage) throw new Error(tm('A atualização não foi preparada.', 'The update was not prepared.'));
    // O próprio executável, em modo Node, espera o app fechar, troca os arquivos (com rollback), apaga o pacote e reabre o app.
    // Só fechamos depois que ele provar que iniciou; se não iniciar, o app continua aberto e a pessoa é avisada.
    try {
      await startPortableSwap({
        pid: process.pid,
        stageDir: u.stage,
        cleanup: [join(updateDir, '.gnupdate-stage'), u.file],
        appDir: dirname(process.execPath),
        exe: basename(process.execPath),
        workDir: updateDir,
        logFile: updateLog.file,
        log: updateLog,
      });
    } catch (e) {
      throw new Error(tm('Não foi possível iniciar o atualizador. Baixe a atualização manualmente. ', 'Could not start the updater. Download the update manually. ') + (e as Error).message);
    }
    app.quit();
    return;
  }
  const target = process.env.APPIMAGE;
  if (!target) throw new Error(tm('O AppImage atual não foi identificado.', 'The current AppImage could not be identified.'));
  await replaceAppImage(u.file, target, updateLog);
  updateLog(`appimage: reiniciando ${target}`);
  app.relaunch({ execPath: target, args: [] });
  app.quit();
}
ipcMain.handle(channel('installUpdate'), async () => {
  try {
    await installDownloadedUpdate();
  } catch (err) {
    throw failWithLog('instalar', err);
  }
});
// "Novidades": o CHANGELOG.md vai junto do app (extraResources); em desenvolvimento é o da raiz do repositório.
ipcMain.handle(channel('getChangelog'), async () => {
  const file = app.isPackaged ? join(process.resourcesPath, 'CHANGELOG.md') : join(__dirname, '..', '..', '..', 'CHANGELOG.md');
  const markdown = await readFile(file, 'utf8').catch(() => '');
  return { markdown: markdown.slice(0, 2 * 1024 * 1024), version: app.getVersion() };
});
ipcMain.handle(channel('openExternal'), async (_e, url: string) => {
  if (!isAllowedUpdateUrl(String(url))) throw new Error(tm('Endereço não permitido.', 'Address not allowed.'));
  await shell.openExternal(String(url));
});
ipcMain.handle(channel('copyText'), (_e, text: string) => clipboard.writeText(String(text)));
ipcMain.handle(channel('logRendererError'), (_e, message: string, stack?: string) => {
  appLog(`interface: ${String(message).slice(0, 2000)}${stack ? `\n${String(stack).slice(0, 4000)}` : ''}`);
  return { logFile: appLog.file };
});
ipcMain.handle(
  channel('showItemInFolder'),
  needsGit((_e: unknown, repoPath: string, file: string) => shell.showItemInFolder(join(repoPath, file.replace(/\/$/, '')))),
);
ipcMain.handle(
  channel('openPath'),
  needsGit((_e: unknown, repoPath: string, file: string) => shell.openPath(join(repoPath, file.replace(/\/$/, '')))),
);

// --- Janela ---------------------------------------------------------------------------
/** Ícone da janela (barra de tarefas no Linux e execução em desenvolvimento). No Windows/macOS o do executável já vale. */
function windowIcon(): string | undefined {
  const file = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '..', 'build', 'icon.png');
  return existsSync(file) ? file : undefined;
}

/** Zoom atual da interface e como gravá-lo junto com o estado da janela (preenchido por `createWindow`). */
let currentZoom = 1;
let saveWindowState: () => void = () => undefined;

/** Moldura desta execução (Windows/Linux: botões nativos sobre as abas; macOS: semáforo à esquerda; GITNEXUS_NATIVE_FRAME=1: moldura do sistema). */
const frameMode = titleBarMode(process.platform, process.env);

/** Cores do overlay (as do tema da interface, que ela informa) e a altura que acompanha o zoom: os botões nativos têm de ficar na altura da faixa de abas. */
let overlayColors: { color: string; symbolColor: string } = TITLE_BAR_COLORS.dark;
function syncTitleBarOverlay(win: BrowserWindow | null): boolean {
  if (frameMode !== 'overlay' || !win || win.isDestroyed()) return false;
  try {
    win.setTitleBarOverlay({ ...overlayColors, height: overlayHeight(currentZoom) });
    return true;
  } catch (e) {
    appLog(`barra de título: o overlay não pôde ser ajustado: ${describeError(e)}`); // gerenciador de janelas sem suporte: a moldura padrão segue
    return false;
  }
}

function applyZoom(wc: Electron.WebContents, factor: number): number {
  currentZoom = clampZoom(factor);
  if (!wc.isDestroyed()) wc.setZoomFactor(currentZoom);
  syncTitleBarOverlay(BrowserWindow.fromWebContents(wc));
  saveWindowState();
  return currentZoom;
}

// --- Abrir o repositório no terminal / no editor: sem shell, só programas conhecidos (veja external-tools.ts) ---
async function repoFolder(repoPath: unknown): Promise<string> {
  const dir = resolve(String(repoPath ?? ''));
  const info = await stat(dir).catch(() => null);
  // só pastas que são repositórios (têm .git): a interface não pode mandar abrir qualquer lugar
  if (!info?.isDirectory() || !existsSync(join(dir, '.git'))) throw new Error(tm('Pasta de repositório inválida.', 'Invalid repository folder.'));
  return dir;
}
ipcMain.handle(
  channel('openInTerminal'),
  needsGit(async (_e: unknown, repoPath: string) => {
    const dir = await repoFolder(repoPath);
    const app = await launchFirst(terminalLaunches(process.platform, dir), spawn as unknown as SpawnFn);
    if (!app) throw new Error(tm('Não encontrei um terminal para abrir.', 'Could not find a terminal to open.'));
    return { app };
  }),
);
ipcMain.handle(
  channel('openInEditor'),
  needsGit(async (_e: unknown, repoPath: string) => {
    const dir = await repoFolder(repoPath);
    const app = await launchFirst(editorLaunches(process.platform, dir, process.env, existsSync), spawn as unknown as SpawnFn);
    if (!app) throw new Error(tm('Não encontrei o VS Code (ou o VSCodium) instalado.', 'Could not find VS Code (or VSCodium) installed.'));
    return { app };
  }),
);

// --- Notificações do sistema (a interface decide QUANDO avisar; aqui só se mostra) ---
// Guarda as notificações abertas: sem uma referência o coletor de lixo pode apagá-las antes do clique.
const openNotifications = new Set<Notification>();
ipcMain.handle(channel('notify'), (e, input: { title?: unknown; body?: unknown }) => {
  if (!Notification.isSupported()) return false;
  const cut = (v: unknown, max: number) => String(v ?? '').slice(0, max);
  const n = new Notification({ title: cut(input?.title, 120) || 'GitNexus', body: cut(input?.body, 400) });
  const win = BrowserWindow.fromWebContents(e.sender);
  n.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  n.on('close', () => openNotifications.delete(n));
  openNotifications.add(n);
  n.show();
  return true;
});

// Zoom pelos comandos da paleta: a interface só pede a ação; quem sabe o fator atual é este processo.
ipcMain.handle(channel('setZoom'), (e, action: string) => {
  if (!isZoomAction(action)) throw new Error(tm('Ação de zoom inválida.', 'Invalid zoom action.'));
  return applyZoom(e.sender, stepZoom(currentZoom, action));
});

// A interface informa as cores da faixa de abas a cada troca de tema; o overlay dos botões da janela as acompanha.
ipcMain.handle(channel('setTitleBar'), (e, input: unknown) => {
  const colors = parseTitleBarColors(input);
  if (!colors) throw new Error(tm('Cores da barra de título inválidas.', 'Invalid title bar colors.'));
  overlayColors = colors;
  return syncTitleBarOverlay(BrowserWindow.fromWebContents(e.sender));
});

function createWindow(): void {
  // Sem o menu padrão (Windows/Linux, app empacotado): ele reservaria Ctrl+W, Ctrl+R e o DevTools, que colidem com os atalhos do app.
  // No macOS o menu é mantido (precisa dele para copiar/colar e sair).
  if (app.isPackaged && process.platform !== 'darwin') Menu.setApplicationMenu(null);
  // tamanho, posição e maximizado da última vez, ajustados às telas de agora (o monitor pode não existir mais)
  const stateFile = join(dataDir, 'window-state.json');
  const saved = fitWindowState(readWindowState(stateFile), screen.getAllDisplays().map((d) => d.workArea));
  const win = new BrowserWindow({
    ...(saved.x !== undefined && saved.y !== undefined ? { x: saved.x, y: saved.y } : {}),
    width: saved.width,
    height: saved.height,
    minWidth: 960,
    minHeight: 600,
    title: 'GitNexus',
    backgroundColor: '#17181b',
    icon: windowIcon(),
    autoHideMenuBar: true,
    ...titleBarWindowOptions(frameMode, saved.zoom ?? 1, overlayColors),
    webPreferences: {
      additionalArguments: [`${TITLE_BAR_ARG}${frameMode}`],
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (saved.maximized) win.maximize();
  let rememberTimer: ReturnType<typeof setTimeout> | undefined;
  const remember = (): void => {
    clearTimeout(rememberTimer);
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    // `getNormalBounds` é o tamanho de janela normal, mesmo com ela maximizada (ao desmaximizar volta a ele)
    writeWindowState(stateFile, { ...win.getNormalBounds(), maximized: win.isMaximized(), ...(currentZoom !== 1 ? { zoom: currentZoom } : {}) });
  };
  saveWindowState = remember;
  // zoom lembrado, e o teclado (sem o menu padrão não há atalhos): Ctrl/⌘ + = (ou +), -, 0
  currentZoom = saved.zoom ?? 1;
  win.webContents.on('dom-ready', () => win.webContents.setZoomFactor(currentZoom));
  win.webContents.on('before-input-event', (ev, input) => {
    if (input.type !== 'keyDown') return;
    const action = zoomActionForKey(input.key, { control: input.control, meta: input.meta, alt: input.alt });
    if (!action) return;
    ev.preventDefault();
    applyZoom(win.webContents, stepZoom(currentZoom, action));
  });
  const rememberSoon = (): void => {
    clearTimeout(rememberTimer);
    rememberTimer = setTimeout(remember, 400);
  };
  win.on('resize', rememberSoon);
  win.on('move', rememberSoon);
  win.on('maximize', remember);
  win.on('unmaximize', remember);
  win.on('close', remember);
  // Links externos abrem no navegador; a janela nunca navega para fora do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (ev, url) => {
    if (!url.startsWith('file:') && !url.startsWith(process.env.VITE_DEV_SERVER_URL ?? 'file:')) ev.preventDefault();
  });

  // Só no CI (GITNEXUS_SMOKE=1): confere que o app empacotado abre e responde, e sai com 0/1 (veja smoke.ts).
  if (smokeEnabled()) attachSmoke(win, (code) => app.exit(code));

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, 'renderer', 'index.html'));
}

const cycle = cycleArgs();
if (cycle) {
  // Só no CI (GITNEXUS_UPDATE_CYCLE): não abre janela; roda o ciclo de atualização do portátil e sai (veja cycle.ts).
  void app.whenReady().then(() => runUpdateCycle(cycle, process.execPath, process.pid, (code) => app.exit(code)));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [w] = BrowserWindow.getAllWindows();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });
  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => worker?.kill());
