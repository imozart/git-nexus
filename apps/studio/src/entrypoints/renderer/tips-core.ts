// Dicas contextuais (#288): poucas, discretas e dispensáveis. As regras que valem para todas (uma por sessão, nunca depois de dispensada) e a conta de cada
// situação ficam aqui, sem Vue nem `window`, para testar.

export const TIPS_DISMISSED_KEY = 'gitnexus.tipsDismissed';

/** Lê as dicas dispensadas para sempre (lista de ids em JSON): torto ou de outro tipo vira "nenhuma". */
export function parseDismissed(raw: string | null | undefined): string[] {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Pode aparecer: não foi dispensada para sempre e nenhuma outra apareceu nesta sessão (no máximo UMA dica por sessão, para não virar ruído). */
export const canShowTip = (id: string, dismissed: readonly string[], shownThisSession: boolean): boolean => !shownThisSession && !dismissed.includes(id);

/** Há quantos dias o stash mais antigo foi guardado (inteiro, para baixo); `null` sem stash. `date` em segundos, como no Git. */
export function oldestStashDays(stashes: readonly { date: number }[], nowMs: number): number | null {
  if (!stashes.length) return null;
  const oldest = Math.min(...stashes.map((s) => s.date));
  return Math.max(0, Math.floor((nowMs - oldest * 1000) / 86_400_000));
}

/** Um stash esquecido: de 30 dias para cima. */
export const STASH_FORGOTTEN_DAYS = 30;
export const isStashForgotten = (days: number | null): boolean => days !== null && days >= STASH_FORGOTTEN_DAYS;
