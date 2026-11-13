import { contextBridge, ipcRenderer } from 'electron';
import type { CommitPolicy, ConventionalCommitInput, GitNexusApi } from '@git-nexus/git-core/pure';
import { validateCommitMessage } from '@git-nexus/governance-policy';
import { MAIN_METHODS, WORKER_METHODS, channel } from '../shared/channels';

const remote = Object.fromEntries(
  [...WORKER_METHODS, ...MAIN_METHODS].map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(channel(m), ...args)]),
);

const api = {
  ...remote,
  // Síncrono e sem I/O: o linter roda direto no preload para feedback em tempo de digitação.
  validateCommitMessage: (input: ConventionalCommitInput, policy?: CommitPolicy) =>
    validateCommitMessage(input, policy),
} as unknown as GitNexusApi;

contextBridge.exposeInMainWorld('gitNexus', api);
