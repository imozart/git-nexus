# GitNexus

Gerenciador Git desktop portátil (Electron + Vue 3 + TypeScript) com linter de Conventional Commits em tempo real e resolução visual de conflitos 3-way. Arquitetura inspirada no [Beekeeper Studio](https://github.com/beekeeper-studio/beekeeper-studio/).

Especificação completa: [INSTRUCOES.md](INSTRUCOES.md).

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
```

Saída de `pnpm dist` (Windows x64): `GitNexus-<versão>-portable-x64.exe` (arquivo único, sem instalador) e `GitNexus-<versão>-win-x64.zip`.
Os dados (lista de repositórios, preferências) ficam em `GitNexusData/` ao lado do executável; nada é gravado no registro.

## Aba de Staging (referência: IntelliJ)

- **Lista de arquivos** em dois grupos — *Alterações* (rastreados) e *Arquivos não versionados* — com checkbox: marcado = no commit (stage), parcial = parte no stage, vazio = pendente. O resumo no topo mostra quantos estão no commit e quantos pendentes. Cores/letras por status (M, A, D, R, novo).
- **Seleção múltipla:** clique, Ctrl+clique, Shift+clique, Ctrl+A e retângulo (arrastar no espaço vazio). **Arraste** a seleção para *Alterações* para incluí-la no commit (e para *Não versionados* para tirar arquivos novos do stage). Espaço marca/desmarca; ↑/↓ navegam.
- **Menu de contexto** (botão do meio ou direito, em arquivo ou grupo): descartar alterações, incluir/remover do commit, adicionar ao `.gitignore`, copiar caminho/nome, mostrar na pasta, abrir. Descartes pedem confirmação, guardam cópia em `GitNexusData/discarded` e oferecem **Desfazer**.
- **Diff lado a lado** (HEAD x working tree) com numeração, trechos inalterados recolhíveis e botões por linha (`›`) e por bloco (`»`) para descartar. Barra superior: ↑ diferença anterior (Shift+F7) · ↓ próxima (F7) · ← arquivo anterior (Alt+←) · → próximo arquivo (Alt+→). Modo *Unificado* disponível.

### Testar a interface sem Electron

`apps/studio/scripts/ui-harness/server.ts` serve o renderer compilado num navegador comum, ligado ao mesmo código de Git do processo utilitário (útil para CDP/Playwright):
`esbuild scripts/ui-harness/server.ts --bundle --platform=node --format=esm --outfile=harness.mjs` e `node harness.mjs dist/renderer <pasta-de-dados> 5199`.

## Releases automáticas (GitHub Actions)

Cada merge na `master` dispara `.github/workflows/release.yml`:

1. **Versão** — `scripts/release-info.mjs` lê a última tag `vX.Y.Z` e os commits desde então (Conventional Commits): `!`/`BREAKING CHANGE` → **major**, `feat` → **minor**, qualquer outro → **patch**. Sem tags, a primeira release usa a versão do `package.json` raiz. A tag é a fonte da verdade; nenhum commit de versão volta para a master.
2. **Qualidade** — `typecheck` + `test` (a release não sai se falharem).
3. **Build em paralelo** (6 jobs): Windows x64/ARM64, macOS Intel/Apple Silicon, Linux x64/ARM64.
4. **Release** — notas agrupadas por tipo (novidades, correções, breaking changes…, com links para commits/PRs, ticket `Refs:` e autor), tabela de downloads, `SHA256SUMS.txt` e link de comparação com a versão anterior. A release é criada como rascunho, recebe todos os arquivos e só então é publicada.

| Sistema | Pacotes gerados |
|---------|-----------------|
| Windows | instalador `-setup.exe` (por usuário, sem admin), `-portable.exe`, `.zip` |
| macOS | `.dmg` e `.zip` |
| Linux | `.AppImage`, `.deb`, `.rpm`, `.tar.gz` |

Detalhes:
- **Pular release:** inclua `[skip release]` na mensagem do commit.
- **Release manual / forçar incremento:** Actions → *Release* → *Run workflow* (campo `bump`).
- **PRs:** `.github/workflows/ci.yml` roda typecheck, testes e build (Ubuntu e Windows) antes do merge.
- **Merges seguidos:** as releases entram em fila; se um merge for "pulado" pela fila, seus commits entram na release seguinte.
- **Sem assinatura de código:** Windows (SmartScreen) e macOS (Gatekeeper) avisarão; as notas da release explicam como proceder. Para assinar, adicione os segredos do `electron-builder` (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_*`) ao repositório e exponha-os no passo *Empacotar*.
- **Modo portátil:** `.exe` portátil, AppImage e ZIP/tar.gz guardam dados em `GitNexusData/` ao lado do executável; instalador, `.deb`/`.rpm` e `.app` em `/Applications` usam a pasta padrão do sistema. Criar uma pasta `GitNexusData` ao lado de qualquer instalação força o modo portátil.
- Testar o texto da release localmente: `node scripts/release-info.mjs next` e `node scripts/release-info.mjs notes --version 1.2.3 --out notas.md`.

## Versões (verificadas em 13/11/2026)

| Item | Versão | Observação |
|------|--------|------------|
| Electron | 45.3.1 | Chromium/Node embutidos; `@types/node` fica em 24.x para casar com o Node do Electron |
| Vue / Pinia | 3.5.45 / 4.1.0 | |
| Vite / ESBuild / Sass | 8.3.8 / 0.28.2 / 1.108.2 | |
| electron-builder | 26.18.0 | |
| TypeScript | 7.0.2 nos pacotes (`tsc`) · 6.0.3 nos apps com `.vue` | `vue-tsc`/Volar ainda exigem TS < 7; migrar quando liberarem |
| Vitest | 5.1.0 | |
| pnpm | 12.18.0 | scripts de build liberados só para `esbuild` e `electron` (`allowBuilds`) |
| Node (dev) | >= 24 | LTS atual é a 26 (Lithium); 24 em manutenção |

## Status

| # | Etapa | Estado |
|---|-------|--------|
| 1 | Monorepo PNPM | feito |
| 2 | Tipos IPC + `git-core` | feito, testado contra repositório git real |
| 3 | Build do `studio` (ESBuild + Vite) | feito |
| 4 | Gerenciador de repositórios (varredura, busca, WSL2, persistência JSON) | feito |
| 5 | `CommitForm.vue` + `MergeConflictResolver.vue` + abas (Staging, Grafo, Conflitos) | feito |
| 6 | `electron-builder` portátil (Windows) | feito e testado localmente |
| 7 | Releases multiplataforma via GitHub Actions | workflows escritos e validados (sintaxe + script de versão/notas testado); **ainda não executados no GitHub**. Builds macOS/Linux só rodam no CI |

Pendências conhecidas: ícone do app (usa o padrão do Electron), assinatura de código (sem certificado), suporte WSL2 testado só por unidade (parse de caminho), não em distro real.
