# Componentes e regras da interface

Tudo o que é botão, seletor, ícone, etiqueta e aba vem do **ui-kit** (`apps/ui-kit`, pacote `@git-nexus/ui-kit`), com o prefixo `Gn`. As telas montam; não refazem. Quem precisa de algo que o kit não tem **cria o componente no kit** em vez de estilizar na tela.

## Catálogo

| Componente | Para quê | Detalhes |
|---|---|---|
| `GnButton` | Botão com texto | `variant` (preenchimento: `primary` sólido, `ghost` leve) e `tone` (cor: `neutral`, `accent`, `success`, `warn`, `danger`), `size` `sm`/`md` |
| `GnIconButton` | Botão só de ícone | `icon` e `label` **obrigatório** (vira `aria-label` e a dica do `GnTooltip`); leve por padrão |
| `GnButtonGroup` | Par ou conjunto de botões colados | anterior/próximo; serve para `GnButton` e `GnIconButton` |
| `GnSegmented` | Escolher **uma** opção entre poucas | `v-model`, `options`, teclado e `aria` prontos; ativo em azul tingido |
| `GnDialog` | Diálogo modal | overlay, caixa com elevação, foco preso, Esc, clique no fundo, foco devolvido e fundo inerte; `width`, `maxHeight`, `role`, `labelledby`/`label`, `describedby`, `dismissable`, `initialFocus`; emite `close` (`'escape'` ou `'backdrop'`) o Esc fecha antes uma lista aberta de dentro (combobox) e o pai segue dono do estado (`v-if`); `isDialogOpen()` diz se há algum aberto |
| `GnTooltip` | Dica de um elemento ao passar o mouse ou focar | `text` (obrigatório), `placement` (`top`/`bottom`), `delay` (500 ms), `disabled`; fica como **filho** do elemento descrito (não o envolve: o `GnButtonGroup` depende de `:first-child`/`:last-child`); o pai ganha `data-tooltip` e não deve ter `title` nativo |
| `GnSearchField` | Campo de pesquisa de texto | **um** campo com `✕ Aa ab .*` **dentro** dele (ver "Campo de pesquisa" abaixo); `v-model` do texto e de `case-sensitive`, `whole-word` e `regex`; `label` **obrigatório**, `labels`, `error`, `history`, `variant="replace"` |
| `GnIcon` | Ícone decorativo | `name` (ver `components/icons.ts`); herda a cor do texto; sem `v-html` |
| `GnBadge` | Etiqueta de estado | `tone` com o mesmo vocabulário do botão |
| `GnTabs` | Abas | barra principal, Ferramentas e Configurações; teclado pronto (setas, Home, End, Enter e espaço; só a aba ativa entra no Tab) |

Os ícones são traços próprios (grade 24x24), uma linha em `icons.ts` por ícone. Acrescentar um é só incluir o nome e o caminho.

## Cor dos botões

A cor tem significado, não é enfeite. Sólido = a ação que a pessoa veio fazer **nesta tela** (uma por área); o contorno colorido diz o que a ação é.

| Contexto | Como | Exemplos |
|---|---|---|
| Ação principal | `variant="primary"` (azul) | Adicionar repositório…, Conectar, Carregar commits, Criar tag |
| Navegar, consultar | `tone="accent"` | Grafo / Histórico, Ferramentas, Abrir (linha da lista), Pesquisar |
| Confirmar, concluir | `tone="success"` (sólido ou contorno) | Commit, Marcar como resolvido, Criar PR, Continuar (rebase) |
| Atenção, em andamento, reescreve histórico | `tone="warn"` | Conflitos, Executar rebase…, Pular commit, Desfazer |
| Destrutivo | `tone="danger"` | Excluir, Abortar rebase, Desconectar, Remover |
| O resto | sem `variant` nem `tone` | **Atualizar**, Cancelar, Fechar, Ours/Theirs |

- **Lista com N linhas:** nunca sólido (20 repositórios não podem ter 20 botões azuis chamando atenção). Use contorno, ou `variant="ghost"` com `tone` para o leve colorido (texto na cor do tom, sem fundo nem borda até o hover). O "Remover" de cada linha é `GnIconButton` leve vermelho.
- **"Atualizar" é neutro** em todas as telas: a mesma ação tem a mesma aparência.
- **"Buscar" é fetch** (Início); a pesquisa no Grafo se chama **Pesquisar**.
- **Contraste:** o azul sólido usa `--gn-accent-solid` (texto branco com 4,5:1) e **escurece** no hover. O azul de bordas, links e foco continua `--gn-accent`. O teste do ui-kit confere o contraste de todos os tons.

## Ícones nos botões

Ícone em todos os botões pesa; em poucos, melhora. Regra:

- **Só ícone** (navegação, fechar, reordenar, histórico/blame): sempre `GnIconButton`, com `label`.
- **Confirma ou destrói** (verde e vermelho): ícone à esquerda do texto (✓, ✕, lixeira), para a cor não ser a única pista. No máximo um de cada lado por barra.
- **Reescreve histórico, irreversível:** `⚠` só no botão sólido âmbar.
- **Texto de rotina** (Atualizar, Abrir, Cancelar): sem ícone.
- **Lista repetida:** texto nas ações comuns; só ícone na destrutiva.

## Navegação e seletores

- Pares de navegação (arquivo anterior/próximo, diferença anterior/próxima) são `GnButtonGroup` com dois `GnIconButton`, **cada contador junto do seu par**, em neutro.
- Seletor de visão ou filtro é `GnSegmented`, nunca botões com CSS próprio. O ativo é azul **tingido**, nunca o sólido, para não parecer a ação principal.

## Tipografia

