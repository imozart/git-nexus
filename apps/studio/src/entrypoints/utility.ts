// Executa em Electron UtilityProcess: nenhuma chamada Git bloqueia a UI.
import { join } from 'node:path';
import { onGitCommand, onGitProgress } from '@git-nexus/git-core';
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

// Progresso do git (porcentagem do fetch/pull/push): no máximo um evento a cada 80 ms por operação, para não inundar a interface.
const lastProgress = new Map<string, number>();
onGitProgress((e) => {
  const key = `${e.repoPath}|${e.op}`;
  const now = Date.now();
  if (e.percent !== 100 && now - (lastProgress.get(key) ?? 0) < 80) return;
  lastProgress.set(key, now);
  process.parentPort.postMessage({ event: 'gitProgress', data: e } satisfies UtilityEvent);
});

process.parentPort.on('message', async ({ data }: { data: UtilityRequest }) => {
  const reply = (r: UtilityResponse) => process.parentPort.postMessage(r);
  try {
    reply({ id: data.id, ok: true, result: await handlers[data.method](...data.args) });
  } catch (e) {
    reply({ id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
