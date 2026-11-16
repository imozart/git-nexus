# Automação do repositório: bots, merge automático, betas e versão

## Como os "bots" do GitHub funcionam

Quase todo "bot" é uma destas duas coisas:

| O que é | Exemplos | Como age |
|---|---|---|
| **Workflow do GitHub Actions** | `github-actions[bot]` (assina as releases, comenta, faz commits), nossos `release.yml`, `ci.yml`, `codeql.yml` | roda quando algo acontece (push, PR, agenda, botão) com o `GITHUB_TOKEN` do repositório |
| **GitHub App** | `dependabot[bot]`, Renovate, release-please | serviço externo instalado no repositório; abre PRs e comenta com a própria identidade |

Nenhum deles "decide" sozinho além do que você configurou: um bot só abre PR, e quem aceita é a regra de proteção da branch.

## Merge automático (como funciona e o que o projeto faz)

> O **Dependabot** (`.github/dependabot.yml`) e o workflow de **merge automático** (`dependabot-automerge.yml`) estão ligados. O auto-merge só faz sentido porque o
> ruleset da `main` exige os checks (lista em [REPOSITORIO](REPOSITORIO.md)): sem eles o GitHub juntaria na hora.

1. O **Dependabot** (`.github/dependabot.yml`) abre PRs semanais (segunda, 09:00 de Brasília) de atualização de dependências e de actions, agrupados
   (`codemirror`, `vue`, `electron`, `ferramentas`, `actions`), com espera de 7 dias depois do lançamento de cada versão (`cooldown`) e a label `dependências`.
   Os títulos seguem o Conventional Commits: `chore(deps-dev)` para dependências de desenvolvimento e `ci(deps)` para actions; `build(deps)` ficaria para
   dependência de produção (hoje não há nenhuma: o Vite empacota tudo, então tudo, inclusive Vue e CodeMirror, é de desenvolvimento).
2. O workflow `dependabot-automerge.yml` olha o PR (`dependabot/fetch-metadata`) e, se for **patch ou minor**, liga o **auto-merge** do GitHub
   (`gh pr merge --auto`). Atualizações **major** e o **Electron** ficam para você revisar.
3. O auto-merge **não** junta na hora: o GitHub espera as verificações **obrigatórias** do ruleset da `main` (os 10 checks de [REPOSITORIO](REPOSITORIO.md): CI no Ubuntu e no Windows,
   cobertura, empacotamento, fumaça, interface, título, segredos e lint dos workflows) ficarem verdes. Se alguma falhar, o PR fica aberto. O merge é um **merge commit**, e o recurso
   *Allow auto-merge* já está ligado (`gh repo edit imozart/git-nexus --enable-auto-merge`). PRs que o Dependabot já abriu antes deste workflow só entram no fluxo quando recebem um push novo (`@dependabot rebase`).
4. Depois do merge, o pipeline de release **não** gera uma versão nova só por causa de `ci(deps)` ou `chore(deps-dev)`: atualização de dependência não é mudança do
   app. Ela entra na próxima release de verdade (e no `CHANGELOG.md` dela). Só `build(deps)` (produção) publica sozinho. Consequência: uma correção de segurança
   em Vue ou CodeMirror só chega ao usuário na próxima release; para ela sair já, use *Actions → Release → Run workflow* (a execução manual sempre publica).

O mesmo mecanismo serve para qualquer PR: `gh pr merge --auto --merge <PR>` em um PR seu faz o GitHub juntá-lo sozinho quando o CI passar.

Outras automações que cabem aqui, se um dia fizerem falta (nenhuma está ligada): fechar issues paradas (`actions/stale`), etiquetar PRs por pasta
(`actions/labeler`), rascunho de notas (já geramos as notas a partir dos Conventional Commits em `scripts/release-info.mjs`).

## Releases e betas

- **Estável:** o merge na `main` calcula a versão pelos Conventional Commits (`feat` → minor, `fix` e o resto → patch, `!` → major),
  compila os 6 pacotes, publica a release e **só então** grava a versão no código (próxima seção).