A fonte do app é a **JetBrains Mono** (v2.304, licença OFL 1.1), embutida: funciona sem internet e fica igual em todos os sistemas. Ninguém escreve nome de fonte nas telas: tudo vem de token, em `apps/ui-kit/src/styles/tokens.scss`.

| Token | O que é |
|---|---|
| `--gn-font-jetbrains` | A JetBrains Mono (com reserva monoespaçada) |
| `--gn-font-sans` | "Sistema" na interface: `Segoe UI`, `system-ui`... (a fonte de antes) |
| `--gn-font-mono-system` | "Sistema" no código: `ui-monospace`, `Cascadia Code`, `Consolas`... |
| `--gn-font-ui` | A fonte que vale agora na interface (do corpo do texto) |
| `--gn-font-code` | A fonte que vale agora no código (`pre`, `code`, `kbd`, `samp`, editor, diff) |
| `--gn-mono` | **Apelido** de `--gn-font-code`; os usos antigos continuam valendo |
| `--gn-font-size`, `--gn-line` | Tamanho e altura de linha do corpo (12px e 1,5; em "Sistema" voltam a 13px e 1,45) |
| `--gn-ligatures` | `none` (padrão) ou `normal`: as ligaduras (`!==`, `=>`) vêm **desligadas**, para o diff mostrar exatamente o que foi digitado |

- **Pesos disponíveis: 400, 500, 600 e 700, sem itálico.** `font-synthesis: none` impede o navegador de inventar negrito ou itálico: não use `font-weight` fora desses quatro nem `font-style: italic` esperando uma face.
- **Preferências:** a pessoa escolhe a fonte da interface, a do código e as ligaduras no diálogo de configurações (Ctrl+, ) ou pela paleta. A escolha vira os atributos `data-font-ui`, `data-font-code` (`jetbrains` ou `system`) e `data-ligatures` (`off` ou `on`) no `<html>`, que os tokens usam, e fica guardada em `gitnexus.fontUi`, `gitnexus.fontCode` e `gitnexus.ligatures` (o padrão não guarda chave). O código está em `renderer/font.ts` (reativo) e `renderer/font-core.ts` (puro).
- **Central de Configurações (nova preferência):** o diálogo (`components/SettingsDialog.vue`) é um menu lateral (`tablist` vertical) com uma seção por arquivo em `components/settings/`. Para acrescentar uma opção: (1) ponha o campo na seção certa dentro de um elemento com `data-setting="id"` (a busca e a abertura direta levam o foco até ele); (2) registre-a em `SETTINGS_INDEX` (`settings-core.ts`) com o texto e os **sinônimos em pt-BR e en**; (3) se for do Git, use `getGitConfig`/`setGitConfig` (lista fechada de chaves em `git-config-pure.ts`, validada na interface e no processo que grava) e nunca um arquivo paralelo; se for do app, uma chave nova em `PREF_KEYS` para entrar na exportação; (4) textos em `pt-BR.ts` **e** `en.ts`. Outras telas apontam para cá com `settings.open('git', 'git-sign')`. Os atalhos de comando são remapeáveis (`commands.shortcutOf`): um comando novo ganha a linha na seção Atalhos sozinho.
- **Texto de código num componente:** `font-family: var(--gn-mono);` (ou `var(--gn-font-code)`). Texto comum herda do corpo: não declare nada. No editor (CodeMirror), `fontFamily: 'var(--gn-mono)'`; ele re-mede os caracteres quando a fonte muda (`fontRevision`).
- **O que não fazer:** família literal (`'Segoe UI'`, `Consolas`, `monospace`), fonte de CDN (Google Fonts etc.: o app funciona offline), `@font-face` fora de `apps/ui-kit/src/styles/fonts.scss`, `font-weight` que não exista, ligaduras ou `font-feature-settings` literais (só pelo `--gn-ligatures`).
- **Regra do marco da fonte:** a fonte **não muda cor nem estrutura**; a revisão de layout com a fonte larga está no detector `ui-tests/tests/layout-font.mjs`.

## Movimento

Toda duração de `transition`/`animation` vem de um token de `apps/ui-kit/src/styles/tokens.scss`, nunca de um valor fixo (`0.2s`, `120ms`):

| Token | Uso |
|---|---|
| `--gn-motion-fast` (120 ms) | hover, borda, seta que gira |
| `--gn-motion-base` (140 ms) | entrada de overlays, barras de progresso (`--gn-enter` é apelido dele) |
| `--gn-motion-slow` (200 ms) | barras largas |
| `--gn-motion-loop` (1,1 s) | uma volta de indicador de progresso sem fim |

- **Movimento reduzido** vale quando o sistema pede (`prefers-reduced-motion: reduce`) ou quando a opção *Movimento* das Configurações (Aparência) está em *Reduzido* (`data-reduced-motion="true"` no `<html>`). *Normal* mantém o movimento mesmo com o sistema pedindo menos. *Sistema* (padrão) acompanha o sistema. As durações caem para 0,01 ms (não 0: o evento de fim da animação ainda dispara) e os indicadores sem fim leem `--gn-ind-width` e `--gn-ind-opacity` para ficarem cheios e esmaecidos, ainda legíveis.
- **Em componente:** `transition: opacity var(--gn-motion-fast) ease;`. Não escreva `@media (prefers-reduced-motion)` nem `scroll-behavior: smooth` no componente: só o `tokens.scss` fala com a media query.
- **Em TypeScript** (o que não é CSS, como a chuva de confete): `isReducedMotion(motionPref.value, systemReduces)` de `renderer/motion-core`.
- `apps/studio/test/ui-conventions.test.ts` (bloco `movimento`) reprova duração fixa e `prefers-reduced-motion` fora do `tokens.scss`.

