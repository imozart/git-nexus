import type { GitNexusApi } from '@git-nexus/git-core/pure';
import { HOOK_REJECTED_PREFIX } from '../../shared/channels';

export const api: GitNexusApi = window.gitNexus;

/** Remove o prefixo "Error invoking remote method ..." que o Electron adiciona. */
export function errMsg(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}

export function isHookRejection(msg: string): boolean {
  return msg.startsWith(HOOK_REJECTED_PREFIX);
}

export function stripHookPrefix(msg: string): string {
  return msg.slice(HOOK_REJECTED_PREFIX.length);
}
