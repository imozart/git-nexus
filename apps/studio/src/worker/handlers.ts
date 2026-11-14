// Handlers do processo utilitário (sem dependência do Electron: testáveis em Node puro).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  CommitRejectedError,
  addToGitignore,
  commit,
  discardFile,
  getFileSides,
  restoreBackup,
  writeWorkingFile,
  getFileDiff,
  getGitStatus,
  getHistory,
  getMergeConflicts,
  isWslPath,
  resolveConflictFile,
  runGit,
  scanDirectories,
  scanStagedSecrets,
  stageFiles,
  toRepositoryMeta,
  unstageFiles,
  type CommitPolicy,
  type DiscardScope,
  type ConventionalCommitInput,
  type RepoConfig,
  type RepoPolicyInfo,
  type RepositoryMeta,
  type SecretScanResult,
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
    discardFile: (repoPath: string, file: string, scope: DiscardScope) =>
      discardFile(repoPath, file, scope, join(dataDir, 'discarded', new Date().toISOString().replace(/[:.]/g, '-'))),
    restoreBackup: (repoPath: string, file: string, backup: string) => restoreBackup(repoPath, file, backup),
    addToGitignore: (repoPath: string, pattern: string) => addToGitignore(repoPath, pattern),
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
  };
}