## Barra de título

A janela não usa a barra de título do sistema: os botões de minimizar, maximizar e fechar ficam na mesma faixa das abas (`core__top`), uma só faixa no topo. O processo principal escolhe a moldura (`apps/studio/src/shared/title-bar.ts`, `titleBarMode`) e a passa ao preload; a interface a lê em `api.titleBar` e marca o `<html>` com `data-titlebar`:

| Moldura | Onde | O que acontece |
|---|---|---|
| `overlay` | Windows e Linux | `titleBarStyle: 'hidden'` + `titleBarOverlay`: os botões nativos são desenhados sobre a faixa, à direita, com as cores do tema; a faixa deixa o espaço deles com `env(titlebar-area-*)` |
| `inset` | macOS | `hiddenInset`: o semáforo fica à esquerda e a faixa deixa 78 px para ele |
| `native` | outras plataformas, ou `GITNEXUS_NATIVE_FRAME=1` | moldura padrão do sistema, nada muda |

- **Arrasto:** com `overlay` ou `inset`, `.core__top` é `-webkit-app-region: drag`; abas, botões, campos e seletores são `no-drag` (regra em `CoreInterface.vue`). **Controle novo na faixa** (botão, campo, aba): entra na lista `:is(...)` dessa regra, senão ele não recebe clique. Duplo clique na faixa maximiza (comportamento nativo do sistema).
- **Altura:** a faixa tem `min-height: 43px` (`TITLE_BAR_HEIGHT`) e o overlay usa a mesma altura; com zoom da interface o processo principal ajusta a altura do overlay (`overlayHeight`). Mudou a altura da faixa? Mude a constante junto (o teste confere).
- **Cores:** a interface informa `--gn-bg` e `--gn-text` ao processo principal (`setTitleBar`) a cada troca de tema, e o overlay acompanha na hora. As cores iniciais (`TITLE_BAR_COLORS`) são as dos tokens; o teste confere que continuam iguais.
- **Linux sem suporte a overlay** (alguns gerenciadores de janela): se o ajuste falhar, o erro vai para o `gitnexus-app.log`; para voltar à moldura do sistema, abra o app com `GITNEXUS_NATIVE_FRAME=1`.
- **Testes:** `apps/studio/test/title-bar.test.ts` (regras puras) e `ui-tests/tests/title-bar.mjs` (a interface com a moldura simulada por `?titlebar=overlay|inset` no harness: arrasto, margens, cores do tema). O visual dos botões nativos e o Snap Layouts do Windows 11 só se conferem num Electron real.

## Elevação, camadas e foco

Três níveis de sombra, uma escala de camadas e uma regra de foco, todos em tokens (`apps/ui-kit/src/styles/tokens.scss`), com valor nos dois temas. **Regra do marco:** as cores do sistema não mudam; sombra é só preto com transparência.

| Nível | Token | Escuro / claro | Onde usar |
|---|---|---|---|
| Grande | `--gn-shadow-lg` | `0 16px 48px`, 55% / 22% | diálogos (`GnDialog`) e paleta de comandos |
| Médio | `--gn-shadow-md` | `0 8px 28px`, 45% / 16% | menu de contexto, menu de codificação, lista do `ComboBox`, painel do `BranchPicker`, popover do `SyncButton` |
| Pequeno | `--gn-shadow-sm` | `0 4px 12px`, 35% / 10% | tooltip e item arrastado no rebase |
| Nenhum | | | linhas de lista, painéis fixos, campos, chips, badges, diff, barra superior e abas: planos, separados só por borda |

- **Fundo de overlay:** `--gn-backdrop` (50% escuro / 32% claro) atrás de diálogos e da paleta. Raios de overlay: `--gn-radius-lg` (10 px) e `--gn-radius-sm` (4 px); `--gn-radius` continua sendo o dos controles.
- **Camadas:** `--gn-z-popover` 1000, `--gn-z-dialog` 1100, `--gn-z-palette` 2000, `--gn-z-tooltip` 2100, `--gn-z-confetti` 3000. A lista do `ComboBox` usa `calc(var(--gn-z-dialog) + 1)` para abrir também de dentro de diálogos; um popover que precisa ficar acima do painel usa `calc(var(--gn-z-popover) + 1)`. Valor de 3 dígitos literal não entra.
- **Foco:** campo de texto ganha borda `--gn-accent` e o anel `--gn-ring` (`box-shadow`); botões e itens usam `outline: 2px solid var(--gn-accent)` no `:focus-visible`.
- **Entrada animada:** `gn-pop-in` para modais (diálogo e paleta) e `gn-fade-in` para o que é ancorado (menus, popovers, tooltip), sempre com a duração `--gn-enter`. Movimento reduzido já está no token (ver "Movimento").
- **Como criar:** diálogo é o `GnDialog` (nunca overlay e caixa refeitos); menu ou popover usa `--gn-shadow-md`, `--gn-radius-lg` e `animation: gn-fade-in var(--gn-enter) ease-out`; dica é o `GnTooltip` (ver "Dicas").
- **O que não fazer:** sombra em linha de lista, painel fixo, campo, chip ou diff; `box-shadow` com desfoque literal; `z-index` de 3 dígitos literal; `rgba(0, 0, 0, …)` como fundo de overlay; `z-index: var(--gn-z-dialog)` fora do `GnDialog`. Livres: `inset …` (indicador interno, como o da aba ativa e o da linha atual), `0 0 0 Npx …` (anel ou contorno) e deslocamento sem desfoque (`0 -2px 0 …`, destino do arraste no rebase).

## Dicas (GnTooltip)

