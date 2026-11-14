import { accessSync, constants, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BrowserWindow, Menu, app, clipboard, dialog, ipcMain, shell, utilityProcess, type UtilityProcess } from 'electron';
import { WORKER_METHODS, channel, type UtilityRequest, type UtilityResponse } from '../shared/channels';

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
const dataDir = resolveDataDir() ?? app.getPath('userData');
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
  w.on('message', (msg: UtilityResponse) => {
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
  ipcMain.handle(channel(m), (_e, ...args: unknown[]) => callWorker(m, args));
}

ipcMain.handle(channel('pickDirectories'), async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = { title: 'Selecionar pastas', properties: ['openDirectory', 'multiSelections'] as ('openDirectory' | 'multiSelections')[] };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? [] : r.filePaths;
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
