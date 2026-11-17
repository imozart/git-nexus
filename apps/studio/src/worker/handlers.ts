// Handlers do processo utilitário (sem dependência do Electron: testáveis em Node puro).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  CommitRejectedError,
  checkoutBranch,
  checkoutRevision,
  createBranch,
  deleteBranch,
  listBranches,
  mergeBranch,
  pullBranch,
  compareWithBase,
  getSyncCommits,
  pushRepo,
  updateRepo,
  rebaseOntoBranch,
  abortRebase,
  addToGitignore,
  applyStash,
  commit,
  continueRebase,
  createStash,
  dropStash,
  getBlame,
  getCommitDetail,
  getCommitFileDiff,
  getFileHistory,
  getStashFileDiff,
  getStashFiles,
  listStashes,
  listTrackedFiles,
  renameStash,
  restoreStashFiles,
  discardFile,
  fetchRepo,
  getFileSides,
  restoreBackup,
  writeIndexContent,
  writeWorkingFile,
  getFileDiff,
  getGitStatus,
  getHistory,
  getMergeConflicts,
  getOperations,
  getRebasePlan,
  getRebaseState,
  getRepoSummary,
  isWslPath,
  pullRepo,
  resolveConflictFile,
  runGit,
  scanDirectories,
  scanStagedSecrets,
  searchHistory,
  skipRebase,
  stageFiles,
  startRebase,
  toRepositoryMeta,
  undoOperation,
  unstageFiles,
  type BumpChoice,
  type CommitPolicy,
  type CreateBranchInput,
  type CreateStashInput,
  type PullMode,
  type UpdateMethod,
  type HistorySearch,
  type DiscardScope,
  type ConventionalCommitInput,
  type RebaseItem,
  type RepoConfig,
  type RepoPolicyInfo,
  type RepositoryMeta,
  type SecretScanResult,
  setMessageLocale,
} from '@git-nexus/git-core';
import {
  DEFAULT_POLICY,
  DEFAULT_SECRETS,
  REPO_CONFIG_FILE,
  formatCommitMessage,
  mergePolicy,
  parseRepoConfig,
  validateCommitMessage,
} from '@git-nexus/governance-policy';
import { HOOK_REJECTED_PREFIX, type WorkerMethod } from '../shared/channels';
import { createReleaseTag, getReleaseInfo, writeChangelog } from './release';

/** Lê o `.gitnexus.json` da raiz do repositório (ausente = sem política do time). */
export async function readRepoPolicy(repoPath: string): Promise<RepoPolicyInfo> {
  let text: string;
  try {
    text = await readFile(join(repoPath, REPO_CONFIG_FILE), 'utf8');
  } catch {
    return { found: false, commit: {}, secrets: { ...DEFAULT_SECRETS, ignorePaths: [] }, errors: [] };
  }
  const p = parseRepoConfig(text.replace(/^﻿/, ''));
  return { found: true, commit: p.commit, secrets: p.secrets, errors: p.errors };
}

