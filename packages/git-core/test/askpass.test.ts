import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  classifyRemoteFailure,
  cloneRepository,
  fetchRepo,
  firstErrorLine,
  hostOfUrl,
  parseAskpassPrompt,
  remoteEnv,
  remoteErrorText,
  remoteFailureMessage,
  runGit,
  setActiveAskpass,
  shQuote,
  startAskpassBridge,
  type AskpassBridge,
  type AskpassRequest,
} from '../src/index.js';

describe('parseAskpassPrompt', () => {
  it('HTTPS: usuário e senha, com o servidor e o usuário que vierem no endereço', () => {
    expect(parseAskpassPrompt("Username for 'https://git.exemplo.gov.br': ")).toEqual({ kind: 'username', host: 'git.exemplo.gov.br' });
    expect(parseAskpassPrompt("Password for 'https://maria@git.exemplo.gov.br:8443': ")).toEqual({ kind: 'password', host: 'git.exemplo.gov.br:8443', user: 'maria' });
    expect(parseAskpassPrompt("Password for 'https://maria:segredo@host.com': ").user).toBe('maria'); // a senha da URL nunca vira "usuário"
  });

  it('SSH: frase-senha da chave, senha e servidor desconhecido', () => {
    expect(parseAskpassPrompt("Enter passphrase for key '/home/maria/.ssh/id_ed25519': ").kind).toBe('passphrase');
    expect(parseAskpassPrompt('Enter passphrase for C:\\Users\\m\\.ssh\\id_rsa: ').kind).toBe('passphrase');
    expect(parseAskpassPrompt("maria@servidor.com's password: ")).toEqual({ kind: 'password', host: 'servidor.com', user: 'maria' });
    const c = parseAskpassPrompt("The authenticity of host 'github.com (140.82.112.4)' can't be established.\nED25519 key fingerprint is SHA256:abc.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ");
    expect(c.kind).toBe('confirm');
    expect(c.host).toBe('github.com (140.82.112.4)');
  });

  it('texto desconhecido vira "other" (a interface pede como segredo)', () => {
    expect(parseAskpassPrompt('Algo diferente: ').kind).toBe('other');
    expect(parseAskpassPrompt('').kind).toBe('other');
  });

  it('hostOfUrl', () => {
    expect(hostOfUrl('https://a.b/c')).toEqual({ host: 'a.b' });
    expect(hostOfUrl('http://u@a.b:8080/c')).toEqual({ host: 'a.b:8080', user: 'u' });
    expect(hostOfUrl('git@github.com:x/y.git')).toEqual({});
  });
});

