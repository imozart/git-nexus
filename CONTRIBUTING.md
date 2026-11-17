# Como contribuir

Obrigado por querer ajudar! O GitNexus é software livre sob a **GNU GPL v3** (somente a versão 3). Ao enviar uma contribuição
você concorda que ela seja distribuída sob a mesma licença.

## Antes de começar

- Procure nas [issues](https://github.com/imozart/git-nexus/issues) se o assunto já existe. Para abrir uma nova, use um dos formulários
  (defeito, lentidão, funcionalidade, documentação, idioma, pergunta). Para algo grande (uma tela nova, mudança de arquitetura), abra a issue
  **antes** e combine a direção: evita trabalho perdido.
- **Vulnerabilidades:** não use issues; siga a [política de segurança](SECURITY.md).
- Para entender o código (quem roda onde, contratos IPC): [`docs/ESPECIFICACAO.md`](docs/ESPECIFICACAO.md) e [`docs/DESENVOLVIMENTO.md`](docs/DESENVOLVIMENTO.md).
  Regra de ouro: o Git pesado roda só no `UtilityProcess`, nunca no processo principal nem na interface.

## Ambiente

Node >= 24 (a versão exata está em `.node-version`) e pnpm 12 (`corepack enable`).

```bash
pnpm install
pnpm typecheck        # tsc + vue-tsc
pnpm test             # vitest (inclui testes contra repositórios git reais)
pnpm test:coverage    # com o piso mínimo de cobertura que o CI cobra
pnpm build            # esbuild + vite
pnpm dev              # app em desenvolvimento (Vite HMR + Electron)
pnpm test:ui          # testes de interface (precisa do build e de um Chrome/Edge)
```

A interface também pode ser exercitada sem o Electron (harness em `apps/studio/scripts/ui-harness`); veja o [guia de desenvolvimento](docs/DESENVOLVIMENTO.md).

## Fluxo

1. Faça um fork e crie uma branch **a partir da `main`**, no formato `tipo/descricao-curta` (minúsculas): `feat/painel-de-log`, `fix/crash-no-merge`,
   `docs/guia-de-uso`. Tipos: `feat`, `fix`, `hotfix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `style`, `chore`, `revert`.
   O **tipo da branch precisa ser o mesmo do título do PR**.
2. Escreva testes junto com a mudança (`packages/*/test`, `apps/studio/test`, `scripts/test`). Mudança de comportamento sem teste costuma voltar.
3. **Mensagens de commit no padrão Conventional Commits** (`feat(escopo): …`, `fix: …`). Elas são o que o pipeline lê: a **versão** e o
   **`CHANGELOG.md`** saem dos commits da branch (não do título do PR). `feat` → minor, `fix` e o resto → patch, `!` ou `BREAKING CHANGE:` → major.
   Mensagens como `wip` ou `ajustes` caem em "Outras alterações".
4. Abra o pull request **para a `main`** preenchendo o modelo. O **título** também segue o Conventional Commits e tem **no máximo 100 caracteres** (um check confere; título maior reprova o job "Título do PR").
5. O CI precisa passar. Os checks de todo PR:
   - **Título do PR (Conventional Commits)** e **Nome da branch (tipo/descrição)**;
   - **Typecheck, testes e build** (Ubuntu e Windows), **Cobertura de testes**, **Empacotamento** (Ubuntu e Windows);
   - **Testes de interface (Chrome headless)** e **Teste de fumaça do app empacotado**;
   - **Lint dos workflows (actionlint)**, **Varredura de segredos (gitleaks)** e **Auditoria de dependências (pnpm audit)**.
6. Os **rótulos** são automáticos: tipo (pelo título), área (pelas pastas), tamanho, `conflito`, `desatualizada` e `bloqueado` (veja [`docs/LABELS.md`](docs/LABELS.md)).
   `tamanho: XL` (mais de 500 linhas) pede para dividir o PR. `desatualizada` pede para atualizar a branch com a `main`.
7. **Pilha de PRs** (um PR parte de outro): todos têm base na `main`; o comentário do bot mostra a ordem de merge. Mergeie na ordem.
8. Um mantenedor revisa. Responda aos comentários com novos commits; o merge é feito com *merge commit*.

Não edite à mão a versão dos `package.json` nem o `CHANGELOG.md`: o pipeline os grava a cada release.

## Padrões

- **TypeScript estrito**; sem `any` solto. Código novo na mesma linguagem e no mesmo estilo do que está em volta.
- **Textos da interface** nunca fixos: use `t('area.chave')` e acrescente a chave em `pt-BR.ts` **e** em `en.ts` (o teste `i18n.test.ts` cobra).
  Mensagens do núcleo usam `tm('português', 'English')`. Veja [`docs/I18N.md`](docs/I18N.md).
- **Nunca** use `--no-verify` nem desligue verificações para fazer algo passar.
- Não inclua segredos, tokens, caminhos pessoais nem dados de clientes em código, testes, imagens ou GIFs.
- Dependências novas: justifique no PR (tamanho, manutenção, licença compatível com a GPL-3.0).
- Workflows novos: actions fixadas por **SHA** com o `# vX` no comentário, `permissions` mínimas e dados do PR (título, branch) sempre por variável de ambiente, nunca dentro do script.

## Conduta

Seja respeitoso. Veja o [Código de Conduta](CODE_OF_CONDUCT.md).