A dica de um elemento é o componente `GnTooltip`, **filho** do elemento descrito (nunca em volta dele) e **sem `title` nativo** no mesmo elemento (a dica apareceria duas vezes):

```vue
<GnIconButton icon="arrow-up" label="Anterior" title="Próxima diferença (F7)" />  <!-- usa o GnTooltip por dentro -->
<button class="tab">... <GnTooltip :text="i.title ?? i.label" /></button>            <!-- uso direto -->
```

- **Comportamento:** abre com o mouse após 500 ms (sem atraso por 300 ms depois de fechar outra) e na hora com o teclado (`:focus-visible`); fecha ao sair, clicar, rolar, girar a roda, com Esc ou ao perder o foco; só uma por vez. Troca de lado perto das bordas da janela.
- **Leitura nos testes:** o pai mantém `data-tooltip` com o texto (mesmo com a dica fechada). Teste de interface lê `el.dataset.tooltip`, não `el.title`.
- **Acessibilidade:** o nome do botão continua sendo o `aria-label`; a dica só entra em `aria-describedby` quando o texto difere dele (por exemplo, quando traz o atalho). Botão só de ícone precisa de `aria-label`.
- **Controle desabilitado:** o pai com `disabled` ou `aria-disabled="true"` não mostra dica (o botão desabilitado nem recebe o mouse). Onde a dica explica **por que** está desabilitado ("Continuar" do merge, "Desfazer" do histórico de operações), o `title` nativo continua, como exceção registrada no teste de convenção.
- **Elemento sem filhos** (`<input>`, `<select>`, `<textarea>`, `<img>`): o `GnTooltip` não cabe dentro; o `title` nativo continua, como exceção registrada. Ponha o `<input>` dentro de um `<label>` com a dica quando o rótulo existir.
- **Texto:** quebras de linha (`\n`) são respeitadas e texto longo sem espaços (caminho, endereço) quebra em vez de estourar a largura máxima (280 px).
- **Onde NÃO vai um `title`:** `<ConfirmDialog :title>` é o título do diálogo, não uma dica; `GnIconButton`, `GnSegmented` (`title` do grupo e de cada opção) e `ComboBox` (`title`) já mostram o `GnTooltip` por dentro.
- **Visual:** `--gn-text` sobre `--gn-surface-2`, `--gn-shadow-sm`, `--gn-radius-sm`, `--gn-z-tooltip`, entrada em fade (`--gn-enter`).

## Campo de pesquisa (GnSearchField) e busca no arquivo

Campo de pesquisa de **texto** (procurar em arquivo, em repositório, na história) é o `GnSearchField`, não um `<input>` solto com três botões ao lado. Filtro de lista curta (branches, codificações) continua sendo um campo simples.

```vue
<GnSearchField v-model="texto" v-model:case-sensitive="aa" v-model:whole-word="ab" v-model:regex="re"
               label="Pesquisar no arquivo" :labels="{ clear, caseSensitive, wholeWord, regex }"
               :error="erroDaRegex" :history="historico" @enter="(voltar) => ir(voltar)" @escape="fechar" />
```

- **Controles dentro do campo:** ✕ (só com texto), `Aa` (diferenciar maiúsculas), `ab` (palavra inteira) e `.*` (expressão regular), botões de 24 px sem borda em repouso. O texto ocupa o que sobra ao lado deles: texto longo **não** passa por baixo dos botões.
- **Ligado não é só cor:** fundo translúcido, borda e **sublinhado**. Cada opção é `aria-pressed`, com `aria-keyshortcuts` e dica (`GnTooltip`) com o **nome e o atalho** ("Palavra inteira (Alt+O)").
- **✕** apaga o texto como uma **edição** do campo (`Ctrl+Z` traz de volta), devolve o foco ao campo e **não** mexe nas opções.
- **Atalhos das opções:** `Alt+C` (caixa), `Alt+O` (palavra inteira), `Alt+X` (regex); no macOS, `⌘+Alt`. Valem pela **tecla física**, e o **AltGr** dos teclados ABNT2/ISO (Ctrl+Alt no Windows, `AltGraph` no Linux) **nunca** é atalho, porque digita caracteres (AltGr+C é "¢" no ABNT2). Regra e testes em `search-field-core.ts`.
- **Erro de regex:** borda de erro, mensagem em `role="alert"` ligada ao campo por `aria-describedby` e `aria-invalid`; a tela passa o texto em `error` (o kit não traduz).
- **Várias linhas:** o campo é um `textarea` de uma linha que **cresce até 4** quando o texto tem quebra de linha (colar um trecho); `Enter` busca, `Shift+Enter` volta, `Esc` fecha, `↑`/`↓` percorrem o histórico (`history`, a mais nova por último).
- **`variant="replace"`:** o campo "Substituir por": só o ✕ (a substituição sempre mantém a caixa do que foi escrito).

A **barra de busca no arquivo** (`FindBar.vue`, dentro do `CodeEditor`) usa o `GnSearchField`: `Ctrl+F` com o foco no editor abre a barra **daquele** arquivo (só leitura também), preenchida pela seleção de uma linha ou pela palavra sob o cursor. Destaca **todas** as ocorrências da parte visível (a atual com contorno mais grosso), mostra "3 de 12" (`10000+` acima do limite), `Enter`/`Shift+Enter` e `F3`/`Ctrl+G` navegam dando a volta (com aviso), "Na seleção" restringe ao trecho selecionado ao abrir, e marcas na lateral mostram onde há ocorrências. O motor é o `@codemirror/search` (`SearchQuery`, em `find-core.ts`); a interface, os textos e a acessibilidade são nossos.

