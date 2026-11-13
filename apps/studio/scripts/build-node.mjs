// ESBuild: processos Node (main, preload, utility). O renderer é compilado pelo Vite.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    main: 'src/entrypoints/main.ts',
    preload: 'src/entrypoints/preload.ts',
    utility: 'src/entrypoints/utility.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24', // Node embutido no Electron 45
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
