# CI e pipeline de release

O que cada workflow de `.github/workflows/` faz, em ordem do que acontece num merge. Para bots, betas, versão e changelog, veja [AUTOMATION](AUTOMATION.md); para labels e issues, [LABELS](LABELS.md).

## Releases automáticas (GitHub Actions)

Um merge na `main` que muda o app (regra em [AUTOMATION](AUTOMATION.md#releases-e-betas)) dispara `.github/workflows/release.yml`:

1. **Versão** — `scripts/release-info.mjs` lê a última tag `vX.Y.Z` e os commits desde então (Conventional Commits): `!`/`BREAKING CHANGE` → **major**, `feat` → **minor**, qualquer outro → **patch**. Sem tags, a primeira release usa a versão do `package.json` raiz. A tag é a fonte da verdade e vai para o build; depois de publicar a release **estável**, o job *Registrar a versão no código* grava a mesma versão nos `package.json` da main (`chore(release): vX.Y.Z [skip release]`), para o código-fonte e a tag não divergirem.
2. **Qualidade** — `typecheck` + `test` (a release não sai se falharem).
3. **Build em paralelo** (6 jobs): Windows x64/ARM64, macOS Intel/Apple Silicon, Linux x64/ARM64.
4. **Release** — notas agrupadas por tipo (novidades, correções, breaking changes…, com links para commits/PRs, ticket `Refs:` e autor), tabela de downloads, `SHA256SUMS.txt` e link de comparação com a versão anterior. A release é criada como rascunho, recebe todos os arquivos e só então é publicada.

| Sistema | Pacotes gerados |
|---------|-----------------|
| Windows | instalador `-setup.exe` (por usuário, sem admin) e `.zip` portátil |
| macOS | `.dmg` e `.zip` |
| Linux | `.AppImage`, `.deb`, `.rpm`, `.tar.gz` |

Detalhes:
- **Pular release:** ponha a label `sem-release` no PR antes de aceitá-lo, ou inclua `[skip release]` na mensagem do merge (valem as duas). Serve para juntar vários PRs em uma versão só: veja [LABELS](LABELS.md#pular-a-release-de-um-pr).
- **Changelog:** o [`CHANGELOG.md`](../CHANGELOG.md) é gerado a cada release estável (mesmo commit `chore(release)` que grava a versão); não edite à mão. Detalhes em [AUTOMATION](AUTOMATION.md).
- **Release manual / forçar incremento:** Actions → *Release* → *Run workflow* (campo `bump`).
- **Beta:** no mesmo botão, `channel = beta` publica `vX.Y.Z-beta.N` como pré-lançamento (não vira “última versão”, não gera manifestos e não aparece como atualização no app).
- **Bots, betas e a versão no `package.json`:** como funcionam e o que configurar no GitHub: [`AUTOMATION.md`](AUTOMATION.md).
- **PRs:** `.github/workflows/ci.yml` roda typecheck, testes e build (Ubuntu e Windows) antes do merge. Também rodam em todo PR: **título em Conventional Commits** (`pr-title.yml`; valida o padrão e o **limite de 100 caracteres**, e dá o rótulo de tipo, mas a versão e o changelog saem das mensagens dos **commits da branch**, não do título), **nome da branch** (`branch-name.yml`), **lint dos workflows** com actionlint + shellcheck (`lint-workflows.yml`) e o **ensaio do empacotamento** (`package-check.yml`: `electron-builder --dir` no Linux e no Windows + conferência de 64 bits), para que um build quebrado apareça antes do merge e não depois. O `dependencies.yml` faz a **revisão de dependências** (bloqueia PR que traz dependência vulnerável) e a **auditoria** do lockfile (`pnpm audit`: alta/crítica reprovam, as demais aparecem no resumo). Um aviso sem correção publicada e só de ferramenta de desenvolvimento pode ser **aceito com prazo** em `auditConfig.ignoreGhsas` (`pnpm-workspace.yaml`): cada um leva acima o motivo, a condição de saída e a issue de acompanhamento, e o `scripts/test/audit-ignores.test.ts` cobra isso (hoje: o `picomatch`, issue #200). O `smoke.yml` é o **teste de fumaça**: empacota o app e o **abre de verdade** (Linux, display virtual) para conferir que a janela abre, a interface monta e a ponte com o worker responde; localmente: `GITNEXUS_SMOKE=1 apps/studio/release/win-unpacked/GitNexus.exe` (sai com 0 e imprime `GITNEXUS_SMOKE_OK`). O `secret-scan.yml` varre **todo o histórico** (todas as branches) atrás de segredos com o gitleaks, em todo PR e a cada push na `main`.
- **Tudo ou nada:** se qualquer um dos 6 builds falhar, os demais são cancelados e nenhuma release é publicada.
- **Labels, tamanho, conflito, atraso e ordem de merge dos PRs:** `pr-labels.yml`, `pr-size.yml`, `pr-conflicts.yml`, `pr-behind.yml` e `pr-stack.yml`; tudo descrito em [LABELS](LABELS.md).
- **Rótulos e backlog:** `labeler.yml` etiqueta cada PR pelas pastas que ele altera (`.github/labeler.yml`: app, ui-kit, git-core, política, ci, docs, dependências) e `stale.yml` marca como `parado` o que está sem resposta há 60 dias e fecha após mais 14 (issues `bug`, `security`, `pinned` e as abertas pelo pipeline ficam de fora).
- **Saúde da main:** toda segunda-feira (`main-health.yml`, também manual) a `main` passa por typecheck, testes, build e auditoria, mesmo sem PR; se quebrar sozinha (dependência nova, vulnerabilidade publicada, mudança no ambiente), abre uma issue com o rótulo `main-health`.
- **Issue de falha:** o mesmo job abre uma issue com o rótulo `release-failure` (ou comenta na que já está aberta) com o link da execução e o relatório, para ficar um registro pesquisável da falha.
- **Aviso de falha por e-mail:** o job `notify-failure` envia o job, o passo e o trecho do log com o erro. Em *Settings → Secrets and variables → Actions*, crie os secrets `MAIL_USERNAME` (e-mail Gmail remetente) e `MAIL_PASSWORD` ([senha de app](https://myaccount.google.com/apppasswords), exige verificação em duas etapas) e a variável `NOTIFY_EMAIL` (destinatário). Sem eles, a falha só aparece no resumo da execução. Pré-visualizar: `node scripts/failure-report.mjs --repo dono/repo --run <id> --out relatorio.txt`.
- **Preparação dos jobs:** o trecho repetido (pnpm + Node + `pnpm install --frozen-lockfile`) vive na composite action `.github/actions/setup`, com as versões fixadas por SHA num lugar só; o job faz o checkout e chama `uses: ./.github/actions/setup` (com `install: 'false'` quando um cache precisa vir antes da instalação).
- **Versão do Node:** fica num arquivo só, `.node-version` (hoje 24); todos os workflows a leem (`node-version-file`). Para subir de versão, mude o arquivo e o `engines.node` do `package.json`; `scripts/test/workflows.test.ts` reprova se divergirem ou se um workflow voltar a fixar o número.
- **Merges seguidos:** as releases entram em fila; se um merge for "pulado" pela fila, seus commits entram na release seguinte.
- **Sem assinatura de código:** Windows (SmartScreen) e macOS (Gatekeeper) avisarão; as notas da release explicam como proceder. Para assinar, adicione os segredos do `electron-builder` (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_*`) ao repositório e exponha-os no passo *Empacotar*.
- **Somente 64 bits:** só geramos x64 e ARM64 (nenhum alvo ia32). Não há `.exe` “portable” do NSIS porque o launcher dele é um processo de 32 bits (e o `elevate.exe` do NSIS também é 32 bits, por isso `nsis.packElevateHelper: false`); o portátil no Windows é o ZIP. O passo *Verificar que o app é somente 64 bits* (`scripts/verify-arch.mjs`) lê os cabeçalhos PE/ELF/Mach-O de todos os binários do app empacotado e reprova o build se achar um de 32 bits. (O instalador `-setup.exe` do NSIS é um wrapper de 32 bits que só roda durante a instalação; o app instalado é 64 bits.)
- **Modo portátil:** AppImage e ZIP/tar.gz guardam dados em `GitNexusData/` ao lado do executável; instalador, `.deb`/`.rpm` e `.app` em `/Applications` usam a pasta padrão do sistema. Criar uma pasta `GitNexusData` ao lado de qualquer instalação força o modo portátil.
- Testar o texto da release localmente: `node scripts/release-info.mjs next` e `node scripts/release-info.mjs notes --version 1.2.3 --out notas.md`.
