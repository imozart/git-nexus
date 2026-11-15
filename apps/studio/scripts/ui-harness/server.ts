// Harness de UI: serve o renderer compilado num navegador comum e liga `window.gitNexus` aos MESMOS
// handlers do processo utilitário (git real). Serve para testar a interface com CDP/Playwright
// sem precisar do Electron. Uso: node harness.mjs <dist/renderer> <dataDir> [porta]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { validateCommitMessage } from '@git-nexus/governance-policy';
import { createHandlers } from '../../src/worker/handlers';
import { checkForUpdate } from '../../src/entrypoints/update';
import { isAllowedUpdateUrl } from '../../src/shared/update';

const [, , root = 'dist/renderer', dataDir = '.harness-data', portArg = '5199'] = process.argv;
const handlers = createHandlers(dataDir);
let clipboard = '';

const MAIN_STUBS: Record<string, (...a: any[]) => unknown> = {
  pickDirectories: () => [],
  copyText: (t: string) => void (clipboard = t),
  showItemInFolder: () => undefined,
  openPath: () => '',
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
api.validateCommitMessage = (input, policy) => {
  const x = new XMLHttpRequest();
  x.open('POST', '/validate', false);
  x.send(JSON.stringify({ input, policy }));
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
        const fn = handlers[m as keyof typeof handlers] ?? MAIN_STUBS[m];
        res.end(JSON.stringify({ ok: true, result: (await fn!(...args)) ?? null }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    if (url.pathname === '/validate') {
      const { input, policy } = JSON.parse(await body());
      res.end(JSON.stringify(validateCommitMessage(input, policy)));
      return;
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
