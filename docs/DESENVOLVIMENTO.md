# Guia de desenvolvimento

Como o repositório é organizado e como rodar, testar e empacotar. As regras de contribuição estão no [CONTRIBUTING](../CONTRIBUTING.md); a especificação original e os contratos IPC, na [especificação](ESPECIFICACAO.md).

## Estrutura

```
apps/studio                 Electron (main / preload / renderer / utility)
apps/ui-kit                 @git-nexus/ui-kit (Vue 3 + SCSS)
packages/git-core           Driver Git, scanner, WSL2, grafo, marcadores de conflito, contratos IPC
packages/governance-policy  Validação/formatação de Conventional Commits
```

## Comandos

Pré-requisitos: Node >= 24 e pnpm 12 (`corepack enable` ou `npm i -g pnpm`).

```bash
pnpm install
pnpm typecheck      # tsc (pacotes) + vue-tsc (apps)
pnpm test           # vitest: política, grafo, marcadores, integração com repositório git real
pnpm build          # esbuild (main/preload/utility) + vite (renderer)
pnpm dev            # Vite HMR + Electron
pnpm dist           # gera os artefatos Windows em apps/studio/release/
pnpm --filter @git-nexus/studio pack:dir   # só a pasta descompactada (win-unpacked)
```

Saída de `pnpm dist` (Windows x64): `GitNexus-<versão>-win-x64.zip` (portátil: extrair e executar) e, quando o NSIS roda, `GitNexus-<versão>-win-x64-setup.exe`.
Os dados (lista de repositórios, preferências) ficam em `GitNexusData/` ao lado do executável; nada é gravado no registro.

## Testar a interface sem Electron

`apps/studio/scripts/ui-harness/server.ts` serve o renderer compilado num navegador comum, ligado ao mesmo código de Git do processo utilitário (útil para CDP/Playwright):
`esbuild scripts/ui-harness/server.ts --bundle --platform=node --format=esm --outfile=harness.mjs` e `node harness.mjs dist/renderer <pasta-de-dados> 5199`.

**Testes de interface automatizados** (`apps/studio/scripts/ui-tests`): `pnpm --filter @git-nexus/studio build` e depois `pnpm test:ui` (ou `pnpm test:ui git-log` para um só). O runner sobe o harness e um Chrome/Edge headless (`CHROME_PATH` aponta outro navegador), roda cada `tests/*.mjs` com estado limpo, dirige a tela por CDP e guarda capturas em `GN_UI_OUT`. No CI é o `ui-tests.yml`. Para escrever um teste, copie um de `tests/` (use `mkRepo`, `openRepo`, `t.until`, `t.check`).

## Notas sobre versões

Os números exatos estão no `package.json` de cada pacote e no `pnpm-lock.yaml` (esta página não repete o que muda a cada atualização). O que vale saber:

- **Electron:** traz o Chromium e o Node embutidos; `@types/node` fica na série **24.x** para casar com o Node do Electron.
- **TypeScript:** os pacotes (`tsc`) usam a série 7; os apps com `.vue` ficam na série 6 porque o `vue-tsc`/Volar ainda exigem TypeScript < 7. Migrar quando liberarem.
- **pnpm:** os scripts de build ficam bloqueados por padrão e só `esbuild` e `electron` estão liberados (`allowBuilds` no `pnpm-workspace.yaml`).
- **Node (desenvolvimento):** >= 24, em um arquivo só (`.node-version`), lido por todos os workflows.

## Estado e pendências

Monorepo, núcleo Git, build, gerenciador de repositórios, abas (Staging, Grafo, Conflitos), empacotamento 64 bits e **releases multiplataforma pelo GitHub Actions** estão feitos e em uso (a lista de versões está no [CHANGELOG](../CHANGELOG.md)).

Pendências conhecidas:

- **Assinatura de código** no Windows e no macOS (sem certificado; veja [CODE_SIGNING](CODE_SIGNING.md)).
- **WSL2** testado só por unidade (leitura de caminho), não em distribuição real.
- **Flatpak/Flathub** ainda é um rascunho a testar (veja [PACKAGING](PACKAGING.md)).
- O repositório é **privado**: parte da automação (revisão de dependências, proveniência assinada, ruleset) só vale depois que ele for público.
- **Ao tornar o repositório público:** ativar o *Private vulnerability reporting* (o [SECURITY](../SECURITY.md) manda reportar por ele) e acrescentar o atalho de segurança em `.github/ISSUE_TEMPLATE/config.yml`.

## Mais documentação

- [CI e pipeline de release](CI.md): o que cada workflow faz.
- [Automação](AUTOMATION.md): bots, merge automático, betas, versão e changelog.
- [Labels, issues e PRs](LABELS.md): rótulos automáticos, formulários de issue, ordem de merge.
- [Idiomas](I18N.md), [empacotamento](PACKAGING.md) e [assinatura de código](CODE_SIGNING.md).
