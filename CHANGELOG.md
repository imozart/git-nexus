# Changelog

Todas as mudanças relevantes do GitNexus, por versão. As versões seguem o [SemVer](https://semver.org/lang/pt-BR/) e o formato é inspirado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

Este arquivo é **gerado a partir dos commits (Conventional Commits)** a cada release estável, no mesmo commit `chore(release)` que grava a versão: não é preciso editá-lo à mão. Ficam fora da lista os commits de testes, CI, estilo e manutenção interna; a lista completa, com os pacotes para baixar, está em cada [release](https://github.com/imozart/git-nexus/releases).

## [1.4.0] - 2026-11-15

### ✨ Novidades

- **ui:** painéis laterais recolhíveis com faixas nomeadas ([`12e464a`](https://github.com/imozart/git-nexus/commit/12e464a8afac2b32f72270db3926fac127491647))
- **log:** aba de log com os comandos git executados, por repositório ([`0436ea9`](https://github.com/imozart/git-nexus/commit/0436ea9f008ad857350c220841289947cc9c44e9))
- **i18n:** seletor de idioma com bandeira e lista arredondada ([`6a50009`](https://github.com/imozart/git-nexus/commit/6a50009b0949ba83d4ce4a9d4457ab7c31c5af41))

## [1.3.0] - 2026-11-14

### ✨ Novidades

- **packaging:** manifesto do Flatpak/Flathub gerado a cada release ([`cc738cf`](https://github.com/imozart/git-nexus/commit/cc738cfd2c8fd5e47c054facd1bd07256a8be9b3))
- **i18n:** traduzir todas as telas e as mensagens do núcleo ([`cfa607e`](https://github.com/imozart/git-nexus/commit/cfa607eb9bde420eee22485bb18ac64f15adc0d2))
- **update:** instalar a atualização dentro do app, com SHA-256 conferido ([`c7fb367`](https://github.com/imozart/git-nexus/commit/c7fb367ad0b2b319830f8060447c8667496e31bd))

### 📚 Documentação

- vitrine com GIFs no README e página do projeto ([`2634faa`](https://github.com/imozart/git-nexus/commit/2634faabff080e3c5218b0cb49611e291b8b0f5a))

## [1.2.0] - 2026-11-14

### ✨ Novidades

- **i18n:** multi-idioma (pt-BR e inglês) com troca na hora ([`38c2cbc`](https://github.com/imozart/git-nexus/commit/38c2cbcc522b71b00586efae258aaeaf2cdc6c27))
- **hosting:** GitHub e GitLab (inclusive on-premise): PRs/MRs, CI e criar PR ([`278796d`](https://github.com/imozart/git-nexus/commit/278796d81a5bf0dbbafd612954fc3db320bea3b8))
- **packaging:** manifestos de winget, Scoop e Homebrew a cada release ([`7dc487f`](https://github.com/imozart/git-nexus/commit/7dc487f7dd33ed230f8cb114174e35dcb89b4451))
- **update:** avisar quando houver uma versão nova ([`7e4fd35`](https://github.com/imozart/git-nexus/commit/7e4fd351e029092fdce1824effce113bcf15dec9))
- **release:** versão e changelog dentro do app, com o núcleo do pipeline ([`2a03496`](https://github.com/imozart/git-nexus/commit/2a03496a30e11879e2b3405da9e32ea2fbdfae70))
- **rebase:** rebase interativo visual ([`67474f3`](https://github.com/imozart/git-nexus/commit/67474f33246bf0bdc428d3b020039d8b5277ee54))
- **palette:** paleta de comandos (Ctrl+K) e atalhos de teclado ([`fe95d57`](https://github.com/imozart/git-nexus/commit/fe95d57b78f7580d6721d509c36db37c6f09f9dc))
- **dashboard:** painel de repositórios com ahead/behind, fetch e pull em lote ([`a9e23c2`](https://github.com/imozart/git-nexus/commit/a9e23c20bf88d460fad1ab463cac57fbb1fce41f))
- **history:** busca no histórico, histórico de arquivo e blame ([`02cb911`](https://github.com/imozart/git-nexus/commit/02cb911bb0fb41ef7229de0c147341825e6f674f))
- **stash:** stash com nome e restauração parcial ([`5aa9c72`](https://github.com/imozart/git-nexus/commit/5aa9c72b1d1b8835f4d0b652aeef3a58d397639c))
- **staging:** stage e unstage por linha e por bloco ([`6ea837b`](https://github.com/imozart/git-nexus/commit/6ea837bc5b43e601ae32a5c08efacdd22983ffd2))
- **ops:** histórico de operações com desfazer (reflog) e aba Ferramentas ([`30bff95`](https://github.com/imozart/git-nexus/commit/30bff9522a02efa03053d42779a82f76f8ee9a03))
- **policy:** política do time versionada, ticket pela branch e scanner de segredos ([`79664d8`](https://github.com/imozart/git-nexus/commit/79664d866b9f8963567e14746a7c1750656c38dc))

### 🐛 Correções

- **ops:** encurtar hash no resumo do reset ([`b22ae15`](https://github.com/imozart/git-nexus/commit/b22ae15ae2aaed47f482b672a990176c7db6f3c1))

### ⚡ Performance

- repositórios grandes (stage em lotes, lista com janela, filtro e conflitos pelo índice) ([`769b450`](https://github.com/imozart/git-nexus/commit/769b45022986286de9f0c759ab635be5b0916d9f))

## [1.1.0] - 2026-11-13

### ✨ Novidades

- **app:** adicionar ícone do aplicativo e desktopName no Linux ([`766a4b4`](https://github.com/imozart/git-nexus/commit/766a4b44909ba03f6d01851bbad44e97e9cb4b85))

## [1.0.0] - 2026-11-13

### ✨ Novidades

- **ci:** notificar falha da release por e-mail e cancelar a matriz inteira ([`072f28a`](https://github.com/imozart/git-nexus/commit/072f28a1886911430a0daff0f2463dd311636157))
- navegação entre arquivos no diff, build só 64 bits e limpeza ([`0fd6fb5`](https://github.com/imozart/git-nexus/commit/0fd6fb50e58ca6a2d88fcdb344f67d4117b48cca))
- implementa o MVP do GitNexus com releases automáticas ([`00b59ab`](https://github.com/imozart/git-nexus/commit/00b59ab4e09a5c5565fe35aa1b40894199a71a24))

### 🐛 Correções

- **build:** informar homepage no package.json para gerar deb e rpm ([`09d49ab`](https://github.com/imozart/git-nexus/commit/09d49ab1848ebf1e3a934594a2353e986d1b3d73))
- **build:** definir executableName do Linux e não cancelar a matriz ao falhar ([`ea2412d`](https://github.com/imozart/git-nexus/commit/ea2412d1b93e58a9f8bffb23bc1c17c4f9eb7cf0))
- **ci:** usar bash no job de build para expandir VERSION no Windows ([`19a6649`](https://github.com/imozart/git-nexus/commit/19a66491184807ec986fefc595263fc94539d75a))

### 🔹 Outras alterações

- Initial commit ([`3836781`](https://github.com/imozart/git-nexus/commit/3836781649b234584ffc6d07731856ed0a7d186a))

[1.4.0]: https://github.com/imozart/git-nexus/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/imozart/git-nexus/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/imozart/git-nexus/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/imozart/git-nexus/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/imozart/git-nexus/releases/tag/v1.0.0
