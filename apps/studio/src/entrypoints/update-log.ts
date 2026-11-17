// Log da atualização do app (processo principal). Um arquivo de texto com TODO o progresso: consulta à release, download,
// conferência do SHA-256, extração, preparo, início do atualizador e a troca dos arquivos (o script de troca, que roda
// depois que o app fecha, escreve no MESMO arquivo). Serve para diagnosticar atualizações que falham em campo.
// Sem Electron aqui dentro, para poder ser testado com uma pasta temporária.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/** Nome do arquivo: fica em `<pasta de dados>/logs/` (no modo portátil, `GitNexusData/logs/`). */
export const UPDATE_LOG_NAME = 'gitnexus-update.log';

/** Passou disto, o log atual vira `<arquivo>.old` (só se guarda a atualização anterior); evita crescer sem limite. */
export const MAX_LOG_BYTES = 512 * 1024;

export interface UpdateLog {
  /** Caminho do arquivo (para mostrar à pessoa onde olhar). */
  readonly file: string;
  /** Acrescenta uma linha `2026-11-16T22:50:00.000Z mensagem`. NUNCA lança: log que falha não pode derrubar a atualização. */
  (message: string): void;
}

/** Mensagem de um erro com o código do sistema (EBUSY, EPERM…) quando existe: é o que mais ajuda a achar a causa. */
export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const code = (e as NodeJS.ErrnoException).code;
  return `${code ? `[${code}] ` : ''}${e.message}`;
}

export function createUpdateLog(file: string): UpdateLog {
  let ready = false;
  const write = (message: string): void => {
    try {
      if (!ready) {
        mkdirSync(dirname(file), { recursive: true });
        try {
          if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.old`);
        } catch {
          /* ainda não existe */
        }
        ready = true;
      }
      appendFileSync(file, `${new Date().toISOString()} ${message}\n`, 'utf8');
    } catch {
      /* sem permissão, disco cheio… a atualização segue sem log */
    }
  };
  return Object.assign(write, { file });
}

/** Um log que não grava nada (quando quem chama não passou um). */
export const noLog: UpdateLog = Object.assign((): void => undefined, { file: '' });
