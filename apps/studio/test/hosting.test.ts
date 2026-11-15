import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit, type ProviderKind } from '@git-nexus/git-core';
import { HostingService, type TokenStore } from '../src/worker/hosting-service';
import { apiBase, ciFromGithub, ciFromGitlab, detectKind, listQuery, mapGithubPull, mapGitlabMr, parseRemote, suggestTitle, summarize } from '../src/shared/hosting';

describe('parseRemote', () => {
  it('entende https, scp e ssh://, com e sem .git', () => {
    expect(parseRemote('https://github.com/dono/repo.git')).toEqual({ scheme: 'https', host: 'github.com', projectPath: 'dono/repo' });
    expect(parseRemote('https://github.com/dono/repo')).toMatchObject({ projectPath: 'dono/repo' });
    expect(parseRemote('git@github.com:dono/repo.git')).toEqual({ scheme: 'ssh', host: 'github.com', projectPath: 'dono/repo' });
    expect(parseRemote('ssh://git@gitlab.empresa.com:2222/grupo/sub/projeto.git')).toEqual({ scheme: 'ssh', host: 'gitlab.empresa.com', projectPath: 'grupo/sub/projeto' });
    expect(parseRemote('http://git.interno:8080/time/app.git')).toEqual({ scheme: 'http', host: 'git.interno:8080', projectPath: 'time/app' });
  });
  it('descarta credenciais embutidas e ignora caminhos locais e lixo', () => {
    const r = parseRemote('https://usuario:segredo@gitlab.com/g/p.git');
    expect(r).toEqual({ scheme: 'https', host: 'gitlab.com', projectPath: 'g/p' });
    expect(JSON.stringify(r)).not.toContain('segredo');
    expect(parseRemote('C:\\repos\\app')).toBeNull();
    expect(parseRemote('/home/x/app.git')).toBeNull();
    expect(parseRemote('https://github.com/so-um')).toBeNull();
    expect(parseRemote('lixo')).toBeNull();
  });
});

describe('provedor e API', () => {
  it('reconhece GitHub e GitLab (inclusive próprio) e aceita escolha manual', () => {
    expect(detectKind('github.com')).toBe('github');
    expect(detectKind('gitlab.com')).toBe('gitlab');
    expect(detectKind('gitlab.badesc.gov.br')).toBe('gitlab');
    expect(detectKind('meu-gitlab.empresa.com:8443')).toBe('gitlab');
    expect(detectKind('git.empresa.com')).toBeNull();
    expect(detectKind('git.empresa.com', 'github')).toBe('github');
    expect(detectKind('github.com.evil.com')).toBeNull(); // não confunde com github.com
  });
  it('endereços da API (nuvem, GitHub Enterprise, GitLab próprio, http interno)', () => {
    expect(apiBase('github', 'github.com', 'https')).toBe('https://api.github.com');
    expect(apiBase('github', 'ghe.empresa.com', 'https')).toBe('https://ghe.empresa.com/api/v3');
    expect(apiBase('gitlab', 'gitlab.empresa.com', 'ssh')).toBe('https://gitlab.empresa.com/api/v4');
    expect(apiBase('gitlab', 'gitlab.interno:8080', 'http')).toBe('http://gitlab.interno:8080/api/v4');
  });
  it('consulta de estado: GitHub não tem "merged"', () => {
    expect(listQuery('github', 'open')).toContain('state=open');
    expect(listQuery('github', 'merged')).toContain('state=closed');
    expect(listQuery('gitlab', 'open')).toContain('state=opened');
    expect(listQuery('gitlab', 'merged')).toContain('state=merged');
  });
});

