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