**Substituir** (`Ctrl+H`, `⌘⌥F` no macOS, ou o botão de alternar ao lado do campo): a segunda linha da barra tem o campo "Substituir por" (`GnSearchField variant="replace"`), **Substituir** (troca a ocorrência atual e vai para a próxima; `Enter` no campo faz o mesmo), **Todas** (uma única transação: **um** `Ctrl+Z` desfaz tudo; a contagem é anunciada na região `role="status"`), **Manter caixa**, **Selecionar todas** (`Alt+Enter`; vários cursores, e digitar troca todas) e a **prévia** da ocorrência atual. `Ctrl+Alt+Enter` substitui todas; `Ctrl+D` no editor adiciona a próxima ocorrência, um passo de cada vez. Em editor somente leitura só há busca. A regra de procurar, destacar e substituir é uma só (a `SearchQuery` do editor) e está em `replace-core.ts`:

- **modo texto:** o texto novo é literal; **modo regex:** `$1`..`$99`, `$<nome>`, `$&`, `$$` ou `\$` (cifrão literal), `\n`, `\r`, `\t` e `\\` (grupo que não existe fica literal, como no JavaScript);
- **manter a caixa:** TUDO MAIÚSCULO, minúsculo e Primeira maiúscula do trecho achado passam para o texto novo (foo→bar, Foo→Bar, FOO→BAR); outra mistura fica como digitada;
- **fim de linha do arquivo preservado:** num arquivo CRLF o editor mantém CRLF (antes a primeira edição o trocava por LF) e toda quebra do texto novo entra como CRLF; num arquivo LF, LF.

## A janela de pesquisa (renderer)

Peças do renderer (não do kit: falam com a store e o `api`) que montam o `GnSearchField` e o `GnDialog`:

