import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'scripts/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      // Só roda com `pnpm test:coverage` (ou `vitest run --coverage`); `pnpm test` continua sem cobertura.
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      // Código com lógica testável sem Electron nem navegador. Telas (.vue), preload e a janela principal ficam de fora:
      // são cobertas pelos testes de interface (harness), que não entram nesta conta.
      include: ['packages/*/src/**/*.ts', 'apps/studio/src/shared/**/*.ts', 'apps/studio/src/worker/**/*.ts', 'scripts/lib/**/*.mjs'],
      exclude: ['**/*.d.ts', '**/*.d.mts', '**/types/**'],
      // Piso: o que existe hoje (nov/2026 era 90,7% linhas, 88,8% instruções, 82,6% ramos, 80,3% funções) menos uma folga.
      // Impede a cobertura de cair sem ninguém perceber; suba os números aos poucos, nunca os baixe para passar.
      thresholds: { lines: 88, statements: 86, branches: 80, functions: 78 },
    },
  },
});
