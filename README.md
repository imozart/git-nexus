# GitNexus

Gerenciador Git desktop portátil (Electron + Vue 3 + TypeScript) com linter de Conventional Commits em tempo real e resolução visual de conflitos 3-way. Arquitetura inspirada no [Beekeeper Studio](https://github.com/beekeeper-studio/beekeeper-studio/).

Especificação completa: [INSTRUCOES.md](INSTRUCOES.md).

## Estrutura

```
apps/studio                 Electron (main / preload / renderer / utility)
apps/ui-kit                 @git-nexus/ui-kit (Vue 3 + SCSS)
packages/git-core           Driver Git, scanner, WSL2, grafo, marcadores de conflito, contratos IPC
packages/governance-policy  Validação/formatação de Conventional Commits
```

## Comandos

Pré-requisitos: Node >= 24 e pnpm 12 (`corepack enable` ou `npm i -g pnpm`).

```bash
pnpm install
pnpm typecheck      # tsc (pacotes) + vue-tsc (apps)
pnpm test           # vitest: política, grafo, marcadores, integração com repositório git real
pnpm build          # esbuild (main/preload/utility) + vite (renderer)
pnpm dev            # Vite HMR + Electron
pnpm dist           # gera os artefatos Windows em apps/studio/release/
pnpm --filter @git-nexus/studio pack:dir   # só a pasta descompactada (win-unpacked)
```

Saída de `pnpm dist` (Windows x64): `GitNexus-<versão>-win-x64.zip` (portátil: extrair e executar) e, quando o NSIS roda, `GitNexus-<versão>-win-x64-setup.exe`.
Os dados (lista de repositórios, preferências) ficam em `GitNexusData/` ao lado do executável; nada é gravado no registro.

## Paleta de comandos e atalhos

**Ctrl+K** (ou **Ctrl+Shift+P**; ⌘ no macOS) abre a paleta: digite parte do nome de qualquer ação (sem acento, letras salteadas funcionam: `gh` encontra "Grafo / Histórico"), ↑↓ navega, Enter executa, Esc fecha. Os comandos usados por último aparecem primeiro. Há um comando por repositório catalogado ("Abrir repositório: …") e os do repositório aberto.

| Atalho | Ação |
|---|---|
| Ctrl+K / Ctrl+Shift+P | Paleta de comandos |
| Ctrl+1 | Ir para Repositórios |
| Ctrl+PageDown / Ctrl+PageUp | Próxima / anterior aba |
| Alt+W | Fechar aba |
| F5 | Atualizar status do repositório |
| Ctrl+Shift+A / Ctrl+Shift+U | Incluir tudo / remover tudo do commit |
| Ctrl+Shift+C | Ir para o título do commit |
| Ctrl+Enter (no formulário) | Fazer o commit |
| Ctrl+Shift+B | Mostrar/ocultar o painel de commit |
| F7 / Shift+F7 | Próxima / diferença anterior |
| Alt+→ / Alt+← | Próximo / arquivo anterior |

Os atalhos só usam Ctrl/⌘/Alt (ou teclas F), então nunca atrapalham a digitação. No app empacotado (Windows/Linux) o menu padrão do Electron é removido, porque reservaria Ctrl+W, Ctrl+R e o DevTools.

## Painel de repositórios

A tela inicial mostra, para cada repositório catalogado: **branch**, **↑ commits para enviar / ↓ commits para receber** (em relação ao upstream), **alterações locais**, **conflitos** ou "em dia". O status carrega em segundo plano (4 por vez).

- **Buscar todos:** `git fetch --all --prune` em todos, com relatório de sucessos e falhas (remoto inacessível, credencial necessária…). Nunca pergunta senha: sem terminal, o git falha em vez de travar.
- **Atualizar seguros:** pull **somente por fast-forward**, e só onde é seguro: há upstream, o repositório está atrás, não divergiu e a árvore está limpa. Nada de merge automático nem reescrita de histórico; o relatório diz quantos foram atualizados.
- **Buscar / Pull** individuais em cada linha (o pull recusa quando a branch divergiu e explica o motivo).
- **Só com pendências:** esconde os repositórios em dia.

## Instalar por gerenciador de pacote

A cada release o pipeline gera os manifestos de **winget**, **Scoop** e **Homebrew** (artefato `packaging-manifests` da execução). Veja [`docs/PACKAGING.md`](docs/PACKAGING.md) para publicá-los. Depois de publicados:

```powershell
winget install Imozart.GitNexus        # Windows (instalador por usuário)
scoop bucket add gitnexus https://github.com/imozart/scoop-gitnexus && scoop install gitnexus   # Windows (portátil)
```
```bash
brew install --cask imozart/gitnexus/gitnexus   # macOS
```

## Atualizações

O app avisa quando existe uma versão nova: **8 segundos depois de abrir** (para não atrasar a abertura) e depois **a cada 12 horas**, ele consulta a última release pública do GitHub e, se for maior que a versão em uso, mostra uma faixa no topo: *Nova versão X disponível (você usa Y)*, com **Baixar**, **Ver novidades**, **Depois** (volta a avisar na próxima abertura) e **Ignorar esta versão**.

- **Baixar** abre no navegador o pacote certo para o seu sistema: instalador (ou ZIP, se você usa a versão portátil) no Windows, DMG no macOS, AppImage no Linux, sempre da arquitetura certa. Sem pacote compatível, abre a página da release.
- **Privacidade:** é uma única requisição GET à API pública do GitHub, sem enviar nenhum dado seu nem identificador (só o `User-Agent` genérico `GitNexus-update-check`). Só são abertos endereços `https://github.com/imozart/git-nexus/…`.
- Pela paleta (Ctrl+K): *Verificar atualizações do GitNexus* (consulta na hora, mesmo para uma versão ignorada) e *Desligar/Ligar a verificação automática*.
- Não instala sozinho: a instalação continua sendo um passo seu (abrir o instalador ou extrair o ZIP). Isso vale para todos os formatos, inclusive o portátil.
- Precisa que o repositório seja **público**; com repositório privado a consulta retorna "não encontrado" e o app segue normalmente, sem avisos. Em desenvolvimento a verificação fica desativada.

## Assinatura de código (Windows)

Hoje os executáveis do Windows **não são assinados**, então o SmartScreen avisa na primeira abertura ("Mais informações" → "Executar assim mesmo"). O pipeline já está pronto para assinar pelo **SignPath Foundation** (gratuito para código aberto): o passo a passo está em [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md) e a política pública em [`docs/CODE_SIGNING_POLICY.md`](docs/CODE_SIGNING_POLICY.md). Sem a configuração, o build segue normalmente sem assinatura.

## Licença

GitNexus é software livre, distribuído sob a **GNU General Public License v3.0 (somente a versão 3)**. Veja o arquivo [`LICENSE`](LICENSE). Você pode usar, estudar, modificar e redistribuir, inclusive comercialmente, desde que mantenha a mesma licença nas versões distribuídas e disponibilize o código-fonte delas.

Copyright (C) 2026 contribuidores do GitNexus.

## Aba de Staging (referência: IntelliJ)

- **Lista de arquivos** em dois grupos — *Alterações* (rastreados) e *Arquivos não versionados* — com checkbox: marcado = no commit (stage), parcial = parte no stage, vazio = pendente. O resumo no topo mostra quantos estão no commit e quantos pendentes. Cores/letras por status (M, A, D, R, novo).
- **Seleção múltipla:** clique, Ctrl+clique, Shift+clique, Ctrl+A e retângulo (arrastar no espaço vazio). **Arraste** a seleção para *Alterações* para incluí-la no commit (e para *Não versionados* para tirar arquivos novos do stage). Espaço marca/desmarca; ↑/↓ navegam.
- **Menu de contexto** (botão do meio ou direito, em arquivo ou grupo): descartar alterações, incluir/remover do commit, adicionar ao `.gitignore`, copiar caminho/nome, mostrar na pasta, abrir. Descartes pedem confirmação, guardam cópia em `GitNexusData/discarded` e oferecem **Desfazer**.
- **Diff lado a lado** (HEAD x working tree) com numeração, trechos inalterados recolhíveis e botões por linha (`›`) e por bloco (`»`) para descartar. Barra superior: ↑ diferença anterior (Shift+F7) · ↓ próxima (F7) · ← arquivo anterior (Alt+←) · → próximo arquivo (Alt+→). A diferença atual fica destacada e o contador mostra “diferença 2 de 5”; na primeira/última diferença, ↑/↓ pulam para o arquivo anterior/próximo da lista (inclusive não versionados) e funcionam sem clicar antes em nenhum arquivo. Modo *Unificado* disponível.
- **Stage por linha e por bloco:** o seletor *Tudo | Pendente | No commit* escolhe o que comparar. Em **Pendente** (índice x disco) cada linha tem **+** e cada bloco **⊕** para incluir no commit só aquele trecho; em **No commit** (HEAD x índice) **−** e **⊖** tiram o trecho do commit. Só o índice é alterado (o disco não muda), há *Desfazer* no aviso, e o commit parcial deixa o resto pendente. Funciona também em arquivos novos.


## Política do time (`.gitnexus.json`)

Um arquivo `.gitnexus.json` na raiz do repositório define as regras de commit do time. Versionado junto com o código, vale para todos que abrirem o repositório no GitNexus e **sobrepõe** a configuração local de cada pessoa (também no momento de gravar o commit, não só na tela). O botão *Política → Salvar como política do time* cria o arquivo a partir da configuração atual.

```json
{
  "commit": {
    "types": ["feat", "fix", "docs", "refactor", "chore"],
    "scopes": ["auth", "ui", "api"],
    "maxSubjectLength": 72,
    "scopeRequired": true,
    "ticketRequired": true,
    "ticketPattern": "PROJ-\\d+",
    "ticketFromBranch": true
  },
  "secrets": { "mode": "block", "ignorePaths": ["test/fixtures/**"], "maxFileSizeMb": 5 }
}
```

- **Todos os campos são opcionais.** Campo inválido é ignorado e o problema aparece no formulário de commit.
- **Ticket e tipo pela branch:** em `feature/PROJ-123-login` o ticket `PROJ-123` e o tipo `feat` já vêm preenchidos (o `Refs:` sai na mensagem). Editar o ticket à mão desliga o automático.
- **Scanner de segredos:** antes de cada commit examina só as linhas *adicionadas* em stage e acusa chaves (AWS, GitHub, GitLab, Slack, Google, Stripe, npm), chaves privadas, JWT, senhas em URL ou atribuídas no código, arquivos sensíveis (`.env`, `*.pem`, `id_rsa`…) e arquivos grandes. O segredo nunca é exibido por inteiro. `mode`: `warn` (avisa e permite "Commitar mesmo assim", padrão), `block` (impede o commit) ou `off`. Falso positivo: comentário `gitnexus:allow-secret` na linha ou o caminho em `ignorePaths`.

## Ferramentas (aba por repositório)

- **Operações (desfazer de verdade):** lista tudo o que mudou o HEAD (commits, amends, merges, pulls, rebases, resets, trocas de branch) a partir do reflog. *Desfazer* volta ao estado anterior à operação (e às mais novas), pedindo confirmação com a lista do que será revertido. Commit e amend voltam as alterações ao stage; as demais usam `reset --keep` (preserva o que você tem local e cancela se houver conflito). O próprio desfazer aparece na lista e pode ser desfeito (refazer). Trocas de branch só são desfeitas quando são a operação mais recente, porque o reflog do HEAD não registra de qual branch é cada entrada.
- **Stash (shelf) com nome:** guarde as alterações com um nome (tudo, ou só alguns arquivos; opcionalmente os arquivos novos e mantendo o que já está no stage). Cada stash lista seus arquivos com o diff; dá para **restaurar só alguns arquivos** (recusa se já tiverem alterações locais, a menos que você confirme sobrescrever), aplicar tudo (mantendo ou removendo), **renomear** e excluir. Conflitos ao aplicar são avisados e o stash é mantido.
- **Busca no histórico (aba Grafo):** por texto na mensagem, por **código adicionado/removido** (pickaxe, `-S`), por **regex** nas linhas alteradas (`-G`), por autor, arquivo/pasta e data. Clicar num commit mostra a mensagem completa, os arquivos alterados e o diff de cada um.
- **Arquivo (histórico e blame):** escolha um arquivo (ou use *Histórico do arquivo* / *Anotar (blame)* no menu do botão do meio, ou os atalhos ⏱ 👤 no detalhe do commit). O **histórico** segue renomeações; o **blame** mostra autor, data e commit de cada linha, com uma faixa de cor por commit, inclui as linhas ainda não commitadas e abre o diff do commit ao clicar.
- **Rebase interativo visual:** escolha os últimos N commits (ou use *Rebase interativo a partir daqui* no detalhe de um commit do grafo). Cada commit vira uma linha que você **arrasta** (ou sobe/desce pelos botões) e para a qual escolhe a ação: **manter**, **editar mensagem** (carrega a mensagem completa), **juntar (squash)** ao de cima combinando as mensagens, **juntar (fixup)** descartando a mensagem, ou **descartar**. O resumo mostra "4 commits → 2" e a lista avisa se algum commit já está publicado (exigirá push forçado). Proteções: exige árvore limpa (peça um stash antes), recusa histórico com merges, valida a lista (o primeiro mantido não pode ser "juntar", nenhum commit pode faltar) e **guarda um backup** em `refs/gitnexus/rebase-backup/<branch>/<data>`. O rebase aparece em *Operações* e pode ser desfeito. Se parar por **conflito**, a tela mostra o passo (2/4) e os arquivos; resolva na aba Conflitos e use *Continuar*, *Pular este commit* ou *Abortar* (volta tudo ao estado anterior), e o Staging avisa que há um rebase em andamento. Ainda não funciona em repositórios WSL2.
- **Versão e changelog:** calcula a próxima versão (SemVer) e o changelog a partir dos Conventional Commits desde a última tag `vX.Y.Z`, com **as mesmas regras e o mesmo código do pipeline de release** (`scripts/lib/release-core.mjs`): breaking → major, `feat` → minor, o resto → patch (ou force o incremento). Mostra "v1.0.0 → v1.1.0" e as seções (Novidades, Correções…, com escopo, PR e ticket); **Copiar notas**, **Salvar no CHANGELOG.md** (insere no topo, sem duplicar versão, preservando CRLF) e **Criar tag** anotada com o changelog na mensagem (local; o push é seu). Sem tags, a primeira versão vem do `package.json`. Funciona em qualquer repositório que use Conventional Commits.
- **GitHub e GitLab (PRs/MRs e CI):** a aba *PRs / MRs e CI* reconhece o remoto (`https://`, `git@host:`, `ssh://`) e funciona com **github.com, GitHub Enterprise, gitlab.com e GitLab próprio (on-premise)**; para um host que o app não reconhece, você escolhe se é GitHub ou GitLab. Conecte uma conta com um token de acesso (o link e os escopos necessários aparecem na tela): ele é **validado no provedor** e guardado **criptografado pelo sistema** (DPAPI no Windows, Keychain no macOS, libsecret no Linux; sem isso o token só vive na memória); as chamadas à API acontecem no processo principal e o token **nunca volta para a tela**. Aí dá para: **listar** pull requests / merge requests (abertos, mergeados, fechados) com o **status do CI** de cada um (GitHub: check-runs e statuses; GitLab: pipeline) e ver a falha; **criar** um PR/MR com título e **descrição montados dos Conventional Commits** da branch (seções por tipo, escopo e `Refs:` com os tickets), escolhendo o destino, como rascunho e **enviando a branch antes** (push) se ainda não existir no remoto. No **detalhe de um commit do Grafo** aparece o status de CI dele. Só abre no navegador páginas do mesmo host do remoto.

### Testar a interface sem Electron

`apps/studio/scripts/ui-harness/server.ts` serve o renderer compilado num navegador comum, ligado ao mesmo código de Git do processo utilitário (útil para CDP/Playwright):
`esbuild scripts/ui-harness/server.ts --bundle --platform=node --format=esm --outfile=harness.mjs` e `node harness.mjs dist/renderer <pasta-de-dados> 5199`.

## Releases automáticas (GitHub Actions)

Cada merge na `main` dispara `.github/workflows/release.yml`:

1. **Versão** — `scripts/release-info.mjs` lê a última tag `vX.Y.Z` e os commits desde então (Conventional Commits): `!`/`BREAKING CHANGE` → **major**, `feat` → **minor**, qualquer outro → **patch**. Sem tags, a primeira release usa a versão do `package.json` raiz. A tag é a fonte da verdade; nenhum commit de versão volta para a main.
2. **Qualidade** — `typecheck` + `test` (a release não sai se falharem).
3. **Build em paralelo** (6 jobs): Windows x64/ARM64, macOS Intel/Apple Silicon, Linux x64/ARM64.
4. **Release** — notas agrupadas por tipo (novidades, correções, breaking changes…, com links para commits/PRs, ticket `Refs:` e autor), tabela de downloads, `SHA256SUMS.txt` e link de comparação com a versão anterior. A release é criada como rascunho, recebe todos os arquivos e só então é publicada.

| Sistema | Pacotes gerados |
|---------|-----------------|
| Windows | instalador `-setup.exe` (por usuário, sem admin) e `.zip` portátil |
| macOS | `.dmg` e `.zip` |
| Linux | `.AppImage`, `.deb`, `.rpm`, `.tar.gz` |

Detalhes:
- **Pular release:** inclua `[skip release]` na mensagem do commit.
- **Release manual / forçar incremento:** Actions → *Release* → *Run workflow* (campo `bump`).
- **PRs:** `.github/workflows/ci.yml` roda typecheck, testes e build (Ubuntu e Windows) antes do merge.
- **Tudo ou nada:** se qualquer um dos 6 builds falhar, os demais são cancelados e nenhuma release é publicada.
- **Aviso de falha por e-mail:** o job `notify-failure` envia o job, o passo e o trecho do log com o erro. Em *Settings → Secrets and variables → Actions*, crie os secrets `MAIL_USERNAME` (e-mail Gmail remetente) e `MAIL_PASSWORD` ([senha de app](https://myaccount.google.com/apppasswords), exige verificação em duas etapas) e a variável `NOTIFY_EMAIL` (destinatário). Sem eles, a falha só aparece no resumo da execução. Pré-visualizar: `node scripts/failure-report.mjs --repo dono/repo --run <id> --out relatorio.txt`.
- **Merges seguidos:** as releases entram em fila; se um merge for "pulado" pela fila, seus commits entram na release seguinte.
- **Sem assinatura de código:** Windows (SmartScreen) e macOS (Gatekeeper) avisarão; as notas da release explicam como proceder. Para assinar, adicione os segredos do `electron-builder` (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_*`) ao repositório e exponha-os no passo *Empacotar*.
- **Somente 64 bits:** só geramos x64 e ARM64 (nenhum alvo ia32). Não há `.exe` “portable” do NSIS porque o launcher dele é um processo de 32 bits (e o `elevate.exe` do NSIS também é 32 bits, por isso `nsis.packElevateHelper: false`); o portátil no Windows é o ZIP. O passo *Verificar que o app é somente 64 bits* (`scripts/verify-arch.mjs`) lê os cabeçalhos PE/ELF/Mach-O de todos os binários do app empacotado e reprova o build se achar um de 32 bits. (O instalador `-setup.exe` do NSIS é um wrapper de 32 bits que só roda durante a instalação; o app instalado é 64 bits.)
- **Modo portátil:** AppImage e ZIP/tar.gz guardam dados em `GitNexusData/` ao lado do executável; instalador, `.deb`/`.rpm` e `.app` em `/Applications` usam a pasta padrão do sistema. Criar uma pasta `GitNexusData` ao lado de qualquer instalação força o modo portátil.
- Testar o texto da release localmente: `node scripts/release-info.mjs next` e `node scripts/release-info.mjs notes --version 1.2.3 --out notas.md`.

## Versões (verificadas em 13/11/2026)

| Item | Versão | Observação |
|------|--------|------------|
| Electron | 45.3.1 | Chromium/Node embutidos; `@types/node` fica em 24.x para casar com o Node do Electron |
| Vue / Pinia | 3.5.45 / 4.1.0 | |
| Vite / ESBuild / Sass | 8.3.8 / 0.28.2 / 1.108.2 | |
| electron-builder | 26.18.0 | |
| TypeScript | 7.0.2 nos pacotes (`tsc`) · 6.0.3 nos apps com `.vue` | `vue-tsc`/Volar ainda exigem TS < 7; migrar quando liberarem |
| Vitest | 5.1.0 | |
| pnpm | 12.18.0 | scripts de build liberados só para `esbuild` e `electron` (`allowBuilds`) |
| Node (dev) | >= 24 | LTS atual é a 26 (Lithium); 24 em manutenção |

## Status

| # | Etapa | Estado |
|---|-------|--------|
| 1 | Monorepo PNPM | feito |
| 2 | Tipos IPC + `git-core` | feito, testado contra repositório git real |
| 3 | Build do `studio` (ESBuild + Vite) | feito |
| 4 | Gerenciador de repositórios (varredura, busca, WSL2, persistência JSON) | feito |
| 5 | `CommitForm.vue` + `MergeConflictResolver.vue` + abas (Staging, Grafo, Conflitos) | feito |
| 6 | `electron-builder` (Windows ZIP portátil + instalador, 64 bits) | feito e testado localmente |
| 7 | Releases multiplataforma via GitHub Actions | workflows escritos e validados (sintaxe + script de versão/notas testado); **ainda não executados no GitHub**. Builds macOS/Linux só rodam no CI |

Pendências conhecidas: assinatura de código (sem certificado), suporte WSL2 testado só por unidade (parse de caminho), não em distro real.
