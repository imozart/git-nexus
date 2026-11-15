// Teste de fumaça do app empacotado (usado só pelo CI, com GITNEXUS_SMOKE=1): abre a janela de verdade, espera a interface montar,
// faz uma chamada que atravessa preload -> processo principal -> processo utilitário (worker) e sai com 0 se tudo respondeu.
// Sem a variável de ambiente, não faz nada: o usuário final nunca passa por aqui.
import type { BrowserWindow } from 'electron';

export const SMOKE_OK = 'GITNEXUS_SMOKE_OK';
export const SMOKE_FAIL = 'GITNEXUS_SMOKE_FAIL';

export const smokeEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => env.GITNEXUS_SMOKE === '1';

/** Expressão executada na página: a interface montou (`.core`) e a ponte com o worker responde (devolve a lista de repositórios). */
export const PROBE = `(async () => {
  if (!document.querySelector('.core')) return 'interface ainda não montou';
  if (typeof window.gitNexus?.getKnownRepositories !== 'function') return 'window.gitNexus ausente (preload não carregou)';
  const repos = await window.gitNexus.getKnownRepositories();
  return Array.isArray(repos) ? 'ok' : 'getKnownRepositories não devolveu uma lista';
})()`;

export function attachSmoke(win: BrowserWindow, exit: (code: number) => void, timeoutMs = 45_000): void {
  let done = false;
  const finish = (code: number, msg: string): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    console.log(code === 0 ? SMOKE_OK : `${SMOKE_FAIL}: ${msg}`);
    exit(code);
  };
  const timer = setTimeout(() => finish(2, `tempo esgotado (${timeoutMs / 1000}s) sem a interface responder`), timeoutMs);

  win.webContents.on('render-process-gone', (_e, d) => finish(1, `o renderer caiu (${d.reason})`));
  win.webContents.on('did-fail-load', (_e, code, desc) => finish(1, `a página não carregou (${code} ${desc})`));
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.log(`[renderer] ${e.message}`);
  });
  win.webContents.on('did-finish-load', () => {
    // a interface (Vue) monta um instante depois do load: repete a sonda até responder ou o tempo acabar
    const poll = async (): Promise<void> => {
      if (done) return;
      try {
        const r = (await win.webContents.executeJavaScript(PROBE)) as string;
        if (r === 'ok') return finish(0, '');
        if (!r.startsWith('interface ainda')) return finish(1, r); // erro definitivo: não adianta esperar
        setTimeout(() => void poll(), 300);
      } catch (err) {
        finish(1, `erro ao consultar a interface: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    void poll();
  });
}
