// Credenciais pedidas pelo git/ssh durante uma operação com o remoto: a parte pura (sem Node), usada pela ponte no worker e pela interface.
import { tm } from './messages.js';

/** O que o git/ssh está perguntando. */
export type AskpassKind = 'username' | 'password' | 'passphrase' | 'confirm' | 'other';

/** Um pedido de resposta, mostrado como diálogo pela interface. */
export interface AskpassRequest {
  /** Identifica o pedido (a resposta volta com este id). */
  id: string;
  /** O texto exato que o git/ssh escreveu ("Username for 'https://...': "). */
  prompt: string;
  kind: AskpassKind;
  /** Servidor (host[:porta]) a que o pedido se refere, quando o texto traz um endereço. */
  host?: string;
  /** Usuário já conhecido (vem na URL), quando houver. */
  user?: string;
}

/** A resposta é segredo (senha, frase-senha): a interface esconde o que é digitado e nada disto pode ir para log. */
export const isSecretKind = (k: AskpassKind): boolean => k === 'password' || k === 'passphrase' || k === 'other';

/** host[:porta] e usuário de um endereço (`https://user@host:8443/x`); vazio se não parece um endereço. */
export function hostOfUrl(url: string): { host?: string; user?: string } {
  const m = /^[a-z][a-z0-9+.-]{0,31}:\/\/(?:([^@/\s]+)@)?([^/\s:]+(?::\d+)?)/i.exec(url.trim());
  return m ? { host: m[2], ...(m[1] ? { user: m[1].split(':')[0] } : {}) } : {};
}

/**
 * Classifica o texto que o git ou o ssh passam ao programa de senha:
 * - `Username for 'https://host': ` e `Password for 'https://user@host': ` (HTTPS);
 * - `Enter passphrase for key '/caminho': ` (chave SSH com frase-senha) e `user@host's password: ` (SSH por senha);
 * - `Are you sure you want to continue connecting (yes/no/[fingerprint])?` (servidor SSH desconhecido).
 * Texto que não casa com nada vira `other` (a interface pede como segredo, por segurança).
 */
export function parseAskpassPrompt(prompt: string): Pick<AskpassRequest, 'kind' | 'host' | 'user'> {
  const p = prompt.trim();
  const quoted = /'([^']*)'/.exec(p)?.[1] ?? '';
  if (/^username for\b/i.test(p)) return { kind: 'username', ...hostOfUrl(quoted) };
  if (/^password for\b/i.test(p)) return { kind: 'password', ...hostOfUrl(quoted) };
  if (/passphrase/i.test(p)) return { kind: 'passphrase' };
  if (/\(yes\/no(\/\[fingerprint\])?\)/i.test(p) || /continue connecting/i.test(p)) {
    const host = /authenticity of host '([^']+)'/i.exec(p)?.[1];
    return { kind: 'confirm', ...(host ? { host } : {}) };
  }
  const ssh = /^([^@\s]+)@([^\s']+)'s password:?$/i.exec(p);
  if (ssh) return { kind: 'password', host: ssh[2], user: ssh[1] };
  return { kind: 'other' };
}

/** Por que uma operação com o remoto (buscar, atualizar, enviar) falhou, em categorias que a interface sabe explicar. */
export type RemoteFailure = 'auth' | 'hostKey' | 'notFound' | 'network' | 'other';

/** Lê o texto de erro do git e diz a causa. Sem regex com `.*` entre partes (evita backtracking em saídas longas e repetitivas). */
export function classifyRemoteFailure(output: string): RemoteFailure {
  const low = output.toLowerCase();
  if (low.includes('host key verification failed') || low.includes('remote host identification has changed')) return 'hostKey';
  if (
    low.includes('authentication failed') ||
    low.includes('permission denied (') ||
    low.includes('permission denied, please try again') ||
    low.includes('could not read username') ||
    low.includes('could not read password') ||
    low.includes('terminal prompts disabled') ||
    low.includes('http basic: access denied') ||
    low.includes('invalid username or password') ||
    low.includes('the requested url returned error: 401') ||
    low.includes('the requested url returned error: 403') ||
    low.includes('no supported authentication methods') ||
    low.includes('authorization error') ||
    low.includes('git credentials for')
  ) {
    return 'auth';
  }
  if (low.includes('repository not found') || (low.includes("repository '") && low.includes("' not found")) || low.includes('does not appear to be a git repository') || low.includes('the requested url returned error: 404')) return 'notFound';
  if (low.includes('could not resolve host') || low.includes('unable to access') || low.includes('connection timed out') || low.includes('connection refused') || low.includes('network is unreachable') || low.includes('could not connect') || low.includes('connection reset')) {
    return 'network';
  }
  return 'other';
}

/** Mensagem para a pessoa, por causa; `other` devolve `null` (quem chama mostra o texto do git). */
export function remoteFailureMessage(kind: RemoteFailure): string | null {
  switch (kind) {
    case 'auth':
      return tm(
        'O servidor recusou o acesso (autenticação). Confira o usuário e a senha ou o token; se o acesso for por chave SSH, confira se a chave está carregada no ssh-agent. Tente de novo para digitar as credenciais.',
        'The server refused access (authentication). Check the username and password or token; for SSH access, check that the key is loaded in ssh-agent. Try again to type the credentials.',
      );
    case 'hostKey':
      return tm(
        'A identidade do servidor SSH não pôde ser confirmada (host key). Se o servidor é novo, aceite a impressão digital quando o app perguntar; se ela mudou, converse com o administrador antes de continuar.',
        'The SSH server identity could not be verified (host key). If the server is new, accept the fingerprint when the app asks; if it changed, talk to the administrator before continuing.',
      );
    case 'notFound':
      return tm('Repositório não encontrado no remoto. Confira o endereço do "origin" e se você tem acesso a ele.', 'Repository not found on the remote. Check the "origin" address and that you have access to it.');
    case 'network':
      return tm('Não foi possível conectar ao servidor. Confira a conexão (e a VPN, se houver) e o endereço do remoto.', 'Could not connect to the server. Check your connection (and the VPN, if any) and the remote address.');
    default:
      return null;
  }
}

/** Primeira linha útil de uma saída de erro do git (o que antes ia direto para a tela). */
export const firstErrorLine = (s: string): string => (s.trim().split('\n').find((l) => l.trim()) ?? '').trim();

/** O que mostrar quando uma operação com o remoto falha: a explicação da causa, ou a primeira linha do git se a causa não é conhecida. */
export function remoteErrorText(stderr: string, fallback: string): string {
  return remoteFailureMessage(classifyRemoteFailure(stderr)) ?? (firstErrorLine(stderr) || fallback);
}
