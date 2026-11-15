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
| Estado | `conflito`, `bloqueado`, `desatualizada` | estado do PR |

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

## Donos do código (CODEOWNERS)

`.github/CODEOWNERS` pede a revisão do dono sempre que um PR muda arquivos da área. Hoje é uma pessoa só; ao entrar mais gente, troque pelo time de cada área.
A revisão do dono **não é obrigatória** (para isso, ative *Require review from Code Owners* no ruleset da `main`), e o autor do PR nunca é pedido como revisor do próprio PR.

## Templates de issue

`.github/ISSUE_TEMPLATE/` tem **formulários** (issue forms) em vez de texto livre: campos obrigatórios, listas de escolha e labels aplicadas sozinhas.
A issue em branco está desligada (`config.yml`): toda issue passa por um formulário. O que a lista do Beekeeper Studio (4 modelos em Markdown) e a nossa têm em comum
são bug, funcionalidade, documentação e pergunta; o que é nosso: desempenho (dependente do tamanho do repositório) e idioma (i18n).

| Formulário | Título | Labels | O que pede de especial |
|---|---|---|---|
| 🐛 Defeito (`bug.yml`) | `bug: ` | `bug`, `triagem` | passos, versão do app (*Ferramentas → Versão e changelog*), sistema, **forma de instalação** (instalador, ZIP, winget, AppImage, deb, rpm, Flatpak…), versão do Git e o **log de comandos** do painel (Ctrl+Shift+L) |
| ⚡ Lentidão ou travamento (`desempenho.yml`) | `perf: ` | `performance`, `triagem` | **tamanho do repositório** (arquivos rastreados, commits, `.git`), onde trava, se o app volta, máquina e disco |
| ✨ Funcionalidade (`funcionalidade.yml`) | `feat: ` | `enhancement`, `triagem` | problema antes da solução, alternativas, área do app e se a pessoa pode testar o beta |
| 📚 Documentação (`documentacao.yml`) | `docs: ` | `documentation`, `triagem` | onde está (arquivo ou link) e o tipo do problema |
| 🌐 Idioma ou tradução (`idioma.yml`) | `i18n: ` | `idioma`, `triagem` | idioma novo, correção ou texto sem tradução; liga a [docs/I18N.md](I18N.md) |
| ❓ Pergunta (`pergunta.yml`) | `pergunta: ` | `question`, `triagem` | o que a pessoa quer fazer e o que já tentou |

Toda issue nasce com **`triagem`** (ainda não analisada). Tire a label quando ela for lida e classificada: o filtro `is:issue is:open label:triagem` é a fila de trabalho.
O prefixo do título acompanha os tipos do Conventional Commits (`bug`, `feat`, `docs`, `perf`), o que facilita transformar uma issue em branch e em PR (`fix/…`, `feat/…`).

Quando o repositório ficar público: ative *Private vulnerability reporting* e acrescente o atalho de segurança no `config.yml` (o comentário no arquivo lembra).

## Branch desatualizada

O workflow **Atraso dos PRs** (`pr-behind.yml`) marca com `desatualizada` o PR que **não tem commits novos da `main`** e tira a label quando a branch é atualizada (merge ou rebase da `main`).
Roda a cada push na `main` e a cada PR aberto ou atualizado.

- **É um aviso, não uma trava.** O repositório é privado no plano gratuito, sem ruleset, então nada impede o merge de um PR desatualizado. A trava de verdade é a regra
  *Require branches to be up to date before merging* do ruleset da `main`, disponível quando o repositório ficar público (ou com GitHub Pro).
- **O que conta:** só commits com conteúdo novo. Ficam de fora os **commits de merge** (o conteúdo deles já está nos commits que juntaram; sem isso, em uma pilha de PRs, o merge do de
  baixo marcaria todos os de cima) e o **`chore(release)`** que o pipeline grava depois de cada release (sem isso, todo PR ficaria marcado a cada release).
- **Atenção a pilhas:** com *Require up to date* ligado no futuro, cada merge deixa os PRs restantes atrás da `main` e cada um precisaria ser atualizado e passar o CI de novo
  (Windows e empacotamento inclusos). Em pilha longa isso é caro; vale decidir quando o ruleset existir.
- Para simular: `GITHUB_REPOSITORY=dono/repo node scripts/pr-behind.mjs --dry-run`.
