// Utilitários dos testes de interface: conecta ao navegador (headless) ou à janela real do Electron por CDP e oferece ações/verificações simples.
// Quem sobe o harness e o navegador é o run.mjs; quem abre o app empacotado é o run-electron.mjs; cada teste só usa `connect`.
// Janela real (run-electron.mjs): GN_UI_REAL=1 não força o tamanho da janela e GN_UI_URL_MATCH escolhe a página (o app carrega file://).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' });
export const tmpRoot = (p) => mkdtempSync(join(tmpdir(), p));

/** Valor como expressão JS da página, em base64: entra no código sem nunca poder virar código (nada de JSON.stringify montando script). */
export const lit = (s) => `new TextDecoder().decode(Uint8Array.from(atob('${Buffer.from(String(s), 'utf8').toString('base64')}'), (c) => c.charCodeAt(0)))`;

/** Repositório de teste com um commit inicial (identidade e opções locais, sem depender da configuração do git da máquina). */
export function mkRepo(root, name, { branch = 'main', files = { 'a.txt': 'um\n' } } = {}) {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-b', 'main');
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(repo, 'config', k, v);
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, f)), { recursive: true });
    writeFileSync(join(repo, f), c);
  }
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'init');
  if (branch !== 'main') git(repo, 'checkout', '-qb', branch);
  return repo;
}

const CDP_PORT = Number(process.env.GN_UI_CDP_PORT ?? 9400);
const APP_PORT = Number(process.env.GN_UI_APP_PORT ?? 5199);
const REAL = process.env.GN_UI_REAL === '1';
const URL_MATCH = process.env.GN_UI_URL_MATCH ?? String(APP_PORT);

export async function connect(OUT, results) {
  mkdirSync(OUT, { recursive: true });
  const base = `http://127.0.0.1:${APP_PORT}`;
  const target = await (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const t = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json()).find((x) => x.type === 'page' && x.url.includes(URL_MATCH));
        if (t) return t;
      } catch {
        /* navegador ainda subindo */
      }
      await sleep(500);
    }
  })();
  if (!target) throw new Error('Não achei a página do app no navegador (CDP).');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res) => (ws.onopen = res));
  let id = 0;
  const waiters = new Map();
  /** Erros da página desde que a conexão abriu: exceção não tratada, console.error e entradas de log de nível error. */
  const pageErrors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiters.has(d.id)) {
      waiters.get(d.id)(d);
      waiters.delete(d.id);
    } else if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails?.exception?.description === 'Object' ? 'exceção: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 400) : (d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text ?? 'exceção'));
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') pageErrors.push(d.params.args?.map((a) => a.value ?? (a.preview?.properties ? '{' + a.preview.properties.map((p) => p.name + ': ' + p.value).join(', ') + '}' : a.description)).join(' '));
    else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') pageErrors.push(`${d.params.entry.text} ${d.params.entry.url ?? ''}`.trim());
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      const t = setTimeout(() => rej(new Error('TIMEOUT ' + method)), 40000);
      waiters.set(i, (d) => {
        clearTimeout(t);
        res(d);
      });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (expr) => {
    const x = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (x.result.exceptionDetails) throw new Error(JSON.stringify(x.result.exceptionDetails.exception?.description ?? x.result.exceptionDetails));
    return x.result.result.value;
  };
  const shot = async (n) => {
    await send('Page.bringToFront');
    writeFileSync(join(OUT, n + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  };
  const VK = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Tab: 9, PageDown: 34, PageUp: 33, F5: 116, F7: 118 };
  /** Tecla real via CDP. mods: 1=Alt 2=Ctrl 4=Meta 8=Shift. */
  const key = async (k, mods = 0) => {
    const vk = VK[k] ?? k.toUpperCase().charCodeAt(0);
    const b = { key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, modifiers: mods, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...b });
    if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...b });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...b });
  };
  const clickBtn = (text, scope = 'document') =>
    ev(`(() => { const b=[...${scope}.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith(${lit(text)}) && !x.disabled); b?.click(); return !!b; })()`);
  const text = (sel) => ev(`document.querySelector(${lit(sel)})?.innerText.replace(/\\s+/g,' ').trim() ?? null`);
  const count = (sel) => ev(`document.querySelectorAll(${lit(sel)}).length`);
  /** Espera (até `ms`) a expressão JS ficar verdadeira na página; devolve o último valor. */
  const until = async (expr, ms = 12000) => {
    const end = Date.now() + ms;
    let v;
    while (Date.now() < end) {
      try {
        v = await ev(expr);
      } catch {
        v = null;
      }
      if (v) return v;
      await sleep(250);
    }
    return v;
  };
  const check = (name, ok, extra) => {
    results[name] = ok ? 'OK' : 'FALHOU' + (extra !== undefined ? ' ' + JSON.stringify(extra) : '');
  };
  await send('Page.enable');
  // a escolha de idioma da primeira abertura cobriria a tela de todos os testes: marca como já mostrada, a menos que o teste dela peça o contrário (gitnexus.testNoSeed)
  const SEED = "try { if (localStorage.getItem('gitnexus.testNoSeed') === null) localStorage.setItem('gitnexus.localeAsked', '1'); } catch {}";
  await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED });
  await send('Runtime.evaluate', { expression: SEED + "; document.querySelector('[data-testid=\"locale-welcome-skip\"]')?.click()" });
  await send('Runtime.enable');
  await send('Log.enable');
  // no navegador headless a tela é fixa em 1500x900; na janela real do Electron vale o tamanho que o app abriu
  if (!REAL) await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  // partida a frio (navegador novo, máquina lenta): só segue quando a interface montou
  for (let i = 0; i < 80; i++) {
    try {
      if ((await ev("!!document.querySelector('.core') && typeof window.gitNexus?.getKnownRepositories === 'function'")) === true) break;
    } catch {
      /* página ainda carregando */
    }
    await sleep(250);
  }
  await sleep(300);

  /** Cataloga o repositório, recarrega e abre a tela de staging dele. */
  async function openRepo(repo, name) {
    await ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
    await ev('location.reload()');
    await sleep(1500);
    const ok = await ev(
      `(() => { const row=[...document.querySelectorAll('li.repo')].find(x=>x.querySelector('strong')?.textContent.trim()===${lit(name)}); const b=row && row.querySelector('.repo__btns button'); b?.click(); return !!b; })()`,
    );
    await sleep(2200);
    return ok;
  }
  return {
    base,
    send,
    ev,
    shot,
    key,
    clickBtn,
    text,
    count,
    until,
    check,
    openRepo,
    /** Erros da página até agora (vazio = nenhum). */
    // erro de script de extensão do navegador (bloqueador de anúncios etc., que o Edge instala em perfil novo) não é erro do app
    errors: () => pageErrors.filter((e) => !/chrome-extension:\/\/|Could not establish connection\. Receiving end does not exist/.test(String(e))),
    /** Encerra com código 1 se alguma verificação falhou. O resultado também sai em JSON no stdout para o run.mjs. */
    close: () => {
      ws.close();
      process.exit(Object.values(results).some((v) => v !== 'OK') ? 1 : 0);
    },
  };
}
