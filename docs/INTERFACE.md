# Componentes e regras da interface

Tudo o que é botão, seletor, ícone, etiqueta e aba vem do **ui-kit** (`apps/ui-kit`, pacote `@git-nexus/ui-kit`), com o prefixo `Gn`. As telas montam; não refazem. Quem precisa de algo que o kit não tem **cria o componente no kit** em vez de estilizar na tela.

## Catálogo

| Componente | Para quê | Detalhes |
|---|---|---|
| `GnButton` | Botão com texto | `variant` (preenchimento: `primary` sólido, `ghost` leve) e `tone` (cor: `neutral`, `accent`, `success`, `warn`, `danger`), `size` `sm`/`md` |
| `GnIconButton` | Botão só de ícone | `icon` e `label` **obrigatório** (vira `aria-label` e tooltip); leve por padrão |
| `GnButtonGroup` | Par ou conjunto de botões colados | anterior/próximo; serve para `GnButton` e `GnIconButton` |
| `GnSegmented` | Escolher **uma** opção entre poucas | `v-model`, `options`, teclado e `aria` prontos; ativo em azul tingido |
| `GnDialog` | Diálogo modal | overlay, caixa com elevação, foco preso, Esc, clique no fundo, foco devolvido e fundo inerte; `width`, `maxHeight`, `role`, `labelledby`/`label`, `describedby`, `dismissable`, `initialFocus`; emite `close` (`'escape'` ou `'backdrop'`) e o pai segue dono do estado (`v-if`); `isDialogOpen()` diz se há algum aberto |
| `GnIcon` | Ícone decorativo | `name` (ver `components/icons.ts`); herda a cor do texto; sem `v-html` |
| `GnBadge` | Etiqueta de estado | `tone` com o mesmo vocabulário do botão |
| `GnTabs` | Abas de documentos | usado na barra principal e em Ferramentas |

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

## Como criar um componente do kit

1. Nome `Gn` + substantivo, em `apps/ui-kit/src/components/`, exportado em `src/index.ts`.
2. Sem acesso a i18n, stores ou `api`: textos entram por prop ou slot.
3. Só tokens (`--gn-*`); nenhuma cor fixa, exceto o texto sobre preenchimento sólido, que já tem teste de contraste.
4. Props tipadas, `aria` e teclado no que for interativo.
5. Teste em `apps/ui-kit/test/` (regras estáticas e contraste) e, para comportamento, o teste de interface em `apps/studio/scripts/ui-tests/`.

## O que impede regressão

`apps/studio/test/ui-conventions.test.ts` reprova `<button>` cru novo nas telas, o CSS de seletor copiado, emoji como ícone e "Atualizar" colorido. A lista de exceções ali tem o motivo de cada uma e só deve encolher.

O mesmo arquivo trava a **tipografia** (bloco `tipografia`): `font-family` e `font:` só com token (`var(--gn-font-ui)`, `var(--gn-font-code)`, `var(--gn-mono)` ou `inherit`), `fontFamily` em JavaScript só com `var(--gn-*)`, nenhuma fonte de fora, `@font-face` só em `fonts.scss` e ligaduras só pelo token. A mensagem de erro aponta o arquivo e o token certo. Os dois arquivos que podem nomear famílias (`tokens.scss` e `fonts.scss`) estão listados ali com o motivo. O `apps/ui-kit/test/fonts.test.ts` confere os arquivos da fonte (assinatura e SHA-256) e o `typography.test.ts`, os tokens e os atributos.
