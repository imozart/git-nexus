// As regras da configuração do Git editável pelas Configurações (sem Node: a interface valida com as MESMAS regras do processo que grava).
import type { GitConfigKey } from './types/ipc.js';

/** O que cada chave aceita: lista fixa de valores, ou `text` (livre, sem quebra de linha) com um validador opcional. */
type Rule = { values: readonly string[] } | { text: true; check?: (v: string) => 'email' | 'branch' | null };

const BOOL = ['true', 'false'] as const;

export const GIT_CONFIG_RULES: Record<GitConfigKey, Rule> = {
  'user.name': { text: true },
  'user.email': { text: true, check: (v) => (/^[^\s@]+@[^\s@]+$/.test(v) ? null : 'email') },
  'user.signingkey': { text: true },
  'gpg.format': { values: ['openpgp', 'ssh', 'x509'] },
  'commit.gpgsign': { values: BOOL },
  'pull.rebase': { values: ['true', 'false', 'merges', 'interactive'] },
  'init.defaultBranch': { text: true, check: (v) => (/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(v) && !v.includes('..') && !v.endsWith('/') && !v.endsWith('.lock') ? null : 'branch') },
  'core.autocrlf': { values: ['true', 'input', 'false'] },
  'rerere.enabled': { values: BOOL },
  'merge.conflictStyle': { values: ['merge', 'diff3', 'zdiff3'] },
};

export const GIT_CONFIG_KEYS = Object.keys(GIT_CONFIG_RULES) as GitConfigKey[];

export type GitConfigErrorCode = 'key' | 'value' | 'email' | 'branch' | 'scope';

export class GitConfigError extends Error {
  constructor(
    readonly code: GitConfigErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const isGitConfigKey = (k: string): k is GitConfigKey => Object.prototype.hasOwnProperty.call(GIT_CONFIG_RULES, k);

/** Valida o valor de uma chave (lança `GitConfigError` com o código; a interface traduz). */
export function validateGitConfigValue(key: string, value: string): void {
  if (!isGitConfigKey(key)) throw new GitConfigError('key', `chave não permitida: ${key}`);
  if (/[\r\n\0]/.test(value)) throw new GitConfigError('value', 'o valor não pode ter quebra de linha');
  const rule = GIT_CONFIG_RULES[key];
  if ('values' in rule) {
    if (!rule.values.includes(value)) throw new GitConfigError('value', `valor inválido para ${key}: ${value}`);
    return;
  }
  if (!value.trim()) throw new GitConfigError('value', 'o valor não pode ser vazio (use "remover")');
  const bad = rule.check?.(value);
  if (bad) throw new GitConfigError(bad, `valor inválido para ${key}`);
}
