// Andamento das operações com o remoto: o git escreve "Receiving objects:  45% (9/20)" no stderr (com `--progress`, mesmo sem terminal), e
// cada linha vai terminando em "\r". Aqui só se lê e se repassa; quem mostra é a interface. Sem nenhuma API do Node (serve o renderer e os testes).
import type { GitProgressEvent } from './types/ipc.js';

const listeners = new Set<(e: GitProgressEvent) => void>();

/** Observa o andamento de toda operação com o remoto (fetch, pull, push). Devolve a função que cancela. */
export function onGitProgress(cb: (e: GitProgressEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitGitProgress(e: GitProgressEvent): void {
  for (const l of listeners) {
    try {
      l(e);
    } catch {
      /* um observador com defeito não pode quebrar o git */
    }
  }
}

/** `{ phase, percent }` de uma linha de progresso do git, ou null se a linha não é de progresso. Aceita o prefixo "remote: ". */
export function parseProgressLine(line: string): { phase: string; percent: number } | null {
  const m = /^(?:remote:\s*)?([A-Za-z][A-Za-z ]*?):\s+(\d{1,3})%/.exec(line.trim());
  if (!m) return null;
  const percent = Number(m[2]);
  return percent <= 100 ? { phase: m[1]!, percent } : null;
}

/**
 * Lê o stderr aos pedaços (um pedaço pode terminar no meio de uma linha) e chama `onProgress` para cada linha de progresso completa.
 * Devolve a função a chamar com cada pedaço novo.
 */
export function progressReader(onProgress: (p: { phase: string; percent: number }) => void): (chunk: string) => void {
  let rest = '';
  return (chunk) => {
    const parts = (rest + chunk).split(/[\r\n]+/);
    rest = parts.pop() ?? '';
    for (const line of parts) {
      const p = parseProgressLine(line);
      if (p) onProgress(p);
    }
  };
}
