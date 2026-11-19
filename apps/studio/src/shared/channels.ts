import type { AskpassRequest, GitCommandEvent, GitNexusApi, GitProgressEvent } from '@git-nexus/git-core/pure';

/** Métodos executados no UtilityProcess (trabalho pesado de Git / disco). */
export const WORKER_METHODS = [
  'scanDirectories',
  'getKnownRepositories',
  'addRepositoryPath',
  'getSigningInfo',
  'getLfsInfo',
  'pullLfs',
  'getSubmodules',
  'initSubmodules',
  'updateSubmodules',
  'askpassAnswer',
  'searchContent',
  'getFileContext',
  'cloneRepository',
  'initRepository',
  'removeRepository',
  'touchRepository',
  'getGitStatus',
  'stageFiles',
  'unstageFiles',
  'getFileDiff',
  'getHistory',
  'getFileSides',
  'getFileEncoding',
  'writeWorkingFile',
  'writeIndexContent',
  'discardFile',
  'restoreBackup',
  'addToGitignore',
  'setLocale',
  'executeCommit',
  'getAmendInfo',
  'listTags',
  'listRemoteTags',
  'createTag',
  'deleteTag',
  'pushTag',
  'cherryPickCommit',
  'pushWithLease',
  'revertCommit',
  'getInProgress',
  'continueOperation',
  'abortOperation',
  'executeAmend',
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
  'compareWithBase',
  'getSyncCommits',
  'pushRepo',
  'updateRepo',
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
export const MAIN_METHODS = ['pickDirectories', 'copyText', 'openInTerminal', 'openInEditor', 'notify', 'setZoom', 'logRendererError', 'showItemInFolder', 'openPath', 'checkForUpdate', 'openExternal', 'downloadUpdate', 'installUpdate', 'getChangelog', 'hostingInfo', 'hostingSaveToken', 'hostingRemoveToken', 'listChangeRequests', 'getCiStatus', 'suggestChangeRequest', 'createChangeRequest', 'hostingOpen', 'getGitAvailability', 'recheckGit', 'installGit', 'cancelGitInstall', 'openGitDownloadPage'] as const satisfies readonly (keyof GitNexusApi)[];
export type MainMethod = (typeof MAIN_METHODS)[number];

export const channel = (m: string) => `gitnexus:${m}`;

export interface UtilityRequest {
  id: number;
  method: WorkerMethod;
  args: unknown[];
}

export type UtilityResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Mensagem espontânea do worker (sem pedido): lote de comandos git executados, para a aba "Log". */
export type UtilityEvent =
  | { event: 'gitCommands'; data: GitCommandEvent[] }
  | { event: 'gitProgress'; data: GitProgressEvent }
  /** O git/ssh pediu uma credencial: o processo principal repassa à interface, que mostra o diálogo. */
  | { event: 'askpass'; data: AskpassRequest }
  /** Exceção não tratada dentro do worker: o processo principal a registra no log do app. */
  | { event: 'appError'; data: { source: string; message: string; stack?: string } };

/** Prefixo usado para sinalizar rejeição de commit por hook (carrega a saída do hook). */
export const HOOK_REJECTED_PREFIX = 'GITNEXUS_COMMIT_REJECTED\n';
