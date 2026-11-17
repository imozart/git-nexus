// Notificações do sistema: as regras (puras, sem Vue nem Electron) de QUANDO avisar e O QUE dizer. Quem mostra é o processo principal.

/** Textos de uma notificação. */
export interface Notice {
  title: string;
  body: string;
}

/**
 * Avisar só faz sentido com a opção ligada e com a janela do app em segundo plano: com ela à frente, a própria tela já mostra a novidade
 * e uma notificação em cima seria só barulho.
 */
export function shouldNotify(o: { enabled: boolean; windowFocused: boolean }): boolean {
  return o.enabled && !o.windowFocused;
}

/** O que importa da situação de uma branch para decidir se a busca trouxe algo. */
export interface BehindState {
  /** Commits do remoto que a branch ainda não tem. */
  behind: number;
  /** A branch tem upstream (sem ele não há "remoto" para comparar). */
  upstream: string | null;
  detached?: boolean;
}

/**
 * A busca automática trouxe commits novos para a branch atual? Compara o "atrás" de antes com o de depois: só conta o que CHEGOU agora
 * (uma branch que já estava atrás antes da busca não gera aviso a cada busca). Devolve quantos commits chegaram, ou 0.
 */
export function newCommitsFromFetch(before: BehindState | null | undefined, after: BehindState | null | undefined): number {
  if (!after || after.detached || !after.upstream) return 0;
  const was = before && before.upstream === after.upstream ? before.behind : 0;
  return Math.max(0, after.behind - was);
}
