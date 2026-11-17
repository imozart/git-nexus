# Guia de uso

O que o GitNexus faz e como usar cada parte. Para instalar, veja o [README](../README.md); para mexer no código, o [guia de desenvolvimento](DESENVOLVIMENTO.md).

## Paleta de comandos e atalhos

**Ctrl+K** (ou **Ctrl+Shift+P**; ⌘ no macOS) abre a paleta: digite parte do nome de qualquer ação (sem acento, letras salteadas funcionam: `gh` encontra "Grafo / Histórico"), ↑↓ navega, Enter executa, Esc fecha. Os comandos usados por último aparecem primeiro. Há um comando por repositório catalogado ("Abrir repositório: …") e os do repositório aberto.

| Atalho | Ação |
|---|---|
| Ctrl+K / Ctrl+Shift+P | Paleta de comandos |
| Ctrl+1 | Ir para Repositórios |
| Ctrl+PageDown / Ctrl+PageUp | Próxima / anterior aba |
| Alt+W | Fechar aba |
| F5 | Recarregar o status do repositório (só relê o local; quem fala com o remoto é o botão de sincronização) |
| Ctrl+Shift+A / Ctrl+Shift+U | Incluir tudo / remover tudo do commit |
| Ctrl+Shift+C | Ir para o título do commit |
| Ctrl+Enter (no formulário) | Fazer o commit |
| Ctrl+Shift+B | Mostrar/ocultar o painel de commit |
| Ctrl+Shift+L | Mostrar/ocultar o log do Git |
| Ctrl+Shift+E | Mostrar/ocultar a lista de arquivos |
| F7 / Shift+F7 | Próxima / diferença anterior |
| Alt+→ / Alt+← | Próximo / arquivo anterior |

Os atalhos só usam Ctrl/⌘/Alt (ou teclas F), então nunca atrapalham a digitação. No app empacotado (Windows/Linux) o menu padrão do Electron é removido, porque reservaria Ctrl+W, Ctrl+R e o DevTools.

## Painel de repositórios

