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

## Medir o resolvedor de conflitos

A barra de qualidade do resolvedor (issue #231) é medida, não suposta:

- **Desempenho do motor** (`pnpm test packages/git-core/test/merge-perf.test.ts`): arquivo de 20 mil linhas com 200 conflitos abre e aceita a primeira decisão em até 1 s e cada escolha leva até 100 ms (o teste falha se passar); em 100 mil linhas o cálculo fica abaixo de 200 ms, por isso não há processo separado para a fusão.
- **Desempenho da tela** (`pnpm test:ui merge-large`): o mesmo arquivo na tela de verdade. Só o que está perto da área visível é desenhado (acima de 60 trechos); a verificação é a **trava contra regressão** (abrir em até 5 s e escolha em até 150 ms, o dobro da meta de ~2 s e ~100 ms, porque o harness roda num navegador com a máquina ocupada) e os tempos medidos vão para `merge-large-metrics.json` em `GN_UI_OUT`.
- **Acessibilidade** (`pnpm test:ui merge-teclado`): regiões nomeadas, anúncio por região viva, foco visível em cada parada do Tab e o fluxo completo (decidir, desfazer, gravar) só com teclas.
- **Eficácia sobre conflitos reais:** `GN_MEASURE_REPO=<repositório> GN_MEASURE_LIMIT=400 pnpm test apps/studio/test/merge-efficacy.test.ts -t "taxa de conflitos"` percorre os merges do histórico, reconstrói cada conflito com `git merge-tree --write-tree` e compara o que a tela comporia **sem digitar nada** (só selecionando linhas das duas versões e da base) com a resolução humana do commit de merge. Cada conflito é achado pelas linhas iguais em volta (o que o humano mudou fora dos conflitos não conta contra a tela), commits de merge que ficaram com marcadores são ignorados e o que exigiu texto digitado sai listado, com as linhas, para melhorar o motor. A meta inicial é **80%**; a primeira medição (6 históricos, 286 conflitos) deu **78,7%**, e dos 61 restantes, 11 eram só uma linha em branco digitada entre os blocos (candidato a melhoria do motor), 13 o humano mexeu nas linhas em volta do conflito (não dá para saber o que decidiu) e o resto, em geral, edições das duas versões combinadas à mão.
- **Roteiro cronometrado (beta):** o novo resolvedor só vira o padrão, e a tela antiga só sai, se for mais rápido e errar menos que o editor de marcadores. Cada pessoa da beta faz os 5 cenários abaixo nas duas telas (a ordem alterna entre as pessoas), cronometra de abrir a tela de conflitos até o arquivo marcado como resolvido e anota os erros (resultado errado, marcador esquecido, desistiu): **1.** rebase com conflito em 3 arquivos; **2.** apagado de um lado e alterado no outro; **3.** conflito só de fim de linha (LF/CRLF); **4.** arquivo binário; **5.** arquivo grande (centenas de conflitos, use "Resolver os simples…"). São pelo menos 3 pessoas; os tempos e os erros entram na issue de acompanhamento.

## Busca no repositório (núcleo v2)

`packages/git-core/src/search-run.ts` (`searchRepository`) e `search-pure.ts` são o motor da pesquisa (#233); a janela "Pesquisar no repositório" (`components/SearchWindow.vue`) é a interface dele; o `searchContent` antigo saiu na fase 4, junto com a aba de Ferramentas.

- **Motor:** `git grep -z -n --column` (sem `-I`, para listar o binário que casa), no dialeto **PCRE2** (`-P`) quando o Git suporta (descoberto uma vez) e na estendida quando não. O destaque tem as colunas do Git: o resto da linha usa a mesma expressão em JavaScript, **conferida com a coluna do Git**; se ela não reproduz (grupo atômico, quantificador possessivo...), o `git grep -o` diz onde cada trecho começa e termina.
- **Pedido (`SearchQuery`):** `scope` (`worktree`, `tracked`, `changed`, `staged`, `revision`), máscaras (`*.ts, !dist/`), ignorados, não versionados, submódulos, contexto (0 a 5), `limit`/`offset`, `timeoutMs`. Nada do que o usuário digita vira opção do Git: máscaras e revisões são validadas e os arquivos vão como `:(literal)`.
- **Várias linhas:** liga sozinha com quebra de linha; o `git grep -l` escolhe os candidatos (pelo trecho fixo mais longo) e o núcleo varre o texto decodificado, com limite de 5 MB por arquivo (acima disso o arquivo aparece como ignorado).
- **Lotes e cancelamento:** `onBatch` recebe lotes enquanto o `git grep` ainda lê; o `AbortSignal` (e o tempo máximo e o limite da página) encerra o processo de verdade (`runGit` aceita `signal`, `onStdout` e `discardStdout`). Pelo IPC: `startSearch(repo, query, id)` volta na hora, `onSearchBatch`/`onSearchDone` trazem o resto (o `id` é do chamador, então nenhum lote se perde) e `cancelSearch(id)` cancela.
- **Sem cache de resultado ainda:** o índice e o `HEAD` não mudam quando alguém edita um arquivo no disco, então um cache por (consulta, índice, `HEAD`) devolveria resultado velho. Ele entra junto com o índice persistente (fase 10), que sabe quais arquivos estão sujos.
- **Medir:** `pnpm test packages/git-core/test/search-run.test.ts` roda com 2 mil arquivos (folga larga); `GN_SEARCH_FILES=20000 pnpm test packages/git-core/test/search-run.test.ts -t "arquivos numerosos"` mede as metas de verdade (primeiro lote em 300 ms, busca completa em 2 s, cancelar em poucos milissegundos) e imprime os tempos.

### A janela de pesquisa (fase 4)

- **Arquivos:** `SearchWindow.vue` (a janela, dentro de um `GnDialog`), `search-window-core.ts` (puro: modelo de resultados, janela da lista virtualizada, teclado, marcas, divisória, "mudou por fora?", só leitura), `stores/search.ts` (quem abre: `Ctrl+F` e `Ctrl+Shift+F`, o comando `search.window` com `alias`) e, no núcleo, `work-file.ts` (`readWorkingFile`, `stampWorkingFile`, `saveWorkingFile`).
- **Lista virtualizada:** linhas de **24 px** fixas (cabeçalho de arquivo e ocorrência), só as visíveis mais 8 de folga no DOM (`windowRange`). Os lotes do `startSearch` entram por um temporizador de 16 ms (**não** `requestAnimationFrame`: em segundo plano os quadros param e o fim da busca nunca seria aplicado), no máximo 1200 por quadro, então a interface não trava com 5 mil ocorrências de uma vez.
- **Gravar:** `saveWorkingFile` codifica **antes** de tocar no disco (caractere fora da codificação = `unencodable`, nada gravado), confere o **hash** do que foi lido (`changed`, a menos que `force`) e grava num temporário na mesma pasta + `rename` (atômico), mantendo o modo. O mesmo `writeFileAtomic` agora serve ao descarte por linha (`writeWorkingFile`). A codificação vem dos bytes do disco (BOM, UTF-8 válido, senão Windows-1252); arquivo só ASCII abre como UTF-8 sem consultar o Git (dois `git show` custavam ~150 ms por abertura).
- **Realce no editor:** as colunas do núcleo da busca (`marksOf`), não uma busca nova no editor; `CodeEditor` aceita `marks` e expõe `reveal(linha, de, até)`. Linha cortada (`clippedStart`) acha o início do trecho na linha inteira e, se não achar, não marca (nunca no lugar errado).
- **Esc dentro da janela:** o `GnDialog` deixa o Esc para quem está dentro de um `[data-dialog-esc="own"]` (o `CodeEditor` com a barra de busca aberta). Linhas da lista **não** usam `aria-expanded` (o diálogo trataria como lista aberta e não fecharia com Esc): o estado recolhido vai no nome.
- **Testes:** `search-window-core.test.ts` e `work-file.test.ts` (unidade); `content-search.mjs` (a pesquisa), `search-window.mjs` (editar com segurança) e `search-window-perf.mjs` (5 mil resultados, rolagem, tarefas longas e 30 mil linhas; as medidas saem em `search-window-perf-metrics.json`).

### Filtros, histórico e mensagens da pesquisa (fase 5)

- **Arquivos:** `search-filters-core.ts` (puro: `Filters`, `buildQuery`, histórico, `regexErrorAt`, sugestões de "nada encontrado"), `components/SearchFilters.vue` (o painel de filtros, só o formulário) e, na lista, `Row` ganhou `dir` e `ctx` (`search-window-core.ts`). O núcleo da busca ganhou `SearchQuery.folder` (`cleanFolder`/`maskedInFolder` em `search-pure.ts`: as máscaras valem dentro da pasta; a pasta não passa pelo separador de máscaras, então aceita espaço).
- **Os filtros são o pedido do núcleo:** nada é refeito no renderer. `buildQuery(prefs)` monta o `SearchQuery` (escopo, revisão, pasta, máscara, ignorados, novos, submódulos, contexto); mudou um filtro, a janela refaz a busca (agrupar só refaz as linhas).
- **Ocultar da lista** (`Hidden`: ocorrências, arquivos e pastas) é só da lista: a contagem do núcleo continua sendo o total e `ResultModel.count(hidden)` dá o que sobra. A pasta raiz (`''`) vale só para os arquivos direto nela, não para as subpastas. Uma pesquisa nova limpa o que foi ocultado; refazer por causa de uma gravação, não. (A fase de substituir em vários arquivos usa esse mesmo conjunto: o que está oculto não é substituído.)
- **Contexto:** o núcleo devolve `before`/`after` em cada ocorrência; a lista os mostra como linhas `ctx` de 24 px (sem repetir uma linha que já aparece como contexto de outra ocorrência, e sem repetir as que são ocorrência). Elas não entram no teclado (`stepHit`) nem na contagem.
- **Carregar mais:** a página tem 5.000 ocorrências; `done.nextOffset` pede a seguinte (`offset`) e os resultados novos entram depois dos que já estão na lista.
- **Histórico:** `gitnexus.searchHistory` (por id do repositório, 30 entradas, com as opções, a máscara, o escopo, a revisão e a pasta). Entra quando a pessoa age sobre a pesquisa (Enter, escolher uma ocorrência, fechar a janela, escolher no histórico), não a cada tecla.
- **Esc e `aria-expanded`:** o botão Filtros e o de histórico usam `aria-expanded`, então o `GnDialog` deixa o Esc para a janela, que fecha primeiro o histórico, depois os filtros, e só então a janela.
- **Testes:** `search-filters-core.test.ts`, `search-window-core.test.ts` (agrupar, contexto, ocultar) e, no núcleo, `search-pure.test.ts`/`search-run.test.ts` (pasta); `search-filters.mjs` (48 verificações com `git` de verdade: escopos, máscara, pasta, contexto, agrupar, ocultar, histórico que sobrevive a recarregar, mensagens, carregar mais, "Pesquisar aqui", tema claro e inglês).

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
