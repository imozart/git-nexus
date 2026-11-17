// Regras (puras) da busca automática: quando buscar e como dizer "há quanto tempo". Sem Vue, sem API: dá para testar.

/** Intervalo mínimo entre duas buscas do mesmo repositório (e período da verificação em segundo plano). */
export const AUTO_FETCH_MIN_MS = 5 * 60_000;

/**
 * Já passou o intervalo mínimo desde a última vez que o repositório falou com o remoto?
 * `lastAttempt`: a última tentativa do app (conta mesmo se falhou, para não martelar um servidor fora do ar);
 * `lastFetch`: o `FETCH_HEAD` (conta buscas feitas fora do app).
 */
export function dueForFetch(now: number, lastAttempt: number | null | undefined, lastFetch: number | null | undefined, minMs = AUTO_FETCH_MIN_MS): boolean {
  const last = Math.max(lastAttempt ?? 0, lastFetch ?? 0);
  return now - last >= minMs;
}

export type Ago = { unit: 'now' } | { unit: 'min' | 'hour' | 'day'; n: number };

/** "Agora há pouco", N min, N h ou N dias (arredondando para baixo). Relógio adiantado (data no futuro) vale "agora". */
export function agoParts(now: number, then: number): Ago {
  const min = Math.floor((now - then) / 60_000);
  if (min < 1) return { unit: 'now' };
  if (min < 60) return { unit: 'min', n: min };
  const hour = Math.floor(min / 60);
  if (hour < 24) return { unit: 'hour', n: hour };
  return { unit: 'day', n: Math.floor(hour / 24) };
}
