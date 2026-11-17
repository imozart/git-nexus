// Erros inesperados da interface (exceção no Vue, `error` e `unhandledrejection` da janela): vão para o log do app e viram um aviso discreto.
// Este arquivo é a parte PURA (sem Vue nem janela), para ser testada: quando vale registrar um erro, e como descrevê-lo.

/** O mesmo erro em sequência (um laço que lança a cada quadro) não pode inundar o log nem a tela. */
export const REPEAT_WINDOW_MS = 5000;
/** Teto de registros por sessão. */
export const MAX_REPORTS = 25;

export class ErrorThrottle {
  private last = new Map<string, number>();
  private count = 0;

  /** `true` se este erro deve ser registrado agora. */
  allow(message: string, now: number): boolean {
    if (this.count >= MAX_REPORTS) return false;
    const before = this.last.get(message);
    if (before !== undefined && now - before < REPEAT_WINDOW_MS) return false;
    this.last.set(message, now);
    this.count++;
    return true;
  }
}

/** Texto e pilha de qualquer coisa que tenha sido lançada. */
export function describeThrown(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error) return { message: e.message || e.name, ...(e.stack ? { stack: e.stack } : {}) };
  if (typeof e === 'string') return { message: e };
  try {
    return { message: JSON.stringify(e) ?? String(e) };
  } catch {
    return { message: String(e) };
  }
}

/** Erros que não são do app e não valem aviso: o navegador reclama disso sem que nada tenha quebrado. */
export function isBenignError(message: string): boolean {
  return /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i.test(message);
}
