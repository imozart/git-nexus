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

### Substituir em vários arquivos (fase 6)

- **Arquivos:** `replace-files-core.ts` (puro: `planFile`, `applyFile`, `tally`, motivos de recusa), a linha "Substituir por" e o resto da interface em `SearchWindow.vue`, e no núcleo `work-file.ts` (`saveWorkingFile` com cópia de segurança, `restoreWorkingFile`, `pruneBackups`). O atalho é o comando `search.replace` (`Mod+Shift+H`), que abre a mesma janela com a linha de substituir.
- **As mesmas regras do arquivo único:** a troca usa `replace-core.ts` (grupos, escapes, manter a caixa, quebra de linha do arquivo) sobre um `EditorState` do CodeMirror criado SEM tela, com `EditorState.lineSeparator` quando o arquivo é CRLF. As posições do CodeMirror contam cada quebra como um caractere; por isso a troca é uma transação e o texto sai de `doc.sliceString(0, len, lineBreak)`, nunca de índices no texto cru.
- **A lista não é a fonte:** a janela só diz em que linhas (as ocorrências não ocultas) a pessoa quer trocar. `planFile` lê o disco; se uma linha da lista não tem ocorrência no conteúdo (`diverged`, p. ex. regex PCRE que o JavaScript entende diferente) o arquivo é recusado, e ocorrências do disco em linhas fora da lista não são trocadas.
- **Prévia na lista:** `Row` ganhou `new` (a linha depois da troca, 24 px, logo abaixo da ocorrência) e `note` (o motivo de o arquivo não ser alterado). A prévia é calculada por arquivo, 4 por vez, a partir do que o disco tem agora (com um teto de memória para o conteúdo lido); mudar o texto novo recalcula sem reler o disco.
- **Aplicar:** relê cada arquivo; hash diferente do da prévia = `changed`; recalcula do conteúdo lido e grava com `saveWorkingFile` (`expectHash`, codificação do arquivo, atômico). `SaveOptions.backup` é o id do lote (gerado na interface, validado no worker como `[A-Za-z0-9-]{8,64}`): o worker o transforma em `<dados>/replaced/<id>`, o núcleo copia o original antes de gravar (a primeira cópia do lote vale) e a poda apaga lotes com mais de 30 dias, no máximo uma vez por hora.
- **Desfazer:** `restoreWorkingFile` só devolve o arquivo se o disco ainda tem o hash que a substituição gravou. O último lote de cada repositório fica em memória (módulo da janela), então o desfazer vale enquanto o app está aberto.
- **Testes:** `replace-files-core.test.ts` (plano, aplicar, CRLF, UTF-16, totais), `search-window-core.test.ts` (linha nova e nota), `work-file.test.ts` (cópia, restaurar, poda) e `search-replace.mjs` (UI com `git` de verdade: prévia, exclusão por ocorrência/arquivo/pasta, aplicar com confirmação, CRLF e Windows-1252 byte a byte, desfazer, desfazer que respeita o que mudou depois, arquivo mudado depois da busca, escopos recusados, nunca commita, tema claro e inglês).

### Acessibilidade, medição e documentação (fase 7)

- **Acessibilidade:** o fluxo inteiro só com o teclado é `search-teclado.mjs` (36 verificações, teclas reais pelo CDP): diálogo modal nomeado, foco preso (40 `Tab` e 12 `Shift+Tab` sem sair) e devolvido ao fechar, `searchbox`, `listbox` com `aria-activedescendant` que aponta uma opção que existe e está selecionada, total e contador "N de M" em região viva, `Alt+C` e `Alt+↓` sem mouse, nome acessível em todo controle visível, tema claro e inglês sem sobra de português. O teste de convenções (`ui-conventions.test.ts`) fixa o que dá para fixar no código: diálogo com `label`, dois `GnSearchField`, nada de `<select>`/`<datalist>`, `role="listbox"` com `aria-activedescendant`, `role="status"` no total e `:aria-expanded` no histórico. As regras estão em `INTERFACE.md`, "A janela de pesquisa (renderer)".
- **Foco devolvido:** o `GnDialog` devolve o foco ao elemento que o tinha **se ele ainda existe**. Depois de **salvar** pela janela, a tela de trás recarrega e o botão antigo some, então o foco cai no `body`; por isso o teste confere a devolução num abrir/fechar logo no início.
- **Medição:** o núcleo com 20 mil arquivos é `GN_SEARCH_FILES=20000 GN_SEARCH_KEEP=1 npx vitest run packages/git-core/test/search-run.test.ts -t "arquivos numerosos"` (imprime `BUSCA primeiro-lote`, `varredura-completa` e `cancelar`); a interface é `search-window-perf.mjs`, e com `GN_SEARCH_BIG=<TEMP>/gitnexus-search-big-20000` ele também percorre a janela sobre esse repositório. Cuidado: esvaziar o campo e esperar a lista limpar **antes** de ligar o cronômetro, senão os resultados da busca anterior fazem o "primeiro resultado" marcar 10 ms. A tabela com as metas e os tempos está em `USO.md`, "Pesquisar no repositório".
- **Documentação:** a seção "Pesquisar no repositório" de `USO.md` (saiu de Ferramentas e ganhou teclado e leitor de tela, capturas e a tabela de desempenho); `INTERFACE.md` registra `FindBar`, `SearchWindow` e `SearchFilters`. Nenhuma dependência nova nas fases 1 a 7 (`pnpm check:notices` confere).

