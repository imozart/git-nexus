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

Saída de `pnpm dist` (Windows x64): `GitNexus-<versão>-win-x64-portable.zip` (portátil: extrair e executar) e, quando o NSIS roda, `GitNexus-<versão>-win-x64-setup.exe`.
Os dados (lista de repositórios, preferências) ficam em `GitNexusData/` ao lado do executável; nada é gravado no registro.

## Testar a interface sem Electron

`apps/studio/scripts/ui-harness/server.ts` serve o renderer compilado num navegador comum, ligado ao mesmo código de Git do processo utilitário (útil para CDP/Playwright):
`esbuild scripts/ui-harness/server.ts --bundle --platform=node --format=esm --outfile=harness.mjs` e `node harness.mjs dist/renderer <pasta-de-dados> 5199`.

**Testes de interface automatizados** (`apps/studio/scripts/ui-tests`): `pnpm --filter @git-nexus/studio build` e depois `pnpm test:ui` (ou `pnpm test:ui git-log` para um só). O runner sobe o harness e um Chrome/Edge headless (`CHROME_PATH` aponta outro navegador), roda cada `tests/*.mjs` com estado limpo, dirige a tela por CDP e guarda capturas em `GN_UI_OUT`. No CI é o `ui-tests.yml`. Para escrever um teste, copie um de `tests/` (use `mkRepo`, `openRepo`, `t.until`, `t.check`). **Valores dentro do código da página entram por `lit(valor)`** (`lib.mjs`, base64), nunca por `${JSON.stringify(valor)}` em template string: o CodeQL reprova isso como `js/bad-code-sanitization`, e `test/test-scripts-code-injection.test.ts` falha antes, no `pnpm test`.

## Git ausente (aviso, bloqueio e instalação)

O harness de interface simula o Git pela própria página: `fetch('/fakegit?mode=missing')` faz o app agir como num computador sem Git (as chamadas que dependem dele recusam com `GIT_UNAVAILABLE`), `fail=1` faz a instalação falhar e `delay=<ms>` ajusta o ritmo das etapas; o teste é `scripts/ui-tests/tests/git-missing.mjs`. No app real, `GITNEXUS_FORCE_GIT_MISSING=1` força o estado "sem Git". A lógica (versões, escolha do arquivo e dos argumentos por sistema) é pura em `src/shared/git-install.ts`; detecção, instalação e estado ficam em `src/entrypoints/git-detect.ts`, `git-install.ts` e `git-manager.ts`, com testes em `test/git-install.test.ts`. A versão mínima é `MIN_GIT_VERSION` (um lugar só).

## Ciclo de atualização do ZIP portátil (Windows)

A atualização do portátil só se comporta como em produção com o **app empacotado**: no processo principal do Electron o `fs` trata `app.asar` como pasta, e o antivírus costuma segurar o executável recém-colocado (`spawn EPERM`). O teste `apps/studio/scripts/update-cycle/run.mjs` faz o ciclo inteiro com o pacote de verdade: monta um ZIP de uma "versão nova", deixa `.gnupdate-stage` e `.gnupdate-old` antigos (cada um com um `resourcesapp.asar`), roda o preparo e o script de troca e confere troca concluída, restos apagados na abertura seguinte, arquivos novos no lugar, dados do usuário intactos e, no fim, o app trocado abrindo (`GITNEXUS_SMOKE`).

```
pnpm --filter @git-nexus/studio build
pnpm --filter @git-nexus/studio exec electron-builder --win --x64 --dir --publish never
node apps/studio/scripts/update-cycle/run.mjs apps/studio/release/win-unpacked
```

O app tem um gancho só de teste, `src/entrypoints/cycle.ts` (variável `GITNEXUS_UPDATE_CYCLE`, inerte sem ela), que roda o preparo e a troca no processo principal, como o app faz ao instalar. No CI o workflow `update-cycle.yml` (windows-latest) roda só quando o PR toca a atualização, o empacotamento ou este teste, e à mão (`workflow_dispatch`). Numa máquina em que o Electron não abre janela, `GN_CYCLE_SKIP_SMOKE=1` pula só a última verificação. O teste espera o antivírus liberar os executáveis copiados e repete o disparo em `EPERM`; o atualizador também repete a reabertura do app (6 tentativas, 3 s entre elas) antes de desistir.

## Imagens e GIFs da documentação

As mídias de `docs/media` (e a vitrine do README) são gravadas com o **app real** pelo harness de interface, sem caminho pessoal nem dado de cliente:

```bash
cd apps/studio && npx vite build
# grava os quadros (<cena>-<n>.png, janela 1320x760, pt-BR, tema escuro): todas as cenas, ou uma com GN_MEDIA_ONLY=paleta
GN_MEDIA=1 GN_MEDIA_OUT=<pasta> node scripts/ui-tests/run.mjs media
# monta os GIFs e o commit-linter.png (precisa de Pillow: pip install pillow)
python scripts/ui-tests/montar-gifs.py <pasta> ../../docs/media
```

- `scripts/ui-tests/tests/media.mjs` tem uma **cena por GIF** (`paleta`, `commit-linter`, `desfazer`, `rebase`, `stage-por-linha`, `conflito`). Cada uma monta um repositório de demonstração em `C:\gn-demo` (ou `/tmp/gn-demo`), dirige a tela por CDP e grava um quadro por passo. Sem `GN_MEDIA=1` o arquivo sai na hora com sucesso: o `ui-test` normal não grava nada.
- `scripts/ui-tests/montar-gifs.py` junta os quadros (apresentações de 3 a 5 quadros, de 1,5 a 3 s cada, em loop) e salva o `commit-linter.png`, que também é a imagem do manifesto do Flatpak (`scripts/lib/flatpak.mjs`) e da página do projeto: se ele mudar de nome, esses dois mudam junto.
- Para mudar um GIF, ajuste a cena correspondente (o que cada quadro mostra) e a tabela `CENAS` do script (duração de cada quadro). Regrave quando a interface mudar de forma visível.

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
- O repositório é **público**: revisão de dependências, proveniência assinada, ruleset, CodeQL e o relato privado de vulnerabilidade (o [SECURITY](../SECURITY.md) manda reportar por ele) estão ligados. O que está configurado e por quê: [REPOSITORIO](REPOSITORIO.md).

## Mais documentação

- [CI e pipeline de release](CI.md): o que cada workflow faz.
- [Automação](AUTOMATION.md): bots, merge automático, betas, versão e changelog.
- [Labels, issues e PRs](LABELS.md): rótulos automáticos, formulários de issue, ordem de merge.
- [Configuração do repositório](REPOSITORIO.md): rulesets, checks obrigatórios, token da release, segurança e como aceitar um PR.
- [Idiomas](I18N.md), [empacotamento](PACKAGING.md) e [assinatura de código](CODE_SIGNING.md).
