import { contextBridge, ipcRenderer } from 'electron';
import type { AskpassRequest, CommitPolicy, ConventionalCommitInput, GitCommandEvent, GitInstallProgress, GitNexusApi, GitProgressEvent, UpdateProgress } from '@git-nexus/git-core/pure';
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
  // Evento: etapas da instalação automática do Git.
  onGitInstallProgress: (cb: (p: GitInstallProgress) => void) => {
    const handler = (_e: unknown, p: GitInstallProgress) => cb(p);
    ipcRenderer.on(channel('gitInstallProgress'), handler);
    return () => ipcRenderer.removeListener(channel('gitInstallProgress'), handler);
  },
  // Evento: comandos git executados pelo app (aba "Log").
  onGitCommand: (cb: (events: GitCommandEvent[]) => void) => {
    const handler = (_e: unknown, events: GitCommandEvent[]) => cb(events);
    ipcRenderer.on(channel('gitCommands'), handler);
    return () => ipcRenderer.removeListener(channel('gitCommands'), handler);
  },
  // Evento: andamento (porcentagem) das buscas, atualizações e envios.
  onGitProgress: (cb: (e: GitProgressEvent) => void) => {
    const handler = (_e: unknown, p: GitProgressEvent) => cb(p);
    ipcRenderer.on(channel('gitProgress'), handler);
    return () => ipcRenderer.removeListener(channel('gitProgress'), handler);
  },
  // Evento: o git/ssh precisa de uma credencial (usuário, senha, token, frase-senha): a interface mostra o diálogo.
  onAskpassRequest: (cb: (r: AskpassRequest) => void) => {
    const handler = (_e: unknown, r: AskpassRequest) => cb(r);
    ipcRenderer.on(channel('askpass'), handler);
    return () => ipcRenderer.removeListener(channel('askpass'), handler);
  },
  // Síncrono e sem I/O: o linter roda direto no preload para feedback em tempo de digitação.
  validateCommitMessage: (input: ConventionalCommitInput, policy?: CommitPolicy, locale?: 'pt-BR' | 'en') =>
    validateCommitMessage(input, policy, locale),
} as unknown as GitNexusApi;

contextBridge.exposeInMainWorld('gitNexus', api);
