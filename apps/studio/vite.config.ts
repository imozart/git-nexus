import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: `${here}src/entrypoints/renderer`,
  base: './',
  plugins: [vue()],
  build: {
    outDir: `${here}dist/renderer`,
    emptyOutDir: true,
    target: 'chrome140', // Chromium embutido no Electron 45
    chunkSizeWarningLimit: 1500, // app desktop: bundle é local, não trafega pela rede
  },
  server: { port: 5173, strictPort: true },
});
