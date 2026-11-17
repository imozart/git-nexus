// Operações com o remoto em andamento (buscar, atualizar, enviar): uma por repositório, com a porcentagem que o git informa (`--progress`).
// A interface lê `opOf(caminho)` para desabilitar o botão, mostrar "Atualizando… 45%" e desenhar a barra. A busca automática também passa por aqui
// (`silent`): mostra só a barra discreta e não bloqueia nada.
import { reactive } from 'vue';
import type { GitProgressEvent } from '@git-nexus/git-core/pure';
import { api } from './api';

export type SyncKind = 'fetch' | 'update' | 'push';
export interface SyncOp {
  kind: SyncKind;
  /** Em segundo plano (busca automática): sem botão ocupado nem rótulo de andamento. */
  silent: boolean;
  /** 0 a 100; null enquanto o git não informou número (barra indeterminada). */
  percent: number | null;
  /** Etapa do git em inglês ("Receiving objects"), ou ''. */
  phase: string;
}

const ops = reactive<Record<string, SyncOp>>({});
let off: (() => void) | undefined;

/** Passa a ouvir o andamento que o processo do git publica (uma vez só; sem ponte, por exemplo nos testes de unidade, não faz nada). */
function listen(): void {
  if (off || typeof api?.onGitProgress !== 'function') return;
  off = api.onGitProgress((e: GitProgressEvent) => {
    const op = ops[e.repoPath];
    if (op && e.percent !== null) {
      op.percent = e.percent;
      op.phase = e.phase;
    }
  });
}

/** A operação em andamento neste repositório, ou undefined. Reativa: serve em `computed` e em templates. */
export const opOf = (repoPath: string): SyncOp | undefined => ops[repoPath];

/**
 * Roda `fn` marcando o repositório como ocupado até terminar (mesmo se falhar). Uma operação por vez por repositório: se já há uma,
 * devolve `undefined` sem rodar nada (o chamador trata como "ignorado").
 */
export async function runSyncOp<T>(repoPath: string, kind: SyncKind, fn: () => Promise<T>, silent = false): Promise<T | undefined> {
  if (repoPath in ops) return undefined;
  listen();
  ops[repoPath] = { kind, silent, percent: null, phase: '' };
  try {
    return await fn();
  } finally {
    delete ops[repoPath];
  }
}
