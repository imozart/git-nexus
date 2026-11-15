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
  /** O que "Instalar e reiniciar" faz aqui: `installer` (Windows), `appimage` (Linux) ou `manual` (só abre o download). */
  install?: 'installer' | 'appimage' | 'manual';
}

/** Progresso do download da atualização (`total` = 0 quando o servidor não informa o tamanho). */
export interface UpdateProgress {
  done: number;
  total: number;
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

  /** Abre o diálogo nativo de seleção de pastas. */
  pickDirectories(): Promise<string[]>;
  removeRepository(id: string): Promise<void>;
  touchRepository(id: string): Promise<void>;
  stageFiles(repoPath: string, files: string[]): Promise<void>;
  unstageFiles(repoPath: string, files: string[]): Promise<void>;
  /** `'head'` = diff de tudo que mudou localmente (último commit x disco). */
  getFileDiff(repoPath: string, file: string, staged: boolean | 'head'): Promise<string>;
  getHistory(repoPath: string, limit?: number): Promise<CommitInfo[]>;

  // Diff lado a lado e descarte de alterações
  /** `mode` booleano é aceito por compatibilidade: false = `index`, true = `staged`. */
  getFileSides(repoPath: string, file: string, mode: DiffMode | boolean): Promise<FileSides>;
  /** Regrava o arquivo do working tree (descarte por linha/bloco). Não faz `git add`. */
  writeWorkingFile(repoPath: string, file: string, content: string): Promise<void>;
  /** Grava o conteúdo como versão do arquivo no ÍNDICE (stage por linha/trecho), sem alterar o disco. */
  writeIndexContent(repoPath: string, file: string, content: string): Promise<void>;
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

  // Integração com o sistema (processo principal)
  copyText(text: string): Promise<void>;
  showItemInFolder(repoPath: string, file: string): Promise<void>;
  openPath(repoPath: string, file: string): Promise<string>;
}