A tela inicial mostra, para cada repositório catalogado: **branch**, o **indicador de sincronização** (veja [Sincronização com o remoto](#sincronização-com-o-remoto): ↓ commits para receber, ↑ commits para enviar, divergida, remota apagada), **alterações locais**, **conflitos** ou "em dia" (só quando está mesmo em dia: uma branch cuja remota foi apagada não diz "em dia"). O status carrega em segundo plano (4 por vez).

- **Buscar todos:** `git fetch --all --prune` em todos, com relatório de sucessos e falhas (remoto inacessível, credencial necessária…). Nunca pergunta senha: sem terminal, o git falha em vez de travar.
- **Atualizar seguros:** pull **somente por fast-forward**, e só onde é seguro: há upstream, o repositório está atrás, não divergiu e a árvore está limpa. Nada de merge automático nem reescrita de histórico; o relatório diz quantos foram atualizados.
- **Buscar / Pull** individuais em cada linha (o pull recusa quando a branch divergiu e explica o motivo).
- **Só com pendências:** esconde os repositórios em dia.

## Aba de Staging (referência: IntelliJ)

- **Lista de arquivos** em dois grupos — *Alterações* (rastreados) e *Arquivos não versionados* — com checkbox: marcado = no commit (stage), parcial = parte no stage, vazio = pendente. O resumo no topo mostra quantos estão no commit e quantos pendentes. Cores/letras por status (M, A, D, R, novo).
- **Seleção múltipla:** clique, Ctrl+clique, Shift+clique, Ctrl+A e retângulo (arrastar no espaço vazio). **Arraste** a seleção para *Alterações* para incluí-la no commit (e para *Não versionados* para tirar arquivos novos do stage). Espaço marca/desmarca; ↑/↓ navegam.
- **Menu de contexto** (botão do meio ou direito, em arquivo ou grupo): descartar alterações, incluir/remover do commit, adicionar ao `.gitignore`, copiar caminho/nome, mostrar na pasta, abrir. Descartes pedem confirmação, guardam cópia em `GitNexusData/discarded` e oferecem **Desfazer**.
- **Diff lado a lado** (HEAD x working tree) com numeração, trechos inalterados recolhíveis e botões por linha (`›`) e por bloco (`»`) para descartar. Barra superior: ↑ diferença anterior (Shift+F7) · ↓ próxima (F7) · ← arquivo anterior (Alt+←) · → próximo arquivo (Alt+→). A diferença atual fica destacada e o contador mostra “diferença 2 de 5”; na primeira/última diferença, ↑/↓ pulam para o arquivo anterior/próximo da lista (inclusive não versionados) e funcionam sem clicar antes em nenhum arquivo. Modo *Unificado* disponível.
- **Emendar o último commit** (caixa no formulário de commit): carrega a mensagem do último commit nos campos (tipo, escopo, título, corpo, ticket, breaking change), inclui o que está no stage no mesmo commit e roda `git commit --amend`, com os mesmos hooks e a mesma validação (política do time incluída). Sem nada no stage, só troca a mensagem. Desmarcar devolve o rascunho que estava no formulário. Se o commit **já foi enviado** ao remoto, o app avisa que emendar reescreve o histórico publicado e só habilita o botão depois de você confirmar; o envio seguinte precisará ser forçado com segurança (veja *Enviar com segurança*, em *Sincronização com o remoto*).
- **Codificação do arquivo** (rodapé do app): mostra o caminho do arquivo aberto no diff e, à direita, a codificação em que ele foi lido (`UTF-8`, `Windows-1252`…). O app detecta sozinho (BOM, UTF-8 válido; senão Windows-1252, o legado mais comum no Windows). **Clicar na codificação** abre a lista, com pesquisa e por grupo (Unicode, Europa Ocidental/Central, Cirílico, Grego, Turco, Hebraico, Árabe, Tailandês, Japonês, Chinês, Coreano…), com as opções de editores como o Notepad++ e o IntelliJ: UTF-8 (com e sem BOM), UTF-16 e UTF-32 (LE/BE, com e sem BOM), UTF-7, Windows-125x, ISO-8859-x, IBM437/850/852/866…, KOI8, Mac, Shift_JIS, EUC-JP/KR, GBK, GB18030, Big5 e outras. Escolher **recarrega o diff** nessa codificação; a escolha fica lembrada **por arquivo** e *Automática* volta à detectada. O arquivo em disco **não é convertido**.
  **Integridade:** abrir o diff só lê. Quando o app grava (descartar linha/bloco, incluir linha/bloco no stage, resolver conflito), regrava **na mesma codificação em que leu**, com o mesmo BOM, de modo que os bytes que você não editou não mudam (antes tudo era regravado como UTF-8 e trocava "ç", "ã" por "�" em arquivos Windows-1252). Se o arquivo tem bytes que não existem na codificação em uso (por exemplo, um arquivo Windows-1252 lido como UTF-8, que mostra "�"), o rodapé avisa e as ações que gravam ficam **desligadas** até você escolher a codificação certa. E se o texto tiver um caractere que a codificação não representa, a gravação é **recusada** com a explicação, em vez de trocá-lo por "?". O fim de linha (CRLF/LF) é tratado à parte e não depende da codificação.
- **Painéis laterais recolhíveis, com nome:** as faixas finas nas bordas (*Alterações* à esquerda, *Commit* à direita; *Conflitos* na tela de merge) mostram o nome de cada painel, com um contador (arquivos pendentes / arquivos no commit). Clique na faixa para recolher ou reabrir o painel e dar mais espaço ao diff; o estado é lembrado.
- **Log do Git** (parte de baixo da tela, recolhível como no IntelliJ): cada comando `git` que o app executa naquele repositório, com horário, resultado (✓/✗) e duração. Consultas (`status`, `log`, `diff`…) aparecem em cinza; o filtro *Só alterações* mostra apenas o que modifica o repositório; comando que falhou já mostra o motivo; dá para copiar a lista e limpar. A altura se ajusta arrastando a borda de cima. Senhas e tokens em endereços ou cabeçalhos são mascarados (`https://***@…`) e nada é gravado em disco: o log vive só na memória (últimos 500 comandos por repositório).
- **Stage por linha e por bloco:** o seletor *Tudo | Pendente | No commit* escolhe o que comparar. Em **Pendente** (índice x disco) cada linha tem **+** e cada bloco **⊕** para incluir no commit só aquele trecho; em **No commit** (HEAD x índice) **−** e **⊖** tiram o trecho do commit. Só o índice é alterado (o disco não muda), há *Desfazer* no aviso, e o commit parcial deixa o resto pendente. Funciona também em arquivos novos.

## Seletor de branch

No cabeçalho do repositório, a branch atual é um botão (ícone de branch, nome e seta). Clicar abre o painel:

- **Busca** nas branches **locais e remotas**: digite parte do nome (o trecho encontrado fica realçado) e as seções se abrem sozinhas. Esc ou clique fora fecham.
- **Ações:** *Atualizar a branch atual* (busca do remoto e atualiza só por fast-forward, guardando e devolvendo as suas alterações locais), *Nova branch…* e *Ir para tag ou commit…* (deixa o HEAD desanexado). Duas caixas: *Só desatualizadas* (mostra só as branches locais atrás do remoto, divergidas ou com a remota apagada; funciona junto da pesquisa) e *Buscar automaticamente* (veja abaixo).
- **Listas:** *Recentes* (as últimas branches em que você esteve, pelo reflog), *Locais* e *Remotas* (agrupadas por remoto). Cada linha local mostra o mesmo indicador de sincronização do cabeçalho; a atual vem marcada.
- **Menu de cada branch** (clique na linha, ou → no teclado; duplo clique ou Enter faz o checkout): *Trocar para esta branch* (numa remota, cria a branch local que a acompanha), *Nova branch a partir dela…*, *Merge dela na atual*, *Rebase da atual sobre ela* (pede confirmação, porque reescreve o histórico), *Pull na atual com rebase ou com merge* (branches remotas) e *Excluir* (só branch local; se ela tiver commits que não estão em nenhuma outra, pede uma segunda confirmação).
- **Nova branch a partir da mais recente:** por padrão o diálogo cria a partir de **origin/main (ou a branch principal do remoto) depois de buscá-la**, isto é, da versão mais recente do remoto, e não da cópia local que pode estar velha. Se não houver rede, usa a última cópia local e avisa. Também dá criar a partir da branch atual ou de qualquer outra, e escolher se quer trocar para a nova. A nova branch **não passa a acompanhar a `main`** (um pull nela não traria a main).
- **Conflitos:** se um merge, rebase ou pull parar por conflitos, o app não mostra erro: a operação fica em andamento e leva você à tela de conflitos (o rebase tem a faixa própria no topo).
- Se houver alterações locais que seriam sobrescritas, a troca é recusada com a explicação (faça commit ou guarde com stash antes).

## Sincronização com o remoto

O GitNexus mostra, sem você pedir, se a branch está desatualizada e deixa resolver ali mesmo. O mesmo indicador aparece no cabeçalho do repositório, nas linhas do seletor de branch e na lista de repositórios, sempre com número, texto no tooltip e nome acessível (a informação nunca depende só da cor):

| Indicador | Significado |
|---|---|
| *(nada)* | em dia com o upstream |
| **↓N** (âmbar) | o remoto tem N commits que a branch ainda não tem |
| **↑N** (verde) | a branch tem N commits que ainda não foram enviados |
| **↓N ↑M !** | divergida: os dois ao mesmo tempo |
| **∅** (cinza) | a branch não tem upstream (não acompanha nenhuma branch remota) |
| **!** (vermelho) | o upstream está configurado, mas a branch remota foi apagada |
| **↓N main** | na tela do repositório: a branch está N commits atrás da branch principal do remoto (`origin/main`), que o upstream não mostra (as branches criadas pelo app não acompanham a main) |

- **Botão de sincronização** (ao lado do seletor de branch, como o *Fetch/Pull/Push origin* do GitHub Desktop): o rótulo e a ação mudam com o estado. *Buscar origin* (em dia), *Atualizar origin ↓N* (atrás: traz os commits por fast-forward), *Enviar origin ↑N* (à frente), *Publicar branch* (sem upstream, ou com a remota apagada: envia e cria o upstream) e *Sincronizar ↑N ↓M* (divergida: abre o painel para escolher). O botão **Recarregar** só relê o status local (F5); quem fala com o remoto é o botão de sincronização.
- **Painel de sincronização** (a seta ao lado do botão): lista os commits que **chegam** e os que **saem** (hash, assunto, autor, há quanto tempo; os 20 mais recentes e "e mais N"). Sem upstream, lista o que ainda não foi publicado. Divergida: *Atualizar com merge* ou *Atualizar com rebase* (o rebase pede confirmação, porque reescreve o histórico da branch).
- **Atualizar com alterações locais**, como o *Update* do IntelliJ: o app guarda as alterações ainda não commitadas (stash), atualiza e as devolve no fim. Se a devolução conflitar, as alterações **continuam no stash**, nada se perde, e o app avisa e leva aos conflitos. Se a atualização falha antes de mudar algo (rede, divergência), as alterações voltam na hora.
- **Enviar nunca força.** Se o remoto tem commits que a branch não tem, o envio é recusado com a orientação de atualizar antes. A única exceção é o **envio seguro**, abaixo.
- **Enviar com segurança (depois de um rebase ou de um amend):** reescrever o histórico de uma branch já publicada a deixa *divergida* do remoto. No painel de sincronização aparece **Enviar com segurança**, que usa `git push --force-with-lease`: antes de confirmar o app diz quantos commits do remoto serão substituídos, e o git **recusa** se o remoto recebeu commits que você ainda não viu desde a última busca (então ninguém tem o trabalho apagado sem saber). Nunca é oferecido na branch principal (`main`, `master`, `develop`…) nem em `release/*`, nem em branch ainda não publicada, e o núcleo também recusa nesses casos.
- **Andamento visível:** enquanto busca, atualiza ou envia, o botão fica ocupado (*Atualizando… 45%*) e uma barra mostra o progresso: a porcentagem que o git informa (receber objetos, resolver diferenças…) ou uma barra indeterminada quando ele não informa número. Não dá para clicar duas vezes. A busca automática mostra só uma barra discreta.
- **Busca automática:** o app busca do remoto sozinho (`git fetch --all --prune`) ao abrir o repositório, ao voltar o foco para a janela e a cada 5 minutos, com intervalo mínimo de 5 minutos por repositório, para o adiante/atrás não ficar velho. É silenciosa: nunca pergunta senha e não mostra erro quando falha (sem rede, sem credencial). O tooltip do botão do seletor mostra *Última busca no remoto: há 4 min*. Desligue em *Buscar automaticamente*, no painel do seletor de branch.
- **Em relação à branch principal:** numa feature branch, o painel do seletor mostra *Em relação a origin/main: ↑A ↓B* com *Merge de origin/main* e *Rebase sobre origin/main* (o rebase pede confirmação). Não aparece na própria main, com HEAD desanexado nem sem remoto.

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
- **Tags** (seção *Tags* em Ferramentas): **criar** uma tag no commit atual, ou em outro commit, branch ou tag; sem mensagem ela é *leve* (só um nome), com mensagem é *anotada* (guarda quem criou, quando e o texto: a indicada para releases). A lista mostra nome, commit, data, assunto, a mensagem das anotadas e se a tag está **no remoto** ou é **só local** (consulta o remoto; se não der, a lista continua sem essa marca). **Ir para** deixa o HEAD desanexado na tag; **Enviar** (uma) e **Enviar as que faltam** (todas) levam ao remoto **sem forçar**: se o remoto já tem uma tag com esse nome em outro commit, o envio é recusado. **Apagar** tira só a local; **Apagar no remoto** tira do remoto (os commits continuam), os dois com confirmação. No detalhe de um commit do grafo, **Criar tag aqui** abre as Tags com esse commit como destino.
- **Cherry-pick e revert (aba Grafo):** no detalhe de um commit, **Cherry-pick** aplica as mudanças dele na branch atual (um novo commit, com a mesma mensagem) e **Reverter** cria um commit que desfaz as mudanças dele, sem reescrever o histórico. Os dois pedem confirmação. Em commit de merge usam o primeiro pai. Se parar por **conflitos**, o app abre a tela de conflitos e, na tela do repositório, uma faixa *Cherry-pick (ou Revert) em andamento* com **Continuar** (só habilita depois de resolver e marcar como resolvido) e **Abortar** (volta ao estado de antes). Se as mudanças do commit já estão na branch, o app avisa e não deixa a operação aberta.
- **Merge em andamento (abortar ou concluir):** quando um merge para por conflitos, a mesma faixa aparece na tela do repositório **e** na tela de conflitos: *Merge em andamento. N arquivo(s) em conflito…*. **Abortar** (com confirmação) roda `git merge --abort` e devolve o repositório ao estado de antes do merge; **Continuar** só liga depois que todos os conflitos foram resolvidos e marcados como resolvidos, e conclui o merge com a mensagem padrão (também dá para concluir pelo formulário de commit).
- **Arquivo (histórico e blame):** escolha um arquivo (ou use *Histórico do arquivo* / *Anotar (blame)* no menu do botão do meio, ou os atalhos ⏱ 👤 no detalhe do commit). O **histórico** segue renomeações; o **blame** mostra autor, data e commit de cada linha, com uma faixa de cor por commit, inclui as linhas ainda não commitadas e abre o diff do commit ao clicar.
- **Rebase interativo visual:** escolha os últimos N commits (ou use *Rebase interativo a partir daqui* no detalhe de um commit do grafo). Cada commit vira uma linha que você **arrasta** (ou sobe/desce pelos botões) e para a qual escolhe a ação: **manter**, **editar mensagem** (carrega a mensagem completa), **juntar (squash)** ao de cima combinando as mensagens, **juntar (fixup)** descartando a mensagem, ou **descartar**. O resumo mostra "4 commits → 2" e a lista avisa se algum commit já está publicado (exigirá push forçado). Proteções: exige árvore limpa (peça um stash antes), recusa histórico com merges, valida a lista (o primeiro mantido não pode ser "juntar", nenhum commit pode faltar) e **guarda um backup** em `refs/gitnexus/rebase-backup/<branch>/<data>`. O rebase aparece em *Operações* e pode ser desfeito. Se parar por **conflito**, a tela mostra o passo (2/4) e os arquivos; resolva na aba Conflitos e use *Continuar*, *Pular este commit* ou *Abortar* (volta tudo ao estado anterior), e o Staging avisa que há um rebase em andamento. Ainda não funciona em repositórios WSL2.
- **Versão e changelog:** calcula a próxima versão (SemVer) e o changelog a partir dos Conventional Commits desde a última tag `vX.Y.Z`, com **as mesmas regras e o mesmo código do pipeline de release** (`scripts/lib/release-core.mjs`): breaking → major, `feat` → minor, o resto → patch (ou force o incremento). Mostra "v1.0.0 → v1.1.0" e as seções (Novidades, Correções…, com escopo, PR e ticket); **Copiar notas**, **Salvar no CHANGELOG.md** (insere no topo, sem duplicar versão, preservando CRLF) e **Criar tag** anotada com o changelog na mensagem (local; o push é seu). Sem tags, a primeira versão vem do `package.json`. Funciona em qualquer repositório que use Conventional Commits.
- **GitHub e GitLab (PRs/MRs e CI):** a aba *PRs / MRs e CI* reconhece o remoto (`https://`, `git@host:`, `ssh://`) e funciona com **github.com, GitHub Enterprise, gitlab.com e GitLab próprio (on-premise)**; para um host que o app não reconhece, você escolhe se é GitHub ou GitLab. Conecte uma conta com um token de acesso (o link e os escopos necessários aparecem na tela): ele é **validado no provedor** e guardado **criptografado pelo sistema** (DPAPI no Windows, Keychain no macOS, libsecret no Linux; sem isso o token só vive na memória); as chamadas à API acontecem no processo principal e o token **nunca volta para a tela**. Aí dá para: **listar** pull requests / merge requests (abertos, mergeados, fechados) com o **status do CI** de cada um (GitHub: check-runs e statuses; GitLab: pipeline) e ver a falha; **criar** um PR/MR com título e **descrição montados dos Conventional Commits** da branch (seções por tipo, escopo e `Refs:` com os tickets), escolhendo o destino, como rascunho e **enviando a branch antes** (push) se ainda não existir no remoto. No **detalhe de um commit do Grafo** aparece o status de CI dele. Só abre no navegador páginas do mesmo host do remoto.

## Repositórios grandes

Medido em um repositório sintético de **20.000 arquivos e 5.000 commits** (`GN_PERF=1 pnpm exec vitest run packages/git-core/test/perf.test.ts`; a ferramenta gera o repositório com `git fast-import` e imprime os tempos):

| Operação | Tempo |
|---|---|
| status (limpo / com 8.000 alterações) | ~0,2 s / ~0,3 s |
| histórico de 300 commits | ~0,1 s |
| busca por mensagem / por autor | ~0,1 s |
| busca por conteúdo (pickaxe) em 5.000 commits | ~0,45 s |
| histórico de arquivo (segue renomeações) | ~0,27 s |
| blame de um arquivo de 5.000 linhas | ~0,15 s |
| conflitos com 8.000 alterações | 0,12 s (era 0,73 s) |

O que isso mudou no app:

- **Lista de arquivos com janela:** o staging desenha 500 linhas por grupo e oferece **Mostrar mais / Mostrar todos**; com 9.000 alterações o DOM caiu de ~45 mil para ~5 mil nós. Os checkboxes de grupo, a seleção (Ctrl+A) e o "incluir tudo" continuam valendo para **todos** os arquivos, não só os desenhados.
- **Filtro de arquivos** (aparece com mais de 30 alterações): filtra por parte do caminho; o checkbox do grupo passa a valer para o que está filtrado.
- **Incluir/remover do commit em lotes:** antes, "incluir tudo" com milhares de arquivos estourava o limite de ~32 mil caracteres da linha de comando do Windows e simplesmente não funcionava; agora vai em lotes e com `--literal-pathspecs` (um arquivo chamado `a[1].txt` ou `*.md` não vira curinga).
- **Detecção de conflitos pelo índice** (`git ls-files --unmerged`), em vez de `git diff`, que comparava o conteúdo de todos os arquivos alterados a cada atualização da tela.

## Idiomas

**Português (Brasil)** e **English**, com troca **na hora** (seletor ao lado de *Comandos* ou pela paleta). Na primeira abertura vale o idioma do sistema. **Todas as telas** estão traduzidas, e também as mensagens de erro e aviso do núcleo, do worker e da validação de commit. Só o texto gerado a partir dos commits (notas de release e CHANGELOG) fica em português, porque usa o mesmo núcleo do pipeline de release. Como contribuir com outro idioma: [`I18N.md`](I18N.md).

## Atualizações

O app avisa quando existe uma versão nova: **8 segundos depois de abrir** (para não atrasar a abertura) e depois **a cada 12 horas**, ele consulta a última release pública do GitHub e, se for maior que a versão em uso, mostra uma faixa no topo: *Nova versão X disponível (você usa Y)*, com **Atualizar agora**, **Ver novidades**, **Depois** (volta a avisar na próxima abertura) e **Ignorar esta versão**.

- **Atualizar agora** (Windows instalado, Windows em ZIP portátil e Linux em AppImage): tudo acontece dentro do app. Ele baixa o pacote **na mesma pasta do executável** (se ela não for gravável, na pasta de dados), mostra a barra de progresso e **confere o SHA-256** contra o `SHA256SUMS.txt` da mesma release; se o hash não bater, o arquivo é descartado. Só depois mostra *Versão X baixada e conferida* e pede a sua confirmação em **Reiniciar agora** — nada é fechado sozinho (**Depois** adia). Ao confirmar: no Windows instalado roda o instalador em modo silencioso (por usuário, sem administrador); no ZIP portátil extrai o pacote, troca os arquivos (a pasta `GitNexusData` e seus outros arquivos são preservados; se algo falhar, a versão anterior é restaurada) e reabre; no Linux troca o arquivo do AppImage e reabre. O pacote baixado é **apagado** ao terminar (e, por garantia, os restos são limpos a cada abertura). Na primeira abertura depois de atualizar, o app avisa *GitNexus atualizado para a versão X*.
- Se a atualização dentro do app falhar, aparecem **Tentar de novo** e **Baixar manualmente** (abre a página da release no navegador). Esse é também o único caminho nos formatos que não se atualizam sozinhos (macOS, .deb/.rpm, pasta sem permissão de escrita) e em releases antigas sem `SHA256SUMS.txt`; nesses casos o botão do aviso é **Baixar**.
- **Log da atualização** (todas as instalações): o app grava todo o andamento da atualização no arquivo **`gitnexus-update.log`**, na pasta `logs` dos dados do app: no ZIP portátil e no AppImage é `GitNexusData/logs/` ao lado do programa; no Windows instalado, a pasta `logs` dentro dos dados do aplicativo do usuário (em `%APPDATA%`). Ele registra o contexto (versão, sistema, tipo de instalação, pastas), a consulta à release, o download (tamanho, andamento, SHA-256), a extração (qual ferramenta e o erro completo), o preparo, a partida do atualizador e cada passo da troca dos arquivos, inclusive o que fica no mesmo arquivo depois que o app fecha. Cada abertura registra a versão em que o app subiu, para comparar com o fim do atualizador. Quando algo falha, a mensagem de erro diz onde está o log. Guarda só a atualização atual e a anterior (`.old`, até cerca de 512 KB cada) e não contém senhas nem tokens; tem os caminhos das suas pastas, então confira antes de compartilhar.
- **Log de erros do app:** exceções inesperadas (da interface, do processo principal e do worker do git) e processos que caíram são registrados em **`gitnexus-app.log`**, na mesma pasta `logs` do log da atualização. Quando a interface tem um erro, aparece um aviso discreto com o caminho do arquivo (o app continua aberto). O mesmo erro repetido é registrado uma vez a cada 5 segundos. Confira o arquivo antes de compartilhar: ele tem caminhos das suas pastas.
- **Segurança:** a interface não informa endereço nenhum: o processo principal consulta a release, escolhe o pacote e só baixa de `https://github.com/imozart/git-nexus/…`. O nome do arquivo é validado e há um limite de tamanho.
- **Privacidade:** a verificação é uma única requisição GET à API pública do GitHub, sem enviar nenhum dado seu nem identificador (só o `User-Agent` genérico `GitNexus-update-check`). O download só acontece quando você clica em *Atualizar agora* ou *Baixar*.
- **Novidades** (botão na página principal): abre dentro do app o `CHANGELOG.md` que acompanha esta versão, com a lista de versões (a mais recente aberta, as outras recolhíveis, a que você usa marcada como *em uso*) e links dos commits. O botão **Ver no GitHub** (com a marca do GitHub) abre o `CHANGELOG.md` no repositório. Funciona sem internet; só os links e o botão abrem o navegador.
- Pela paleta (Ctrl+K): *Verificar atualizações do GitNexus* (consulta na hora, mesmo para uma versão ignorada) e *Desligar/Ligar a verificação automática*.
- Precisa que o repositório seja **público**; com repositório privado a consulta retorna "não encontrado" e o app segue normalmente, sem avisos. Em desenvolvimento a verificação fica desativada.

## Verificar o que você baixou

Toda release traz, além dos pacotes:

- `SHA256SUMS.txt`: o SHA-256 de cada arquivo (`sha256sum --check SHA256SUMS.txt`; no Windows, `Get-FileHash <arquivo>`).
- `GitNexus-<versão>-sbom.cdx.json`: a **lista de componentes** (SBOM, CycloneDX) do app, gerada do lockfile. Cobre tudo o que o lockfile resolve, inclusive ferramentas de build; o pacote final embute só o que o vite junta mais o Electron.
- **Proveniência assinada** (releases publicadas com o repositório público): prova de qual commit e workflow geraram cada arquivo. Confira com
  `gh attestation verify <arquivo> --repo imozart/git-nexus`. Se o arquivo foi trocado ou não veio deste repositório, o comando falha.

## Assinatura de código (Windows)

Hoje os executáveis do Windows **não são assinados**, então o SmartScreen avisa na primeira abertura ("Mais informações" → "Executar assim mesmo"). O pipeline já está pronto para assinar pelo **SignPath Foundation** (gratuito para código aberto): o passo a passo está em [`CODE_SIGNING.md`](CODE_SIGNING.md) e a política pública em [`CODE_SIGNING_POLICY.md`](CODE_SIGNING_POLICY.md). Sem a configuração, o build segue normalmente sem assinatura.