describe('causa da falha com o remoto', () => {
  it('reconhece cada causa', () => {
    expect(classifyRemoteFailure("fatal: could not read Username for 'https://x': terminal prompts disabled")).toBe('auth');
    expect(classifyRemoteFailure('git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.')).toBe('auth');
    expect(classifyRemoteFailure("remote: Invalid username or password.\nfatal: Authentication failed for 'https://x/'")).toBe('auth');
    expect(classifyRemoteFailure('Host key verification failed.')).toBe('hostKey');
    expect(classifyRemoteFailure("fatal: repository 'https://x/y.git/' not found")).toBe('notFound');
    expect(classifyRemoteFailure("fatal: unable to access 'https://x/': Could not resolve host: x")).toBe('network');
    expect(classifyRemoteFailure('estranho')).toBe('other');
  });

  it('"Permission denied" de um arquivo local NÃO é falha de credencial', () => {
    expect(classifyRemoteFailure("error: unable to create file a.txt: Permission denied")).toBe('other');
  });

  it('a mensagem explica o que fazer; causa desconhecida devolve o texto do git', () => {
    expect(remoteFailureMessage('auth')).toMatch(/ssh-agent|credenciais|credentials/i);
    expect(remoteFailureMessage('other')).toBeNull();
    expect(remoteErrorText("fatal: could not read Username for 'https://x': terminal prompts disabled", 'padrão')).toMatch(/recusou o acesso|refused access/i);
    expect(remoteErrorText('\n\nfatal: coisa estranha\noutra', 'padrão')).toBe('fatal: coisa estranha');
    expect(remoteErrorText('', 'padrão')).toBe('padrão');
    expect(firstErrorLine('\n a \n b')).toBe('a');
  });

  it('saída longa e repetitiva é classificada em tempo curto (sem regex quadrática)', () => {
    const t0 = Date.now();
    classifyRemoteFailure('unable to access '.repeat(60_000));
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('shQuote', () => {
  it('barras normais e escapes de $ ` "', () => {
    expect(shQuote('C:\\Program Files\\nodejs\\node.exe')).toBe('"C:/Program Files/nodejs/node.exe"');
    expect(shQuote('/tmp/a"b$c`d')).toBe('"/tmp/a\\"b\\$c\\`d"');
  });
});

// --- ponta a ponta: git de verdade + servidor HTTP que exige senha + ponte + script -----------------------------------------------------
let root: string;
let server: http.Server;
let url: string;
let bridge: AskpassBridge | null = null;
const seen: AskpassRequest[] = [];
/** O que a "pessoa" responde, por tipo de pedido (função: pode variar por chamada). */
let respond: (r: AskpassRequest) => string | null = () => null;
const USER = 'maria';
const PASS = 'segredo-123';

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-askpass-'));
  const bare = join(root, 'r.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) execFileSync('git', ['-C', work, 'config', k!, v!]);
  writeFileSync(join(work, 'a.txt'), 'a\n');
  execFileSync('git', ['-C', work, 'add', '.']);
  execFileSync('git', ['-C', work, 'commit', '-qm', 'feat: base']);
  execFileSync('git', ['-C', work, 'push', '-q', bare, 'main']);

  // servidor HTTP "smart" mínimo (só leitura): 401 sem credencial correta; com ela, anuncia as refs do repositório
  server = http.createServer((req, res) => {
    const ok = req.headers.authorization === 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
    if (!ok) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="gitnexus"' });
      return void res.end('auth');
    }
    if (req.url?.startsWith('/r.git/info/refs')) {
      const out = execFileSync('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', bare]);
      res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement' });
      res.write('001e# service=git-upload-pack\n0000');
      return void res.end(out);
    }
    if (req.url === '/r.git/git-upload-pack' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          // o corpo pode vir compactado (gzip) quando é grande: o git de teste manda pequeno, sem compressão
          const out = execFileSync('git', ['upload-pack', '--stateless-rpc', bare], { input: Buffer.concat(chunks) });
          res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-result' });
          res.end(out);
        } catch {
          res.writeHead(500);
          res.end();
        }
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/r.git`;
});
afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

async function startBridge(timeoutMs?: number): Promise<AskpassBridge> {
  seen.length = 0;
  const b = await startAskpassBridge({
    dir: join(root, 'ask dir com espaço'), // pasta com espaço: o caso comum no Windows
    timeoutMs,
    onRequest: (r) => {
      seen.push(r);
      // responde depois de um instante, como uma pessoa (e para provar que o git espera)
      setTimeout(() => b.answer(r.id, respond(r)), 30);
    },
  });
  bridge = b;
  setActiveAskpass(b);
  return b;
}
afterEach(async () => {
  setActiveAskpass(null);
  await bridge?.close();
  bridge = null;
});

/** Roda o git como o app roda: `credential.helper` vazio (o do computador não pode responder no lugar do teste). */
const lsRemote = (silent = false) => runGit(root, ['-c', 'credential.helper=', 'ls-remote', url], { check: false, env: remoteEnv(silent) });

describe('ponte de credenciais (git de verdade)', () => {
  it('sem a ponte, o git falha na hora com "terminal prompts disabled" (o comportamento que a investigação confirmou)', async () => {
    const r = await lsRemote();
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/terminal prompts disabled|could not read Username/i);
  });

  it('com a ponte, o git pergunta usuário e senha, o app responde e a operação funciona', async () => {
    await startBridge();
    respond = (r) => (r.kind === 'username' ? USER : r.kind === 'password' ? PASS : null);
    const r = await lsRemote();
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/refs\/heads\/main/);
    expect(seen.map((s) => s.kind)).toEqual(['username', 'password']);
    expect(seen[0]!.host).toBe(new URL(url).host);
  });

  it('a senha digitada nunca aparece nos comandos registrados (o log mostra só os argumentos)', async () => {
    await startBridge();
    respond = (r) => (r.kind === 'username' ? USER : PASS);
    const logged: string[] = [];
    const { onGitCommand } = await import('../src/index.js');
    const off = onGitCommand((e) => logged.push(e.command + '\n' + e.output));
    const r = await lsRemote();
    off();
    expect(r.code).toBe(0);
    expect(logged.join('\n')).not.toContain(PASS);
  });

  it('senha errada: o git falha e a mensagem é a de autenticação (não o texto cru)', async () => {
    await startBridge();
    respond = (r) => (r.kind === 'username' ? USER : 'senha-errada');
    const r = await lsRemote();
    expect(r.code).not.toBe(0);
    expect(remoteErrorText(r.stderr, 'padrão')).toMatch(/recusou o acesso|refused access/i);
  });

  it('a pessoa cancela o diálogo: o git falha sem travar e sem senha vazando', async () => {
    await startBridge();
    respond = () => null;
    const r = await lsRemote();
    expect(r.code).not.toBe(0);
    expect(seen).toHaveLength(1); // desistiu no primeiro pedido
    expect(classifyRemoteFailure(r.stderr)).toBe('auth');
  });

  it('operação silenciosa (busca em segundo plano ou em lote) nunca pede nada, mesmo com a ponte ativa', async () => {
    await startBridge();
    respond = (r) => (r.kind === 'username' ? USER : PASS);
    const r = await lsRemote(true);
    expect(r.code).not.toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('fetchRepo pede as credenciais; fetchRepo silencioso não', async () => {
    const dir = join(root, 'clone-fetch');
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    execFileSync('git', ['-C', dir, 'config', 'credential.helper', '']);
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', url]);
    await startBridge();
    respond = (r) => (r.kind === 'username' ? USER : PASS);
    const quiet = await fetchRepo(dir, true);
    expect(quiet.ok).toBe(false);
    expect(seen).toHaveLength(0);
    expect(quiet.message).toMatch(/recusou o acesso|refused access/i);
    const loud = await fetchRepo(dir);
    expect(loud.ok, loud.message).toBe(true);
    expect(seen.map((s) => s.kind)).toEqual(['username', 'password']);
  });

  it('clonar um endereço que exige senha pergunta e conclui', async () => {
    await startBridge();
    respond = (r) => (r.kind === 'username' ? USER : PASS);
    const parent = join(root, 'clones');
    mkdirSync(parent);
    // o `credential.helper` do computador poderia responder no lugar do teste: desligado só para este clone
    const prev = process.env.GIT_CONFIG_COUNT;
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'credential.helper';
    process.env.GIT_CONFIG_VALUE_0 = '';
    try {
      const r = await cloneRepository({ url, parentDir: parent, name: 'protegido' });
      expect(existsSync(join(r.path, 'a.txt'))).toBe(true);
      expect(seen.map((s) => s.kind)).toEqual(['username', 'password']);
    } finally {
      if (prev === undefined) delete process.env.GIT_CONFIG_COUNT;
      else process.env.GIT_CONFIG_COUNT = prev;
      delete process.env.GIT_CONFIG_KEY_0;
      delete process.env.GIT_CONFIG_VALUE_0;
    }
  });

  it('pedido sem resposta é cancelado no tempo limite (o git não fica preso para sempre)', async () => {
    const b = await startAskpassBridge({ dir: join(root, 'ask-timeout'), timeoutMs: 400, onRequest: () => undefined });
    bridge = b;
    setActiveAskpass(b);
    const t0 = Date.now();
    const r = await lsRemote();
    expect(r.code).not.toBe(0);
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(b.pending()).toBe(0);
  });
});

describe('canal da ponte', () => {
  const ask = (endpoint: string, payload: unknown): Promise<string> =>
    new Promise((resolve) => {
      const s = net.connect(endpoint);
      let buf = '';
      s.setEncoding('utf8');
      s.on('connect', () => s.write(typeof payload === 'string' ? payload : JSON.stringify(payload) + '\n'));
      s.on('data', (d: string) => (buf += d));
      s.on('close', () => resolve(buf));
      s.on('error', () => resolve(buf));
    });

  it('token errado, ausente ou JSON quebrado: cancelado, e nenhum pedido chega à interface', async () => {
    const got: AskpassRequest[] = [];
    const b = await startAskpassBridge({ dir: join(root, 'ask-tok'), onRequest: (r) => got.push(r) });
    bridge = b;
    const ep = b.env.GITNEXUS_ASKPASS_ENDPOINT!;
    expect(JSON.parse(await ask(ep, { token: 'errado', prompt: 'Password for x: ' }))).toEqual({ cancel: true });
    expect(JSON.parse(await ask(ep, { prompt: 'Password for x: ' }))).toEqual({ cancel: true });
    expect(JSON.parse(await ask(ep, 'isto não é json\n'))).toEqual({ cancel: true });
    expect(got).toHaveLength(0);
  });

  it('com o token certo o pedido chega; a resposta volta; responder de novo ou com id desconhecido é ignorado', async () => {
    const got: AskpassRequest[] = [];
    const b = await startAskpassBridge({ dir: join(root, 'ask-ok'), onRequest: (r) => got.push(r) });
    bridge = b;
    const p = ask(b.env.GITNEXUS_ASKPASS_ENDPOINT!, { token: b.env.GITNEXUS_ASKPASS_TOKEN, prompt: "Username for 'https://h': " });
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: 'username', host: 'h' });
    expect(b.pending()).toBe(1);
    b.answer('id-que-nao-existe', 'x');
    b.answer(got[0]!.id, 'maria');
    b.answer(got[0]!.id, 'outra');
    expect(JSON.parse(await p)).toEqual({ answer: 'maria' });
    expect(b.pending()).toBe(0);
  });

  it('pedidos simultâneos recebem cada um a sua resposta', async () => {
    const got: AskpassRequest[] = [];
    const b = await startAskpassBridge({ dir: join(root, 'ask-par'), onRequest: (r) => got.push(r) });
    bridge = b;
    const ep = b.env.GITNEXUS_ASKPASS_ENDPOINT!;
    const tk = b.env.GITNEXUS_ASKPASS_TOKEN;
    const pa = ask(ep, { token: tk, prompt: "Username for 'https://a': " });
    const pb = ask(ep, { token: tk, prompt: "Username for 'https://b': " });
    await new Promise((r) => setTimeout(r, 300));
    for (const r of got) b.answer(r.id, `resp-${r.host}`);
    expect(JSON.parse(await pa)).toEqual({ answer: 'resp-a' });
    expect(JSON.parse(await pb)).toEqual({ answer: 'resp-b' });
  });

  it('fechar a ponte cancela quem estava esperando', async () => {
    const b = await startAskpassBridge({ dir: join(root, 'ask-close'), onRequest: () => undefined });
    const p = ask(b.env.GITNEXUS_ASKPASS_ENDPOINT!, { token: b.env.GITNEXUS_ASKPASS_TOKEN, prompt: 'Password: ' });
    await new Promise((r) => setTimeout(r, 200));
    await b.close();
    expect(JSON.parse(await p)).toEqual({ cancel: true });
  });

  it('o ambiente traz o script, o canal e o token; o script é executável e usa o Node do app', async () => {
    const b = await startAskpassBridge({ dir: join(root, 'ask-env'), onRequest: () => undefined });
    bridge = b;
    expect(b.env.GIT_ASKPASS).toBe(b.env.SSH_ASKPASS);
    expect(b.env.SSH_ASKPASS_REQUIRE).toBe('force');
    expect(b.env.GITNEXUS_ASKPASS_TOKEN).toMatch(/^[0-9a-f]{48}$/);
    const script = readFileSync(b.env.GIT_ASKPASS!, 'utf8');
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).toContain('ELECTRON_RUN_AS_NODE=1');
    if (process.platform !== 'win32') expect(statSync(b.env.GIT_ASKPASS!).mode & 0o111).not.toBe(0);
  });

  it('ambiente por tipo de operação: silencioso e sem ponte nunca pergunta; com a ponte, sem BatchMode', async () => {
    expect(remoteEnv(true).GIT_SSH_COMMAND).toMatch(/BatchMode=yes/);
    expect(remoteEnv().GIT_ASKPASS).toBeUndefined(); // ponte não ativa
    const b = await startAskpassBridge({ dir: join(root, 'ask-env2'), onRequest: () => undefined });
    bridge = b;
    setActiveAskpass(b);
    expect(remoteEnv().GIT_ASKPASS).toBe(b.env.GIT_ASKPASS);
    expect(remoteEnv().GIT_SSH_COMMAND).toBeUndefined();
    expect(remoteEnv().GIT_TERMINAL_PROMPT).toBe('0');
    expect(remoteEnv(true).GIT_ASKPASS).toBeUndefined();
  });
});
