# Configuração do repositório

O que está ligado em *Settings* do GitHub (não dá para versionar no código) e por quê. Quem muda uma dessas regras deve atualizar esta página.
Para ver o estado real: `gh api repos/imozart/git-nexus/rulesets` e `gh api repos/imozart/git-nexus`.

## Ruleset da `main` (`protect main`)

| Regra | Efeito |
|---|---|
| `deletion`, `non_fast_forward` | A `main` não pode ser apagada nem reescrita (sem force push) |
| `pull_request` | Toda mudança entra por PR; **só merge commit** (squash e rebase desligados, porque a release lê as mensagens dos commits) |
| `required_status_checks` | Os 10 checks abaixo precisam passar antes do merge |

**Checks obrigatórios** (nome exato do job): `Typecheck, testes e build (ubuntu-latest)` e `(windows-latest)`, `Cobertura de testes`,
`Empacotamento (ubuntu-latest)` e `(windows-latest)`, `Teste de fumaça do app empacotado`, `Testes de interface (Chrome headless)`,
`Título do PR (Conventional Commits)`, `Varredura de segredos (gitleaks)` e `Lint dos workflows (actionlint)`.

- **Renomear um job obrigatório** deixa todos os PRs esperando um check que nunca chega. Mude o nome **e** o ruleset juntos.
- **Fora da lista, de propósito:** a auditoria de dependências (uma vulnerabilidade nova travaria até o PR que a corrige) e a revisão de dependências (compara com a base e já cobre o PR que muda dependências).
- **Sem aprovação obrigatória** (0 revisões): o projeto tem um só mantenedor, que não pode aprovar o próprio PR.
- **Sem "branch atualizada":** `strict_required_status_checks_policy` está desligado. Ligá-lo obriga a atualizar cada PR da pilha e repetir o CI depois de cada merge; o aviso `desatualizada` cobre o caso.
- **Bypass:** só o papel de **admin** (sempre). É o que permite ao pipeline de release gravar o `chore(release)` direto na `main` (próxima seção) e a você aceitar um PR em emergência (botão de merge com bypass).

## Token da release (`RELEASE_PUSH_TOKEN`)

Depois de cada release estável, o job *Registrar a versão e o CHANGELOG* grava um commit `chore(release): vX.Y.Z [skip release]` direto na `main`. Com o ruleset isso só passa por um
token com bypass. O GitHub **não** aceita o `GITHUB_TOKEN` (app GitHub Actions) como bypass em repositório de conta pessoal, então o secret `RELEASE_PUSH_TOKEN` guarda um **token
fine-grained** de admin:

- escopo: **só este repositório**, permissão **Contents: Read and write** (nada mais), validade de 90 dias;
- sem o secret (ou expirado) a release **sai normalmente**, mas o commit com a versão e o CHANGELOG não é gravado e o workflow emite um aviso. Para refazer: `node scripts/bump-version.mjs --version X.Y.Z && node scripts/changelog.mjs --version X.Y.Z` e abrir um PR;
- renovar: gerar outro token com os mesmos escopos e `gh secret set RELEASE_PUSH_TOKEN --repo imozart/git-nexus`.

## Ruleset das tags (`protect version tags`)

Tags `v*` não podem ser apagadas nem movidas (`deletion`, `non_fast_forward`); criar continua livre (a release cria a tag). A regra `update` ficou de fora.

## Configurações do repositório

| Configuração | Valor | Por quê |
|---|---|---|
| Tipos de merge | só merge commit | a versão e o changelog saem dos commits, não do título do PR |
| Apagar a branch depois do merge | ligado | |
| Auto-merge | permitido | usado pelo merge automático do Dependabot (veja [AUTOMATION](AUTOMATION.md)) |
| Permissão padrão do `GITHUB_TOKEN` | leitura | cada job pede o que precisa |
| Aprovação de workflows de contribuidores externos | **todos** | repositório público: ninguém roda workflow sem aprovação |
| Secret scanning e push protection | ligados | bloqueia o push com segredo reconhecido |
| Relato privado de vulnerabilidade | ligado | é o canal do [SECURITY](../SECURITY.md) |
| Dependabot (alertas, atualizações de segurança e de versão) | ligado | [`dependabot.yml`](../.github/dependabot.yml) |
| CodeQL | setup padrão do GitHub (JavaScript/TypeScript e Actions) | sem arquivo de workflow no repositório |

## Aceitar um PR

```bash
gh pr merge <número> --merge        # nunca --squash nem --rebase: o ruleset recusa
```

- Para **não publicar release** neste merge (juntar vários PRs em uma versão): label `sem-release` no PR antes do merge, ou `[skip release]` na descrição do merge ([LABELS](LABELS.md#pular-a-release-de-um-pr)).
- PR só de `docs`, `test`, `ci`, `style` ou `chore` não publica release por si só.

## Limites conhecidos

- O **e-mail pessoal do autor** aparece nos commits antigos (já públicos). Reescrever o histórico invalidaria clones, tags e releases; daqui para frente use o e-mail `noreply` do GitHub.
- Os checks obrigatórios rodam no Ubuntu e no Windows; o macOS só é exercitado no workflow de release.
- O teste na janela real do Electron roda só no Linux do CI.
