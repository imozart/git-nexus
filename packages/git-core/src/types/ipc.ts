import type { EncodingChoice, FileEncoding, FileEncodingInfo } from '../file-encoding.js';

/** Operação parada no meio que o app sabe continuar ou abortar (o rebase tem o painel próprio). */
export type InProgressKind = 'merge' | 'cherry-pick' | 'revert';

/** Veja `getAmendInfo`. */
export interface AmendInfo {
  hasHead: boolean;
  message: string;
  pushed: boolean;
  isMerge: boolean;
}

export interface RepositoryMeta {
  id: string;
  name: string;
  path: string;
  isWsl: boolean;
  lastOpenedAt: number;
}

export type ConventionalCommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'build'
  | 'ci'
  | 'chore';

export interface ConventionalCommitInput {
  type: ConventionalCommitType;
  scope?: string;
  ticketNumber?: string;
  subject: string;
  body?: string;
  breakingChanges?: string;
}

export interface MergeConflictBlock {
  filePath: string;
  ours: string;
  base: string;
  theirs: string;
  hasUnresolvedMarkers: boolean;
  /** Conteúdo atual do arquivo no working tree (com marcadores de conflito), quando legível. */
  workingContent?: string;
}

export interface GitNexusIPC {
  // Gestão de Pastas e Repositórios Portáteis
  scanDirectories(rootPaths: string[]): Promise<RepositoryMeta[]>;
  getKnownRepositories(): Promise<RepositoryMeta[]>;
  addRepositoryPath(path: string): Promise<RepositoryMeta>;

  // Execução Git via UtilityProcess
  getGitStatus(repoPath: string): Promise<{ branch: string; staged: string[]; unstaged: string[] }>;
  validateCommitMessage(input: ConventionalCommitInput): { isValid: boolean; errors: string[] };
  executeCommit(repoPath: string, input: ConventionalCommitInput): Promise<{ commitHash: string }>;

