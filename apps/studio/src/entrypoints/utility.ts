// Executa em Electron UtilityProcess: nenhuma chamada Git bloqueia a UI.
import { join } from 'node:path';
import { onGitCommand } from '@git-nexus/git-core';
import type { GitCommandEvent } from '@git-nexus/git-core/pure';
import type { UtilityEvent, UtilityRequest, UtilityResponse } from '../shared/channels';
import { createHandlers } from '../worker/handlers';

const handlers = createHandlers(process.env.GITNEXUS_DATA_DIR ?? join(process.cwd(), '.dev-data'));

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

process.parentPort.on('message', async ({ data }: { data: UtilityRequest }) => {
  const reply = (r: UtilityResponse) => process.parentPort.postMessage(r);
  try {
    reply({ id: data.id, ok: true, result: await handlers[data.method](...data.args) });
  } catch (e) {
    reply({ id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
