import type { GitNexusApi } from '@git-nexus/git-core/pure';

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
  'discardFile',
  'restoreBackup',
  'addToGitignore',
  'executeCommit',
  'getOperations',
  'undoOperation',
  'getRepoPolicy',
  'saveRepoConfig',
  'scanStagedSecrets',
  'getMergeConflicts',
  'resolveConflictFile',
] as const satisfies readonly (keyof GitNexusApi)[];
export type WorkerMethod = (typeof WORKER_METHODS)[number];

/** Métodos tratados pelo processo principal (APIs nativas do Electron). */
export const MAIN_METHODS = ['pickDirectories', 'copyText', 'showItemInFolder', 'openPath'] as const satisfies readonly (keyof GitNexusApi)[];
export type MainMethod = (typeof MAIN_METHODS)[number];

export const channel = (m: string) => `gitnexus:${m}`;

export interface UtilityRequest {
  id: number;
  method: WorkerMethod;
  args: unknown[];
}

export type UtilityResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Prefixo usado para sinalizar rejeição de commit por hook (carrega a saída do hook). */
export const HOOK_REJECTED_PREFIX = 'GITNEXUS_COMMIT_REJECTED\n';
