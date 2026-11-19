// Núcleo puro do GnTooltip (sem Vue nem DOM, para testar): onde a dica fica e quanto esperar para mostrá-la.

/** Atraso com o mouse até a dica aparecer. No foco por teclado é sempre 0. */
export const TIP_DELAY_MS = 500;
/** Depois de fechar uma dica, a próxima abre sem atraso por este tempo (passar o mouse por uma fileira de botões). */
export const TIP_WARM_MS = 300;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type TipSide = 'top' | 'bottom';

/**
 * Posição da dica (coordenadas de janela, para `position: fixed`): centralizada na horizontal sobre o alvo, no lado preferido (acima por padrão).
 * Se faltar espaço nesse lado (`espaço < altura + gap + margem`), usa o outro; se nenhum lado couber, mantém o preferido. O `left` fica limitado
 * à janela (`margin` de cada lado); uma dica mais larga que a janela fica encostada à esquerda.
 */
export function placeTip(
  anchor: Rect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  prefer: TipSide = 'top',
  gap = 6,
  margin = 4,
): { left: number; top: number; side: TipSide } {
  const need = tip.height + gap + margin;
  const room = { top: anchor.top, bottom: viewport.height - (anchor.top + anchor.height) };
  const other: TipSide = prefer === 'top' ? 'bottom' : 'top';
  const side: TipSide = room[prefer] >= need ? prefer : room[other] >= need ? other : prefer;
  const top = side === 'top' ? anchor.top - gap - tip.height : anchor.top + anchor.height + gap;
  const centered = anchor.left + anchor.width / 2 - tip.width / 2;
  const max = viewport.width - tip.width - margin;
  const left = Math.max(margin, Math.min(centered, max));
  return { left, top, side };
}

/** Atraso para abrir agora: 0 se uma dica fechou há menos de `warm` ms; senão `delay` (também quando nunca fechou nenhuma: `null`). */
export function tipDelay(now: number, lastClosedAt: number | null, delay = TIP_DELAY_MS, warm = TIP_WARM_MS): number {
  return lastClosedAt !== null && now - lastClosedAt < warm ? 0 : delay;
}