  // Resolução 3-Way
  getMergeConflicts(repoPath: string): Promise<MergeConflictBlock[]>;
  resolveConflictFile(repoPath: string, filePath: string, mergedContent: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------------------
// Extensões do contrato (compatíveis com GitNexusIPC; parâmetros novos são opcionais).
// ---------------------------------------------------------------------------------------

/** Política de governança dos commits (configurável na UI). */
export interface CommitPolicy {
  maxSubjectLength: number;
  scopeRequired: boolean;
  ticketRequired: boolean;
  /** Regex (sem âncoras obrigatórias; é aplicada como correspondência total). */
  ticketPattern: string;
  /** Restringe os tipos aceitos (padrão: todos). Vem da política do time. */
  types?: ConventionalCommitType[];
  /** Lista fechada de escopos permitidos (padrão: qualquer escopo válido). */
  scopes?: string[];
  /** Preenche o ticket automaticamente a partir do nome da branch (ex.: feat/PROJ-123-login). */
  ticketFromBranch?: boolean;
}

/** Modo do scanner de segredos: `warn` avisa e permite seguir; `block` impede o commit. */
export type SecretsMode = 'warn' | 'block' | 'off';

export interface SecretsConfig {
  mode: SecretsMode;
  /** Globs de caminhos ignorados pelo scanner (ex.: `test/fixtures/**`). */
  ignorePaths: string[];
  /** Tamanho (MB) a partir do qual um arquivo em stage gera aviso. 0 desliga. */
  maxFileSizeMb: number;
}

/** Conteúdo do `.gitnexus.json` na raiz do repositório (política versionada junto com o código). */
export interface RepoConfig {
  commit: Partial<CommitPolicy>;
  secrets: Partial<SecretsConfig>;
}

export interface RepoPolicyInfo {
  /** O repositório tem `.gitnexus.json`. */
  found: boolean;
  /** Política efetiva do time (vazia se não houver arquivo). */
  commit: Partial<CommitPolicy>;
  secrets: SecretsConfig;
  /** Problemas encontrados ao ler o arquivo (JSON inválido, campo desconhecido, regex inválida…). */
  errors: string[];
}

export type OperationKind = 'commit' | 'amend' | 'checkout' | 'merge' | 'pull' | 'reset' | 'rebase' | 'cherry-pick' | 'revert' | 'other';

/** Uma operação do histórico (reflog do HEAD), da mais nova para a mais antiga. */
export interface GitOperation {
  /** Identificador (posição no reflog + hash + hora): o hash sozinho se repete, ex.: checkout logo após um commit. */
  id: string;
  /** Hash do HEAD DEPOIS da operação. */
  hash: string;
  shortHash: string;
  /** epoch em segundos */
  date: number;
  kind: OperationKind;
  summary: string;
  /** Hash do HEAD imediatamente ANTES da operação. */
  prevHash?: string;
  /** Em trocas de branch: de onde se veio. */
  fromBranch?: string;
  undoable: boolean;
  /** Por que não dá para desfazer (quando `undoable` é false). */
  undoReason?: string;
}

export interface UndoResult {
  message: string;
}

/** Uma entrada do stash (shelf). */
export interface StashEntry {
  /** Posição (0 = mais recente). */
  index: number;
  /** `stash@{n}` */
  ref: string;
  hash: string;
  /** epoch em segundos */
  date: number;
  branch: string;
  /** Nome dado pelo usuário ou, sem nome, o assunto do commit em que foi criado. */
  message: string;
  /** Tem nome (criado com mensagem) em vez do WIP padrão. */
  named: boolean;
}

export interface StashFile {
  path: string;
  /** A, M ou D (para os não rastreados, sempre A). */
  status: string;
  untracked: boolean;
}

export interface CreateStashInput {
  message?: string;
  includeUntracked?: boolean;
  keepIndex?: boolean;
  paths?: string[];
}

export interface StashApplyResult {
  conflicts: boolean;
  message: string;
}

export type HistorySearchMode = 'message' | 'content' | 'regex';

/** Filtros da busca no histórico. */
export interface HistorySearch {
  text?: string;
  /** message = texto na mensagem; content = commits que adicionam/removem o texto (pickaxe); regex = linhas alteradas que casam. */
  mode?: HistorySearchMode;
  author?: string;
  /** Só commits que tocam este caminho. */
  path?: string;
  /** Datas aceitas pelo git (ex.: 2026-01-31, "2 weeks ago"). */
  since?: string;
  until?: string;
}

export interface CommitFile {
  /** A, M, D, T… */
  status: string;
  path: string;
}

export interface CommitDetail {
  hash: string;
  /** Mensagem completa (assunto + corpo). */
  message: string;
  files: CommitFile[];
}

/** Uma linha do blame: quem alterou por último e em qual commit. */
export interface BlameLine {
  line: number;
  hash: string;
  shortHash: string;
  author: string;
  /** epoch em segundos */
  date: number;
  summary: string;
  text: string;
}

/** Resumo de um repositório para o painel: branch, sincronização com o upstream e pendências. */
export interface RepoSummary {
  branch: string;
  detached: boolean;
  upstream: string | null;
  /** O upstream está configurado, mas a branch remota foi apagada. */
  gone: boolean;
  /** Última vez que o repositório buscou do remoto (ms desde 1970, pelo `FETCH_HEAD`); null se nunca buscou ou não deu para ler. */
  lastFetch: number | null;
  /** Commits locais ainda não enviados / commits do remoto ainda não trazidos. */
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

export interface SyncResult {
  ok: boolean;
  message: string;
}

/** Uma branch local ou remota. `name` é a referência completa (`feat/x` ou `origin/feat/x`); `short` é o nome sem o remoto. */
export interface BranchInfo {
  name: string;
  short: string;
  kind: 'local' | 'remote';
  /** Só nas remotas: de qual remoto (origin). */
  remote?: string;
  current: boolean;
  /** Só nas locais: a remota que ela acompanha. */
  upstream: string | null;
  ahead: number;
  behind: number;
  /** A remota que ela acompanhava foi apagada. */
  gone: boolean;
  /** Hash curto do último commit e data (segundos desde 1970). */
  hash: string;
  date: number;
  subject: string;
}

export interface BranchList {
  /** Branch atual ('' com HEAD desanexado). */
  current: string;
  detached: boolean;
  /** Hash curto do HEAD (útil quando está desanexado). */
  head: string;
  locals: BranchInfo[];
  remotes: BranchInfo[];
  remoteNames: string[];
  /** Locais visitadas há pouco (reflog), da mais recente para a mais antiga, sem a atual. */
  recent: string[];
  /** Tags mais novas primeiro (para sugerir no "ir para tag ou commit"). */
  tags: string[];
  /** A branch principal do remoto (origin/main): onde nasce uma branch "a partir da mais recente". */
  defaultRemoteBranch: string | null;
}

export interface CreateBranchInput {
  name: string;
  /** Branch local, remota (origin/main), tag, hash ou HEAD. */
  base: string;
  /** Busca a base no remoto antes de criar (a branch nasce da versão mais recente). */
  fetch?: boolean;
  /** Troca para a nova branch (padrão: sim). */
  checkout?: boolean;
}

export type PullMode = 'rebase' | 'merge';

/**
 * A branch atual em relação à branch principal do remoto (origin/main), que o app já usa como "a versão mais recente" ao criar branches.
 * `ahead` = commits só da atual; `behind` = commits da base que a atual ainda não tem.
 */
export interface BaseComparison {
  /** Referência completa da base (origin/main). */
  base: string;
  /** Nome sem o remoto (main). */
  short: string;
  ahead: number;
  behind: number;
}

/** Resultado de uma operação de branch: nunca lança para o que a pessoa pode resolver (conflito, nome em uso, alterações locais). */
export interface BranchActionResult {
  ok: boolean;
  message: string;
  /** Aviso que não impediu o resultado (ex.: sem rede, usou a cópia local). */
  warning?: string;
  /** Merge, rebase ou pull parou por conflitos e ficou em andamento. */
  conflicted?: boolean;
  /** Exclusão recusada porque a branch tem commits que não estão em outra: só com confirmação (`force`). */
  needsForce?: boolean;
}

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

/** Um passo do rebase interativo, na ordem em que será aplicado (do mais antigo ao mais novo). */
export interface RebaseItem {
  hash: string;
  action: RebaseAction;
  /** Nova mensagem: obrigatória em `reword`; em `pick` (ou no grupo de squash/fixup) substitui a mensagem final. */
  message?: string;
}

export interface RebaseCommit extends CommitInfo {
  /** Já está em alguma branch remota: reescrever exigirá push --force. */
  published: boolean;
}

export interface RebasePlan {
  /** Commit-base completo (não é reescrito). */
  base: string;
  branch: string;
  /** Do mais antigo para o mais novo. */
  commits: RebaseCommit[];
  hasMerges: boolean;
}

export interface RebaseState {
  inProgress: boolean;
  step: number;
  total: number;
  branch: string;
  /** Arquivos em conflito no passo atual. */
  conflicted: string[];
}

export interface RebaseResult {
  status: 'done' | 'stopped' | 'aborted';
  message: string;
  /** Referência com o estado anterior ao rebase. */
  backup?: string;
  state: RebaseState;
}

export type BumpChoice = 'auto' | 'major' | 'minor' | 'patch';

export interface ReleaseCommit {
  hash: string;
  short: string;
  type: string;
  scope: string;
  title: string;
  breaking: boolean;
  breakingNote: string | null;
  pr: string | null;
  ticket: string | null;
  author: string;
}

export interface ReleaseSection {
  id: string;
  title: string;
  items: ReleaseCommit[];
}

/** Próxima versão e changelog calculados a partir das tags vX.Y.Z e dos Conventional Commits desde a última. */
export interface ReleaseInfo {
  branch: string;
  /** Última tag vX.Y.Z (null se ainda não há). */
  previous: string | null;
  /** Próxima versão sugerida (sem o "v"). */
  version: string;
  bump: 'initial' | 'major' | 'minor' | 'patch';
  hasTags: boolean;
  /** A tag da próxima versão já existe (não dá para criá-la de novo). */
  tagExists: boolean;
  /** Sem tags: a versão veio do package.json da raiz. */
  initialFromPackage: boolean;
  commitCount: number;
  sections: ReleaseSection[];
  /** Changelog em Markdown (só as seções). */
  markdown: string;
}

/** Resultado da verificação de atualização (consulta às releases públicas do GitHub). */
export interface UpdateInfo {
  status: 'up-to-date' | 'available' | 'unavailable';
  /** Versão em uso. */
  current: string;
  /** Última versão publicada (sem o "v"). */
  latest?: string;
  /** Página da release. */
  url?: string;
  /** Pacote sugerido para este sistema (instalador, ZIP portátil, DMG ou AppImage) e seu nome. */
  downloadUrl?: string;
  assetName?: string;
  /** Notas da release (Markdown). */
  notes?: string;
  publishedAt?: string;
  /** Motivo, quando `unavailable`. */
  message?: string;
  /** `SHA256SUMS.txt` da release (necessário para instalar sem sair do app). */
  sumsUrl?: string;
  /** O que "Atualizar agora" faz aqui: `installer` (Windows), `portable` (ZIP no Windows), `appimage` (Linux) ou `manual` (só abre o download). */
  install?: 'installer' | 'appimage' | 'portable' | 'manual';
}

/** Um commit na lista "o que chega / o que sai" do painel de sincronização. */
export interface SyncCommit {
  /** Hash curto. */
  hash: string;
  subject: string;
  author: string;
  /** Segundos desde 1970. */
  date: number;
}

/** Commits que o upstream tem e a branch não (`incoming`) e o contrário (`outgoing`), os mais recentes primeiro, até `SYNC_COMMITS_LIMIT`. */
export interface SyncCommits {
  incoming: SyncCommit[];
  outgoing: SyncCommit[];
}

/** Quantos commits de cada lado o painel de sincronização lista. O resto vira "e mais N" (o total vem do adiante/atrás). */
export const SYNC_COMMITS_LIMIT = 20;

/** Como atualizar a branch com o remoto: só avançar (fast-forward), mesclar ou reaplicar os commits locais (rebase). */
export type UpdateMethod = 'ff' | 'merge' | 'rebase';

/** Andamento de uma operação com o remoto (fetch, pull, push), lido da saída `--progress` do git. `percent` é null quando o git não informa número. */
export interface GitProgressEvent {
  repoPath: string;
  op: 'fetch' | 'pull' | 'push';
  /** Etapa do git em inglês, já normalizada: "Receiving objects", "Resolving deltas"… */
  phase: string;
  percent: number | null;
}

/** Um comando git executado pelo app (alimenta a aba "Log"). Sem segredos: o texto já passou por `redactSecrets`. */
export interface GitCommandEvent {
  id: number;
  /** Caminho do repositório em que rodou, como o app o recebeu. */
  repoPath: string;
  /** Ex.: `git status --porcelain=v2 -z`. */
  command: string;
  /** Só consulta (status, log, diff...); `false` = pode alterar o repositório. */
  readOnly: boolean;
  /** Quando começou (ms desde 1970). */
  startedAt: number;
  durationMs: number;
  /** Código de saída (-1 = o git nem chegou a iniciar). */
  code: number;
  /** Saída do git (stderr + stdout), cortada; só vem em comandos que alteram ou que falharam. */
  output?: string;
}

/** Progresso do download da atualização (`total` = 0 quando o servidor não informa o tamanho). */
export interface UpdateProgress {
  done: number;
  total: number;
  /** `download` (padrão) → `prepare`: pacote já conferido, extraindo os arquivos (ZIP portátil); sem percentual. */
  stage?: 'download' | 'prepare';
}

/** CHANGELOG.md que acompanha o app (Markdown gerado pelo pipeline de release) e a versão em uso. */
export interface ChangelogData {
  markdown: string;
  /** Versão do app em execução (para destacar "em uso" na lista). */
  version: string;
}

/** Resultado do download verificado: o arquivo conferido com o SHA-256 da release, pronto para instalar. */
export interface UpdateDownload {
  version: string;
  assetName: string;
  sha256: string;
}

export type ProviderKind = 'github' | 'gitlab';
export type ChangeRequestState = 'open' | 'merged' | 'closed';

/** Pull request (GitHub) ou merge request (GitLab). */
export interface ChangeRequest {
  number: number;
  title: string;
  author: string;
  state: ChangeRequestState;
  draft: boolean;
  sourceBranch: string;
  targetBranch: string;
  /** Commit mais recente da branch de origem (para consultar o CI). */
  sha: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export type CiState = 'success' | 'failure' | 'pending' | 'none';

export interface CiCheck {
  name: string;
  state: CiState;
  url?: string;
}

export interface CiStatus {
  state: CiState;
  checks: CiCheck[];
}

/** O que o app sabe sobre o remoto do repositório (provedor, conta e branches). */
export interface HostingInfo {
  supported: boolean;
  /** Por que não é suportado (sem remoto, provedor desconhecido…). */
  reason?: string;
  kind?: ProviderKind;
  host?: string;
  projectPath?: string;
  webUrl?: string;
  /** O host não é github.com nem parece GitLab: a pessoa precisa dizer qual é o provedor. */
  needsKind: boolean;
  /** Há token guardado para este host (o token nunca volta para a interface). */
  hasToken: boolean;
  /** O token fica criptografado pelo sistema (DPAPI/Keychain/libsecret). `false` = só na memória, até fechar o app. */
  secureStorage: boolean;
  remote?: string;
  currentBranch: string;
  defaultBranch: string;
  branches: string[];
}

export interface ChangeRequestSuggestion {
  title: string;
  /** Descrição em Markdown montada dos Conventional Commits. */
  body: string;
  head: string;
  base: string;
  commits: Array<{ short: string; subject: string }>;
  /** A branch de origem já existe no remoto. */
  headPublished: boolean;
}

export interface CreateChangeRequestInput {
  title: string;
  body: string;
  base: string;
  head: string;
  draft?: boolean;
  /** Envia a branch (push -u) antes de criar. */
  push?: boolean;
}

export interface CreatedChangeRequest {
  url: string;
  number: number;
  pushed: boolean;
}

export type SecretFindingKind = 'secret' | 'sensitive-file' | 'large-file';

export interface SecretFinding {
  kind: SecretFindingKind;
  file: string;
  /** Linha (1-based) no arquivo novo; ausente para arquivos inteiros. */
  line?: number;
  /** Nome da regra (ex.: "Chave de acesso AWS"). */
  rule: string;
  /** Trecho mascarado: nunca contém o segredo completo. */
  preview: string;
}

export interface SecretScanResult {
  mode: SecretsMode;
  findings: SecretFinding[];
}

export interface CommitResult {
  commitHash: string;
  /** stdout/stderr do git e dos hooks locais. */
  output: string;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  parents: string[];
  refs: string[];
  author: string;
  /** epoch em segundos */
  date: number;
  subject: string;
}

/** Conteúdo das duas versões de um arquivo para o diff lado a lado. */
export interface FileSides {
  /** Versão base (HEAD ou índice, conforme o modo). Vazio se o arquivo é novo. */
  oldText: string;
  /** Versão alterada (working tree ou índice, conforme o modo). Vazio se foi removido. */
  newText: string;
  binary: boolean;
  tooLarge: boolean;
  isNew: boolean;
  isDeleted: boolean;
  /** Caminho é um diretório (não rastreado) — não há diff de linhas. */
  isDirectory: boolean;
  /** Codificação com que as duas versões foram lidas (e com que as gravações do diff regravam o arquivo). */
  encoding: FileEncoding;
  /** O que a detecção automática concluiu. */
  detectedEncoding: FileEncoding;
  /** Há bytes que não existem em `encoding`: o texto tem "�" e gravar o arquivo o corromperia. */
  invalid: boolean;
}

export type DiscardScope = 'worktree' | 'all';

/** Uma linha do `git status --porcelain`: X = índice, Y = working tree (espaço = sem mudança, `?` = não rastreado). */
export interface FileEntry {
  path: string;
  x: string;
  y: string;
  /** Caminho anterior, em renomeações/cópias. */
  origPath?: string;
}

/**
 * Quais versões comparar:
 *  - `head`   : último commit x working tree (padrão: tudo que mudou localmente)
 *  - `index`  : índice x working tree (o que ainda não está em stage)
 *  - `staged` : último commit x índice (o que vai no commit)
 */
export type DiffMode = 'head' | 'index' | 'staged';

export interface GitNexusApi extends GitNexusIPC {
  getGitStatus(repoPath: string): Promise<{
    branch: string;
    staged: string[];
    unstaged: string[];
    untracked: string[];
    entries: FileEntry[];
  }>;
  validateCommitMessage(
    input: ConventionalCommitInput,
    policy?: CommitPolicy,
    locale?: 'pt-BR' | 'en',
  ): { isValid: boolean; errors: string[] };
  /** Idioma das mensagens de erro/aviso geradas pelo núcleo (a interface avisa ao trocar de idioma). */
  setLocale(locale: string): Promise<void>;
  executeCommit(
    repoPath: string,
    input: ConventionalCommitInput,
    policy?: CommitPolicy,
  ): Promise<CommitResult>;

  /** Dados para emendar o último commit (mensagem atual, se já foi enviado, se é merge). */
  getAmendInfo(repoPath: string): Promise<AmendInfo>;
  /** Emenda o último commit com o stage atual e a mensagem validada (`git commit --amend`). */
  executeAmend(repoPath: string, input: ConventionalCommitInput, localPolicy?: CommitPolicy): Promise<CommitResult>;

  /** Aplica UM commit na branch atual (cherry-pick). Para por conflitos sem lançar erro (`conflicted`). */
  cherryPickCommit(repoPath: string, hash: string): Promise<BranchActionResult>;
  /** Cria um commit que desfaz o commit dado (revert), sem reescrever o histórico. */
  revertCommit(repoPath: string, hash: string): Promise<BranchActionResult>;
  /** Operação parada no meio (cherry-pick, revert ou merge) ou `null`. */
  getInProgress(repoPath: string): Promise<InProgressKind | null>;
  /** Continua a operação parada, depois de resolver os conflitos. */
  continueOperation(repoPath: string): Promise<BranchActionResult>;
  /** Abandona a operação parada e volta ao estado de antes. */
  abortOperation(repoPath: string): Promise<BranchActionResult>;

  /** Abre o diálogo nativo de seleção de pastas. */
  pickDirectories(): Promise<string[]>;
  removeRepository(id: string): Promise<void>;
  touchRepository(id: string): Promise<void>;
  stageFiles(repoPath: string, files: string[]): Promise<void>;
  unstageFiles(repoPath: string, files: string[]): Promise<void>;
  /** `'head'` = diff de tudo que mudou localmente (último commit x disco). */
  getFileDiff(repoPath: string, file: string, staged: boolean | 'head', encoding?: EncodingChoice): Promise<string>;
  getHistory(repoPath: string, limit?: number): Promise<CommitInfo[]>;

  // Diff lado a lado e descarte de alterações
  /** `mode` booleano é aceito por compatibilidade: false = `index`, true = `staged`. */
  getFileSides(repoPath: string, file: string, mode: DiffMode | boolean, encoding?: EncodingChoice): Promise<FileSides>;
  /** Codificação do arquivo (a detectada ou a pedida), para o rodapé; também no diff unificado. */
  getFileEncoding(repoPath: string, file: string, mode: DiffMode | boolean, encoding?: EncodingChoice): Promise<FileEncodingInfo>;
  /**
   * Regrava o arquivo do working tree (descarte por linha/bloco). Não faz `git add`. Grava na codificação do arquivo
   * (`encoding` ou a detectada, com o BOM); se um caractere não existir nela, recusa sem alterar o arquivo.
   */
  writeWorkingFile(repoPath: string, file: string, content: string, encoding?: EncodingChoice): Promise<void>;
  /** Grava o conteúdo como versão do arquivo no ÍNDICE (stage por linha/trecho), sem alterar o disco. Mesma regra de codificação. */
  writeIndexContent(repoPath: string, file: string, content: string, encoding?: EncodingChoice): Promise<void>;
  /**
   * Descarta alterações do arquivo por completo. `worktree` = só as não staged; `all` = staged + working tree.
   * Antes de apagar, guarda uma cópia do arquivo (retornada em `backup`) para permitir desfazer.
   */
  discardFile(repoPath: string, file: string, scope: DiscardScope): Promise<{ backup: string | null }>;
  restoreBackup(repoPath: string, file: string, backup: string): Promise<void>;
  addToGitignore(repoPath: string, pattern: string): Promise<void>;

  // Política do time (.gitnexus.json) e proteção contra vazamento de segredos
  getRepoPolicy(repoPath: string): Promise<RepoPolicyInfo>;
  /** Grava/atualiza `.gitnexus.json` na raiz do repositório (para o time versionar). */
  saveRepoConfig(repoPath: string, config: RepoConfig): Promise<void>;
  /** Examina o que está em stage (linhas adicionadas, nomes e tamanhos de arquivo). */
  scanStagedSecrets(repoPath: string): Promise<SecretScanResult>;

  // Histórico de operações (reflog) com desfazer
  getOperations(repoPath: string, limit?: number): Promise<GitOperation[]>;
  /** Volta ao estado anterior à operação `id` (e às mais novas). */
  undoOperation(repoPath: string, id: string): Promise<UndoResult>;

  // Versão e changelog (mesmo núcleo do pipeline de release)
  getReleaseInfo(repoPath: string, bump?: BumpChoice): Promise<ReleaseInfo>;
  /** Cria a tag anotada vX.Y.Z no HEAD (local). */
  createReleaseTag(repoPath: string, version: string, notes?: string): Promise<{ tag: string }>;
  /** Insere a versão no topo do CHANGELOG.md. */
  writeChangelog(repoPath: string, version: string, markdown: string): Promise<{ path: string }>;

  // Rebase interativo visual
  getRebasePlan(repoPath: string, base: string): Promise<RebasePlan>;
  getRebaseState(repoPath: string): Promise<RebaseState>;
  startRebase(repoPath: string, base: string, items: RebaseItem[]): Promise<RebaseResult>;
  continueRebase(repoPath: string): Promise<RebaseResult>;
  skipRebase(repoPath: string): Promise<RebaseResult>;
  abortRebase(repoPath: string): Promise<RebaseResult>;

  // Painel de repositórios: resumo, fetch e pull (somente fast-forward)
  getRepoSummary(repoPath: string): Promise<RepoSummary>;
  fetchRepo(repoPath: string): Promise<SyncResult>;
  pullRepo(repoPath: string): Promise<SyncResult>;

  // Branches: listar, trocar, criar, excluir, merge, rebase e pull
  listBranches(repoPath: string): Promise<BranchList>;
  /** Adiante/atrás da branch atual em relação à base do remoto; null se não se aplica (é a própria base, HEAD desanexado, sem remoto). */
  compareWithBase(repoPath: string): Promise<BaseComparison | null>;
  checkoutBranch(repoPath: string, ref: string, kind: 'local' | 'remote'): Promise<BranchActionResult>;
  checkoutRevision(repoPath: string, rev: string): Promise<BranchActionResult>;
  createBranch(repoPath: string, input: CreateBranchInput): Promise<BranchActionResult>;
  deleteBranch(repoPath: string, name: string, force?: boolean): Promise<BranchActionResult>;
  mergeBranch(repoPath: string, ref: string): Promise<BranchActionResult>;
  rebaseOntoBranch(repoPath: string, ref: string): Promise<BranchActionResult>;
  pullBranch(repoPath: string, remoteRef: string, mode: PullMode): Promise<BranchActionResult>;
  /** Os commits que chegam e os que saem em relação ao upstream (sem upstream: os que ainda não existem em nenhum remoto). */
  getSyncCommits(repoPath: string): Promise<SyncCommits>;
  /** Envia a branch atual (push simples, NUNCA forçado); sem upstream, publica criando o upstream no remoto padrão. */
  pushRepo(repoPath: string): Promise<BranchActionResult>;
  /** Busca no remoto e atualiza a branch atual, guardando e devolvendo as alterações locais (autostash). */
  updateRepo(repoPath: string, method: UpdateMethod): Promise<BranchActionResult>;

  // Busca no histórico, histórico de arquivo, detalhe de commit e blame
  searchHistory(repoPath: string, query: HistorySearch, limit?: number): Promise<CommitInfo[]>;
  getFileHistory(repoPath: string, file: string, limit?: number): Promise<CommitInfo[]>;
  listTrackedFiles(repoPath: string): Promise<string[]>;
  getCommitDetail(repoPath: string, hash: string): Promise<CommitDetail>;
  getCommitFileDiff(repoPath: string, hash: string, file: string): Promise<string>;
  /** Autoria linha a linha (`rev` opcional; padrão: arquivo no disco). */
  getBlame(repoPath: string, file: string, rev?: string): Promise<BlameLine[]>;

  // Stash / shelf com nome e restauração parcial
  listStashes(repoPath: string): Promise<StashEntry[]>;
  createStash(repoPath: string, input: CreateStashInput): Promise<StashEntry>;
  getStashFiles(repoPath: string, ref: string): Promise<StashFile[]>;
  getStashFileDiff(repoPath: string, ref: string, file: string): Promise<string>;
  /** `drop` = pop: remove o stash se aplicar sem conflitos. */
  applyStash(repoPath: string, ref: string, drop?: boolean): Promise<StashApplyResult>;
  /** Traz só alguns arquivos do stash; recusa se tiverem alterações locais, salvo `overwrite`. */
  restoreStashFiles(repoPath: string, ref: string, files: string[], overwrite?: boolean): Promise<void>;
  dropStash(repoPath: string, ref: string): Promise<void>;
  renameStash(repoPath: string, ref: string, message: string): Promise<void>;

  // GitHub / GitLab (inclusive instâncias próprias): PRs/MRs, status de CI e criação a partir dos commits
  hostingInfo(repoPath: string): Promise<HostingInfo>;
  /** Valida o token no provedor e o guarda criptografado (`kind` só é necessário para hosts não reconhecidos). */
  hostingSaveToken(repoPath: string, token: string, kind?: ProviderKind): Promise<{ login: string }>;
  hostingRemoveToken(repoPath: string): Promise<void>;
  listChangeRequests(repoPath: string, state: ChangeRequestState): Promise<ChangeRequest[]>;
  getCiStatus(repoPath: string, sha: string): Promise<CiStatus>;
  suggestChangeRequest(repoPath: string, base: string): Promise<ChangeRequestSuggestion>;
  createChangeRequest(repoPath: string, input: CreateChangeRequestInput): Promise<CreatedChangeRequest>;
  /** Abre no navegador uma página do mesmo host do remoto (PR, MR, pipeline). */
  hostingOpen(repoPath: string, url: string): Promise<void>;

  // Atualização: consulta a última release e abre o download no navegador
  checkForUpdate(): Promise<UpdateInfo>;
  /** Abre uma página/arquivo da release no navegador (só endereços do GitHub do projeto). */
  openExternal(url: string): Promise<void>;
  /** Baixa o pacote da última release e confere o SHA-256 contra o `SHA256SUMS.txt` da mesma release. Só vale se `install` != manual. */
  downloadUpdate(): Promise<UpdateDownload>;
  /** Instala o pacote baixado e reinicia o app (Windows: instalador silencioso; Linux: troca o AppImage). */
  installUpdate(): Promise<void>;
  /** Acompanha o progresso do download; devolve a função que cancela a assinatura. */
  onUpdateProgress(cb: (p: UpdateProgress) => void): () => void;
  /** Lê o CHANGELOG.md empacotado com o app (vazio se o arquivo não existir). */
  getChangelog(): Promise<ChangelogData>;
  /** Recebe cada comando git que o app executa (aba "Log"); devolve a função que cancela a assinatura. */
  onGitCommand(cb: (events: GitCommandEvent[]) => void): () => void;
  /** Recebe o andamento (porcentagem) das buscas, atualizações e envios; devolve a função que cancela a assinatura. */
  onGitProgress(cb: (e: GitProgressEvent) => void): () => void;

  // Integração com o sistema (processo principal)
  copyText(text: string): Promise<void>;
  /** Registra no log do app (`gitnexus-app.log`) um erro inesperado da interface. Devolve o caminho do arquivo. */
  logRendererError(message: string, stack?: string): Promise<{ logFile: string }>;
  showItemInFolder(repoPath: string, file: string): Promise<void>;
  openPath(repoPath: string, file: string): Promise<string>;
}
