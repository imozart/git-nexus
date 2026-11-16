# Changelog

Tudo o que mudou no GitNexus, por versão. As versões seguem o [SemVer](https://semver.org/lang/pt-BR/) e o formato é inspirado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

Este arquivo é **gerado a partir dos commits (Conventional Commits)** a cada release estável, no mesmo commit `chore(release)` que grava a versão: não é preciso editá-lo à mão. Cada versão lista **todos** os commits entre a estável anterior e ela, agrupados por tipo (novidades, correções, testes, CI…); só o commit de registro da própria release fica de fora. Os pacotes para baixar estão em cada [release](https://github.com/imozart/git-nexus/releases).

## [1.5.2] - 2026-11-15

### ♻️ Refatorações

- **ui:** seletor de idioma usa o ComboBox padrão ([`9defb29`](https://github.com/imozart/git-nexus/commit/9defb29f3f6b1d52fca712759691a97c1631eea5))

### 📚 Documentação

- CONTRIBUTING, SECURITY, CODE_OF_CONDUCT e modelo de PR ([`36afcfe`](https://github.com/imozart/git-nexus/commit/36afcfe50e91ef819bd3f732385fbfb71939226b))
- README curto e guias de uso, desenvolvimento e CI ([`ba1d03f`](https://github.com/imozart/git-nexus/commit/ba1d03f91ae41c9b7b7a80fa6a0133099d257e82))

### 🧪 Testes

- **e2e:** testes na janela real do Electron com o app empacotado ([`3f2d1f8`](https://github.com/imozart/git-nexus/commit/3f2d1f86c08895696b0b0d5570209800bbf37281))

### 🤖 CI/CD

- **release:** label sem-release para pular a release de um PR ([`4bea4eb`](https://github.com/imozart/git-nexus/commit/4bea4eb859318cbb389ae88bd13ee11b36048363))
- **labels:** label desatualizada para PRs atrás da main ([`5b90253`](https://github.com/imozart/git-nexus/commit/5b902538e1c806463b3844c2989d169e0dd336b9))
- **deps:** Dependabot semanal com grupos e espera de 7 dias ([`4fa102b`](https://github.com/imozart/git-nexus/commit/4fa102b1f30fadfca6d1817ad7d0896a1bb781d1))
- **release:** beta agendado toda segunda, só quando há novidade ([`6d1f9c2`](https://github.com/imozart/git-nexus/commit/6d1f9c2c65159e9632cc7e31bd5157c0de54d58c))
- **release:** publicar release só quando há mudança no app ([`fc46b51`](https://github.com/imozart/git-nexus/commit/fc46b5171b16aec5f56051442798000aff3a91d8))

## [1.5.1] - 2026-11-15

### 🤖 CI/CD

- **release:** changelog lista todos os commits da versão ([`212a6cb`](https://github.com/imozart/git-nexus/commit/212a6cbe4c5644bcf55ea117231bd341a159b435))

## [1.5.0] - 2026-11-15

### ✨ Novidades

- **ui:** todos os comboboxes seguem o padrão do seletor de idioma ([`a2e6872`](https://github.com/imozart/git-nexus/commit/a2e6872e2ef43af6e3ad89cb47d262a3d72709ab))

### 🐛 Correções

- **tools:** aba Arquivo travava em repositórios grandes (combobox com busca) ([`e61c6bf`](https://github.com/imozart/git-nexus/commit/e61c6bf57ff818821f761fc266cc6729a9432a29))

### 🤖 CI/CD

- **release:** CHANGELOG.md gerado a cada release estável, em workflow próprio ([`07f9a97`](https://github.com/imozart/git-nexus/commit/07f9a97f0949001c6e60cd687b571a8514912ae1))
- **labels:** ordem de merge e label bloqueado para PRs empilhados ([`b7079a7`](https://github.com/imozart/git-nexus/commit/b7079a76ba9b4c7b7ad3e91ee1ac25df347fcdec))
- **labels:** label de conflito nos PRs abertos ([`680fb96`](https://github.com/imozart/git-nexus/commit/680fb9604bf992904a6bb3d8c9b44483b9595db5))
- **labels:** label de tamanho do PR (XS a XL) pelas linhas alteradas ([`c252d3e`](https://github.com/imozart/git-nexus/commit/c252d3e4b7a425324c38f31598aadc64f3c969b7))
- **branch:** verificar o nome da branch (tipo/descrição) em todo PR ([`f52a941`](https://github.com/imozart/git-nexus/commit/f52a94180474cf2e00f5efe01b3f0e4968a8c409))
- **release:** categorias das notas de release geradas pelo GitHub, por label ([`266c63f`](https://github.com/imozart/git-nexus/commit/266c63f10198c20ad7471bf379bfada58394fb3f))
- **labels:** label de tipo pelo título do PR, com a branch como alternativa ([`b5a9dcc`](https://github.com/imozart/git-nexus/commit/b5a9dccbad5eaa9251135ddf411fcfbc8b7494a4))
- **labels:** catálogo de labels versionado e sincronização automática ([`7cea57b`](https://github.com/imozart/git-nexus/commit/7cea57b9dcaf2a87fb052091e1e1331fe97a99bd))
- composite action para preparar o repositório nos workflows ([`68fca8a`](https://github.com/imozart/git-nexus/commit/68fca8ad4f3c801e4dc50f5e615830eee74ff07b))
- rótulos automáticos por pasta e fechamento de itens parados ([`d161e89`](https://github.com/imozart/git-nexus/commit/d161e8999dcdf0b16c55c8ad75593b6b563125b6))
- verificação semanal da main com issue em caso de falha ([`8c4cf2b`](https://github.com/imozart/git-nexus/commit/8c4cf2baf54ef2b779ab2402d908a69996a4a666))
- abrir uma issue quando a release falha ([`27ba0c8`](https://github.com/imozart/git-nexus/commit/27ba0c8c6ffc218e11ed87aef4812661b20f060b))
- versão do Node em um arquivo só (.node-version) ([`3898858`](https://github.com/imozart/git-nexus/commit/3898858d1bd0e42848da40f16fbc38d3d3d3e0a0))
- varredura de segredos no histórico (gitleaks) ([`359484b`](https://github.com/imozart/git-nexus/commit/359484b64663f3f5d44d29545d33bcbd43be84ab))
- SBOM e proveniência assinada nas releases ([`ae5987a`](https://github.com/imozart/git-nexus/commit/ae5987a6a5f49fe4d65a004d75d4f3635fdc3738))
- testes de interface automatizados no repositório ([`7b07e90`](https://github.com/imozart/git-nexus/commit/7b07e9028c2faeef6ae855de5515cb4455702cc8))
- teste de fumaça do app empacotado ([`d09be7a`](https://github.com/imozart/git-nexus/commit/d09be7aec7585e0b7548d6c5a4cc6f98b35b6546))
- cache do Electron nos builds da release ([`ad07c32`](https://github.com/imozart/git-nexus/commit/ad07c32ddeeb4fbcad95bc83c89eacbf2924bf83))
- revisão e auditoria de dependências no PR ([`2599805`](https://github.com/imozart/git-nexus/commit/25998055c593ceafd92106c432f39383f3cb7430))
- cobertura de testes com piso mínimo ([`afcb0eb`](https://github.com/imozart/git-nexus/commit/afcb0eb8ee083973fe82ed3ed6fb62d2cd5ac713))
- título do PR, lint dos workflows e ensaio do empacotamento ([`f5e011c`](https://github.com/imozart/git-nexus/commit/f5e011c8938876e0c30db37e84c27cbc0553723d))

### 🧹 Manutenção

- **repo:** templates de issue em formulário, no padrão do Beekeeper e adaptados ao GitNexus ([`cb83e21`](https://github.com/imozart/git-nexus/commit/cb83e2167c5fae739ab63db2766b324965e000d1))
- **repo:** CODEOWNERS por área do repositório ([`10d9308`](https://github.com/imozart/git-nexus/commit/10d9308c99ae5f5de51c6033b6ce0480f162531a))

## [1.4.0] - 2026-11-15

### ✨ Novidades

- **ui:** painéis laterais recolhíveis com faixas nomeadas ([`12e464a`](https://github.com/imozart/git-nexus/commit/12e464a8afac2b32f72270db3926fac127491647))
- **log:** aba de log com os comandos git executados, por repositório ([`0436ea9`](https://github.com/imozart/git-nexus/commit/0436ea9f008ad857350c220841289947cc9c44e9))
- **i18n:** seletor de idioma com bandeira e lista arredondada ([`6a50009`](https://github.com/imozart/git-nexus/commit/6a50009b0949ba83d4ce4a9d4457ab7c31c5af41))

### 🤖 CI/CD

- versão no código e canal beta ([`fe0a082`](https://github.com/imozart/git-nexus/commit/fe0a082fbd554722c4846e324411b84cb204931c))

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

### 🤖 CI/CD

- **release:** assinar o Windows pelo SignPath quando configurado ([`4fa15fc`](https://github.com/imozart/git-nexus/commit/4fa15fcb333e096daa1206c582a552d1aa036054))

### 🧹 Manutenção

- adotar a licença GPL-3.0 ([`a45cb06`](https://github.com/imozart/git-nexus/commit/a45cb06fc7b8737f9576a208b8baaefb1f642890))

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

[1.5.2]: https://github.com/imozart/git-nexus/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/imozart/git-nexus/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/imozart/git-nexus/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/imozart/git-nexus/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/imozart/git-nexus/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/imozart/git-nexus/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/imozart/git-nexus/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/imozart/git-nexus/releases/tag/v1.0.0