### Buscar em vários repositórios (fase 8)

- **Arquivos:** `apps/studio/src/worker/multi-search.ts` (o orquestrador, puro: o worker injeta `run`, `exists` e `emit`), `startMultiSearch` em `handlers.ts`, `renderer/multi-search-core.ts` (puro: nomes únicos, estado de cada repositório, conjuntos salvos, cabeçalhos da lista), `components/SearchRepos.vue` (o painel) e, na `SearchWindow.vue`, o modo "vários".
- **Só o catálogo:** a interface manda **ids** de `getKnownRepositories`; o worker os resolve no `repositories.json` e o que não está lá volta em `MultiSearchStarted.rejected` e nunca roda (um caminho digitado no lugar do id é só "id desconhecido"). Ler e gravar continua passando por `resolveInsideRepo` do repositório dono.
- **Orquestração:** `createMultiSearcher.start` recebe a lista na ordem pedida (o da aba ativa primeiro) e sobe `min(4, metade dos núcleos)` operários que puxam o próximo da fila. Cada repositório roda o `searchRepository` normal com o `limit` por repositório (1000) e o seu `AbortSignal`; o limite **global** (5000) é exato (o lote que o ultrapassa é cortado) e, ao atingi-lo, para quem roda e marca quem não começou com `reason: 'globalLimit'`. Falhas viram o estado do repositório (`unavailable` pasta sumida, `noGit` ENOENT do spawn, `noRevision` vinda do núcleo, ou erro com a mensagem) e nunca derrubam os outros.
- **Eventos sem canal novo:** cada repositório usa os mesmos `searchBatch`/`searchDone`, com o id `<busca>#<repoId>` e o `repoId`; a interface descobre que a busca acabou quando nenhum repositório está ativo. `cancelSearch(<busca>)` cancela todos e `cancelSearch(<busca>#<repoId>)` só aquele; o mesmo id de busca recomeça (a antiga para de verdade).
- **O prefixo virtual:** na interface, o `file` de cada ocorrência vira `<alias>/<caminho>` (`alias` = nome do repositório, `~2`, `~3` se repetir). Com isso o modelo de resultados, recolher, ocultar e a prévia da substituição (tudo chaveado por `file`) funcionam sem saber que há vários repositórios, e o repositório vira a "pasta" de cima. Só quem fala com o disco desfaz o prefixo (`own(file)` na janela, `ownerOf` no núcleo). `withRepoHeaders` junta as linhas por repositório (elas chegam misturadas) e põe um cabeçalho na frente de cada um, mesmo sem ocorrência (é onde se vê "sem Git").
- **Substituir:** nasce desligado a cada busca (`allowMultiReplace`); ligado, a prévia lê do disco de cada dono, a confirmação lista cada repositório com o seu resumo e uma caixa, e o lote de cópia de segurança (`SaveOptions.backup`) e o `lastReplace` são **por repositório**, então há um **Desfazer** para cada um. "Carregar mais" não existe nessa busca (o corte aparece no cabeçalho do repositório).
- **Testes:** `multi-search.test.ts` (o orquestrador, com um Git de mentira: concorrência, limites, cancelamento por repositório, falha isolada), `multi-search-core.test.ts`, `search-handlers.test.ts` (com Git de verdade: catálogo, indisponível, sem a revisão), `multi-search-perf.test.ts` e `search-multi.mjs` (4 repositórios reais, um indisponível e um com 1200 ocorrências: agrupamento, estados, limite por repositório, conjuntos, editar e salvar no dono, substituir e desfazer por repositório, recusa fora do catálogo, tema claro e inglês).
- **Medir:** `GN_MULTI_FILES=5000 npx vitest run apps/studio/test/multi-search-perf.test.ts` (10 repositórios de 5 mil arquivos; só escreve os arquivos, sem commit; imprime `MULTI primeiro-lote`, `cancelar-todos` e `limite-global`). `GN_MULTI_KEEP=1` guarda os repositórios em `<TEMP>/gitnexus-multi-5000` para repetir (apague depois).

