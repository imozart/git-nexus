import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getLfsInfo, isReadOnlyGit, lfsPatterns, parseLfsPointer, pullLfs } from '../src/index.js';

// monta vários repositórios e baixa por HTTP: em máquina carregada passa dos 30 s padrão
vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

let root: string;
let n = 0;
const GIT_ENV = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim();
const cfg = (d: string) => {
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) sh(d, 'config', k!, v!);
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const pointer = (content: string) => `version https://git-lfs.github.com/spec/v1\noid sha256:${sha(content)}\nsize ${Buffer.byteLength(content)}\n`;

// servidor LFS mínimo: a API "batch" aponta para o próprio servidor, que entrega o objeto pelo hash
const objects = new Map<string, string>();
let server: http.Server;
let lfsUrl: string;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-lfs-'));
  Object.assign(process.env, GIT_ENV);
  server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (req.method === 'POST' && req.url?.endsWith('/objects/batch')) {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { objects: Array<{ oid: string; size: number }> };
        const out = body.objects.map((o) => (objects.has(o.oid) ? { oid: o.oid, size: o.size, actions: { download: { href: `${base}/obj/${o.oid}` } } } : { oid: o.oid, size: o.size, error: { code: 404, message: 'não existe' } }));
        res.writeHead(200, { 'Content-Type': 'application/vnd.git-lfs+json' });
        res.end(JSON.stringify({ transfer: 'basic', objects: out }));
      });
      return;
    }
    const m = /^\/obj\/([0-9a-f]{64})$/.exec(req.url ?? '');
    if (m && objects.has(m[1]!)) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return void res.end(objects.get(m[1]!));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  lfsUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/lfs`;
});
afterAll(() => {
  server.close();
  for (const k of Object.keys(GIT_ENV)) delete process.env[k];
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** Repositório com 3 arquivos LFS (um baixado, um só ponteiro, um sumiu da pasta) e um arquivo comum. */
function lfsRepo() {
  const dir = join(root, `r${++n}`);
  sh(root, 'init', '-q', '-b', 'main', dir);
  cfg(dir);
  sh(dir, 'config', 'lfs.url', lfsUrl);
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n# comentário\nassets/*.psd filter=lfs diff=lfs merge=lfs -text\n');
  const contents = { 'a.bin': 'conteudo-da-a\n'.repeat(50), 'b.bin': 'conteudo-da-b\n'.repeat(80), 'assets/c.psd': 'psd-grande\n'.repeat(30) };
  for (const [f, c] of Object.entries(contents)) {
    writeFileSync(join(dir, f), pointer(c)); // o que o git guarda: o ponteiro
    objects.set(sha(c), c);
  }
  writeFileSync(join(dir, 'leia.txt'), 'texto comum\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-qm', 'feat: arquivos lfs');
  // a.bin: conteúdo já baixado; assets/c.psd: sumiu da pasta; b.bin: continua só o ponteiro
  writeFileSync(join(dir, 'a.bin'), contents['a.bin']);
  rmSync(join(dir, 'assets', 'c.psd'));
  return { dir, contents };
}

describe('leitura de ponteiros e padrões', () => {
  it('parseLfsPointer', () => {
    const c = 'x'.repeat(100);
    expect(parseLfsPointer(pointer(c))).toEqual({ oid: sha(c), size: 100 });
    expect(parseLfsPointer('conteúdo comum')).toBeNull();
    expect(parseLfsPointer('version https://git-lfs.github.com/spec/v1\noid sha256:curto\nsize 1\n')).toBeNull();
    expect(parseLfsPointer('version https://git-lfs.github.com/spec/v1\noid sha256:' + 'a'.repeat(64) + '\n')).toBeNull(); // sem size
  });

  it('lfsPatterns: só as linhas com filter=lfs, ignorando comentários e linhas em branco', () => {
    expect(lfsPatterns('*.psd filter=lfs diff=lfs merge=lfs -text\n# *.x filter=lfs\n\n*.txt text eol=lf\r\nvideos/** filter=lfs -text\n')).toEqual(['*.psd', 'videos/**']);
  });

  it('o log do app trata `git lfs ls-files`/`status`/`version` como consulta e `pull`/`track` como alteração', () => {
    for (const c of ['ls-files', 'status', 'version', 'env']) expect(isReadOnlyGit(['lfs', c])).toBe(true);
    for (const c of ['pull', 'track', 'install', 'fetch']) expect(isReadOnlyGit(['lfs', c])).toBe(false);
  });
});

describe('getLfsInfo', () => {
  it('repositório sem LFS: desligado, sem arquivos (caminho rápido)', async () => {
    const dir = join(root, `plain${++n}`);
    sh(root, 'init', '-q', '-b', 'main', dir);
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    sh(dir, 'add', '-A');
    const info = await getLfsInfo(dir);
    expect(info.enabled).toBe(false);
    expect(info.files).toEqual([]);
    expect(info.total).toBe(0);
    expect(typeof info.installed).toBe('boolean');
  });

  it('lista só os arquivos do LFS, cada um no seu estado, com tamanho e hash', async () => {
    const { dir, contents } = lfsRepo();
    const info = await getLfsInfo(dir);
    expect(info.enabled).toBe(true);
    expect(info.patterns).toEqual(['*.bin', 'assets/*.psd']);
    expect(info.total).toBe(3);
    expect(info.truncated).toBe(false);
    const by = Object.fromEntries(info.files.map((f) => [f.path, f]));
    expect(Object.keys(by).sort()).toEqual(['a.bin', 'assets/c.psd', 'b.bin']);
    expect(by['a.bin']).toMatchObject({ state: 'downloaded', size: Buffer.byteLength(contents['a.bin']) });
    expect(by['b.bin']).toMatchObject({ state: 'pointer', size: Buffer.byteLength(contents['b.bin']), oid: sha(contents['b.bin']) });
    expect(by['assets/c.psd']).toEqual({ path: 'assets/c.psd', state: 'missing' });
    expect(info.pointers).toBe(1);
    expect(by['leia.txt']).toBeUndefined();
  });

  it('um .gitattributes dentro de uma pasta também vale (e exceção "-filter" tira o arquivo)', async () => {
    const dir = join(root, `nested${++n}`);
    sh(root, 'init', '-q', '-b', 'main', dir);
    cfg(dir);
    mkdirSync(join(dir, 'media'));
    writeFileSync(join(dir, 'media', '.gitattributes'), '*.mp4 filter=lfs diff=lfs merge=lfs -text\nfora.mp4 -filter\n');
    writeFileSync(join(dir, 'media', 'v.mp4'), pointer('video'));
    writeFileSync(join(dir, 'media', 'fora.mp4'), 'não é lfs\n');
    sh(dir, 'add', '-A');
    const info = await getLfsInfo(dir);
    expect(info.enabled).toBe(true);
    expect(info.files.map((f) => f.path)).toEqual(['media/v.mp4']);
  });

  it('nomes com espaço e acento saem inteiros', async () => {
    const dir = join(root, `nome${++n}`);
    sh(root, 'init', '-q', '-b', 'main', dir);
    cfg(dir);
    writeFileSync(join(dir, '.gitattributes'), '*.bin filter=lfs -text\n');
    writeFileSync(join(dir, 'relatório final.bin'), pointer('r'));
    sh(dir, 'add', '-A');
    expect((await getLfsInfo(dir)).files[0]!.path).toBe('relatório final.bin');
  });
});

describe('pullLfs', () => {
  it('repositório sem LFS: mensagem clara', async () => {
    const dir = join(root, `plain${++n}`);
    sh(root, 'init', '-q', '-b', 'main', dir);
    const r = await pullLfs(dir);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/não usa Git LFS|does not use Git LFS/i);
  });

  it('caminho que não é arquivo LFS é recusado sem rodar nada', async () => {
    const { dir } = lfsRepo();
    const r = await pullLfs(dir, ['leia.txt', '--include=*', '../fora']);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/não são do Git LFS|not Git LFS/i);
  });

  it('baixa só o arquivo pedido (o outro continua ponteiro) e depois todos', async () => {
    const { dir, contents } = lfsRepo();
    const info0 = await getLfsInfo(dir);
    if (!info0.installed) return; // sem git-lfs neste computador não há como baixar: o teste não se aplica
    const one = await pullLfs(dir, ['b.bin']);
    expect(one.ok, one.message).toBe(true);
    expect(readFileSync(join(dir, 'b.bin'), 'utf8')).toBe(contents['b.bin']);
    const after = await getLfsInfo(dir);
    expect(after.files.find((f) => f.path === 'b.bin')!.state).toBe('downloaded');
    expect(after.pointers).toBe(0);
    const again = await pullLfs(dir);
    expect(again.ok).toBe(true);
    expect(again.message).toMatch(/já estão baixados|already downloaded|Baixado/i);
  });

  it('objeto que o servidor não tem: falha com mensagem (o ponteiro continua)', async () => {
    const { dir } = lfsRepo();
    if (!(await getLfsInfo(dir)).installed) return;
    objects.clear();
    const r = await pullLfs(dir, ['b.bin']);
    expect(r.ok).toBe(false);
    expect((await getLfsInfo(dir)).files.find((f) => f.path === 'b.bin')!.state).toBe('pointer');
  });
});
