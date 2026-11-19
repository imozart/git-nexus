// Movimento da interface (sistema / reduzido / normal): a parte pura, sem DOM, para testar.
export type MotionPref = 'system' | 'reduced' | 'normal';

/** Ordem em que as opções aparecem. */
export const MOTION_PREFS: readonly MotionPref[] = ['system', 'reduced', 'normal'];

/** Escolha guardada → preferência válida. Sem valor (ou valor desconhecido) fica "Sistema": quem nunca mexeu continua como o sistema pedir. */
export function pickMotionPref(stored: string | null | undefined): MotionPref {
  return MOTION_PREFS.includes(stored as MotionPref) ? (stored as MotionPref) : 'system';
}

/** Valor do atributo `data-reduced-motion` do <html>: "true" (reduzido), "false" (normal, mesmo que o sistema peça menos) ou nenhum (segue o sistema). */
export function motionAttribute(pref: MotionPref): 'true' | 'false' | undefined {
  return pref === 'reduced' ? 'true' : pref === 'normal' ? 'false' : undefined;
}

/** O movimento está reduzido agora? (preferência do app + o que o sistema pede). Serve ao que não é CSS, como a chuva de confete. */
export function isReducedMotion(pref: MotionPref, systemReduces: boolean): boolean {
  return pref === 'reduced' || (pref === 'system' && systemReduces);
}