### Buscar na história (fase 9)

- **Arquivos:** `packages/git-core/src/history-search-pure.ts` (puro, também no renderer: normaliza o pedido, monta os argumentos do `git log`, lê cada commit com o diff, `makeRanger` para contar e destacar, `summarizeHistory`), `history-search.ts` (o executor: `searchHistoryStream`), `startHistorySearch` em `handlers.ts` (eventos `historyBatch` e `historyDone`, cancelar por `cancelSearch(id)`), `renderer/history-search-core.ts` (formulário, pedido, selo, diff destacado), `components/HistorySearch.vue` (o painel) e `views/GraphView.vue` (a lista, o detalhe e "Arquivo nesta versão"). `getFileAtRevision` (`history-tools.ts`) lê o arquivo de um commit.
- **Quem faz o quê:** o Git filtra (`-S`, `-G`, `--grep`, `-L`) e o núcleo **lê o diff de cada commit** (`-p -U0`) para dizer entrou/saiu/mudou: conta as ocorrências nas linhas `+` e `-` de cada arquivo com a mesma expressão que a interface usa para destacar (`compileJsRegex`/`fixedRanges` de `search-pure.ts`). Se a expressão não compila no JavaScript, o commit vem com o selo `unknown` (o Git decide sozinho).
- **`Aa` e `ab`:** `Aa` desligado vira `--regexp-ignore-case` (vale no `-S`, no `-G` e no `--grep`; `history-search.test.ts` compara com o `git log` direto). `ab` não existe no Git para `-S`/`-G`: o pedido troca o `-S` por `-G` (candidatos) e `parseHistoryRecord` descarta, no próprio diff, o arquivo em que o texto não entrou nem saiu como palavra inteira. **Conferido no Windows e no Linux pela CI; o macOS (regex do sistema) não tem job de teste e não foi conferido.**
- **Sem `-n`, sem `--skip` e sem `--topo-order`:** o Git aplica `-n` e `--skip` **antes** do filtro do `-S`/`-G` (contam commits candidatos, não achados) e `--topo-order` o obriga a varrer a história toda antes do primeiro resultado. Por isso o núcleo lê a saída em fluxo, encerra o `git log` quando a página enche (o (limite + 1)º commit diz que há mais) e **pula os achados** das páginas anteriores (`skip` = quantos commits que o Git devolveu pular; `nextSkip` volta no fim). `GIT_FLUSH=1` faz o Git entregar cada commit na hora (num pipe ele guarda 64 KB). Um commit só fica completo quando o próximo começa, então o primeiro lote espera o segundo achado.
- **Examinados:** em paralelo, `git rev-list` com os mesmos filtros (sem o texto) dá a ordem e o total; o examinado de um lote é a posição do último achado, e no fim é o total. Passa de 400 mil commits: só o total. Com `--follow` e `-L` não há contagem.
- **Segurança:** o texto vai colado na opção (`-S<texto>`, `--grep=<padrão>`) e nunca vira outra opção; revisões passam por `isSafeRevision`, máscaras e pasta pelas mesmas regras da pesquisa, o arquivo do `-L` por `cleanFolder`. `getFileAtRevision` valida o hash e o caminho.
- **Testes:** `history-search-pure.test.ts` (pedido, argumentos, leitura do diff, selo, fluxo, resumo), `history-search.test.ts` (Git de verdade, comparado com `git log -S/-G/--grep/-L` direto: renomeação, merge, outro branch, tag, intervalo, binário, páginas, cancelar, erros), `search-handlers.test.ts` (o worker), `history-search-perf.test.ts` e `search-historia.mjs` (a interface: 50 verificações).
- **Medir:** `GN_HIST_COMMITS=20000 npx vitest run packages/git-core/test/history-search-perf.test.ts --silent=false` (gera o repositório com `git fast-import` e imprime `HIST primeiro-lote`, `varredura completa`, `cancelar` e as páginas); `GN_HIST_KEEP=1` guarda o repositório em `<TEMP>/gitnexus-hist-<N>` (apague depois).

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
