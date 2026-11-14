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
  ): { isValid: boolean; errors: string[] };
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

  // Integração com o sistema (processo principal)
  copyText(text: string): Promise<void>;
  showItemInFolder(repoPath: string, file: string): Promise<void>;
  openPath(repoPath: string, file: string): Promise<string>;
}
