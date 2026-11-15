# Labels, branches e PRs

Como o repositório etiqueta e organiza PRs sozinho. Cada automação é independente e pode ser desligada apagando o workflow.

## Catálogo de labels

A fonte da verdade é [`.github/labels.json`](../.github/labels.json) (nome, cor e descrição). O workflow **Sincronizar labels**
(`labels-sync.yml`) cria e atualiza as labels sempre que esse arquivo muda na `main`, ou à mão em *Actions → Sincronizar labels → Run workflow*.
Ele **nunca apaga**: label fora do catálogo continua existindo.

Para criar uma label nova: acrescente uma linha ao `labels.json` e abra o PR. Para simular antes (precisa do `gh` autenticado):

```bash
node scripts/sync-labels.mjs --dry-run --repo dono/repo
```

| Grupo | Labels | Quem aplica |
|---|---|---|
| Tipo | `enhancement`, `bug`, `documentation`, `performance`, `refatoração`, `testes`, `build`, `ci`, `estilo`, `chore`, `reversão`, `breaking change` | título do PR (Conventional Commits) |
| Área | `área: app`, `área: ui-kit`, `área: git-core`, `área: política`, `área: ci`, `área: docs`, `dependências` | pastas alteradas (`.github/labeler.yml`) |
| Tamanho | `tamanho: XS` … `tamanho: XL` | linhas alteradas |
| Estado | `conflito`, `bloqueado` | estado do PR |

As labels `release-failure`, `main-health` e `parado` são criadas pelas próprias automações que as usam.

## Label de tipo (título e branch)

O workflow **Labels do PR (tipo)** (`pr-labels.yml`) lê o título do PR e aplica a label do tipo:

| Título | Label |
|---|---|
| `feat` | `enhancement` |
| `fix` | `bug` |
| `docs` | `documentation` |
| `perf` | `performance` |
| `refactor` | `refatoração` |
| `test` | `testes` |
| `build`, `ci`, `chore` | `build`, `ci`, `chore` |
| `style` | `estilo` |
| `revert` | `reversão` |

- `!` no título (`feat(api)!: …`) ou `BREAKING CHANGE:` no início de uma linha do corpo acrescenta **`breaking change`**.
- Título sem tipo válido? Vale o **prefixo da branch** (`feat/…`, `fix/…`; `hotfix/` conta como `fix`).
- Muda o título? A label é trocada (roda também em `edited`). Só as labels deste grupo são removidas; as demais nunca são tocadas.
- Usa `pull_request_target` sem executar código do PR: o checkout é da `main` e título, branch e corpo entram só por variável de ambiente.

## Notas de release por label

`.github/release.yml` define as categorias das notas que o **próprio GitHub** gera a partir das labels dos PRs
(botão *Generate release notes* na tela de release, ou `gh release create --generate-notes`). Usa os mesmos títulos e a mesma ordem
das seções do pipeline (`scripts/lib/release-core.mjs`), e os bots (`dependabot`, `github-actions`) ficam de fora.
As notas publicadas pelo `release.yml` continuam saindo de `scripts/release-info.mjs` (lê os commits); este arquivo vale para as notas geradas pelo GitHub.

## Nome da branch

O workflow **Nome da branch** (`branch-name.yml`, check `Nome da branch (tipo/descrição)`) confere o nome da branch do PR:

- formato `tipo/descricao-curta`, em minúsculas (letras, números, `.`, `_`, `-`, e `/` para subpastas), até 60 caracteres;
- tipos aceitos: `feat`, `fix`, `hotfix` (vale como `fix`), `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `style`, `chore`, `revert`;
- o tipo da branch precisa ser o **mesmo do título** do PR (`feat/painel-de-log` com `feat(log): …`); título sem tipo válido não gera erro aqui, quem cobra é o check do título;
- `dependabot/…`, `renovate/…` e `release/…` ficam de fora.

Para tornar a regra obrigatória, acrescente o check ao ruleset da `main`.

## Tamanho do PR

O workflow **Tamanho do PR** (`pr-size.yml`) soma as linhas adicionadas + removidas e aplica **uma** label de tamanho (recalculada a cada push):

| Label | Linhas alteradas |
|---|---|
| `tamanho: XS` | até 10 |
| `tamanho: S` | 11 a 50 |
| `tamanho: M` | 51 a 200 |
| `tamanho: L` | 201 a 500 |
| `tamanho: XL` | mais de 500: considere dividir o PR |

Lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`), snapshots e arquivos `.min.js/.min.css` não entram na conta. Faixas em `scripts/lib/pr-size.mjs`.

## Conflitos

O workflow **Conflitos nos PRs** (`pr-conflicts.yml`) marca com `conflito` todo PR aberto que não dá merge limpo na `main` e tira a label quando o conflito some.
Roda a cada push na `main` (é quando os outros PRs passam a conflitar, principalmente nas pilhas) e quando um PR é aberto ou atualizado.
O GitHub calcula a mergeabilidade sob demanda: o script consulta de novo (até 6 vezes, de 5 em 5 segundos) enquanto a resposta for `UNKNOWN`, e nunca muda a label sem uma resposta definitiva.

## Pilhas de PRs (ordem de merge)

O workflow **Ordem de merge das pilhas** (`pr-stack.yml`) detecta PRs empilhados: o PR P depende do PR Q (aberto) quando a ponta da branch de Q está entre os commits de P em relação à `main`.
Para cada PR dependente ele aplica a label `bloqueado` e mantém **um** comentário com a ordem de merge (o PR atual em destaque).
A cada abertura, atualização ou fechamento de PR, **todos** os abertos são reavaliados: quando o PR de baixo é mergeado, os de cima perdem a label e o comentário sozinhos.

- A label `bloqueado` é gerenciada pela automação: ela remove quando não há mais dependência. Para um bloqueio manual, use outra label.
- O comentário é identificado por uma marca invisível no início; títulos de PR entram sem `@menção` e em uma linha só.
- Funciona com merge commit (o modo usado neste repositório). Com *squash* ou *rebase* as pontas das branches deixam de ser ancestrais depois do merge, mas isso só afeta PRs de cima que ainda não foram reescritos.
