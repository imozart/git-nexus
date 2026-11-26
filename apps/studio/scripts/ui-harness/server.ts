// Harness de UI: serve o renderer compilado num navegador comum e liga `window.gitNexus` aos MESMOS
// handlers do processo utilitário (git real). Serve para testar a interface com CDP/Playwright
// sem precisar do Electron. Uso: node harness.mjs <dist/renderer> <dataDir> [porta]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { onGitCommand, onGitProgress, setActiveAskpass, startAskpassBridge } from '@git-nexus/git-core';
import type { GitCommandEvent, GitProgressEvent } from '@git-nexus/git-core/pure';
import { validateCommitMessage } from '@git-nexus/governance-policy';
import { createHandlers } from '../../src/worker/handlers';
import { checkForUpdate } from '../../src/entrypoints/update';
import { isAllowedUpdateUrl } from '../../src/shared/update';
import { GIT_FREE_WORKER_METHODS } from '../../src/shared/git-install';
import { HostingService, type TokenStore } from '../../src/worker/hosting-service';

const [, , root = 'dist/renderer', dataDir = '.harness-data', portArg = '5199'] = process.argv;
// eventos da busca v2 (lotes e fim): a página pergunta por eles, como nos outros eventos do harness
const searchEvents: Array<{ event: string; data: unknown }> = [];
const handlers = createHandlers(dataDir, (e) => searchEvents.push(e), { indexRule: process.env.GN_INDEX_RULE ? JSON.parse(process.env.GN_INDEX_RULE) : {} });
let clipboard = '';

// Comandos git do harness: o navegador pergunta por eles (no app real o processo principal os envia).
const gitEvents: GitCommandEvent[] = [];
onGitCommand((e) => gitEvents.push(e));
const progressEvents: GitProgressEvent[] = [];
// credenciais: a mesma ponte do app, com os pedidos expostos por sondagem (a página mostra o diálogo)
const askpassEvents: unknown[] = [];
void startAskpassBridge({ dir: join(dataDir, 'askpass'), onRequest: (r) => askpassEvents.push(r) }).then(setActiveAskpass);
onGitProgress((e) => progressEvents.push(e));

// Armazenamento de tokens do harness: em memória (o app real usa safeStorage do Electron).
class PlainTokenStore implements TokenStore {
  private tokens = new Map<string, string>();
  private kinds = new Map<string, 'github' | 'gitlab'>();
  getToken = async (h: string) => this.tokens.get(h);
  setToken = async (h: string, t: string) => void this.tokens.set(h, t);
  removeToken = async (h: string) => void this.tokens.delete(h);
  getKind = async (h: string) => this.kinds.get(h);
  setKind = async (h: string, k: 'github' | 'gitlab') => void this.kinds.set(h, k);
  secure = () => true;
}
const hosting = new HostingService(new PlainTokenStore());

// Git simulado: o teste liga o estado pela página (`fetch('/fakegit?mode=missing')`). Sem isso o harness diz que o Git está ok (o git real da máquina é o dos handlers).
// Com `missing`, as chamadas que dependem do Git são recusadas como no app (GIT_UNAVAILABLE); `install` percorre as etapas e vira `ok`; `fail=1` faz a instalação falhar.
const fakeGit = { missing: false, fail: false, cancel: false, installs: 0, manual: 0, delay: 120 };
const gitInstallEvents: unknown[] = [];
const fakeAvail = () => ({ status: fakeGit.missing ? 'missing' : 'ok', ...(fakeGit.missing ? {} : { path: 'git', version: '2.56.1' }), method: 'windows-installer', canInstall: true });
// O atraso vem da URL do teste: só vale dentro de 0–5000 ms; fora disso, 0.
const wait = (ms: number) => {
  const safe = ms >= 0 && ms <= 5000 ? ms : 0;
  return new Promise((r) => setTimeout(r, safe));
};

