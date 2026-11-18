# Componentes e regras da interface

Tudo o que é botão, seletor, ícone, etiqueta e aba vem do **ui-kit** (`apps/ui-kit`, pacote `@git-nexus/ui-kit`), com o prefixo `Gn`. As telas montam; não refazem. Quem precisa de algo que o kit não tem **cria o componente no kit** em vez de estilizar na tela.

## Catálogo

| Componente | Para quê | Detalhes |
|---|---|---|
| `GnButton` | Botão com texto | `variant` (preenchimento: `primary` sólido, `ghost` leve) e `tone` (cor: `neutral`, `accent`, `success`, `warn`, `danger`), `size` `sm`/`md` |
| `GnIconButton` | Botão só de ícone | `icon` e `label` **obrigatório** (vira `aria-label` e tooltip); leve por padrão |
| `GnButtonGroup` | Par ou conjunto de botões colados | anterior/próximo; serve para `GnButton` e `GnIconButton` |
| `GnSegmented` | Escolher **uma** opção entre poucas | `v-model`, `options`, teclado e `aria` prontos; ativo em azul tingido |
| `GnDialog` | Diálogo modal | overlay, caixa com elevação, foco preso, Esc, clique no fundo, foco devolvido e fundo inerte; `width`, `maxHeight`, `role`, `labelledby`/`label`, `describedby`, `dismissable`, `initialFocus`; emite `close` (`'escape'` ou `'backdrop'`) o Esc fecha antes uma lista aberta de dentro (combobox) e o pai segue dono do estado (`v-if`); `isDialogOpen()` diz se há algum aberto |
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

## Como criar um componente do kit

1. Nome `Gn` + substantivo, em `apps/ui-kit/src/components/`, exportado em `src/index.ts`.
2. Sem acesso a i18n, stores ou `api`: textos entram por prop ou slot.
3. Só tokens (`--gn-*`); nenhuma cor fixa, exceto o texto sobre preenchimento sólido, que já tem teste de contraste.
4. Props tipadas, `aria` e teclado no que for interativo.
5. Teste em `apps/ui-kit/test/` (regras estáticas e contraste) e, para comportamento, o teste de interface em `apps/studio/scripts/ui-tests/`.

## O que impede regressão

`apps/studio/test/ui-conventions.test.ts` reprova `<button>` cru novo nas telas, o CSS de seletor copiado, emoji como ícone e "Atualizar" colorido. A lista de exceções ali tem o motivo de cada uma e só deve encolher.