| Componente | Para quê | Detalhes |
|---|---|---|
| `FindBar.vue` | Barra de pesquisa e substituição **do arquivo** aberto | dentro do `CodeEditor`; `role="search"`, contador `role="status"` ("3 de 12") |
| `SearchWindow.vue` | Janela **Pesquisar no repositório** (`Ctrl+F`, `Ctrl+Shift+F`; `Ctrl+Shift+H` com "Substituir por") | um `GnDialog` com o campo, filtros, a lista de resultados e o arquivo editável embaixo; guarda as preferências em `gitnexus.searchWindow` |
| `SearchFilters.vue` | Painel de filtros da janela (onde, pasta, novos, ignorados, contexto, agrupar) | só o formulário: quem refaz a busca é a janela |
| `SearchRepos.vue` | Painel **Repositórios** da janela: onde pesquisar (os do catálogo do app), atalhos Todos / Abertos nas abas / Só este e os conjuntos salvos | só o formulário (`v-model` dos ids e dos conjuntos); `aria-pressed` no atalho que bate com a seleção; contador `role="status"` ("3 de 7 escolhidos") |
| `HistorySearch.vue` | Barra compacta **Buscar na história** do Grafo (#292, uma linha): o `GnSearchField` (Aa, ab, .*), os três modos (quando entrou ou saiu, linhas alteradas, mensagem) e **Buscar**; escopo, autor, período, arquivo ou máscara e seguir renomeações ficam no popover **Filtros** (com a contagem e chips removíveis); **Ctrl+F** e **/** focam o campo no Grafo; resumo dispensável; última busca lembrada por repositório; o chip do trecho (`-L`) | só o formulário (`v-model:hits`, `v-model:active`, `v-model:running`); região `role="search"`; contador `role="status"` educado; erro `role="alert"`; o resumo "primeira vez que entrou / última que saiu" são botões; **o selo (entrou +2, saiu −3, mudou −1 +2) é sempre texto**, a cor só reforça |
| `SearchIndexBar.vue` | A linha do **índice de busca** da janela de pesquisa (situação, andamento, proposta "Acelerar as buscas neste repositório?", selo "Busca acelerada") e o diálogo (modo Automático, Sempre ou Nunca, limite de disco, criar, pausar, continuar, reconstruir, apagar) | `role="group"` nomeado; só a **mudança de situação** vai a um `role="status"` (o andamento muda a todo instante e não é anunciado); barra de progresso `role="progressbar"` com `aria-valuenow`; o selo é texto ("Busca acelerada · 2 arquivos conferidos"), não só cor; diálogo modal com o foco em "Fechar" e `Esc` fecha só ele |
| `RepoViewSwitch.vue` | O **seletor de visão** de um repositório (uma aba por repositório): Staging, Grafo / Histórico, Ferramentas e Conflitos | `role="tablist"` nomeado, `role="tab"` com `aria-selected`/`aria-controls`, setas, Home e End; só a visão ativa entra na ordem do Tab; a contagem de conflitos é texto ("Conflitos (2)"); cada visão é um `role="tabpanel"` (`aria-labelledby`) montado na primeira visita e mantido com `v-show` |

Regras de acessibilidade que valem para essa tela (e para qualquer lista de resultados parecida), todas cobertas por `search-teclado.mjs` e pelo teste de convenções:

- **Diálogo modal nomeado** (`GnDialog` com `label`), foco inicial no campo (`initial-focus`), foco preso e devolvido a quem abriu. Não use `<dialog>` nativo, `<select>` nem `<datalist>`: listas curtas são o `ComboBox`.
- **Lista virtualizada como `listbox`:** o contêiner tem `role="listbox"`, nome e `tabindex="0"`; **o foco fica no campo** e a opção ativa é `aria-activedescendant` (o `id` de uma linha que **existe no DOM**; linhas de 24 px, só as visíveis montadas). Cada `role="option"` tem `aria-label` com tudo o que a linha diz ("arquivo, linha 12: texto"), porque o trecho destacado quebra o texto em pedaços.
- **`aria-expanded` só onde há lista aberta de verdade** (histórico, filtros): o `GnDialog` entrega o `Esc` ao controle que está expandido. Linha recolhida de arquivo **não** usa `aria-expanded`: o estado vai no nome.
- **Total e contador em região viva educada** (`role="status"` + `aria-live="polite"`): "128 ocorrências em 14 arquivos · 0,2 s" e "3 de 12". Aviso que impede algo (não coube na codificação, arquivo mudou) é `role="alert"`.
- **Nada só por cor:** o trecho achado tem fundo (e na prévia do "substituir" o velho é riscado e o novo é `<ins>`), a linha selecionada tem fundo **e** barra lateral, as opções ligadas do `GnSearchField` têm fundo, borda e sublinhado.
- **Vários repositórios:** cada repositório tem um **cabeçalho** na lista (`role="option"` como as outras linhas, com o nome acessível "Repositório api, 12 ocorrências, concluído"), e o **estado vai em texto** no selo (buscando, concluído, erro, indisponível, sem Git, sem a revisão X), nunca só na cor. O **Parar** de cada repositório é um botão da linha (`tabindex="-1"`, com nome "Parar a busca em api"); o **Parar** geral da janela continua sendo o caminho do teclado. A lista de repositórios vem do catálogo, nunca de um campo de texto.
- **Medir antes de declarar pronto:** `search-window-perf.mjs` (5 mil resultados, rolagem, tarefas longas, 30 mil linhas) e `packages/git-core/test/search-run.test.ts` (20 mil arquivos); a tabela com os tempos está em `docs/USO.md`, seção "Pesquisar no repositório".

## Tela inicial: cartões, ordem e densidade

A lista de repositórios (`views/ConnectionInterface.vue`) tem **um só HTML** para as três densidades (`comfortable`, `compact`, `table`); o CSS de `.conn__list--<densidade>` muda o desenho. Quem escreve teste de interface conta com `li.repo`, `strong` (nome) e `.repo__btns button` (o primeiro é **Abrir**) em qualquer densidade.

- **As contas ficam em `home-core.ts`** (sem Vue, com `home-core.test.ts`): `sortRepos`, `filterRepos`, `nextSort`, `parseHomePrefs`. A ordem é estável (empate pelo nome) e o que ainda não tem resumo vai para o fim em qualquer direção. A escolha (ordem, direção, densidade, filtros) fica em `localStorage` (`gitnexus.home`), lida campo a campo: valor desconhecido volta ao padrão.
- **Estado em texto, nunca só cor ou ícone:** selos com texto ("1 alteração", "⚠ 1 conflito", "2 stash", "sem upstream", "em dia"), o indicador de sincronização é um `img` com o texto por extenso, e a lista tem nome acessível. Os filtros são botões com `aria-pressed`; o contador é `role="status"`.
- **Tabela:** o cabeçalho de cada coluna ordenável é um `GnButton` ghost (`aria-description` = ascending/descending). A ordem das colunas no CSS (`order`) difere da ordem do HTML, que lê melhor no cartão.
- **Desempenho com centenas de repositórios:** `content-visibility: auto` em cada cartão (o navegador só desenha o que está na tela), resumo em lotes de 6 (`SUMMARY_CONCURRENCY`) e nenhum processo do Git além do `status` e do `log -1` por repositório (`getRepoSummary` lê `FETCH_HEAD` e o registro do stash direto dos arquivos). `home-200.mjs` mede e grava `medidas-home-200.json`.
- **Menu "mais":** `ContextMenu` com `focus-first` (o foco vai ao primeiro item, as setas, Home e End percorrem, Esc fecha e o foco volta ao botão). `GnSegmented` agora move o foco junto com a seleção quando se usa as setas.

## Ferramentas: menu lateral com grupos

`views/ToolsView.vue` tem o mesmo desenho do menu das Configurações: um `tablist` **vertical** (`aria-orientation="vertical"`) com `role="group"` por grupo, `role="tab"` por ferramenta e só a ativa no Tab (as setas, Home e End percorrem e trocam a ferramenta; o botão "Mais ferramentas" entra na ordem das setas). O painel é o `role="tabpanel"` `#tools-panel`, com o nome da ferramenta.

- **Dados do repositório:** `getToolsUsage(repoPath)` (git-core, `tools-usage.ts`) responde `{ lfs, submodules, submodulesPending, stash }` sem rede: lê o `.gitattributes` da raiz (e, se ela não decide, pergunta ao Git pelos de subpastas), o `.gitmodules` e o registro do stash; só consulta `git submodule status` quando há submódulos. A visão recarrega quando `ws.versions[repo]` muda, como os painéis.
- **Ferramenta opcional** (`optional: 'lfs' | 'submodules'` em `TOOLS`): sem uso, vai para o grupo recolhido "Mais ferramentas" (`gitnexus.toolsMore`); se for a ferramenta atual ou chegar por `ws.openTools`, o grupo abre. Sem a resposta do `getToolsUsage`, ficam recolhidas (e ao alcance).
- **Lembrança:** `gitnexus.toolsSection.<repoId>` (cai na chave global antiga se não houver).
- **Nomes longos quebram em duas linhas** no menu; nada de reticências. O painel tem largura de leitura (`.tools__panel`, 1280 px).
- Teste de interface: `ferramentas-grupos.mjs` (os painéis individuais seguem nos seus testes, que abrem pela paleta).

## Log do Git: origem dos comandos

- **Origem:** cada `GitCommandEvent` leva `origin: 'user' | 'background'`. O runner (`git-core/runner.ts`) a lê de um `AsyncLocalStorage` (`withGitOrigin`), então vale para tudo o que uma chamada inicia, inclusive depois de `await` e em chamadas paralelas; sem contexto, o comando é de segundo plano. Quem decide é o worker: `worker/origin.ts` (`BACKGROUND_METHODS`, mais `fetchRepo`/`pullRepo` com `silent`) e `createHandlers` envolve cada método com `withOrigins`. O índice de busca marca os seus comandos como segundo plano por conta própria, mesmo posto para andar por uma busca sua.
- **Método novo no worker:** se o app o chama sozinho (atualiza o que se vê, responde enquanto se digita), ponha-o em `BACKGROUND_METHODS`; o teste `worker-origin.test.ts` falha se um nome da lista não existir.
- **"Minhas ações" e "erro" são contas puras** (`gitlog-core.ts`, `gitlog.test.ts`): `isMine` = origem `user` ou comando que altera; `isError` = falhou e é meu (código -1 sem saída é cancelamento, não erro). A store (`stores/gitlog.ts`) conta ações, segundo plano e erros novos por repositório.
- **Painel** (`components/GitLogPanel.vue`): filtro `GnSegmented` (lembrado em `gitnexus.gitLogFilter`), busca por texto, ações por linha com `GnIconButton` (o botão que abre a saída tem `aria-expanded`; o status ✓/✗ é `role="img"` com texto), exportar por `<a download>` (o mesmo caminho da exportação das Configurações) e o limite em `gitnexus.gitLogMax` (Configurações > Avançado).
- **Segredos:** a máscara está no núcleo (`redactSecrets` no comando e na saída de cada evento); `git-origin.test.ts` roda comandos de verdade com token na URL e em cabeçalho e confere que nada chega ao evento.
- **Teste de interface:** `gitlog-origem.mjs`. O harness só entrega os comandos para a página numa sondagem por vez (duas sondagens com o mesmo `since` duplicavam eventos sob carga).

## Primeiro uso: passeio, folha de atalhos, dicas e "Novidades"

- **Passeio** (`TourOverlay.vue`, `stores/tour.ts`, `tour-core.ts`): os cinco passos têm um alvo `data-tour="…"` no HTML (`repos`, `views`, `commit`, `palette`, `settings`); um controle novo só entra no passeio ganhando o atributo e um passo em `TOUR_STEPS`. O cartão é um `role="dialog"` com `aria-modal="false"` (não bloqueia): o fundo é `pointer-events: none`, só o cartão recebe o mouse; o Tab circula entre os botões dele; Esc pula; o foco volta a quem o tinha. O estado é `gitnexus.tour` (`{ done, step }`). Começa sozinho só com `shouldAutoStart` (catálogo lido e vazio, idioma escolhido, não terminado). **No harness** (`lib.mjs`) o passeio vem marcado como visto, senão apareceria em todo teste; `primeiro-uso.mjs` liga `gitnexus.testTour` para vê-lo de verdade.
- **Folha de atalhos** (`ShortcutsSheet.vue`, `shortcuts-sheet-core.ts`): lê `useCommandsStore().listed()`, o mesmo registro da paleta e de Configurações > Atalhos. A paleta e a folha são comandos (`app.palette`, `app.shortcuts`) para aparecerem na própria folha e entrarem na checagem de conflito ao remapear. `?` abre fora de `input`, `textarea`, editores de código e conteúdo editável (`questionMarkOpensSheet`). Comando novo aparece na folha sozinho.
- **Dicas** (`stores/tips.ts`, `tips-core.ts`, `TipNote.vue`): `offer()` só mostra se a dica não foi dispensada (`gitnexus.tipsDismissed`) e se ainda não houve uma na sessão. Dica nova = uma avaliação em `evaluate` (barata: sem Git quando não há o que mostrar) e um id.
- **Novidades** (`changelog-new-core.ts`): `gitnexus.changelogSeen` guarda a última versão cujas notas foram vistas; `newVersions` compara versões (pré-lançamento antes da estável).
- Testes: `primeiro-uso-core.test.ts` (unidade), `primeiro-uso.mjs`, `atalhos-folha.mjs`, `dicas-contextuais.mjs`.

## Grafo: a lista de commits

- **Contas puras** em `graph-core.ts` (com `graph-core.test.ts`): colunas gravadas (`parseColumnPrefs`), `fitColumns` (quais colunas cabem), `laneMetrics`, `parseRefs`/`abbreviateChips` (a classe do chip depende da lista de remotos: `feat/x` é local e `origin/x` é remota), `avatarOf`, `commitState`, `visibleRange` e `scrollToRow` (lista virtual). `LANE_COLORS` tem uma paleta por tema, com o contraste medido no teste contra os fundos de `tokens.scss`.
- **Dados** (git-core): `getHistory(repo, limit, skip)` devolve uma página `--topo-order` com `authorEmail` e, se há remotos, `local` (o commit que nenhum remoto alcança). `createGraphBuilder()` calcula as lanes **aos poucos** (`append` por página) e dá o mesmo desenho que `buildGraph` de uma vez; um teste monta 100 mil commits em páginas de 2000 e confere que cada página é rápida.
- **A lista** (`views/GraphView.vue`) é um `listbox` com `aria-activedescendant`, uma grade CSS compartilhada pelo cabeçalho e pelas linhas, e janela virtual (`transform: translateY`). A rolagem atualiza a janela **no próprio evento** (sem `requestAnimationFrame`, que o navegador pausa com a página em segundo plano). Nos testes de interface, a lista é virtual: só as linhas da janela existem no DOM (`search-historia.mjs` percorre a rolagem para juntar todas).
- **Filtros do Grafo** (#294): o núcleo `git-core/history-filter.ts` (`HistoryFilter`, `buildLogArgs`) traduz os filtros para o `git log` (`--author` com `--regexp-ignore-case`, `--since`/`--until` grudados na opção, `--no-merges`, `--branches`/`--remotes`/`--tags`, `--not --remotes`, `--parents`, `--topo-order`/`--date-order`, `--simplify-by-decoration`, caminho depois do `--` como `:(literal)`), com `isSafeRevision`/`cleanFolder` da pesquisa; valor inválido volta como erro antes de chegar ao Git. `getHistory(repo, limit, skip, filter)` (sem filtro, todas as referências, como antes), `getHistoryCount` (o "N de M") e `getAuthors` (autocompletar) são métodos de segundo plano do worker. `graph-filter-core.ts` guarda o estado (por repositório, lido com tolerância), os chips, o período e os favoritos; `GraphFilters.vue` é o botão com selo, os chips (`role="list"`) e o painel não modal (`role="dialog"`, Esc fecha e devolve o foco, Tab preso). Testes: `grafo-filtros.test.ts` (Git de verdade, oráculos independentes), `graph-filter-core.test.ts` e `grafo-filtros.mjs`. **Não medido nesta entrega:** a primeira página com "Branch atual" em 100 mil commits (meta de 500 ms da #294).
- **Detalhe fixo e comparação** (#293, #295): `commit-detail-core.ts` (divisão lista|detalhe e sua memória, filtro e agrupamento por pasta, barra de +/−, `Lru` dos últimos 20 commits, `Visited` do Alt+←, trechos do diff) com `commit-detail-core.test.ts`; `CommitDetailPane.vue` (cabeçalho, pais, assinatura, "onde está", arquivos, diff; `aria-live="polite"` anuncia a troca de commit; só o último pedido chega ao Git, com pausa de 120 ms), `CommitFiles.vue` (`listbox`: ↑ ↓ trocam o arquivo; estado e contagem em TEXTO, a barra é `aria-hidden`), `DiffPre.vue` (região com `]` `[` `n` `p`; corte em 300 mil caracteres) e `ComparePanel.vue` (abas, erro em `role="alert"`). No git-core: `getCommitDetail` (renomeação com `oldPath`, `added`/`removed`/`binary` por arquivo, assinatura `%G?`), `getCommitRefs`, `compareRevisions` e `getCompareFileDiff` (`compare.ts`; revisão por `isSafeRevision` e `rev-parse --verify`, hashes na hora do diff; limites de 1000 commits e 5000 arquivos com aviso). Testes: `comparar-revisoes.test.ts` (Git de verdade: `git log a..b`, `git diff a...b` e `a b`, `--numstat`, renomeação, binário, merge, arquivo de 20 mil linhas) e `detalhe-comparar.mjs`. **Não incluído:** diff lado a lado e palavra por palavra no detalhe, colapsar arquivos no diff, Criar PR/MR e cherry-pick de vários commits a partir da comparação, prévia de merge (depende da #298), entradas pelo seletor de branch e pela lista de tags.
- Teste de interface: `grafo-lista.mjs`. **Não medido nesta entrega:** a rolagem de 100 mil commits num repositório real a 60 quadros por segundo e a primeira página em 300 ms (o custo de `--topo-order` num repositório enorme depende do `commit-graph`); a parte de cálculo está medida em unidade.

## Como criar um componente do kit

1. Nome `Gn` + substantivo, em `apps/ui-kit/src/components/`, exportado em `src/index.ts`.
2. Sem acesso a i18n, stores ou `api`: textos entram por prop ou slot.
3. Só tokens (`--gn-*`); nenhuma cor fixa, exceto o texto sobre preenchimento sólido, que já tem teste de contraste.
4. Props tipadas, `aria` e teclado no que for interativo.
5. Teste em `apps/ui-kit/test/` (regras estáticas e contraste) e, para comportamento, o teste de interface em `apps/studio/scripts/ui-tests/`.

## O que impede regressão

`apps/studio/test/ui-conventions.test.ts` reprova `<button>` cru novo nas telas, `<input type="search">`/`role="searchbox"` cru novo (campo de busca é o `GnSearchField`), o CSS de seletor copiado, emoji como ícone e "Atualizar" colorido. A lista de exceções ali tem o motivo de cada uma e só deve encolher.

Também trava a **elevação, as camadas e o foco** (bloco `elevação, camadas e foco`): `box-shadow` com desfoque só por `var(--gn-shadow-*)`, nenhum `z-index` literal de 3 dígitos ou mais, nenhum `background: rgba(0, 0, 0, …)` literal (use `var(--gn-backdrop)`), `z-index: var(--gn-z-dialog)` só no `GnDialog` e os tokens de sombra e de fundo definidos nos dois temas. E as **dicas** (bloco `dicas vêm do GnTooltip`): nenhum `title=` nativo em elemento ou componente das telas, fora das exceções registradas com o motivo. As mensagens apontam o arquivo e o token certo; o `apps/ui-kit/test/tokens.test.ts` segue congelando os valores de cor.

O mesmo arquivo trava a **tipografia** (bloco `tipografia`): `font-family` e `font:` só com token (`var(--gn-font-ui)`, `var(--gn-font-code)`, `var(--gn-mono)` ou `inherit`), `fontFamily` em JavaScript só com `var(--gn-*)`, nenhuma fonte de fora, `@font-face` só em `fonts.scss` e ligaduras só pelo token. A mensagem de erro aponta o arquivo e o token certo. Os dois arquivos que podem nomear famílias (`tokens.scss` e `fonts.scss`) estão listados ali com o motivo. O `apps/ui-kit/test/fonts.test.ts` confere os arquivos da fonte (assinatura e SHA-256) e o `typography.test.ts`, os tokens e os atributos.
