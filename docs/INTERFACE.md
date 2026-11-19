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

## Dicas (GnTooltip)

A dica de um elemento é o componente `GnTooltip`, **filho** do elemento descrito (nunca em volta dele) e **sem `title` nativo** no mesmo elemento (a dica apareceria duas vezes):

```vue
<GnIconButton icon="arrow-up" label="Anterior" title="Próxima diferença (F7)" />  <!-- usa o GnTooltip por dentro -->
<button class="tab">... <GnTooltip :text="i.title ?? i.label" /></button>            <!-- uso direto -->
```

- **Comportamento:** abre com o mouse após 500 ms (sem atraso por 300 ms depois de fechar outra) e na hora com o teclado (`:focus-visible`); fecha ao sair, clicar, rolar, girar a roda, com Esc ou ao perder o foco; só uma por vez. Troca de lado perto das bordas da janela.
- **Leitura nos testes:** o pai mantém `data-tooltip` com o texto (mesmo com a dica fechada). Teste de interface lê `el.dataset.tooltip`, não `el.title`.
- **Acessibilidade:** o nome do botão continua sendo o `aria-label`; a dica só entra em `aria-describedby` quando o texto difere dele (por exemplo, quando traz o atalho). Botão só de ícone precisa de `aria-label`.
- **Controle desabilitado:** o pai com `disabled` ou `aria-disabled="true"` não mostra dica. Onde a dica explica **por que** está desabilitado, a migração (#162) decide por caso (pode manter o `title` nativo).
- **Visual:** `--gn-text` sobre `--gn-surface-2`, `--gn-shadow-sm`, `--gn-radius-sm`, `--gn-z-tooltip`, entrada em fade (`--gn-enter`).

## Como criar um componente do kit

1. Nome `Gn` + substantivo, em `apps/ui-kit/src/components/`, exportado em `src/index.ts`.
2. Sem acesso a i18n, stores ou `api`: textos entram por prop ou slot.
3. Só tokens (`--gn-*`); nenhuma cor fixa, exceto o texto sobre preenchimento sólido, que já tem teste de contraste.
4. Props tipadas, `aria` e teclado no que for interativo.
5. Teste em `apps/ui-kit/test/` (regras estáticas e contraste) e, para comportamento, o teste de interface em `apps/studio/scripts/ui-tests/`.

## O que impede regressão

`apps/studio/test/ui-conventions.test.ts` reprova `<button>` cru novo nas telas, o CSS de seletor copiado, emoji como ícone e "Atualizar" colorido. A lista de exceções ali tem o motivo de cada uma e só deve encolher.

O mesmo arquivo trava a **tipografia** (bloco `tipografia`): `font-family` e `font:` só com token (`var(--gn-font-ui)`, `var(--gn-font-code)`, `var(--gn-mono)` ou `inherit`), `fontFamily` em JavaScript só com `var(--gn-*)`, nenhuma fonte de fora, `@font-face` só em `fonts.scss` e ligaduras só pelo token. A mensagem de erro aponta o arquivo e o token certo. Os dois arquivos que podem nomear famílias (`tokens.scss` e `fonts.scss`) estão listados ali com o motivo. O `apps/ui-kit/test/fonts.test.ts` confere os arquivos da fonte (assinatura e SHA-256) e o `typography.test.ts`, os tokens e os atributos.
