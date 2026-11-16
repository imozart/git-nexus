import type { GitCommandEvent, GitNexusApi } from '@git-nexus/git-core/pure';

/** Métodos executados no UtilityProcess (trabalho pesado de Git / disco). */
export const WORKER_METHODS = [
  'scanDirectories',
  'getKnownRepositories',
  'addRepositoryPath',
  'removeRepository',
  'touchRepository',
  'getGitStatus',
  'stageFiles',
  'unstageFiles',
  'getFileDiff',
  'getHistory',
  'getFileSides',
  'writeWorkingFile',
  'writeIndexContent',
  'discardFile',
  'restoreBackup',
  'addToGitignore',
  'setLocale',
  'executeCommit',
  'getReleaseInfo',
  'createReleaseTag',
  'writeChangelog',
  'getRebasePlan',
  'getRebaseState',
  'startRebase',
  'continueRebase',
  'skipRebase',
  'abortRebase',
  'getRepoSummary',
  'fetchRepo',
  'pullRepo',
  'searchHistory',
  'getFileHistory',
  'listTrackedFiles',
  'getCommitDetail',
  'getCommitFileDiff',
  'getBlame',
  'listStashes',
  'createStash',
  'getStashFiles',
  'getStashFileDiff',
  'applyStash',
  'restoreStashFiles',
  'dropStash',
  'renameStash',
  'getOperations',
  'undoOperation',
  'getRepoPolicy',
  'saveRepoConfig',
  'scanStagedSecrets',
  'getMergeConflicts',
  'resolveConflictFile',
  'listBranches',
  'checkoutBranch',
  'checkoutRevision',
  'createBranch',
  'deleteBranch',
  'mergeBranch',
  'rebaseOntoBranch',
  'pullBranch',
] as const satisfies readonly (keyof GitNexusApi)[];
export type WorkerMethod = (typeof WORKER_METHODS)[number];

/** Métodos tratados pelo processo principal (APIs nativas do Electron). */
export const MAIN_METHODS = ['pickDirectories', 'copyText', 'showItemInFolder', 'openPath', 'checkForUpdate', 'openExternal', 'downloadUpdate', 'installUpdate', 'getChangelog', 'hostingInfo', 'hostingSaveToken', 'hostingRemoveToken', 'listChangeRequests', 'getCiStatus', 'suggestChangeRequest', 'createChangeRequest', 'hostingOpen'] as const satisfies readonly (keyof GitNexusApi)[];
export type MainMethod = (typeof MAIN_METHODS)[number];

export const channel = (m: string) => `gitnexus:${m}`;

export interface UtilityRequest {
  id: number;
  method: WorkerMethod;
  args: unknown[];
}

export type UtilityResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Mensagem espontânea do worker (sem pedido): lote de comandos git executados, para a aba "Log". */
export interface UtilityEvent {
  event: 'gitCommands';
  data: GitCommandEvent[];
}

/** Prefixo usado para sinalizar rejeição de commit por hook (carrega a saída do hook). */
export const HOOK_REJECTED_PREFIX = 'GITNEXUS_COMMIT_REJECTED\n';
