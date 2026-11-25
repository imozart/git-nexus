// Índice de busca (fase 10 da #233): a regra que decide quando propor "Acelerar as buscas neste repositório". Pura, para a interface e os testes usarem a mesma conta.
import type { SearchIndexReason } from './types/ipc.js';

/** Os limites da regra: a issue pede mediana acima de 1,5 s, ou mais de ~50 mil arquivos / 2 GB de texto. */
export interface IndexRule {
  slowMs: number;
  minSamples: number;
  files: number;
  textBytes: number;
}
export const INDEX_RULE: IndexRule = { slowMs: 1500, minSamples: 3, files: 50_000, textBytes: 2 * 1024 ** 3 };

export interface IndexMeasure {
  files?: number;
  textBytes?: number;
  medianMs?: number;
  samples: number;
}

/** Por que o repositório merece um índice (ou `null`): muitos arquivos, muito texto ou buscas lentas (mediana das últimas, com pelo menos 3 medidas). */
export function suggestIndex(m: IndexMeasure, rule: IndexRule = INDEX_RULE): SearchIndexReason | null {
  if ((m.files ?? 0) > rule.files) return 'files';
  if ((m.textBytes ?? 0) > rule.textBytes) return 'size';
  if (m.samples >= rule.minSamples && (m.medianMs ?? 0) > rule.slowMs) return 'slow';
  return null;
}