describe('mapeamento e CI', () => {
  it('PR do GitHub (aberto, mergeado, rascunho) e MR do GitLab', () => {
    const base = { number: 1, title: 't', user: { login: 'ana' }, state: 'open', head: { ref: 'f', sha: 'a'.repeat(40) }, base: { ref: 'main' }, html_url: 'u', created_at: 'c', updated_at: 'u2' };
    expect(mapGithubPull(base)).toMatchObject({ number: 1, author: 'ana', state: 'open', sourceBranch: 'f', targetBranch: 'main', draft: false });
    expect(mapGithubPull({ ...base, state: 'closed', merged_at: '2026-01-01' }).state).toBe('merged');
    expect(mapGithubPull({ ...base, state: 'closed' }).state).toBe('closed');
    expect(mapGithubPull({ ...base, draft: true }).draft).toBe(true);
    const mr = { iid: 7, title: 'm', author: { username: 'beto' }, state: 'opened', draft: true, source_branch: 's', target_branch: 'main', sha: 'b'.repeat(40), web_url: 'w', created_at: 'c', updated_at: 'u' };
    expect(mapGitlabMr(mr)).toMatchObject({ number: 7, author: 'beto', state: 'open', draft: true });
    expect(mapGitlabMr({ ...mr, state: 'merged' }).state).toBe('merged');
    expect(mapGitlabMr({ ...mr, state: 'locked' }).state).toBe('closed');
  });

  it('resumo do CI: falha > pendente > sucesso > nada', () => {
    const c = (state: 'success' | 'failure' | 'pending') => ({ name: 'x', state });
    expect(summarize([])).toBe('none');
    expect(summarize([c('success'), c('success')])).toBe('success');
    expect(summarize([c('success'), c('pending')])).toBe('pending');
    expect(summarize([c('pending'), c('failure'), c('success')])).toBe('failure');
  });

  it('GitHub: junta check-runs e statuses clássicos', () => {
    const r = ciFromGithub(
      [{ name: 'build', status: 'completed', conclusion: 'success' }, { name: 'lint', status: 'in_progress', conclusion: null }, { name: 'skip', status: 'completed', conclusion: 'skipped' }],
      [{ context: 'ci/legacy', state: 'success' }],
    );
    expect(r.state).toBe('pending');
    expect(r.checks.map((x) => x.state)).toEqual(['success', 'pending', 'success', 'success']);
    expect(ciFromGithub([{ name: 'b', status: 'completed', conclusion: 'timed_out' }], []).state).toBe('failure');
    expect(ciFromGithub([{ name: 'b', status: 'completed', conclusion: 'cancelled' }], []).state).toBe('failure');
    expect(ciFromGithub([], [{ context: 'x', state: 'error' }]).state).toBe('failure');
  });

  it('GitLab: status do pipeline', () => {
    expect(ciFromGitlab([]).state).toBe('none');
    expect(ciFromGitlab([{ id: 1, status: 'success' }]).state).toBe('success');
    expect(ciFromGitlab([{ id: 1, status: 'failed' }]).state).toBe('failure');
    expect(ciFromGitlab([{ id: 1, status: 'running' }]).state).toBe('pending');
    expect(ciFromGitlab([{ id: 1, status: 'manual' }]).state).toBe('pending');
    expect(ciFromGitlab([{ id: 1, status: 'canceled' }]).state).toBe('none');
  });
});

describe('suggestTitle', () => {
  const c = (type: string, extra: object = {}) => ({ type, scope: '', title: 'faz algo', breaking: false, ticket: null, subject: `${type}: faz algo`, ...extra });
  it('um commit: usa o assunto dele', () => {
    expect(suggestTitle([c('fix', { subject: 'fix(auth): corrige login' })], 'qualquer')).toBe('fix(auth): corrige login');
  });
  it('vários: tipo mais relevante + branch em palavras + ticket', () => {
    expect(suggestTitle([c('chore'), c('feat'), c('fix')], 'feature/PROJ-12-login-social')).toBe('feat: login social');
    expect(suggestTitle([c('fix', { ticket: 'PROJ-12' }), c('docs')], 'bugfix/corrige-timeout')).toBe('fix: corrige timeout (PROJ-12)');
    expect(suggestTitle([c('docs'), c('chore', { breaking: true })], 'main')).toBe('feat: main');
  });
});

