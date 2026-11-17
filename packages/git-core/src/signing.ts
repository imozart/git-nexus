// Assinatura de commits (GPG, SSH ou X.509): o que o git está configurado para fazer. Assinar mesmo é com o próprio git (`commit -S`); aqui só se
// lê a configuração para a interface mostrar e deixar escolher.
import { runGit } from './runner.js';
import type { SigningFormat, SigningInfo } from './types/ipc.js';

const FORMATS: readonly SigningFormat[] = ['openpgp', 'ssh', 'x509'];

/** Valor efetivo (local, global ou do sistema) de uma chave do git, ou null se não está definida. */
async function cfg(repoPath: string, key: string, type?: 'bool'): Promise<string | null> {
  const r = await runGit(repoPath, ['config', ...(type ? ['--type=bool'] : []), '--get', key], { check: false });
  const v = r.code === 0 ? r.stdout.trim() : '';
  return v || null;
}

/**
 * Como os commits deste repositório são assinados: `enabled` = `commit.gpgsign` ligado (o git assina todo commit sozinho), o formato
 * (`gpg.format`, padrão openpgp) e a chave (`user.signingkey`, se houver).
 */
export async function getSigningInfo(repoPath: string): Promise<SigningInfo> {
  const [sign, format, key] = await Promise.all([cfg(repoPath, 'commit.gpgsign', 'bool'), cfg(repoPath, 'gpg.format'), cfg(repoPath, 'user.signingkey')]);
  const f = (format ?? 'openpgp').toLowerCase();
  return { enabled: sign === 'true', format: (FORMATS as readonly string[]).includes(f) ? (f as SigningFormat) : 'openpgp', key };
}
