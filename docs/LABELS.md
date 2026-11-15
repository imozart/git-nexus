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
