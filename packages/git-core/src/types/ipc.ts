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
  /**
   * Descarta alterações do arquivo por completo. `worktree` = só as não staged; `all` = staged + working tree.
   * Antes de apagar, guarda uma cópia do arquivo (retornada em `backup`) para permitir desfazer.
   */
  discardFile(repoPath: string, file: string, scope: DiscardScope): Promise<{ backup: string | null }>;
  restoreBackup(repoPath: string, file: string, backup: string): Promise<void>;
  addToGitignore(repoPath: string, pattern: string): Promise<void>;

  // Integração com o sistema (processo principal)
  copyText(text: string): Promise<void>;
  showItemInFolder(repoPath: string, file: string): Promise<void>;
  openPath(repoPath: string, file: string): Promise<string>;
}
