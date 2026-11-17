// Ponte de credenciais: quando o git (ou o ssh) precisa de usuário, senha, token ou frase-senha de uma chave, ele chama o programa indicado em
// GIT_ASKPASS / SSH_ASKPASS. Aqui esse programa é um pequeno script que pergunta ao app por um canal local (named pipe no Windows, socket Unix nos
// outros), o app mostra um diálogo e a resposta volta ao git. Sem a ponte, o git falhava na hora ("terminal prompts disabled").
//
// Segurança: o canal só aceita quem conhece o token da sessão (que só viaja pelo ambiente do git iniciado pelo app); a resposta fica só na
// memória e nunca é escrita em log; um pedido sem resposta é cancelado depois de um tempo; o socket Unix fica numa pasta só do usuário (0700).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAskpassPrompt, type AskpassRequest } from './askpass-pure.js';
import { NO_PROMPT } from './no-prompt.js';

/** Tempo máximo esperando a pessoa responder (depois disso o pedido é cancelado e o git falha com mensagem de autenticação). */
export const ASKPASS_TIMEOUT_MS = 5 * 60_000;
/** Tamanho máximo do texto do pedido (o canal descarta o que passar). */
const MAX_REQUEST_BYTES = 8 * 1024;

/**
 * O script que o git executa. Roda com o Node do próprio app (`ELECTRON_RUN_AS_NODE=1`), então não depende de nenhuma instalação.
 * Lê o endereço do canal e o token do ambiente, manda o texto do pedido e escreve a resposta no stdout. Qualquer falha ou cancelamento
 * sai com código 1 e sem nada no stdout (o git entende como "sem credencial").
 */
export const ASKPASS_HELPER_JS = `'use strict';
const net = require('node:net');
const endpoint = process.env.GITNEXUS_ASKPASS_ENDPOINT;
const token = process.env.GITNEXUS_ASKPASS_TOKEN;
const prompt = process.argv.slice(2).join(' ');
if (!endpoint || !token) process.exit(1);
let buf = '';
const sock = net.connect(endpoint);
const give_up = setTimeout(() => process.exit(1), ${ASKPASS_TIMEOUT_MS + 30_000});
sock.setEncoding('utf8');
sock.on('connect', () => sock.write(JSON.stringify({ token, prompt }) + '\\n'));
sock.on('data', (d) => { buf += d; });
sock.on('error', () => process.exit(1));
sock.on('close', () => {
  clearTimeout(give_up);
  try {
    const r = JSON.parse(buf);
    if (typeof r.answer === 'string') { process.stdout.write(r.answer + '\\n', () => process.exit(0)); return; }
  } catch { /* resposta quebrada: trata como cancelado */ }
  process.exit(1);
});
`;

/** Aspas duplas do `sh` em volta de um caminho: barras normais (o `sh` do Git for Windows entende `C:/...`) e escapes para $ \` " \\. */
export function shQuote(path: string): string {
  // um caractere por vez: `\` vira `/` e `"`, `$` e `` ` `` ganham a barra de escape (sem encadear replaces, que o CodeQL acusa de escape incompleto)
  const body = Array.from(path, (ch) => (ch === '\\' ? '/' : ch === '"' || ch === '$' || ch === '`' ? `\\${ch}` : ch)).join('');
  return `"${body}"`;
}

export interface AskpassBridge {
  /** Variáveis para o ambiente de cada git iniciado pelo app (o git usa o script, o script fala com este canal). */
  env: NodeJS.ProcessEnv;
  /** Responde a um pedido (`null` = a pessoa cancelou). Pedido desconhecido ou já respondido é ignorado. */
  answer(id: string, value: string | null): void;
  /** Pedidos esperando resposta agora. */
  pending(): number;
  close(): Promise<void>;
}

export interface AskpassOptions {
  /** Pasta (do app) onde o script e o launcher são gravados. */
  dir: string;
  /** Chamado a cada pedido novo; a resposta chega depois por `answer`. */
  onRequest: (req: AskpassRequest) => void;
  /** Programa que roda o script (padrão: o Node/Electron atual, com ELECTRON_RUN_AS_NODE=1). */
  execPath?: string;
  timeoutMs?: number;
}