const MAIN_STUBS: Record<string, (...a: any[]) => unknown> = {
  getGitAvailability: () => fakeAvail(),
  recheckGit: () => fakeAvail(),
  cancelGitInstall: () => void (fakeGit.cancel = true),
  openGitDownloadPage: () => void fakeGit.manual++,
  installGit: async () => {
    fakeGit.installs++;
    fakeGit.cancel = false;
    const push = (e: Record<string, unknown>) => gitInstallEvents.push({ method: 'windows-installer', ...e });
    push({ step: 'finding' });
    await wait(fakeGit.delay);
    for (let done = 0; done <= 70; done += 10) {
      if (fakeGit.cancel) throw new Error('Instalação cancelada.');
      push({ step: 'downloading', version: '2.56.1', done: done * 1048576, total: 70 * 1048576 });
      await wait(fakeGit.delay / 2);
    }
    push({ step: 'verifying', version: '2.56.1' });
    await wait(fakeGit.delay);
    push({ step: 'installing', version: '2.56.1' });
    await wait(fakeGit.delay * 2);
    if (fakeGit.fail) throw new Error('Falha simulada da instalação.');
    push({ step: 'validating' });
    await wait(fakeGit.delay);
    fakeGit.missing = false;
    push({ step: 'done', version: '2.56.1' });
    return fakeAvail();
  },

  hostingInfo: (p: string) => hosting.hostingInfo(p),
  hostingSaveToken: (p: string, t: string, k?: 'github' | 'gitlab') => hosting.saveToken(p, t, k),
  hostingRemoveToken: (p: string) => hosting.removeToken(p),
  listChangeRequests: (p: string, s: 'open' | 'merged' | 'closed') => hosting.listChangeRequests(p, s),
  getCiStatus: (p: string, sha: string) => hosting.getCiStatus(p, sha),
  suggestChangeRequest: (p: string, b: string) => hosting.suggestChangeRequest(p, b),
  createChangeRequest: (p: string, i: Parameters<HostingService['createChangeRequest']>[1]) => hosting.createChangeRequest(p, i),
  hostingOpen: async (p: string, url: string) => {
    if (!(await hosting.isAllowedUrl(p, url))) throw new Error('Endereço não permitido.');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'opened-url.txt'), url, 'utf8');
  },
  // "Novidades": lê o CHANGELOG.md real do repositório (a versão em uso é a mesma simulada para o aviso de atualização).
  getChangelog: async () => {
    // o harness roda a partir de apps/studio: o CHANGELOG.md fica na raiz do repositório
    const markdown = process.env.GN_FAKE_CHANGELOG ?? (await readFile(join(process.cwd(), '..', '..', 'CHANGELOG.md'), 'utf8').catch(() => ''));
    return { markdown, version: process.env.GN_CURRENT_VERSION ?? '1.2.0' };
  },
  pickDirectories: () => [],
  copyText: (t: string) => void (clipboard = t),
  showItemInFolder: () => undefined,
  openPath: () => '',
  openAppFolder: () => '',
  // Atualização: usa o código real de verificação com uma "release" simulada pela variável GN_FAKE_RELEASE (JSON).
  checkForUpdate: () =>
    checkForUpdate({
      current: process.env.GN_CURRENT_VERSION ?? '1.2.0',
      platform: 'win32',
      arch: 'x64',
      portable: false,
      fetchImpl: (async () => {
        const raw = process.env.GN_FAKE_RELEASE;
        return raw ? { ok: true, status: 200, json: async () => JSON.parse(raw) } : { ok: false, status: 404, json: async () => ({}) };
      }) as unknown as typeof fetch,
    }),
  // Instalação simulada: não baixa nada; só marca no disco o que o app faria (o teste lê installed.txt).
  downloadUpdate: async () => {
    if (process.env.GN_FAKE_DOWNLOAD_FAIL) throw new Error(process.env.GN_FAKE_DOWNLOAD_FAIL);
    await new Promise((r) => setTimeout(r, 400));
    return { version: '9.9.9', assetName: 'GitNexus-9.9.9-win-x64-setup.exe', sha256: 'f'.repeat(64) };
  },
  installUpdate: async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'installed.txt'), 'restart', 'utf8');
  },
  // Terminal e editor simulados: gravam o que abririam (o teste lê o arquivo).
  openInTerminal: async (repoPath: string) => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'opened-terminal.txt'), String(repoPath), 'utf8');
    return { app: 'Terminal (simulado)' };
  },
  openInEditor: async (repoPath: string) => {
    if (process.env.GN_FAKE_NO_EDITOR) throw new Error('Não encontrei o VS Code (ou o VSCodium) instalado.');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'opened-editor.txt'), String(repoPath), 'utf8');
    return { app: 'VS Code (simulado)' };
  },
  // Notificação simulada: só diz que mostrou (o teste observa a chamada na própria página).
  notify: async () => true,
  // Zoom simulado: guarda o fator em disco (o teste lê zoom.txt) e devolve o novo, com os mesmos degraus do app.
  // Barra de título: o harness não tem janela; só aceita (o teste lê as chamadas registradas pela página, veja api.setTitleBar abaixo).
  setTitleBar: async () => false,
  setZoom: async (action: string) => {
    const steps = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    const { mkdir, readFile, writeFile } = await import('node:fs/promises');
    await mkdir(dataDir, { recursive: true });
    const cur = Number(await readFile(join(dataDir, 'zoom.txt'), 'utf8').catch(() => '1')) || 1;
    const i = steps.reduce((b, s, k) => (Math.abs(s - cur) < Math.abs(steps[b]! - cur) ? k : b), 0);
    const next = action === 'reset' ? 1 : steps[Math.min(steps.length - 1, Math.max(0, i + (action === 'in' ? 1 : -1)))]!;
    await writeFile(join(dataDir, 'zoom.txt'), String(next), 'utf8');
    return next;
  },
  // Log de erros da interface: grava no mesmo formato do app e devolve o caminho (o teste lê o arquivo).
  logRendererError: async (message: string, stack?: string) => {
    const { mkdir, appendFile } = await import('node:fs/promises');
    const logFile = join(dataDir, 'logs', 'gitnexus-app.log');
    await mkdir(join(dataDir, 'logs'), { recursive: true });
    await appendFile(logFile, `${new Date().toISOString()} interface: ${String(message).slice(0, 2000)}${stack ? `\n${String(stack).slice(0, 4000)}` : ''}\n`, 'utf8');
    return { logFile };
  },
  // Registra o endereço que o app pediria para abrir no navegador (o teste lê este arquivo).
  openExternal: async (url: string) => {
    if (!isAllowedUpdateUrl(String(url))) throw new Error('Endereço não permitido.');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'opened-url.txt'), String(url), 'utf8');
  },
};