export function createHandlers(dataDir: string): Record<WorkerMethod, (...args: any[]) => Promise<unknown>> {
  const storeFile = join(dataDir, 'repositories.json');

  // Serializa gravações para não corromper o JSON com chamadas concorrentes.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  }

  async function loadRepos(): Promise<RepositoryMeta[]> {
    try {
      return JSON.parse(await readFile(storeFile, 'utf8')) as RepositoryMeta[];
    } catch {
      return [];
    }
  }

  async function saveRepos(repos: RepositoryMeta[]): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    const tmp = storeFile + '.tmp';
    await writeFile(tmp, JSON.stringify(repos, null, 2), 'utf8');
    await rename(tmp, storeFile);
  }

  const upsert = (found: RepositoryMeta[]) =>
    serial(async () => {
      const known = new Map((await loadRepos()).map((r) => [r.id, r]));
      for (const r of found) known.set(r.id, { ...r, lastOpenedAt: known.get(r.id)?.lastOpenedAt ?? 0 });
      await saveRepos([...known.values()]);
    });

  const sorted = (repos: RepositoryMeta[]) =>
    [...repos].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name));

  return {
    scanDirectories: async (roots: string[]) => {
      const found = await scanDirectories(roots);
      await upsert(found);
      return found;
    },
    getKnownRepositories: async () => sorted(await loadRepos()),
    addRepositoryPath: async (path: string) => {
      await runGit(path, ['rev-parse', '--git-dir']); // valida que é um repositório
      // Para caminhos locais normaliza para a raiz do repositório; em WSL (UNC) mantém o caminho informado.
      const { stdout } = await runGit(path, ['rev-parse', '--show-toplevel']);
      const meta = toRepositoryMeta(isWslPath(path) ? path : resolve(stdout.trim() || path));
      await upsert([meta]);
      return meta;
    },
    removeRepository: (id: string) =>
      serial(async () => saveRepos((await loadRepos()).filter((r) => r.id !== id))),
    touchRepository: (id: string) =>
      serial(async () =>
        saveRepos((await loadRepos()).map((r) => (r.id === id ? { ...r, lastOpenedAt: Date.now() } : r))),
      ),
    getGitStatus: (repoPath: string) => getGitStatus(repoPath),
    stageFiles: (repoPath: string, files: string[]) => stageFiles(repoPath, files),
    unstageFiles: (repoPath: string, files: string[]) => unstageFiles(repoPath, files),
    getFileDiff: (repoPath: string, file: string, staged: boolean) => getFileDiff(repoPath, file, staged),
    getHistory: (repoPath: string, limit?: number) => getHistory(repoPath, limit),
    getFileSides: (repoPath: string, file: string, staged: boolean) => getFileSides(repoPath, file, staged),
    writeWorkingFile: (repoPath: string, file: string, content: string) => writeWorkingFile(repoPath, file, content),
    writeIndexContent: (repoPath: string, file: string, content: string) => writeIndexContent(repoPath, file, content),
    discardFile: (repoPath: string, file: string, scope: DiscardScope) =>
      discardFile(repoPath, file, scope, join(dataDir, 'discarded', new Date().toISOString().replace(/[:.]/g, '-'))),
    restoreBackup: (repoPath: string, file: string, backup: string) => restoreBackup(repoPath, file, backup),
    addToGitignore: (repoPath: string, pattern: string) => addToGitignore(repoPath, pattern),
    getReleaseInfo: (repoPath: string, bump?: BumpChoice) => getReleaseInfo(repoPath, bump),
    createReleaseTag: (repoPath: string, version: string, notes?: string) => createReleaseTag(repoPath, version, notes),
    writeChangelog: (repoPath: string, version: string, markdown: string) => writeChangelog(repoPath, version, markdown),
    getRebasePlan: (repoPath: string, base: string) => getRebasePlan(repoPath, base),
    getRebaseState: (repoPath: string) => getRebaseState(repoPath),
    startRebase: (repoPath: string, base: string, items: RebaseItem[]) => startRebase(repoPath, base, items.map((i) => ({ ...i }))),
    continueRebase: (repoPath: string) => continueRebase(repoPath),
    skipRebase: (repoPath: string) => skipRebase(repoPath),
    abortRebase: (repoPath: string) => abortRebase(repoPath),
    getRepoSummary: (repoPath: string) => getRepoSummary(repoPath),
    fetchRepo: (repoPath: string) => fetchRepo(repoPath),
    pullRepo: (repoPath: string) => pullRepo(repoPath),
    searchHistory: (repoPath: string, query: HistorySearch, limit?: number) => searchHistory(repoPath, query, limit),
    getFileHistory: (repoPath: string, file: string, limit?: number) => getFileHistory(repoPath, file, limit),
    listTrackedFiles: (repoPath: string) => listTrackedFiles(repoPath),
    getCommitDetail: (repoPath: string, hash: string) => getCommitDetail(repoPath, hash),
    getCommitFileDiff: (repoPath: string, hash: string, file: string) => getCommitFileDiff(repoPath, hash, file),
    getBlame: (repoPath: string, file: string, rev?: string) => getBlame(repoPath, file, rev),
    listStashes: (repoPath: string) => listStashes(repoPath),
    createStash: (repoPath: string, input: CreateStashInput) => createStash(repoPath, input),
    getStashFiles: (repoPath: string, ref: string) => getStashFiles(repoPath, ref),
    getStashFileDiff: (repoPath: string, ref: string, file: string) => getStashFileDiff(repoPath, ref, file),
    applyStash: (repoPath: string, ref: string, drop?: boolean) => applyStash(repoPath, ref, drop),
    restoreStashFiles: (repoPath: string, ref: string, files: string[], overwrite?: boolean) =>
      restoreStashFiles(repoPath, ref, [...files], overwrite),
    dropStash: (repoPath: string, ref: string) => dropStash(repoPath, ref),
    renameStash: (repoPath: string, ref: string, message: string) => renameStash(repoPath, ref, message),
    getOperations: (repoPath: string, limit?: number) => getOperations(repoPath, limit),
    undoOperation: (repoPath: string, id: string) => undoOperation(repoPath, id),
    getRepoPolicy: (repoPath: string) => readRepoPolicy(repoPath),
    saveRepoConfig: async (repoPath: string, config: RepoConfig) => {
      // Só grava campos conhecidos e já validados; o arquivo é pensado para ser versionado pelo time.
      const clean = parseRepoConfig(JSON.stringify(config));
      if (clean.errors.length) throw new Error(clean.errors.join('\n'));
      const body = { commit: config.commit ?? {}, ...(config.secrets && Object.keys(config.secrets).length ? { secrets: config.secrets } : {}) };
      await writeFile(join(repoPath, REPO_CONFIG_FILE), JSON.stringify(body, null, 2) + '\n', 'utf8');
    },
    scanStagedSecrets: async (repoPath: string): Promise<SecretScanResult> => {
      const { secrets } = await readRepoPolicy(repoPath);
      return { mode: secrets.mode, findings: await scanStagedSecrets(repoPath, secrets) };
    },
    setLocale: async (locale: string) => {
      setMessageLocale(locale);
    },
    executeCommit: async (repoPath: string, input: ConventionalCommitInput, localPolicy?: CommitPolicy) => {
      // A política do time (.gitnexus.json) é obrigatória: sobrepõe o que a interface enviou.
      const team = (await readRepoPolicy(repoPath)).commit;
      const policy = mergePolicy(localPolicy ?? DEFAULT_POLICY, team);
      const v = validateCommitMessage(input, policy);
      if (!v.isValid) throw new Error(v.errors.join('\n'));
      try {
        return await commit(repoPath, formatCommitMessage(input));
      } catch (e) {
        if (e instanceof CommitRejectedError) throw new Error(HOOK_REJECTED_PREFIX + (e.hookOutput || e.message));
        throw e;
      }
    },
    getMergeConflicts: (repoPath: string) => getMergeConflicts(repoPath),
    resolveConflictFile: (repoPath: string, filePath: string, merged: string) =>
      resolveConflictFile(repoPath, filePath, merged),
    listBranches: (repoPath: string) => listBranches(repoPath),
    compareWithBase: (repoPath: string) => compareWithBase(repoPath),
    getSyncCommits: (repoPath: string) => getSyncCommits(repoPath),
    pushRepo: (repoPath: string) => pushRepo(repoPath),
    updateRepo: (repoPath: string, method: UpdateMethod) => updateRepo(repoPath, method),
    checkoutBranch: (repoPath: string, ref: string, kind: 'local' | 'remote') => checkoutBranch(repoPath, ref, kind),
    checkoutRevision: (repoPath: string, rev: string) => checkoutRevision(repoPath, rev),
    createBranch: (repoPath: string, input: CreateBranchInput) => createBranch(repoPath, input),
    deleteBranch: (repoPath: string, name: string, force?: boolean) => deleteBranch(repoPath, name, force),
    mergeBranch: (repoPath: string, ref: string) => mergeBranch(repoPath, ref),
    rebaseOntoBranch: (repoPath: string, ref: string) => rebaseOntoBranch(repoPath, ref),
    pullBranch: (repoPath: string, remoteRef: string, mode: PullMode) => pullBranch(repoPath, remoteRef, mode),
  };
}
