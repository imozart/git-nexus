# Automação do repositório: bots, merge automático, betas e versão

## Como os "bots" do GitHub funcionam

Quase todo "bot" é uma destas duas coisas:

| O que é | Exemplos | Como age |
|---|---|---|
| **Workflow do GitHub Actions** | `github-actions[bot]` (assina as releases, comenta, faz commits), nossos `release.yml`, `ci.yml`, `codeql.yml` | roda quando algo acontece (push, PR, agenda, botão) com o `GITHUB_TOKEN` do repositório |
| **GitHub App** | `dependabot[bot]`, Renovate, release-please | serviço externo instalado no repositório; abre PRs e comenta com a própria identidade |

Nenhum deles "decide" sozinho além do que você configurou: um bot só abre PR, e quem aceita é a regra de proteção da branch.

## Merge automático (como funciona e o que o projeto faz)

> O Dependabot e o workflow de merge automático chegam com o PR de preparação do repositório público (`.github/dependabot.yml`,
> `dependabot-automerge.yml`, `PUBLISHING_CHECKLIST.md`). Esta página já descreve o conjunto.

1. O **Dependabot** (`.github/dependabot.yml`) abre PRs semanais de atualização de dependências e de actions.
2. O workflow `dependabot-automerge.yml` olha o PR (`dependabot/fetch-metadata`) e, se for **patch ou minor**, liga o **auto-merge** do GitHub
   (`gh pr merge --auto`). Atualizações **major** e o **Electron** ficam para você revisar.
3. O auto-merge **não** junta na hora: o GitHub espera as verificações **obrigatórias** do ruleset da `main` (CI no Ubuntu e no Windows e
   CodeQL) ficarem verdes. Se alguma falhar, o PR fica aberto. Por isso o ruleset precisa existir antes (veja `PUBLISHING_CHECKLIST.md`). Ligue o recurso com `gh repo edit imozart/git-nexus --enable-auto-merge --delete-branch-on-merge`.
4. Depois do merge, o pipeline de release **não** gera uma versão nova só por causa de `ci(deps)` ou `chore(deps-dev)` (dependência de
   desenvolvimento e actions); bumps de dependências de runtime (`chore(deps)`) viram release normalmente.

O mesmo mecanismo serve para qualquer PR: `gh pr merge --auto --merge <PR>` em um PR seu faz o GitHub juntá-lo sozinho quando o CI passar.

Outras automações que cabem aqui, se um dia fizerem falta (nenhuma está ligada): fechar issues paradas (`actions/stale`), etiquetar PRs por pasta
(`actions/labeler`), rascunho de notas (já geramos as notas a partir dos Conventional Commits em `scripts/release-info.mjs`).

## Releases e betas

- **Estável:** cada merge na `main` calcula a versão pelos Conventional Commits (`feat` → minor, `fix` e o resto → patch, `!` → major),
  compila os 6 pacotes, publica a release e **só então** grava a versão no código (próxima seção).
- **Beta:** *Actions → Release → Run workflow → channel = beta*. Sai `vX.Y.Z-beta.N`, onde `X.Y.Z` é a estável que sairia agora e `N` conta os betas
  dessa base (`1.3.0-beta.1`, `1.3.0-beta.2`…). É publicada como **pré-lançamento**: não vira "última versão", não gera manifestos de
  winget/Scoop/Homebrew/Flathub e **não aparece como atualização no app** (a verificação consulta só a última release estável).
- Para ter betas sem apertar o botão, acrescente ao `release.yml` um gatilho `schedule` (por exemplo toda sexta) chamando o mesmo job com `channel=beta`.
  Não está ligado: um beta por agenda sem mudança nenhuma só gera ruído.
- O beta usa o mesmo pipeline do estável (typecheck, testes, 6 builds, SHA-256, assinatura). Ainda não foi exercitado no GitHub: o primeiro
  disparo manual é o teste (se algum pacote, como o `.rpm`, recusar a versão com `-beta`, só o beta falha e nada estável é afetado).

## A versão no `package.json`

### Como o Beekeeper Studio faz

No commit citado, `chore: bump version to 6.3.0-beta.0`, uma pessoa muda o campo `version` do `apps/studio/package.json` e depois empurra a tag
`v6.3.0-beta.0`. O workflow de publicação (`studio-publish.yml`) dispara pela **tag**, e dali a **versão do `package.json` é a fonte da verdade**:
o canal (`latest`, `beta`, `alpha`) é extraído dela (`extract_channel.sh`), o electron-builder grava os arquivos de atualização por canal, e o
`github-actions[bot]` publica a release (a de `v6.3.0-beta.0` aparece como pré-lançamento). A versão é decidida por humanos, antes.

### Como o GitNexus faz

O caminho é o inverso: a versão é **calculada pelo CI** (tag anterior + Conventional Commits) e injetada no build
(`electron-builder -c.extraMetadata.version=…`). Ninguém edita versão à mão. Isso evita commit de bump e conflito, mas deixava o código
mentindo: o `package.json` continuava em `1.0.0` com a release em `1.1.x`.

**Impacto de não gravar a versão no código:**

- quem compila a partir da `main` ou de uma tag (distribuições Linux, forks, `pnpm dev`) obtém um app que se declara `1.0.0`;
- esse app acha que **sempre há atualização** (compara `1.0.0` com a última release) e mostra o aviso para quem não instalou pelo pacote oficial;
- `git checkout vX.Y.Z` não reproduz a versão da tag, e o histórico do `package.json` não conta quando cada versão saiu.

O pacote oficial **não** é afetado (a versão é injetada no build), por isso nunca foi um defeito visível para quem baixa a release.

### O que foi implementado

Depois de publicar uma release **estável**, o job `sync-version` (`release.yml`) roda `scripts/bump-version.mjs`, que grava a versão em todos os
`package.json` do monorepo, e faz o commit `chore(release): vX.Y.Z [skip release]` na `main`:

- `[skip release]` evita um laço (o commit não dispara outra release) e o cálculo de versão/notas **ignora** commits `chore(release)`;
- betas não gravam versão (ficam só na tag);
- o commit vai direto para a `main`; se o ruleset a protege (exige PR), é preciso o secret `RELEASE_PUSH_TOKEN` e o bypass descritos abaixo.
  Sem eles o job apenas avisa e a release continua publicada (a versão no `package.json` só fica defasada);
- a tag aponta para o commit **da release** (antes do bump). O commit `chore(release)` vem logo depois.

### Configurar o `RELEASE_PUSH_TOKEN` (só se a `main` exige pull request)

1. Na sua conta: *Settings → Developer settings → Fine-grained tokens*, repositório `imozart/git-nexus`, permissão **Contents: Read and write**.
2. No repositório: *Settings → Secrets and variables → Actions → New repository secret* → `RELEASE_PUSH_TOKEN`.
3. No ruleset da `main` (*Settings → Rules → Rulesets → main → Bypass list*): adicione **Repository admin** (a sua conta, dona do token, está nesse papel).

Rodar à mão (por exemplo para acertar a versão agora): `node scripts/bump-version.mjs --version 1.1.0` (`--dry` só mostra o que mudaria).