const METHODS = [...Object.keys(handlers), ...Object.keys(MAIN_STUBS)];
const STUB = `
const call = (m, args) => fetch('/rpc', { method: 'POST', body: JSON.stringify({ m, args }) }).then(r => r.json()).then(r => {
  if (!r.ok) throw new Error("Error invoking remote method 'gitnexus:" + m + "': Error: " + r.error);
  return r.result;
});
const api = {};
for (const m of ${JSON.stringify(METHODS)}) api[m] = (...args) => call(m, JSON.parse(JSON.stringify(args)));
api.onUpdateProgress = () => () => {};
// Moldura simulada pela URL (?titlebar=overlay|inset): sem janela de verdade, o teste confere margens, arrasto e as cores enviadas ao overlay.
const tb = new URLSearchParams(location.search).get('titlebar');
api.titleBar = tb === 'overlay' || tb === 'inset' ? tb : 'native';
window.__titleBarCalls = [];
api.setTitleBar = async (colors) => { window.__titleBarCalls.push(colors); return api.titleBar === 'overlay'; };
// -1: a primeira sondagem só marca o ponto de partida (uma página recarregada não repete etapas antigas)
let gitInstallSeen = -1;
api.onGitInstallProgress = (cb) => {
  const iv = setInterval(async () => {
    try {
      const r = await (await fetch('/gitinstall?since=' + gitInstallSeen)).json();
      gitInstallSeen = r.next;
      for (const e of r.events) cb(e);
    } catch {
      /* a página está recarregando */
    }
  }, 50);
  return () => clearInterval(iv);
};
let gitSeen = 0;
api.onGitCommand = (cb) => {
  // uma sondagem por vez: com o servidor ocupado a resposta demora mais que o intervalo, e duas sondagens com o mesmo "since" entregariam os mesmos comandos duas vezes
  let polling = false;
  const iv = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const r = await (await fetch('/gitlog?since=' + gitSeen)).json();
      gitSeen = r.next;
      if (r.events.length) cb(r.events);
    } finally {
      polling = false;
    }
  }, 150);
  return () => clearInterval(iv);
};
let progressSeen = 0;
api.onGitProgress = (cb) => {
  const iv = setInterval(async () => {
    const r = await (await fetch('/gitprogress?since=' + progressSeen)).json();
    progressSeen = r.next;
    for (const e of r.events) cb(e);
  }, 100);
  return () => clearInterval(iv);
};
// Lotes e fim da busca: UMA sondagem para todos os ouvintes, em ordem (como o IPC do Electron: nenhum lote chega duas vezes nem depois do fim).
// Sondagens separadas com um ponteiro compartilhado entregavam o mesmo lote em duplicidade quando a máquina estava carregada.
// O ponto de partida é marcado quando a página carrega (uma página recarregada não repete buscas antigas), e NÃO na primeira sondagem: uma busca que a janela
// dispara logo ao abrir (texto lembrado) podia começar antes dessa primeira sondagem, e os lotes dela eram descartados como "antigos".
const searchListeners = { searchBatch: new Set(), searchDone: new Set(), historyBatch: new Set(), historyDone: new Set(), searchIndex: new Set() };
let searchSeen = -1;
let searchBusy = false;
const searchStart = fetch('/searchevents?since=-1').then((r) => r.json()).then((r) => { searchSeen = r.next; }).catch(() => undefined);
let searchTimer = null;
const searchPoll = async () => {
  if (searchBusy) return;
  searchBusy = true;
  try {
    await searchStart;
    const r = await (await fetch('/searchevents?since=' + searchSeen)).json();
    searchSeen = r.next;
    for (const e of r.events) for (const cb of searchListeners[e.event] ?? []) cb(e.data);
  } catch {
    /* a página está recarregando */
  } finally {
    searchBusy = false;
  }
};
const onSearchEvent = (name, cb) => {
  searchListeners[name].add(cb);
  if (!searchTimer) searchTimer = setInterval(searchPoll, 40);
  return () => {
    searchListeners[name].delete(cb);
    if (!Object.values(searchListeners).some((s) => s.size)) {
      clearInterval(searchTimer);
      searchTimer = null;
    }
  };
};
api.onSearchBatch = (cb) => onSearchEvent('searchBatch', cb);
api.onSearchDone = (cb) => onSearchEvent('searchDone', cb);
api.onHistoryBatch = (cb) => onSearchEvent('historyBatch', cb);
api.onHistoryDone = (cb) => onSearchEvent('historyDone', cb);
api.onSearchIndex = (cb) => onSearchEvent('searchIndex', cb);
// -1: a primeira sondagem só marca o ponto de partida (uma página recarregada não repete pedidos antigos, como no Electron)
let askSeen = -1;
api.onAskpassRequest = (cb) => {
  const iv = setInterval(async () => {
    try {
      const r = await (await fetch('/askpass?since=' + askSeen)).json();
      askSeen = r.next;
      for (const e of r.events) cb(e);
    } catch {
      /* a página está recarregando: a sondagem falha e recomeça na próxima */
    }
  }, 100);
  return () => clearInterval(iv);
};
api.validateCommitMessage = (input, policy, locale) => {
  const x = new XMLHttpRequest();
  x.open('POST', '/validate', false);
  x.send(JSON.stringify({ input, policy, locale }));
  return JSON.parse(x.responseText);
};
window.gitNexus = api;
`;

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const body = async () => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  };
  try {
    if (url.pathname === '/rpc') {
      const { m, args } = JSON.parse(await body());
      try {
        if (fakeGit.missing && m in handlers && !GIT_FREE_WORKER_METHODS.has(m)) throw new Error('GIT_UNAVAILABLE: O Git não está instalado neste computador.');
        const fn = handlers[m as keyof typeof handlers] ?? MAIN_STUBS[m];
        res.end(JSON.stringify({ ok: true, result: (await fn!(...args)) ?? null }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    if (url.pathname === '/validate') {
      const { input, policy, locale } = JSON.parse(await body());
      res.end(JSON.stringify(validateCommitMessage(input, policy, locale)));
      return;
    }
    if (url.pathname === '/gitlog') {
      const since = Number(url.searchParams.get('since') ?? 0);
      return void res.end(JSON.stringify({ next: gitEvents.length, events: gitEvents.slice(since) }));
    }
    if (url.pathname === '/gitprogress') {
      const since = Number(url.searchParams.get('since') ?? 0);
      return void res.end(JSON.stringify({ next: progressEvents.length, events: progressEvents.slice(since) }));
    }
    if (url.pathname === '/searchevents') {
      const since = Number(url.searchParams.get('since') ?? 0);
      return void res.end(JSON.stringify({ next: searchEvents.length, events: since < 0 ? [] : searchEvents.slice(since) }));
    }
    if (url.pathname === '/askpass') {
      const since = Number(url.searchParams.get('since') ?? 0);
      return void res.end(JSON.stringify({ next: askpassEvents.length, events: since < 0 ? [] : askpassEvents.slice(since) }));
    }
    if (url.pathname === '/fakegit') {
      const q = url.searchParams;
      if (q.has('mode')) fakeGit.missing = q.get('mode') === 'missing';
      if (q.has('fail')) fakeGit.fail = q.get('fail') === '1';
      if (q.has('delay')) fakeGit.delay = Math.min(Math.max(Number(q.get('delay')) || 0, 0), 2000);
      return void res.end(JSON.stringify({ ...fakeGit, events: gitInstallEvents.length }));
    }
    if (url.pathname === '/gitinstall') {
      const since = Number(url.searchParams.get('since') ?? 0);
      return void res.end(JSON.stringify({ next: gitInstallEvents.length, events: since < 0 ? [] : gitInstallEvents.slice(since) }));
    }
    if (url.pathname === '/clipboard') return void res.end(clipboard);
    if (url.pathname === '/stub.js') {
      res.setHeader('content-type', 'text/javascript');
      return void res.end(STUB);
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.split('/').filter((p) => p && p !== '..').join('/');
    let data = await readFile(join(root, rel));
    if (rel === 'index.html') data = Buffer.from(data.toString('utf8').replace('<script type="module"', '<script src="/stub.js"></script><script type="module"'));
    res.setHeader('content-type', MIME[extname(rel)] ?? 'application/octet-stream');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(Number(portArg), '127.0.0.1', () => console.log(`harness em http://127.0.0.1:${portArg}`));
