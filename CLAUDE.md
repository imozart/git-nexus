# GitNexus

Gerenciador Git desktop portátil (Electron + Vue 3 + TypeScript), monorepo PNPM.

**Instruções completas do projeto (escopo, arquitetura, contratos IPC, ordem de execução): [INSTRUCOES.md](INSTRUCOES.md).** Leia antes de qualquer implementação.

## Resumo operacional
- Monorepo: `apps/studio` (Electron), `apps/ui-kit` (Vue 3 + SCSS), `packages/git-core`, `packages/governance-policy`.
- Padrão de processos do Beekeeper Studio: `main.ts`, `preload.ts`, `renderer.ts`, `utility.ts` em `apps/studio/src/entrypoints/`.
- Build: ESBuild (main/utility/preload), Vite (renderer).
- Electron com `contextIsolation: true` e `nodeIntegration: false`. Nunca expor `ipcRenderer` cru ao renderer.
- Git pesado roda só no `utility.ts` (UtilityProcess), nunca no main nem no renderer.
- Nunca usar `--no-verify` nos commits; hooks rodam e sua saída vai para a UI.
- Contratos IPC em `packages/git-core/src/types/ipc.ts`.
- Dependências: `governance-policy` depende de `git-core` (tipos); `git-core` NÃO depende de `governance-policy`.
- Pacotes internos são consumidos como TypeScript fonte (`main: src/index.ts`) e empacotados pelo ESBuild/Vite.
- Estado de execução: ver "Status" em [README.md](README.md).
