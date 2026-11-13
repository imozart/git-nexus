// Dev: Vite (HMR) + ESBuild --watch + Electron apontando para o dev server.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // caminho do binário

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite dev server sem URL local');

await import('./build-node.mjs'); // build inicial dos processos Node (sem watch por enquanto)

const electron = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
electron.on('close', async () => {
  await server.close();
  process.exit(0);
});
