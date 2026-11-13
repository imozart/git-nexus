// Executa em Electron UtilityProcess: nenhuma chamada Git bloqueia a UI.
import { join } from 'node:path';
import type { UtilityRequest, UtilityResponse } from '../shared/channels';
import { createHandlers } from '../worker/handlers';

const handlers = createHandlers(process.env.GITNEXUS_DATA_DIR ?? join(process.cwd(), '.dev-data'));

process.parentPort.on('message', async ({ data }: { data: UtilityRequest }) => {
  const reply = (r: UtilityResponse) => process.parentPort.postMessage(r);
  try {
    reply({ id: data.id, ok: true, result: await handlers[data.method](...data.args) });
  } catch (e) {
    reply({ id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