// ---------------------------------------------------------------------------------------------
// Serviço: servidor HTTP simulando GitHub (Enterprise) e GitLab + repositórios git reais
// ---------------------------------------------------------------------------------------------
class MemStore implements TokenStore {
  tokens = new Map<string, string>();
  kinds = new Map<string, ProviderKind>();
  getToken = async (h: string) => this.tokens.get(h);
  setToken = async (h: string, t: string) => void this.tokens.set(h, t);
  removeToken = async (h: string) => void this.tokens.delete(h);
  getKind = async (h: string) => this.kinds.get(h);
  setKind = async (h: string, k: ProviderKind) => void this.kinds.set(h, k);
  secure = () => true;
}

const SHA = 'c'.repeat(40);
let server: Server;
let host = '';
const calls: Array<{ method: string; url: string; auth?: string; body?: unknown }> = [];
const dirs: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const auth = (req.headers.authorization ?? (req.headers['private-token'] as string | undefined)) as string | undefined;
      calls.push({ method: req.method!, url: req.url!, auth, body });
      const ok = (data: unknown, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      const u = req.url!;
      const good = auth === 'Bearer tok-gh' || auth === 'tok-gl';
      if (!good) return ok({ message: 'Bad credentials' }, 401);
      // ---- GitHub (estilo Enterprise: /api/v3)
      if (u === '/api/v3/user') return ok({ login: 'ana' });
      if (u.startsWith('/api/v3/repos/dono/repo/pulls?') && req.method === 'GET')
        return ok([
          { number: 5, title: 'feat: nova tela', user: { login: 'ana' }, state: 'open', draft: false, head: { ref: 'feat/tela', sha: SHA }, base: { ref: 'main' }, html_url: `http://${host}/dono/repo/pull/5`, created_at: 'a', updated_at: 'b' },
          { number: 4, title: 'fix: bug', user: { login: 'beto' }, state: 'closed', merged_at: '2026-01-02', head: { ref: 'fix/bug', sha: 'd'.repeat(40) }, base: { ref: 'main' }, html_url: 'x', created_at: 'a', updated_at: 'b' },
        ]);
      if (u === '/api/v3/repos/dono/repo/pulls' && req.method === 'POST') return ok({ html_url: `http://${host}/dono/repo/pull/9`, number: 9 }, 201);
      if (u.includes('/commits/') && u.includes('/check-runs')) return ok({ check_runs: [{ name: 'build', status: 'completed', conclusion: 'failure', html_url: 'http://run/1' }] });
      if (u.includes('/commits/') && u.endsWith('/status')) return ok({ statuses: [] });
      // ---- GitLab (/api/v4)
      if (u === '/api/v4/user') return ok({ username: 'carla' });
      if (u.startsWith('/api/v4/projects/grupo%2Fsub%2Fproj/merge_requests?') && req.method === 'GET')
        return ok([{ iid: 3, title: 'Draft: wip', author: { username: 'carla' }, state: 'opened', draft: true, source_branch: 'feat/x', target_branch: 'main', sha: SHA, web_url: `http://${host}/grupo/sub/proj/-/merge_requests/3`, created_at: 'a', updated_at: 'b' }]);
      if (u === '/api/v4/projects/grupo%2Fsub%2Fproj/merge_requests' && req.method === 'POST') return ok({ web_url: `http://${host}/grupo/sub/proj/-/merge_requests/8`, iid: 8 }, 201);
      if (u.startsWith('/api/v4/projects/grupo%2Fsub%2Fproj/pipelines?')) return ok([{ id: 77, status: 'success', web_url: 'http://pipe/77' }]);
      return ok({ message: 'Not Found' }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

async function repo(remotePath: string): Promise<string> {
  const d = mkdtempSync(join(tmpdir(), 'gitnexus-host-'));
  dirs.push(d);
  const g = (...a: string[]) => runGit(d, a);
  await g('init', '-b', 'main');
  await g('config', 'user.name', 'T');
  await g('config', 'user.email', 't@e.com');
  await g('config', 'commit.gpgsign', 'false');
  await g('config', 'core.autocrlf', 'false');
  await g('remote', 'add', 'origin', `http://${host}/${remotePath}.git`);
  writeFileSync(join(d, 'a.txt'), '1\n');
  await g('add', '.');
  await g('commit', '-m', 'init');
  await g('update-ref', 'refs/remotes/origin/main', 'HEAD'); // simula o fetch: a base existe no remoto
  await g('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  return d;
}
async function commit(d: string, file: string, msg: string): Promise<void> {
  writeFileSync(join(d, file), 'x\n');
  await runGit(d, ['add', '.']);
  await runGit(d, ['commit', '-m', msg]);
}

describe('HostingService (GitHub)', () => {
  it('host próprio não reconhecido pede o provedor; token inválido é recusado sem vazar o token', async () => {
    const store = new MemStore();
    const svc = new HostingService(store);
    const d = await repo('dono/repo');
    const info = await svc.hostingInfo(d);
    expect(info).toMatchObject({ supported: false, needsKind: true, hasToken: false, host, projectPath: 'dono/repo', currentBranch: 'main', defaultBranch: 'main' });
    await expect(svc.saveToken(d, 'tok-errado', 'github')).rejects.toThrow('Token inválido');
    await expect(svc.saveToken(d, 'tok-errado', 'github')).rejects.not.toThrow(/tok-errado/);
    expect(store.tokens.size).toBe(0);
    await expect(svc.saveToken(d, 'tok-gh')).rejects.toThrow('GitHub ou GitLab'); // sem o provedor
    await expect(svc.listChangeRequests(d, 'open')).rejects.toThrow('GitHub ou GitLab');
  });

  it('guarda o token validado, lista PRs, filtra mergeados e consulta o CI', async () => {
    const store = new MemStore();
    const svc = new HostingService(store);
    const d = await repo('dono/repo');
    expect(await svc.saveToken(d, 'tok-gh', 'github')).toEqual({ login: 'ana' });
    expect(store.kinds.get(host)).toBe('github');
    expect(await svc.hostingInfo(d)).toMatchObject({ supported: true, kind: 'github', hasToken: true, needsKind: false });

    const open = await svc.listChangeRequests(d, 'open');
    expect(open.map((p) => [p.number, p.state, p.sourceBranch])).toEqual([[5, 'open', 'feat/tela']]);
    const merged = await svc.listChangeRequests(d, 'merged');
    expect(merged.map((p) => p.number)).toEqual([4]);

    const ci = await svc.getCiStatus(d, SHA);
    expect(ci.state).toBe('failure');
    expect(ci.checks[0]).toMatchObject({ name: 'build', url: 'http://run/1' });
    await expect(svc.getCiStatus(d, 'não-é-hash')).rejects.toThrow('inválido');
    expect(calls.some((c) => c.url.includes('/api/v3/user') && c.auth === 'Bearer tok-gh')).toBe(true);
  });

  it('descrição do PR montada dos Conventional Commits, com tickets e título sugerido', async () => {
    const svc = new HostingService(new MemStore());
    const d = await repo('dono/repo');
    await runGit(d, ['checkout', '-b', 'feature/PROJ-12-login-social']);
    await commit(d, 'f1.txt', 'feat(auth): botão do Google\n\nRefs: PROJ-12');
    await commit(d, 'f2.txt', 'fix: corrige o redirecionamento');
    const s = await svc.suggestChangeRequest(d, 'main');
    expect(s).toMatchObject({ head: 'feature/PROJ-12-login-social', base: 'main', headPublished: false });
    expect(s.commits.map((c) => c.subject)).toEqual(['feat(auth): botão do Google', 'fix: corrige o redirecionamento']);
    expect(s.title).toBe('feat: login social (PROJ-12)');
    expect(s.body).toContain('## Resumo');
    expect(s.body).toContain('2 commit(s)');
    expect(s.body).toContain('## ✨ Novidades');
    expect(s.body).toContain('**auth:** botão do Google');
    expect(s.body).toContain('## 🐛 Correções');
    expect(s.body).toContain('Refs: PROJ-12');
    await expect(svc.suggestChangeRequest(d, 'x; rm')).rejects.toThrow('inválido');
  });

  it('cria o PR (e envia a branch antes, quando pedido) e valida a entrada', async () => {
    const store = new MemStore();
    const svc = new HostingService(store);
    const d = await repo('dono/repo');
    await svc.saveToken(d, 'tok-gh', 'github');
    await runGit(d, ['checkout', '-b', 'feat/tela']);
    await commit(d, 'f.txt', 'feat: tela');

    await expect(svc.createChangeRequest(d, { title: ' ', body: '', base: 'main', head: 'feat/tela' })).rejects.toThrow('título');
    await expect(svc.createChangeRequest(d, { title: 't', body: '', base: 'main', head: 'main' })).rejects.toThrow('a mesma');
    await expect(svc.createChangeRequest(d, { title: 't', body: '', base: 'main', head: 'a b' })).rejects.toThrow('inválido');

    // push para um repositório "bare" local, enquanto a API continua sendo a do servidor simulado
    const bare = mkdtempSync(join(tmpdir(), 'gitnexus-host-bare-'));
    dirs.push(bare);
    await runGit(bare, ['init', '--bare', '-b', 'main']);
    await runGit(d, ['remote', 'set-url', '--push', 'origin', bare]);
    const r = await svc.createChangeRequest(d, { title: 'feat: tela', body: '## Resumo', base: 'main', head: 'feat/tela', draft: true, push: true });
    expect(r).toEqual({ url: `http://${host}/dono/repo/pull/9`, number: 9, pushed: true });
    expect((await runGit(bare, ['branch', '--list', 'feat/tela'])).stdout).toContain('feat/tela');
    const post = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls')).pop()!;
    expect(post.body).toEqual({ title: 'feat: tela', body: '## Resumo', head: 'feat/tela', base: 'main', draft: true });
  });

  it('só permite abrir páginas do mesmo host do remoto', async () => {
    const svc = new HostingService(new MemStore());
    const d = await repo('dono/repo');
    expect(await svc.isAllowedUrl(d, `http://${host}/dono/repo/pull/5`)).toBe(true);
    expect(await svc.isAllowedUrl(d, 'https://github.com/dono/repo/pull/5')).toBe(false);
    expect(await svc.isAllowedUrl(d, `http://${host}.evil.com/x`)).toBe(false);
    expect(await svc.isAllowedUrl(d, 'file:///c:/x')).toBe(false);
    expect(await svc.isAllowedUrl(d, 'javascript:alert(1)')).toBe(false);
  });

  it('remover o token e a falta de conexão viram mensagens claras', async () => {
    const store = new MemStore();
    const svc = new HostingService(store);
    const d = await repo('dono/repo');
    await svc.saveToken(d, 'tok-gh', 'github');
    await svc.removeToken(d);
    expect((await svc.hostingInfo(d)).hasToken).toBe(false);
    await expect(svc.listChangeRequests(d, 'open')).rejects.toThrow('Conecte uma conta');
    const offline = new HostingService(store, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    store.tokens.set(host, 'tok-gh');
    store.kinds.set(host, 'github');
    await expect(offline.listChangeRequests(d, 'open')).rejects.toThrow('Sem conexão');
  });
});

describe('HostingService (GitLab)', () => {
  it('lista MRs, consulta o pipeline e cria MR como rascunho', async () => {
    const store = new MemStore();
    const svc = new HostingService(store);
    const d = await repo('grupo/sub/proj');
    expect(await svc.saveToken(d, 'tok-gl', 'gitlab')).toEqual({ login: 'carla' });

    const mrs = await svc.listChangeRequests(d, 'open');
    expect(mrs).toHaveLength(1);
    expect(mrs[0]).toMatchObject({ number: 3, draft: true, author: 'carla', sourceBranch: 'feat/x' });
    expect((await svc.getCiStatus(d, SHA)).state).toBe('success');

    await runGit(d, ['checkout', '-b', 'feat/x']);
    await commit(d, 'f.txt', 'feat: x');
    const r = await svc.createChangeRequest(d, { title: 'feat: x', body: 'desc', base: 'main', head: 'feat/x', draft: true });
    expect(r).toMatchObject({ number: 8, pushed: false });
    const post = calls.filter((c) => c.method === 'POST' && c.url.includes('merge_requests')).pop()!;
    expect(post.body).toEqual({ source_branch: 'feat/x', target_branch: 'main', title: 'Draft: feat: x', description: 'desc' });
    expect(post.auth).toBe('tok-gl'); // GitLab usa o cabeçalho PRIVATE-TOKEN
  });
});