/** Sobe o canal local e grava o script. Devolve a ponte; `close()` encerra o canal e cancela os pedidos que sobraram. */
export async function startAskpassBridge(opts: AskpassOptions): Promise<AskpassBridge> {
  await mkdir(opts.dir, { recursive: true });
  const helper = join(opts.dir, 'askpass-helper.cjs');
  const launcher = join(opts.dir, 'askpass');
  await writeFile(helper, ASKPASS_HELPER_JS, 'utf8');
  // `#!/bin/sh`: o Git for Windows também executa scripts assim (sem cmd.exe nem PowerShell, que políticas de segurança podem bloquear)
  await writeFile(launcher, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shQuote(opts.execPath ?? process.execPath)} ${shQuote(helper)} "$@"\n`, 'utf8');
  await chmod(launcher, 0o755).catch(() => undefined);

  const token = randomBytes(24).toString('hex');
  const sockDir = process.platform === 'win32' ? '' : await mkdtemp(join(tmpdir(), 'gitnexus-ask-'));
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\gitnexus-askpass-${randomBytes(8).toString('hex')}` : join(sockDir, 's');
  const tokenBuf = Buffer.from(token);
  const timeoutMs = opts.timeoutMs ?? ASKPASS_TIMEOUT_MS;

  const waiting = new Map<string, { socket: net.Socket; timer: ReturnType<typeof setTimeout> }>();
  let seq = 0;
  const finish = (id: string, reply: { answer: string } | { cancel: true }): void => {
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    clearTimeout(w.timer);
    w.socket.end(JSON.stringify(reply) + '\n');
  };

  const server = net.createServer((socket) => {
    let buf = '';
    let handled = false;
    socket.setEncoding('utf8');
    socket.on('error', () => undefined);
    socket.on('data', (d: string) => {
      if (handled) return;
      buf += d;
      if (buf.length > MAX_REQUEST_BYTES) return void socket.destroy();
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      handled = true;
      let msg: { token?: unknown; prompt?: unknown };
      try {
        msg = JSON.parse(buf.slice(0, nl)) as typeof msg;
      } catch {
        return void socket.end(JSON.stringify({ cancel: true }) + '\n');
      }
      const given = Buffer.from(typeof msg.token === 'string' ? msg.token : '');
      if (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf) || typeof msg.prompt !== 'string') {
        return void socket.end(JSON.stringify({ cancel: true }) + '\n');
      }
      const id = `${++seq}-${randomBytes(4).toString('hex')}`;
      const timer = setTimeout(() => finish(id, { cancel: true }), timeoutMs);
      waiting.set(id, { socket, timer });
      // o git desistiu (matou o script): o pedido some sozinho
      socket.on('close', () => {
        if (waiting.delete(id)) clearTimeout(timer);
      });
      const prompt = msg.prompt.slice(0, 1000);
      opts.onRequest({ id, prompt, ...parseAskpassPrompt(prompt) });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => resolve());
  });
  if (process.platform !== 'win32') await chmod(endpoint, 0o600).catch(() => undefined);

  return {
    env: {
      GIT_ASKPASS: launcher,
      SSH_ASKPASS: launcher,
      // o ssh só chama o programa de senha sem terminal se for obrigado (OpenSSH 8.4 ou mais novo)
      SSH_ASKPASS_REQUIRE: 'force',
      GITNEXUS_ASKPASS_ENDPOINT: endpoint,
      GITNEXUS_ASKPASS_TOKEN: token,
    },
    answer: (id, value) => finish(id, value === null ? { cancel: true } : { answer: value }),
    pending: () => waiting.size,
    close: async () => {
      for (const id of [...waiting.keys()]) finish(id, { cancel: true });
      await new Promise<void>((r) => server.close(() => r()));
      if (sockDir) await rm(sockDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

// --- qual ponte está valendo (uma por processo) e o ambiente de cada tipo de operação -------------------------------------------------

let active: AskpassBridge | null = null;
export const setActiveAskpass = (b: AskpassBridge | null): void => {
  active = b;
};
export const getActiveAskpass = (): AskpassBridge | null => active;

/** Só as variáveis da ponte (vazio sem ponte): para comandos que podem pedir frase-senha mas não falam com o remoto, como assinar um commit. */
export const askpassEnv = (): NodeJS.ProcessEnv => (active ? active.env : {});

/**
 * Ambiente do git para uma operação com o remoto. `silent` (busca em segundo plano, lote de vários repositórios): nunca pergunta nada, falha
 * logo (o `NO_PROMPT` de sempre). Sem `silent` e com a ponte ativa: o git pede as credenciais ao app. Sem ponte: igual ao silencioso.
 */
export function remoteEnv(silent = false): NodeJS.ProcessEnv {
  if (silent || !active) return NO_PROMPT;
  // sem BatchMode: o ssh pode perguntar a frase-senha e confirmar servidores novos, e ambos passam pela ponte
  return { GIT_TERMINAL_PROMPT: '0', ...active.env };
}
