import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BrowserWindow, Menu, app, clipboard, dialog, ipcMain, shell, utilityProcess, type UtilityProcess } from 'electron';
import { setMessageLocale, tm } from '@git-nexus/git-core';
import { WORKER_METHODS, channel, type UtilityEvent, type UtilityRequest, type UtilityResponse } from '../shared/channels';
import { isAllowedUpdateUrl } from '../shared/update';
import { checkForUpdate } from './update';
import { WINDOWS_INSTALLER_ARGS, downloadVerified, isReadyFile, replaceAppImage } from './installer';
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
      // comandos git executados pelo worker: repassa a todas as janelas (aba "Log")
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel('gitCommands'), msg.data);
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  });
  w.on('exit', () => {
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

function updateContext() {
  return { current: app.getVersion(), platform: process.platform, arch: process.arch, portable: isPortable, appImage: Boolean(process.env.APPIMAGE) };
}

ipcMain.handle(channel('checkForUpdate'), () => {
  // Em desenvolvimento a versão do app não é a de uma release: não faz sentido comparar (a menos que se force por variável).
  if (!app.isPackaged && !process.env.GITNEXUS_UPDATE_REPO) {
    return { status: 'unavailable', current: app.getVersion(), message: tm('Verificação desativada em desenvolvimento.', 'Update check is disabled in development.') };
  }
  return checkForUpdate(updateContext());
});

// Atualização sem sair do app. O renderer não informa endereço nenhum: o processo principal consulta a release de novo,
// baixa só o pacote que ele mesmo escolheu e confere o SHA-256 contra o SHA256SUMS.txt da mesma release.
let downloadedUpdate: { file: string; kind: 'installer' | 'appimage'; version: string } | null = null;
ipcMain.handle(channel('downloadUpdate'), async (e) => {
  const info = await checkForUpdate(updateContext());
  if (info.status !== 'available' || !info.downloadUrl || !info.assetName || !info.sumsUrl || !info.latest) throw new Error(tm('Não há atualização para baixar.', 'There is no update to download.'));
  if (info.install !== 'installer' && info.install !== 'appimage') throw new Error(tm('Este pacote precisa ser instalado manualmente.', 'This package must be installed manually.'));
  const r = await downloadVerified({
    url: info.downloadUrl,
    name: info.assetName,
    sumsUrl: info.sumsUrl,
    destDir: join(dataDir, 'updates'),
    onProgress: (p) => {
      if (!e.sender.isDestroyed()) e.sender.send(channel('updateProgress'), p);
    },
  });
  downloadedUpdate = { file: r.file, kind: info.install, version: info.latest };
  return { version: info.latest, assetName: info.assetName, sha256: r.sha256 };
});
ipcMain.handle(channel('installUpdate'), async () => {
  const u = downloadedUpdate;
  if (!u || !(await isReadyFile(u.file))) throw new Error(tm('Baixe a atualização antes de instalar.', 'Download the update before installing.'));
  if (u.kind === 'installer') {
    // Instalador NSIS em modo silencioso (por usuário, sem administrador): atualiza no mesmo lugar e reabre o app.
    spawn(u.file, [...WINDOWS_INSTALLER_ARGS], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
    return;
  }
  const target = process.env.APPIMAGE;
  if (!target) throw new Error(tm('O AppImage atual não foi identificado.', 'The current AppImage could not be identified.'));
  await replaceAppImage(u.file, target);
  app.relaunch({ execPath: target, args: [] });
  app.quit();
});
ipcMain.handle(channel('openExternal'), async (_e, url: string) => {
  if (!isAllowedUpdateUrl(String(url))) throw new Error(tm('Endereço não permitido.', 'Address not allowed.'));
  await shell.openExternal(String(url));
});
ipcMain.handle(channel('copyText'), (_e, text: string) => clipboard.writeText(String(text)));
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
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
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
