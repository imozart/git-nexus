// Busca automática (fetch em segundo plano): mantém o adiante/atrás do indicador fiel ao remoto. Silenciosa: falha de rede ou de credencial
// só deixa de atualizar (o git nunca pergunta senha aqui; veja NO_PROMPT no núcleo) e nunca mostra erro. Uma busca por vez por repositório.
import { ref, watch } from 'vue';
import { api } from './api';
import { AUTO_FETCH_MIN_MS, dueForFetch } from './auto-fetch-core';

const KEY = 'gitnexus.autoFetch';

/** Preferência "Buscar automaticamente" (ligada por padrão; fica no localStorage, ou seja, no diretório portátil). */
export const autoFetchEnabled = ref(localStorage.getItem(KEY) !== '0');
watch(autoFetchEnabled, (v) => localStorage.setItem(KEY, v ? '1' : '0'));

/** Última tentativa de cada repositório (vale entre telas: reabrir o repositório não busca de novo antes de passar o intervalo). */
const attempts = new Map<string, number>();
const inflight = new Set<string>();

/** Período da verificação em segundo plano (a busca em si só roda se `dueForFetch`). */
export const AUTO_FETCH_TICK_MS = Math.min(60_000, AUTO_FETCH_MIN_MS);

/**
 * Busca no remoto se a preferência estiver ligada, se já passou o intervalo e se não há outra busca em andamento neste repositório.
 * Devolve `true` só quando a busca terminou com sucesso (aí vale reler o resumo); em qualquer outro caso, `false` e sem erro.
 */
export async function autoFetch(repoPath: string, lastFetch: number | null | undefined, now = Date.now()): Promise<boolean> {
  if (!autoFetchEnabled.value || inflight.has(repoPath)) return false;
  if (!dueForFetch(now, attempts.get(repoPath), lastFetch)) return false;
  inflight.add(repoPath);
  attempts.set(repoPath, now);
  try {
    return (await api.fetchRepo(repoPath)).ok;
  } catch {
    return false;
  } finally {
    inflight.delete(repoPath);
  }
}
