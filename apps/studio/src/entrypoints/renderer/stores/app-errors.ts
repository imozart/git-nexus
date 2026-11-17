import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../api';
import { ErrorThrottle, describeThrown, isBenignError } from '../error-report';

/**
 * Erros inesperados da interface. Cada um vai para o log do app (`gitnexus-app.log`, pelo processo principal) e, uma vez, vira um aviso discreto
 * com o caminho do arquivo. O aviso só diz que algo foi registrado: o app continua aberto.
 */
export const useAppErrorsStore = defineStore('appErrors', () => {
  const logFile = ref<string | null>(null);
  const shown = ref(false);
  const throttle = new ErrorThrottle();

  async function report(source: string, e: unknown): Promise<void> {
    const { message, stack } = describeThrown(e);
    if (isBenignError(message) || !throttle.allow(message, Date.now())) return;
    console.error(`[${source}]`, e);
    try {
      const r = await api.logRendererError(`${source}: ${message}`, stack);
      logFile.value = r.logFile;
      shown.value = true;
    } catch {
      /* sem o processo principal não há onde registrar; o console já tem o erro */
    }
  }

  const dismiss = () => (shown.value = false);

  return { logFile, shown, report, dismiss };
});
