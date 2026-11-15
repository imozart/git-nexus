import { contextBridge, ipcRenderer } from 'electron';
import type { CommitPolicy, ConventionalCommitInput, GitCommandEvent, GitNexusApi, UpdateProgress } from '@git-nexus/git-core/pure';
import { validateCommitMessage } from '@git-nexus/governance-policy';
import { MAIN_METHODS, WORKER_METHODS, channel } from '../shared/channels';

const remote = Object.fromEntries(
  [...WORKER_METHODS, ...MAIN_METHODS].map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(channel(m), ...args)]),
);

const api = {
  ...remote,
  // Evento (não é chamada com resposta): progresso do download da atualização.
  onUpdateProgress: (cb: (p: UpdateProgress) => void) => {
    const handler = (_e: unknown, p: UpdateProgress) => cb(p);
    ipcRenderer.on(channel('updateProgress'), handler);
    return () => ipcRenderer.removeListener(channel('updateProgress'), handler);
  },
  // Evento: comandos git executados pelo app (aba "Log").
  onGitCommand: (cb: (events: GitCommandEvent[]) => void) => {
    const handler = (_e: unknown, events: GitCommandEvent[]) => cb(events);
    ipcRenderer.on(channel('gitCommands'), handler);
    return () => ipcRenderer.removeListener(channel('gitCommands'), handler);
  },
  // Síncrono e sem I/O: o linter roda direto no preload para feedback em tempo de digitação.
  validateCommitMessage: (input: ConventionalCommitInput, policy?: CommitPolicy, locale?: 'pt-BR' | 'en') =>
    validateCommitMessage(input, policy, locale),
} as unknown as GitNexusApi;

contextBridge.exposeInMainWorld('gitNexus', api);
