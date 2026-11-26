// Configuração do Git editável pelas Configurações do app: identidade, assinatura, pull, ramo inicial, quebra de linha e conflitos. Tudo é lido e gravado com
// `git config` (escopo global ou do repositório), nunca em arquivo próprio paralelo. Só as chaves da lista abaixo passam (a ponte vem da interface), e cada valor é
// validado: o Git recusaria alguns, mas aqui a mensagem sai em português e nada estranho (quebra de linha, chave arbitrária) chega ao `git config`.
import { homedir } from 'node:os';
import { runGit } from './runner.js';
import { GIT_CONFIG_KEYS, GitConfigError, isGitConfigKey as isKey, validateGitConfigValue } from './git-config-pure.js';
import type { GitConfigEntry, GitConfigScope } from './types/ipc.js';

export { GIT_CONFIG_KEYS, GIT_CONFIG_RULES, GitConfigError, validateGitConfigValue } from './git-config-pure.js';

/** Pasta em que rodar o `git config --global` (qualquer uma serve: o escopo global não depende de repositório). */
const globalCwd = (): string => homedir();

/**
 * Todas as chaves de um escopo numa só chamada (`git config --list -z`): são 3 processos por leitura, não 3 por chave (a tela das Configurações lê tudo ao
 * abrir e depois de cada gravação). O Git escreve as chaves em minúsculas, e a última ocorrência vence, como no `--get`.
 */
async function readAll(cwd: string, scope: GitConfigScope | 'effective'): Promise<Map<string, string>> {
  const flag = scope === 'effective' ? [] : [`--${scope}`];
  const r = await runGit(cwd, ['config', ...flag, '--list', '-z'], { check: false });
  const out = new Map<string, string>();
  if (r.code !== 0) return out; // sem arquivo daquele escopo (ou fora de um repositório): nada definido
  for (const entry of r.stdout.split('\0')) {
    if (!entry) continue;
    const nl = entry.indexOf('\n');
    // chave sem valor (`[core] bare`) é verdadeira
    out.set((nl < 0 ? entry : entry.slice(0, nl)).toLowerCase(), nl < 0 ? 'true' : entry.slice(nl + 1));
  }
  return out;
}

/** Os valores das chaves: global, do repositório (se `repoPath`) e o efetivo (o que o Git usaria nesse repositório). */
export async function getGitConfig(repoPath: string | null, keys: readonly string[] = GIT_CONFIG_KEYS): Promise<GitConfigEntry[]> {
  const list = keys.filter(isKey);
  const [global, local, effective] = await Promise.all([readAll(globalCwd(), 'global'), repoPath ? readAll(repoPath, 'local') : Promise.resolve(new Map<string, string>()), readAll(repoPath ?? globalCwd(), 'effective')]);
  const pick = (m: Map<string, string>, key: string): string | null => m.get(key.toLowerCase())?.trim() || null;
  return list.map((key) => ({ key, global: pick(global, key), local: pick(local, key), value: pick(effective, key) }));
}

/** Grava (ou remove, com `value === null`) uma chave no escopo pedido. O escopo `local` exige um repositório. */
export async function setGitConfig(repoPath: string | null, scope: GitConfigScope, key: string, value: string | null): Promise<void> {
  if (!isKey(key)) throw new GitConfigError('key', `chave não permitida: ${key}`);
  if (scope !== 'global' && scope !== 'local') throw new GitConfigError('scope', 'escopo inválido');
  if (scope === 'local' && !repoPath) throw new GitConfigError('scope', 'o escopo do repositório precisa de um repositório');
  const cwd = scope === 'local' ? repoPath! : globalCwd();
  if (value === null) {
    // 5 = a chave nem estava definida: remover o que não existe não é erro
    const r = await runGit(cwd, ['config', `--${scope}`, '--unset-all', key], { check: false });
    if (r.code !== 0 && r.code !== 5) throw new Error(r.stderr.trim() || `git config falhou (${r.code})`);
    return;
  }
  validateGitConfigValue(key, value);
  await runGit(cwd, ['config', `--${scope}`, key, value]);
}
