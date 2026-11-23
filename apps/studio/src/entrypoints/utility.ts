// Executa em Electron UtilityProcess: nenhuma chamada Git bloqueia a UI.
import { join } from 'node:path';
import { onGitCommand, onGitProgress, setActiveAskpass, startAskpassBridge } from '@git-nexus/git-core';
import type { GitCommandEvent } from '@git-nexus/git-core/pure';
import type { UtilityEvent, UtilityRequest, UtilityResponse } from '../shared/channels';
import { createHandlers } from '../worker/handlers';

const dataDir = process.env.GITNEXUS_DATA_DIR ?? join(process.cwd(), '.dev-data');
// lotes e fim das buscas (`startSearch`) sobem como eventos: a interface os filtra pelo id que ela mesma escolheu
const handlers = createHandlers(dataDir, (e) => process.parentPort.postMessage(e satisfies UtilityEvent));

// Exceções não tratadas do worker: avisa o processo principal, que registra no log do app (o worker não tem janela nem onde mostrar).
function reportCrash(source: string, e: unknown): void {
  const err = e instanceof Error ? e : new Error(String(e));
  process.parentPort.postMessage({ event: 'appError', data: { source, message: err.message, stack: err.stack } } satisfies UtilityEvent);
}
process.on('uncaughtException', (e) => reportCrash('worker: exceção não tratada', e));
process.on('unhandledRejection', (e) => reportCrash('worker: promessa rejeitada sem tratamento', e));

// Comandos git em lotes (a cada 120 ms): varreduras grandes executam centenas de comandos e não podem inundar a interface.
let batch: GitCommandEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
onGitCommand((e) => {
  batch.push(e);
  flushTimer ??= setTimeout(() => {
    flushTimer = undefined;
    const data = batch;
    batch = [];
    process.parentPort.postMessage({ event: 'gitCommands', data } satisfies UtilityEvent);
  }, 120);
});

// Progresso do git (porcentagem do fetch/pull/push): no máximo um evento a cada 80 ms por operação, para não inundar a interface.
const lastProgress = new Map<string, number>();
onGitProgress((e) => {
  const key = `${e.repoPath}|${e.op}`;
  const now = Date.now();
  if (e.percent !== 100 && now - (lastProgress.get(key) ?? 0) < 80) return;
  lastProgress.set(key, now);
  process.parentPort.postMessage({ event: 'gitProgress', data: e } satisfies UtilityEvent);
});

// Credenciais: o git/ssh pergunta por um canal local, o pedido sobe até a interface (diálogo) e a resposta volta por `askpassAnswer`.
// Se a ponte não sobe (pasta sem permissão, por exemplo), o app segue como antes: o git falha na hora, sem perguntar.
startAskpassBridge({
  dir: join(dataDir, 'askpass'),
  onRequest: (req) => process.parentPort.postMessage({ event: 'askpass', data: req } satisfies UtilityEvent),
})
  .then(setActiveAskpass)
  .catch((e) => reportCrash('worker: ponte de credenciais não iniciou', e));

process.parentPort.on('message', async ({ data }: { data: UtilityRequest }) => {
  const reply = (r: UtilityResponse) => process.parentPort.postMessage(r);
  try {
    reply({ id: data.id, ok: true, result: await handlers[data.method](...data.args) });
  } catch (e) {
    reply({ id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
