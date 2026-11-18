# Changelog

Tudo o que mudou no GitNexus, por versão. As versões seguem o [SemVer](https://semver.org/lang/pt-BR/) e o formato é inspirado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

Este arquivo é **gerado a partir dos commits (Conventional Commits)** a cada release estável, no mesmo commit `chore(release)` que grava a versão: não é preciso editá-lo à mão. Cada versão lista **todos** os commits entre a estável anterior e ela, agrupados por tipo (novidades, correções, testes, CI…); só o commit de registro da própria release fica de fora. Os pacotes para baixar estão em cada [release](https://github.com/imozart/git-nexus/releases).

## [1.17.0] - 2026-11-18

### ✨ Novidades

- **ui:** grupos do ComboBox recolhíveis, com seta que gira (Local aberto e Remoto recolhido no Nova branch) ([`a26c350`](https://github.com/imozart/git-nexus/commit/a26c350e4280d36d0e97b7c64335a65b4035ae1d))
- **ui:** ComboBox com grupos e busca na lista; Nova branch agrupa em Local e Remoto ([`342c6bb`](https://github.com/imozart/git-nexus/commit/342c6bba8a748ccfa56f77069ce468bf99270ea8))
- **ui:** versões do diálogo Novidades em cartões clicáveis e expansíveis ([`faf30bc`](https://github.com/imozart/git-nexus/commit/faf30bc98328b4822daafea4bcf040aadcf734ce))
- **ui:** configurações em abas por grupo, com idioma e tema em ComboBox ([`1000172`](https://github.com/imozart/git-nexus/commit/1000172ef76caab0d94f9f975225de4a6742cdb9))
- **ui:** regra de convenção para fontes e documentação de tipografia e configurações ([`a7f66f0`](https://github.com/imozart/git-nexus/commit/a7f66f0a64bc0cedc865ec214fef6ef1b32d37c5))
- **ui:** reunir idioma, atualização, busca automática e tema no diálogo de configurações ([`8e3ef1d`](https://github.com/imozart/git-nexus/commit/8e3ef1d4f3a0e5c691d9c54a3a106ff2ab9b9981))
- **ui:** diálogo de configurações com a seção Aparência (fontes e ligaduras) ([`be1a371`](https://github.com/imozart/git-nexus/commit/be1a3711cec23085906a95100859badf58105a74))
- **ui-kit:** componente GnDialog (overlay, foco preso, Esc e entrada animada) ([`758d472`](https://github.com/imozart/git-nexus/commit/758d472f9af2ff311e77b3fccdfa20da1e0d6d96))
- **ui-kit:** tokens de elevação, raio, fundo de overlay, camadas e foco ([`b5aa032`](https://github.com/imozart/git-nexus/commit/b5aa032d912f35ce162d500564ea5dff88db59a1))
- **ui:** revisar o layout com a fonte monoespaçada e detector de quebras na janela mínima ([`9a8eb0f`](https://github.com/imozart/git-nexus/commit/9a8eb0f53be66df5344d94f00b450734e6deb01a))
- **ui:** preferências de fonte (interface, código e ligaduras) guardadas e aplicadas ao abrir ([`8892745`](https://github.com/imozart/git-nexus/commit/8892745aa52f2d516c99894f68b0dad58288ceb5))
- **ui:** aplicar a JetBrains Mono ao app inteiro, com ligaduras desligadas por padrão ([`8e8e8c0`](https://github.com/imozart/git-nexus/commit/8e8e8c0eb7fd2f504f94fc4a03daadf65b6bb9fd))
- **ui:** embutir a JetBrains Mono v2.304 no app (arquivos, @font-face, licença OFL e pacote) ([`7c7eaf2`](https://github.com/imozart/git-nexus/commit/7c7eaf2aab2d9a9f30b0024b31677c38cb83519d))

### 🐛 Correções

- **ui:** corrige o fechamento do bloco de tipografia na junção dos testes de convenção ([`8e21dbd`](https://github.com/imozart/git-nexus/commit/8e21dbd934c8807a27ca94f4a1f0b64d74f05066))
- **ui:** Nova branch e Ir para tag ou commit usam o ComboBox do app em vez de select e datalist nativos ([`f13f544`](https://github.com/imozart/git-nexus/commit/f13f544f3cbb9400326acf0a2bba1fa3d449bd12))
- **ui:** campo .gitignore do Novo repositório usa o ComboBox do app ([`951f02f`](https://github.com/imozart/git-nexus/commit/951f02f03a171ee6f51bc93849f8bd8a9de78b3c))
- **ui-kit:** Esc do GnDialog fecha antes a lista aberta de dentro (combobox) e só depois o diálogo ([`e660fc0`](https://github.com/imozart/git-nexus/commit/e660fc04455df4f6c2ff7d4770a07249d5f2df8c))
- **ui:** engrenagem das configurações com a mesma altura, borda e respiro do botão Comandos ([`5031842`](https://github.com/imozart/git-nexus/commit/50318428666aad7969528965085da7d8660a9174))

### 📚 Documentação

- regrava as imagens e GIFs de docs/media com a interface nova e registra o método ([`9676296`](https://github.com/imozart/git-nexus/commit/96762967c91440137b49723308e297bf9cedf10f))
- configurações em abas, com idioma e tema em lista ([`650af91`](https://github.com/imozart/git-nexus/commit/650af9169091c1b033604a6ea4ac854cb06c66bb))

### 🧹 Manutenção

- **ci:** registra o picomatch (GHSA-fc5q-39xc-vjpf) como risco aceito em auditConfig.ignoreGhsas ([`dadc7a1`](https://github.com/imozart/git-nexus/commit/dadc7a1f241c8d7542b9f544d8439f8e9f560a32))
- **ci:** aceitar com prazo o aviso do picomatch (sem correção, só dev) na auditoria ([`f6d3637`](https://github.com/imozart/git-nexus/commit/f6d3637ec66d799c3b326c8bc5869e31e7d699c0))

### 🔹 Outras alterações

- Revert "Merge branch 'chore/audit-picomatch' into release/homologacao-v1.17" ([`1753724`](https://github.com/imozart/git-nexus/commit/1753724036f10f64c0a213d39ad812d2dc446f34))

## [1.16.0] - 2026-11-18

### ✨ Novidades

- **commit:** assinar commits (GPG, SSH ou X.509) pelo formulário, respeitando commit.gpgsign ([`a19709b`](https://github.com/imozart/git-nexus/commit/a19709bbab38ede085559e54cd2696ff8f660d58))
- **lfs:** seção Git LFS em Ferramentas com estado dos arquivos e download ([`09d4a29`](https://github.com/imozart/git-nexus/commit/09d4a29bdbb77714aae32c8546f108644ac5f781))
- **submodules:** seção Submódulos em Ferramentas com estado, inicializar e atualizar ([`d126e36`](https://github.com/imozart/git-nexus/commit/d126e36cd0038010e8361220def750d7cd1d8283))
- **auth:** diálogo de usuário e senha e mensagens claras quando o remoto pede credenciais ([`22c2959`](https://github.com/imozart/git-nexus/commit/22c295916c79d7e6f5c2b5174b75cce8791502e8))
- **app:** notificações do sistema quando a busca traz commits novos e a atualização está pronta ([`2707027`](https://github.com/imozart/git-nexus/commit/27070274a1f375e633e1c83aeaa953ad2ed7b82e))
- **search:** busca no conteúdo dos arquivos (git grep) com resultados por arquivo e linha ([`43427c1`](https://github.com/imozart/git-nexus/commit/43427c16a78a4b9cae9d0a7347c5d1cbaee5758e))
- **repos:** clonar um repositório e criar um novo (git clone e git init) pela tela inicial ([`5d9823d`](https://github.com/imozart/git-nexus/commit/5d9823d3c20c8916fe8fb27ca975f5ce44e2d630))
- **ui:** tema claro e opção Escuro / Claro / Sistema, lembrada entre as aberturas ([`d9c90ac`](https://github.com/imozart/git-nexus/commit/d9c90ac0e62ebb133dca955c7103834a442c582e))

### 🐛 Correções

- **submodules:** teste configura a identidade do git dentro do submódulo (CI não tem global) ([`65ff688`](https://github.com/imozart/git-nexus/commit/65ff68817bd33b12022597cce263f5cf79534f79))
- **commit:** teste de interface monta valores por base64 e propaga correções ([`67233ae`](https://github.com/imozart/git-nexus/commit/67233ae20e52e9e7fb17f309318e91e954174174))
- **lfs:** teste de interface monta valores na página por base64 e propaga correções ([`95b990d`](https://github.com/imozart/git-nexus/commit/95b990d725d5ec021f6ec99446e1f684c974dc58))
- **submodules:** ler o status campo a campo e propagar correções da pilha ([`ff8dc1a`](https://github.com/imozart/git-nexus/commit/ff8dc1ae4da43cf49a3a2f21ce51cd47a864db11))
- **notifications:** teste de interface monta valores na página por base64 (alerta do CodeQL) ([`c0d7701`](https://github.com/imozart/git-nexus/commit/c0d7701ecb7baf03c43b9b9940388f0304303998))
- **search:** teste de interface monta valores na página por base64 (alerta do CodeQL) ([`ced2702`](https://github.com/imozart/git-nexus/commit/ced270209831fe275bdebb702f23725606b6afb3))
- **clone:** reconhecer repositório inexistente no Linux e evitar regex quadrática ([`136d7f5`](https://github.com/imozart/git-nexus/commit/136d7f5d76858250417901142686284fe2b4b946))

## [1.15.0] - 2026-11-17

### ✨ Novidades

- **app:** abrir o repositório no terminal e no editor ([`536aab8`](https://github.com/imozart/git-nexus/commit/536aab8f6ef4a00447402958cca47a7d8bb251fb))
- **app:** zoom da interface por Ctrl+= / Ctrl+- / Ctrl+0 e pela paleta ([`02516e1`](https://github.com/imozart/git-nexus/commit/02516e1478f2e9612dcb113c0a30be05f4d7ef77))
- **app:** lembrar tamanho, posição e estado maximizado da janela ([`ab60c75`](https://github.com/imozart/git-nexus/commit/ab60c75bf7ab149cbdf76f48208e755a2e709b23))
- **sync:** envio forçado seguro (force-with-lease) depois de rebase ou amend ([`9da9656`](https://github.com/imozart/git-nexus/commit/9da9656b88fe3dc63b5ac76b9ad80685d5379b37))
- **tags:** painel de tags para listar, criar, enviar, apagar e ir para a tag ([`467f788`](https://github.com/imozart/git-nexus/commit/467f7884d86393be5564a1269d6ac2ec4582515a))
- **merge:** faixa de merge em andamento com abortar e continuar ([`6c23238`](https://github.com/imozart/git-nexus/commit/6c23238ad5fe2bbaddd65d2c7b298814dbe5c958))
- **graph:** cherry-pick e revert de commit, com continuar e abortar ([`e0b8c18`](https://github.com/imozart/git-nexus/commit/e0b8c188defdf83ea1261b50ce5d7aa0a152654d))
- **commit:** emendar o último commit pelo formulário de commit ([`6df36eb`](https://github.com/imozart/git-nexus/commit/6df36eb01cb6538b63e9b2bdd88cccd2028f3217))

### 🐛 Correções

- **app:** montar os caminhos do VS Code no Windows com win32.join ([`808c35d`](https://github.com/imozart/git-nexus/commit/808c35d3a52ad9199d6b382b281846c2b1702b3f))

## [1.14.0] - 2026-11-17

### ✨ Novidades

- **update:** confete ao abrir o app pela primeira vez após uma atualização ([`e503ce1`](https://github.com/imozart/git-nexus/commit/e503ce1e802bfbba3c71babfa19c45f70344864b))
- **app:** log geral de erros do app em gitnexus-app.log e aviso discreto ([`d1b1276`](https://github.com/imozart/git-nexus/commit/d1b12769ac1dfba1899112bd90bb94f818d0b29f))

### 🐛 Correções

- **git:** ignorar EPIPE ao enviar entrada ao git e trocar a regex do index.lock ([`e78021d`](https://github.com/imozart/git-nexus/commit/e78021dd0a5cdb465fb3876766a4843ab1ab3ade))
- **sync:** atualizar em lote usa o mesmo caminho do painel (stash e mensagens) ([`2ab1f53`](https://github.com/imozart/git-nexus/commit/2ab1f537b00b4ebe99943e6e26f2c38bfbd12a4d))
- **commit:** cada causa de falha do commit mostra a própria mensagem ([`8529339`](https://github.com/imozart/git-nexus/commit/8529339fe95fed21294f12f263dfa773f8aad7c2))
- **git:** consultas rodam com GIT_OPTIONAL_LOCKS=0 e não disputam o index.lock ([`a0bdc33`](https://github.com/imozart/git-nexus/commit/a0bdc33bbafd6abf204fb1f113ae16dcae07fa16))

### 🧪 Testes

- **sync:** dar mais tempo aos cenários de atualizar em lote na suíte inteira ([`961ddee`](https://github.com/imozart/git-nexus/commit/961ddee2d911ad39fb4bac51573983fcd84b5b1b))

## [1.13.2] - 2026-11-17

### 🐛 Correções

- **diff:** descartar e incluir linhas preservam o fim de linha de cada linha ([`1b057d8`](https://github.com/imozart/git-nexus/commit/1b057d8a3472e78690c83a1d761649f6400cf962))

## [1.13.1] - 2026-11-17

### 🐛 Correções

- **update:** apagar pasta de preparo com app.asar não falha mais com EBUSY ([`73da0da`](https://github.com/imozart/git-nexus/commit/73da0da8cb46d1e89991f00e05152917f7fd87d9))

## [1.13.0] - 2026-11-16

### ✨ Novidades

- **diff:** codificação do arquivo no rodapé, lista completa e gravação sem corromper bytes ([`3842656`](https://github.com/imozart/git-nexus/commit/3842656e78a1d75cf561cd367d225be547067c68))

## [1.12.0] - 2026-11-16

### ✨ Novidades

- **update:** log da atualização em arquivo para todas as instalações ([`65094bf`](https://github.com/imozart/git-nexus/commit/65094bfd13af929fbcf919c94f4a7397a25a8fa2))
- **build:** incluir portable no nome do ZIP portátil do Windows ([`62b57f6`](https://github.com/imozart/git-nexus/commit/62b57f6c75dda2d2f3b90df8e4961a4ccd6c1eca))

### 📚 Documentação

- **ci:** documentar o limite de 100 caracteres do título do PR ([`1cfe1b3`](https://github.com/imozart/git-nexus/commit/1cfe1b333b1bd9091213f3e34890940fd1cffc2b))

## [1.11.0] - 2026-11-16

### ✨ Novidades

- **branches:** indicador de sincronização único em todas as telas e filtro de branches desatualizadas ([`f7da463`](https://github.com/imozart/git-nexus/commit/f7da463babbf780bf11958de14e2abd3f3a3309c))
- **branches:** botão de sincronização com progresso, painel de commits, push e atualizar com alterações locais ([`f56f3ac`](https://github.com/imozart/git-nexus/commit/f56f3ac8a025261885681302bc7f8e12b34f889a))
- **branches:** comparar a branch atual com a branch base (origin/main) ([`5d88bd5`](https://github.com/imozart/git-nexus/commit/5d88bd50a6861bfa3ff43af8b34702e0c43f3028))
- **branches:** busca automática em segundo plano para manter o adiante/atrás fiel ao remoto ([`b8ffa60`](https://github.com/imozart/git-nexus/commit/b8ffa6010c2aaefd8762e4702bba6ff4faa8d3b4))
- **branches:** indicador de sincronização (adiante/atrás) no botão do seletor de branch ([`2ad95e6`](https://github.com/imozart/git-nexus/commit/2ad95e678bd4d35c72532f8f907510b97759c1e6))

## [1.10.0] - 2026-11-16

### ✨ Novidades

- **branches:** seletor de branch no cabeçalho do repositório ([`9e2a109`](https://github.com/imozart/git-nexus/commit/9e2a1093094a7a624edda5e24697c974612469ee))
- **branches:** listar, trocar, criar da versão mais recente, excluir, merge, rebase e pull ([`37790aa`](https://github.com/imozart/git-nexus/commit/37790aaf3abe2eec8cc2660f6793f814dc26e4ae))

### 🐛 Correções

- **branches:** leitura do reflog em tempo linear e teste sem JSON.stringify em código ([`d46ac61`](https://github.com/imozart/git-nexus/commit/d46ac61011f93f10a82a9dc04112943f4da1cda9))

### 🧪 Testes

- **ui:** registrar os botões de lista e menu do BranchPicker na lista de exceções ([`d42477b`](https://github.com/imozart/git-nexus/commit/d42477b52c06d574a411e4804fded185bc257552))

## [1.9.1] - 2026-11-16

### 🐛 Correções

- **seguranca:** limita o esquema da URL em redactSecrets e tira JSON.stringify do código dos testes de UI ([`124b16e`](https://github.com/imozart/git-nexus/commit/124b16e894680a690cb012c5a109afe1fc9e4045))

## [1.9.0] - 2026-11-16

### ✨ Novidades

- **ui:** botões por contexto, navegação do diff agrupada, seletores e ícones padronizados ([`203976e`](https://github.com/imozart/git-nexus/commit/203976ee739304dc4e082da416cbe5b92287806d))
- **ui-kit:** GnIcon, GnIconButton, GnButtonGroup e GnSegmented; botão leve colorido e azul sólido acessível ([`a66034c`](https://github.com/imozart/git-nexus/commit/a66034c5de7c4433804fc7662657d8610712bf6e))

### ♻️ Refatorações

- **update:** faixa de atualização usa GnButton, no padrão de cores dos botões ([`9fd2a13`](https://github.com/imozart/git-nexus/commit/9fd2a13deaf79fa8d6eaf4c30c1a8e1192d160bd))

### 📚 Documentação

- **ui:** guia dos componentes Gn*, regras de cor e ícones, e teste que impede regressão ([`7347b8e`](https://github.com/imozart/git-nexus/commit/7347b8ecca5ef17c1a431b0e694a56705bd9c8a0))

### 🧪 Testes

- **ui:** CoreInterface tem 9 botões crus na main (a faixa ganhou Baixar manualmente no estado pronto) ([`a3f4af5`](https://github.com/imozart/git-nexus/commit/a3f4af577fc9c95568bcdab1ab62fe1c7b1b057e))
- **ui:** azul sólido do botão passa a ser o --gn-accent-solid no teste de tons ([`a6bd88e`](https://github.com/imozart/git-nexus/commit/a6bd88ea4c4390d60c9c456d5a90d39c00374a10))

## [1.8.2] - 2026-11-16

### 🐛 Correções

- **update:** atualização do ZIP portátil não depende mais do PowerShell e não fecha o app às cegas ([`6ca7038`](https://github.com/imozart/git-nexus/commit/6ca70388d4bda5f7ff2c889bff38a317dd0ffc48))

## [1.8.1] - 2026-11-16

### 🐛 Correções

- **release:** empacotar o CHANGELOG já com a entrada da versão da própria release ([`7ca263d`](https://github.com/imozart/git-nexus/commit/7ca263db79a4c87396f54341cf4b9d603ff611a2))
- **changelog:** mostrar a versão em uso na lista de novidades ([`a8e6155`](https://github.com/imozart/git-nexus/commit/a8e6155fc2dcda70a982ed7dd5a0107e6b0928f4))

## [1.8.0] - 2026-11-16

### ✨ Novidades

- **changelog:** visualizar o CHANGELOG.md dentro do app, com botão "Ver no GitHub" ([`f54bca0`](https://github.com/imozart/git-nexus/commit/f54bca0a226382faa19338e0cee7eb30b78e4643))

## [1.7.0] - 2026-11-16

### ✨ Novidades

- **update:** atualização dentro do app também no ZIP portátil do Windows ([`e81caad`](https://github.com/imozart/git-nexus/commit/e81caadca949de533e7b796dd73d5e4441525797))

### 📚 Documentação

- configuração do repositório público e textos desatualizados ([`feb0d9b`](https://github.com/imozart/git-nexus/commit/feb0d9b5fcd67448a4693b323e0e7a0226073ce1))
- política de assinatura bilíngue para o SignPath Foundation ([`bdeb881`](https://github.com/imozart/git-nexus/commit/bdeb881a6efa53551bfb4b5ae69f0980051f0e67))

### 🤖 CI/CD

- **dependabot:** merge automático de atualizações patch e minor ([`3eef7e3`](https://github.com/imozart/git-nexus/commit/3eef7e33dc39d109e691b9480de5c1b242eca7f6))

### 🧹 Manutenção

- **deps-dev:** bump @types/node from 24.19.2 to 26.6.6 ([`6462959`](https://github.com/imozart/git-nexus/commit/64629594d98a00b068b773f989af4f46c3fa3bd8))
- **deps-dev:** corrige o alerta do minimatch (override para >= 11.0.1) ([`a2e859b`](https://github.com/imozart/git-nexus/commit/a2e859b0b043aadaef5abf788cfd3e70bbf033cd))

## [1.6.0] - 2026-11-15

### ✨ Novidades

- **ui:** botões com cor semântica (prop tone no GnButton) ([`a869e1b`](https://github.com/imozart/git-nexus/commit/a869e1b59c9162e34a6b85c929b3662a8e1b1aba))

### 📚 Documentação

- badges no README (saúde da main, versão, downloads, licença, plataformas) ([`a80cda2`](https://github.com/imozart/git-nexus/commit/a80cda232db3def0185af40d3a2f537200e68f54))

### 🧪 Testes

- usa um domínio de exemplo no teste de reconhecimento do GitLab ([`ff842ef`](https://github.com/imozart/git-nexus/commit/ff842efb10f6b53e6f493f6db868378972c0de5b))

### 🤖 CI/CD

- **deps:** bump signpath/github-action-submit-signing-request ([`128c5bf`](https://github.com/imozart/git-nexus/commit/128c5bfe616f88c5624eb348b3586d1fb7b74452))

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

[1.17.0]: https://github.com/imozart/git-nexus/compare/v1.16.0...v1.17.0
[1.16.0]: https://github.com/imozart/git-nexus/compare/v1.15.0...v1.16.0
[1.15.0]: https://github.com/imozart/git-nexus/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/imozart/git-nexus/compare/v1.13.2...v1.14.0
[1.13.2]: https://github.com/imozart/git-nexus/compare/v1.13.1...v1.13.2
[1.13.1]: https://github.com/imozart/git-nexus/compare/v1.13.0...v1.13.1
[1.13.0]: https://github.com/imozart/git-nexus/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/imozart/git-nexus/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/imozart/git-nexus/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/imozart/git-nexus/compare/v1.9.1...v1.10.0
[1.9.1]: https://github.com/imozart/git-nexus/compare/v1.9.0...v1.9.1
[1.9.0]: https://github.com/imozart/git-nexus/compare/v1.8.2...v1.9.0
[1.8.2]: https://github.com/imozart/git-nexus/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/imozart/git-nexus/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/imozart/git-nexus/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/imozart/git-nexus/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/imozart/git-nexus/compare/v1.5.2...v1.6.0
[1.5.2]: https://github.com/imozart/git-nexus/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/imozart/git-nexus/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/imozart/git-nexus/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/imozart/git-nexus/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/imozart/git-nexus/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/imozart/git-nexus/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/imozart/git-nexus/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/imozart/git-nexus/releases/tag/v1.0.0
