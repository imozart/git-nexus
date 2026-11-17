import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { BrowserWindow, Menu, app, clipboard, dialog, ipcMain, screen, shell, utilityProcess, type UtilityProcess } from 'electron';
import { setMessageLocale, tm } from '@git-nexus/git-core';
import { WORKER_METHODS, channel, type UtilityEvent, type UtilityRequest, type UtilityResponse } from '../shared/channels';
import { isAllowedUpdateUrl } from '../shared/update';
import { checkForUpdate } from './update';
import { WINDOWS_INSTALLER_ARGS, cleanupUpdateFiles, downloadVerified, isReadyFile, prepareStage, replaceAppImage, startPortableSwap } from './installer';
import { fitWindowState, readWindowState, writeWindowState } from './window-state';
import { APP_LOG_NAME, UPDATE_LOG_NAME, createUpdateLog, describeError } from './update-log';
import { HostingService } from '../worker/hosting-service';
import { SecureTokenStore } from './hosting-store';
import { attachSmoke, smokeEnabled } from './smoke';

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
      const ch = msg.event === 'gitProgress' ? 'gitProgress' : 'gitCommands';
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

for (const m of WORKER_METHODS) {
  ipcMain.handle(channel(m), (_e, ...args: unknown[]) => {
    if (m === 'setLocale') setMessageLocale(String(args[0])); // o processo principal tem as próprias mensagens
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
ipcMain.handle(channel('hostingInfo'), (_e, repoPath: string) => hosting.hostingInfo(String(repoPath)));
ipcMain.handle(channel('hostingSaveToken'), (_e, repoPath: string, token: string, kind?: 'github' | 'gitlab') =>
  hosting.saveToken(String(repoPath), String(token), kind === 'github' || kind === 'gitlab' ? kind : undefined),
);
ipcMain.handle(channel('hostingRemoveToken'), (_e, repoPath: string) => hosting.removeToken(String(repoPath)));
ipcMain.handle(channel('listChangeRequests'), (_e, repoPath: string, state: 'open' | 'merged' | 'closed') =>
  hosting.listChangeRequests(String(repoPath), state === 'merged' || state === 'closed' ? state : 'open'),
);
ipcMain.handle(channel('getCiStatus'), (_e, repoPath: string, sha: string) => hosting.getCiStatus(String(repoPath), String(sha)));
ipcMain.handle(channel('suggestChangeRequest'), (_e, repoPath: string, base: string) => hosting.suggestChangeRequest(String(repoPath), String(base)));
ipcMain.handle(channel('createChangeRequest'), (_e, repoPath: string, input: Parameters<HostingService['createChangeRequest']>[1]) =>
  hosting.createChangeRequest(String(repoPath), input),
);
ipcMain.handle(channel('hostingOpen'), async (_e, repoPath: string, url: string) => {
  if (!(await hosting.isAllowedUrl(String(repoPath), String(url)))) throw new Error(tm('Endereço não permitido.', 'Address not allowed.'));
  await shell.openExternal(String(url));
});

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
if (app.isPackaged) {
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
ipcMain.handle(channel('showItemInFolder'), (_e, repoPath: string, file: string) =>
  shell.showItemInFolder(join(repoPath, file.replace(/\/$/, ''))),
);
ipcMain.handle(channel('openPath'), (_e, repoPath: string, file: string) =>
  shell.openPath(join(repoPath, file.replace(/\/$/, ''))),
);

// --- Janela ---------------------------------------------------------------------------
/** Ícone da janela (barra de tarefas no Linux e execução em desenvolvimento). No Windows/macOS o do executável já vale. */
function windowIcon(): string | undefined {
  const file = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '..', 'build', 'icon.png');
  return existsSync(file) ? file : undefined;
}

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
    webPreferences: {
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
    writeWindowState(stateFile, { ...win.getNormalBounds(), maximized: win.isMaximized() });
  };
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

if (!app.requestSingleInstanceLock()) {
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