- **Nem todo merge publica.** Só gera versão quando algum commit desde a última tag **muda o app**: `feat`, `fix`, `perf`, `refactor`, `build` (inclui
  dependências de produção), breaking (`!`/`BREAKING CHANGE`) ou commit fora do padrão (não dá para saber o que faz). Um merge só de `docs`, `test`, `ci`, `style`
  ou `chore` não gera versão, instaladores nem aviso de atualização: o job "Calcular versão" registra um aviso ("Sem release") e o resto é pulado. Esses commits não
  se perdem: ficam depois da última tag e entram no `CHANGELOG.md` da próxima release de verdade. Regra em `scripts/lib/release-core.mjs` (`shouldRelease`).
  A execução manual (*Run workflow*) **sempre** publica. Para pular um merge, use a label `sem-release` no PR ou `[skip release]` na mensagem do merge ([LABELS](LABELS.md#pular-a-release-de-um-pr)).
- **Beta:** *Actions → Release → Run workflow → channel = beta*. Sai `vX.Y.Z-beta.N`, onde `X.Y.Z` é a estável que sairia agora e `N` conta os betas
  dessa base (`1.3.0-beta.1`, `1.3.0-beta.2`…). É publicada como **pré-lançamento**: não vira "última versão", não gera manifestos de
  winget/Scoop/Homebrew/Flathub e **não aparece como atualização no app** (a verificação consulta só a última release estável).
- **Beta agendado:** toda **segunda-feira às 11:00 UTC** (08:00 em Brasília) o `release.yml` roda com `channel=beta` e `--if-new`: só publica se houver commit que
  **muda o app** (mesma regra do estável) **depois do beta mais recente dessa versão**. Sem novidade, o job registra "Sem release" e nada é publicado, então a agenda
  nunca gera dois betas iguais. Um beta novo da mesma base sobe o contador (`1.3.1-beta.1` → `1.3.1-beta.2`).
  **Quando ele de fato dispara:** como o estável já sai a cada merge que muda o app, a agenda só tem o que publicar quando o estável **não** saiu: execução que
  falhou ou foi cancelada, ou commit com `[skip release]`. Na prática é uma rede de segurança e um canal de teste *sem esforço*, não um fluxo paralelo. Se você quiser
  betas com frequência, o caminho é mudar a política (estável semanal ou manual, beta a cada merge): é uma decisão de projeto, não só de agenda.
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

Depois de publicar uma release **estável**, o job `sync-version` do `release.yml` chama o workflow reutilizável **`release-sync.yml`**, que num commit só
`chore(release): vX.Y.Z [skip release]` na `main` grava:

1. a **versão** em todos os `package.json` do monorepo (`scripts/bump-version.mjs`);
2. a **entrada da versão no `CHANGELOG.md`** (`scripts/changelog.mjs`), montada dos commits desde a estável anterior.

Por que um arquivo separado: o registro é uma unidade com entradas e saídas próprias (a versão), roda sozinho à mão quando uma versão fica de fora
(*Actions → Registrar a release no código → Run workflow*) e tira ~40 linhas do `release.yml`.

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

## CHANGELOG.md

O `CHANGELOG.md` (formato inspirado no *Keep a Changelog*, em português) é **gerado a cada release estável**; não precisa ser editado à mão.

- **Fonte:** os mesmos commits (Conventional Commits) das notas da release, entre a estável anterior e a tag nova, com as mesmas seções.
- **O que entra: tudo.** Todo commit entre a última versão estável e a nova, de qualquer tipo (breaking, novidades, correções, performance, refatorações, documentação, testes,
  build, CI, estilo, manutenção e commits fora do padrão), agrupado por tipo na ordem das notas da release. Só o commit `chore(release)` que o próprio pipeline grava fica de fora.
  Uma versão sem nenhum commit (build manual) ganha uma linha avisando.
- **De onde vêm as linhas:** das mensagens dos commits da branch (merge commits não são lidos): `git log --no-merges`. Para o changelog ficar bom, as mensagens dos commits
  precisam seguir o Conventional Commits; o que não segue cai em *Outras alterações*.
- **Beta nunca entra.** Só versões `X.Y.Z`.
- **Seguro de repetir:** refazer uma versão com os mesmos commits gera o mesmo texto, então reexecutar o pipeline não cria commit. Só a versão do momento é refeita;
  as outras (inclusive edições feitas à mão nelas) são preservadas. O texto antes da primeira versão (título e explicação) também é preservado.
- **Se conserta sozinho:** se uma versão estável anterior não estiver no arquivo (uma release que saiu com o job desligado, por exemplo), a próxima release a completa.
- **Não bloqueia a release:** se o changelog falhar, a versão ainda é gravada e a release continua publicada; o aviso fica no log.

Comandos úteis (precisam do clone com as tags: `git fetch --tags`):

```bash
node scripts/changelog.mjs --version 1.5.0 --dry     # mostra se mudaria, sem gravar
node scripts/changelog.mjs --version 1.5.0           # acrescenta/refaz a 1.5.0 (e completa o que faltar)
node scripts/changelog.mjs --backfill --force        # refaz o arquivo inteiro a partir de todas as tags (perde edições à mão)
```
