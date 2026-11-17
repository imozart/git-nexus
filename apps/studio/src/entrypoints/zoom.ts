// Zoom da interface (Ctrl+= / Ctrl+- / Ctrl+0, e comandos na paleta). Parte pura, sem Electron: quais teclas valem e qual é o próximo passo.

/** Os mesmos passos do Chrome/Edge: o zoom anda de degrau em degrau (100 % é o do meio). */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

export type ZoomAction = 'in' | 'out' | 'reset';

export const isZoomAction = (v: unknown): v is ZoomAction => v === 'in' || v === 'out' || v === 'reset';

/** Qualquer valor (inclusive lixo de arquivo) vira um fator válido; fora de 50 %–300 % ou não numérico = 100 %. */
export function clampZoom(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));
}

/** O degrau mais próximo do fator atual (o fator pode não ser exato: vem de arquivo ou de outra origem). */
function nearestIndex(current: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_STEPS.length; i++) if (Math.abs(ZOOM_STEPS[i]! - current) < Math.abs(ZOOM_STEPS[best]! - current)) best = i;
  return best;
}

/** Próximo fator para a ação. `reset` volta a 100 %; `in`/`out` andam um degrau e param nos limites. */
export function stepZoom(current: number, action: ZoomAction): number {
  if (action === 'reset') return 1;
  const i = nearestIndex(clampZoom(current));
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + (action === 'in' ? 1 : -1)))]!;
}

/**
 * A tecla (de `before-input-event`) é um atalho de zoom? Exige Ctrl (Windows/Linux) ou ⌘ (macOS) sem Alt. Aceita `=` e `+` (o `+` costuma
 * exigir Shift), `-`/`_`, `0`, e as teclas do teclado numérico (`Add`, `Subtract`).
 */
export function zoomActionForKey(key: string, mod: { control: boolean; meta: boolean; alt: boolean }): ZoomAction | null {
  if (!(mod.control || mod.meta) || mod.alt) return null;
  if (key === '=' || key === '+' || key === 'Add') return 'in';
  if (key === '-' || key === '_' || key === 'Subtract') return 'out';
  if (key === '0') return 'reset';
  return null;
}
