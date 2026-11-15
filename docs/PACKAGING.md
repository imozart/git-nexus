# Distribuição por gerenciadores de pacote

A cada release, o workflow `release.yml` roda `scripts/gen-packaging.mjs` e guarda os manifestos como artefato
**`packaging-manifests`** da execução (30 dias). Eles já trazem a versão, as URLs de download e os **SHA-256 reais**.
Também dá para gerar manualmente de qualquer release publicada:

```bash
gh release download v1.3.0 -p SHA256SUMS.txt
node scripts/gen-packaging.mjs --version 1.3.0 --repo imozart/git-nexus --sums SHA256SUMS.txt --out packaging-out
```

> **Pré-requisito geral:** o repositório precisa ser **público**, com licença de código aberto (GPL-3.0 ✔).
> A publicação nos catálogos abaixo exige contas/PRs seus; nada disso é feito automaticamente.

## winget (Windows)

Catálogo oficial: <https://github.com/microsoft/winget-pkgs>.

1. **Primeira vez:** faça um fork de `microsoft/winget-pkgs`, copie `packaging-out/winget/manifests/...` para a mesma árvore e abra um PR.
   Alternativa: `wingetcreate submit packaging-out/winget/manifests/i/Imozart/GitNexus/<versão>` (precisa de um token de acesso pessoal do GitHub).
2. A validação automática do repositório testa o instalador (`nullsoft`, por usuário) e o SmartScreen/antivírus. **Instaladores sem assinatura
   tendem a ser mais lentos para aprovar** (veja `CODE_SIGNING.md`).
3. **Versões seguintes:** use a ação [`vedantmgoyal9/winget-releaser`](https://github.com/vedantmgoyal9/winget-releaser) num job depois da
   publicação (precisa de um PAT em `WINGET_TOKEN`), ou repita o PR com os novos manifestos.

Instalação pelo usuário: `winget install Imozart.GitNexus`.

## Scoop (Windows, versão portátil)

O Scoop instala o **ZIP portátil**. Não há catálogo central para aceitar manifestos novos sem critérios de popularidade; o caminho é um **bucket próprio**:

1. Crie o repositório `imozart/scoop-gitnexus` e coloque `packaging-out/scoop/gitnexus.json` em `bucket/gitnexus.json`.
2. O manifesto já tem `checkver: github` e `autoupdate`, então o próprio Scoop (ou a ação de Excavator) atualiza as versões depois.
3. `persist: GitNexusData` mantém seus repositórios e preferências entre atualizações.

Instalação pelo usuário: `scoop bucket add gitnexus https://github.com/imozart/scoop-gitnexus` e `scoop install gitnexus`.

## Homebrew (macOS)

Casks de apps novos e sem assinatura/notarização **não são aceitos** no `homebrew-cask` oficial; o caminho é um **tap próprio**:

1. Crie o repositório `imozart/homebrew-gitnexus` e coloque `packaging-out/homebrew/Casks/gitnexus.rb` em `Casks/gitnexus.rb`.
2. O cask usa `livecheck` com `github_latest`; atualize a versão e os SHA-256 a cada release (o artefato `packaging-manifests` já os traz prontos).

Instalação pelo usuário: `brew install --cask imozart/gitnexus/gitnexus`.

> Sem notarização, o macOS bloqueia o app na primeira abertura. O cask não resolve isso; é preciso a conta Apple Developer (`CODE_SIGNING.md`).

## Flathub (Linux)

O pipeline gera também o manifesto do **Flatpak** (`flatpak/dev.gitnexus.studio.yml`, `.desktop` e `.metainfo.xml`), junto com os de
winget, Scoop e Homebrew (artefato `packaging-manifests` da release).

O app executa o `git` do sistema e dentro do sandbox do Flatpak ele não existe. Em vez de enfraquecer o sandbox com
`flatpak-spawn --host`, o manifesto **compila o próprio git como um módulo** (em `/app/bin`, que já está no `PATH`), a partir do tarball
oficial do kernel.org com SHA-256 fixo (`FLATPAK.git` em `scripts/lib/flatpak.mjs`; atualize a versão e o hash quando sair um git novo).
O app em si vem dos pacotes `tar.gz` da release (x64 e arm64), rodando com `zypak-wrapper` sobre o `org.electronjs.Electron2.BaseApp`.

Permissões pedidas: rede, X11/Wayland, GPU, a **pasta pessoal** (os repositórios ficam lá) e o serviço de segredos (`org.freedesktop.secrets`)
para guardar os tokens criptografados.

> **Estado: rascunho não testado.** Não há como rodar o `flatpak-builder` no Windows; o manifesto foi validado só como YAML/XML e
> contra o conteúdo real do `tar.gz` da release (pasta raiz `GitNexus-<versão>-linux-<arq>/` com o executável `gitnexus`). Antes de enviar:
>
> 1. Torne o repositório **público** (o Flathub exige) e publique uma release.
> 2. Num Linux com `flatpak-builder`: `flatpak-builder --user --install --force-clean build flatpak/dev.gitnexus.studio.yml`
>    e `flatpak run dev.gitnexus.studio`. Confira que o app abre, que o `git` é encontrado (abra um repositório) e que o token do GitHub/GitLab é guardado.
> 3. Valide: `flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest flatpak/dev.gitnexus.studio.yml` e
>    `... appstream flatpak/dev.gitnexus.studio.metainfo.xml`.
> 4. Abra o pedido em <https://github.com/flathub/flathub> (branch `new-pull-request`) conforme o
>    [guia de submissão](https://docs.flathub.org/docs/for-app-authors/submission). O ID `dev.gitnexus.studio` exige que você
>    comprove o controle do domínio `gitnexus.dev` ou use o ID baseado no GitHub `io.github.imozart.GitNexus` (nesse caso troque
>    `appId` em `scripts/lib/flatpak.mjs` e o `appId` do `electron-builder.yml`).
