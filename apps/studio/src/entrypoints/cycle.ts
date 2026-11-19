// Ciclo de atualização do ZIP portátil no app empacotado (usado só pelo CI, com GITNEXUS_UPDATE_CYCLE=<json>; veja scripts/update-cycle/run.mjs).
// Roda no PROCESSO PRINCIPAL do Electron, onde o fs trata todo `app.asar` como pasta virtual: é lá que a atualização 1.12 → 1.13 quebrou (EBUSY ao apagar
// .gnupdate-stage\resources\app.asar), e os testes em Node puro não reproduzem isso. Faz o mesmo que o app ao instalar: prepara o pacote, dispara o
// script de troca e sai. Sem a variável de ambiente não faz nada: o usuário final nunca passa por aqui.
import { basename, dirname, join } from 'node:path';
import { cleanupUpdateFiles, prepareStage, startPortableSwap } from './installer';
import { createUpdateLog, describeError } from './update-log';

export interface CycleArgs {
  /** `swap` (padrão): extrai o pacote e dispara a troca. `cleanup`: só a limpeza de restos que a abertura do app faz. */
  mode: 'swap' | 'cleanup';
  /** ZIP da versão nova (na pasta do executável, como o app o baixa). */
  zip: string;
  /** Arquivo de log da atualização, onde o script de troca também escreve. */
  logFile: string;
}

/** Lê GITNEXUS_UPDATE_CYCLE; JSON inválido ou incompleto = não é um ciclo (o app abre normalmente). */
export function cycleArgs(env: NodeJS.ProcessEnv = process.env): CycleArgs | null {
  const raw = env.GITNEXUS_UPDATE_CYCLE;
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Partial<CycleArgs>;
    if (typeof a.zip !== 'string' || typeof a.logFile !== 'string') return null;
    return { mode: a.mode === 'cleanup' ? 'cleanup' : 'swap', zip: a.zip, logFile: a.logFile };
  } catch {
    return null;
  }
}

/** Executa o ciclo e sai com 0 (ok) ou 1 (falhou antes da troca). A troca em si termina depois, no processo do atualizador, e registra no mesmo log. */
export async function runUpdateCycle(a: CycleArgs, execPath: string, pid: number, exit: (code: number) => void): Promise<void> {
  const log = createUpdateLog(a.logFile);
  const appDir = dirname(execPath);
  try {
    log(`ciclo: PROCESSO PRINCIPAL do Electron (pid ${pid}), modo ${a.mode}, app em ${appDir}`);
    if (a.mode === 'cleanup') {
      const removed = await cleanupUpdateFiles(appDir, log);
      log(`ciclo: limpeza apagou: ${removed.join(', ') || '(nada)'}`);
      return exit(0);
    }
    const exe = basename(execPath);
    // O atualizador herda o ambiente e o app reaberto também: ele não pode repetir o ciclo, e, sendo o app TROCADO, abre só para a sonda de fumaça e sai sozinho.
    delete process.env.GITNEXUS_UPDATE_CYCLE;
    process.env.GITNEXUS_SMOKE = '1';
    const stage = await prepareStage(a.zip, appDir, exe, log);
    await startPortableSwap({
      pid,
      stageDir: stage,
      cleanup: [join(appDir, '.gnupdate-stage'), a.zip],
      appDir,
      exe,
      workDir: appDir,
      logFile: a.logFile,
      log,
      relaunchArgs: ['--disable-gpu'],
      retries: 20,
    });
    log('ciclo: o atualizador iniciou; este processo sai para a troca começar');
    exit(0);
  } catch (e) {
    log(`ciclo: FALHOU antes da troca: ${describeError(e)}`);
    exit(1);
  }
}
