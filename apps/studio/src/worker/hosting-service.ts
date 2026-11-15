// Serviço de integração com GitHub / GitLab. Roda no processo principal (onde o token fica guardado, criptografado)
// e é testável: o armazenamento de tokens e o `fetch` são injetados.
import {
  runGit,
  tm,
  type ChangeRequest,
  type ChangeRequestState,
  type ChangeRequestSuggestion,
  type CiStatus,
  type CreateChangeRequestInput,
  type CreatedChangeRequest,
  type HostingInfo,
  type ProviderKind,
} from '@git-nexus/git-core';
import { groupCommits, parseCommit } from '../../../../scripts/lib/release-core.mjs';
import {
  apiBase,
  authHeaders,
  ciFromGithub,
  ciFromGitlab,
  detectKind,
  listQuery,
  mapGithubPull,
  mapGitlabMr,
  parseRemote,
  suggestTitle,
  ticketsOf,
  webUrl,
  type ParsedRemote,
  type SuggestCommit,
} from '../shared/hosting';

/** Onde ficam os tokens (por host) e a escolha de provedor dos hosts não reconhecidos. */
export interface TokenStore {
  getToken(host: string): Promise<string | undefined>;
  setToken(host: string, token: string): Promise<void>;
  removeToken(host: string): Promise<void>;
  getKind(host: string): Promise<ProviderKind | undefined>;
  setKind(host: string, kind: ProviderKind): Promise<void>;
  /** O armazenamento é criptografado pelo sistema (senão o token só vive na memória). */
  secure(): boolean;
}

interface Ctx {
  remoteName: string;
  remote: ParsedRemote;
  kind: ProviderKind | null;
}

const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes' };
const BRANCH = /^[\w][\w./-]*$/;
const HEX = /^[0-9a-f]{7,40}$/i;

export class HostingService {
  constructor(
    private readonly store: TokenStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  // ---- descoberta do remoto -------------------------------------------------------------------
  private async ctx(repoPath: string): Promise<Ctx> {
    const names = (await runGit(repoPath, ['remote'], { check: false })).stdout.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!names.length) throw new Error(tm('Este repositório não tem remoto configurado.', 'This repository has no remote configured.'));
    const remoteName = names.includes('origin') ? 'origin' : names[0]!;
    const url = (await runGit(repoPath, ['remote', 'get-url', remoteName])).stdout.trim();
    const remote = parseRemote(url);
    if (!remote) throw new Error(tm(`Não foi possível entender o endereço do remoto "${remoteName}".`, `Could not understand the address of the remote "${remoteName}".`));
    const kind = detectKind(remote.host, await this.store.getKind(remote.host));
    return { remoteName, remote, kind };
  }

  async hostingInfo(repoPath: string): Promise<HostingInfo> {
    const base: HostingInfo = { supported: false, needsKind: false, hasToken: false, secureStorage: this.store.secure(), currentBranch: '', defaultBranch: 'main', branches: [] };
    let c: Ctx;
    try {
      c = await this.ctx(repoPath);
    } catch (e) {
      return { ...base, reason: (e as Error).message };
    }
    const git = async (...a: string[]) => (await runGit(repoPath, a, { check: false })).stdout.trim();
    const currentBranch = await git('branch', '--show-current');
    const remoteBranches = (await git('branch', '-r', '--format=%(refname:short)')).split('\n').map((x) => x.trim()).filter((x) => x.startsWith(`${c.remoteName}/`) && !x.endsWith('/HEAD')).map((x) => x.slice(c.remoteName.length + 1));
    const headRef = await git('symbolic-ref', '--short', `refs/remotes/${c.remoteName}/HEAD`);
    const defaultBranch = headRef ? headRef.slice(c.remoteName.length + 1) : remoteBranches.includes('main') ? 'main' : remoteBranches.includes('master') ? 'master' : (remoteBranches[0] ?? 'main');
    const hasToken = !!(await this.store.getToken(c.remote.host));
    return {
      ...base,
      supported: c.kind !== null,
      reason: c.kind ? undefined : tm(`O host ${c.remote.host} não é reconhecido: informe se é GitHub ou GitLab.`, `The host ${c.remote.host} is not recognized: say whether it is GitHub or GitLab.`),
      needsKind: c.kind === null,
      kind: c.kind ?? undefined,
      host: c.remote.host,
      projectPath: c.remote.projectPath,
      webUrl: webUrl(c.remote),
      hasToken,
      remote: c.remoteName,
      currentBranch,
      defaultBranch,
      branches: remoteBranches,
    };
  }

  // ---- token ----------------------------------------------------------------------------------
  /** Valida o token no provedor (GET /user) e só então o guarda. O token nunca é devolvido nem aparece em mensagens. */
  async saveToken(repoPath: string, token: string, kindArg?: ProviderKind): Promise<{ login: string }> {
    const t = token.trim();
    if (!t || /\s/.test(t)) throw new Error(tm('Informe o token (sem espaços).', 'Provide the token (no spaces).'));
    const c = await this.ctx(repoPath);
    const kind = kindArg ?? c.kind;
    if (!kind) throw new Error(tm('Informe se este host é GitHub ou GitLab.', 'Say whether this host is GitHub or GitLab.'));
    const user = (await this.call(kind, c.remote, t, 'GET', '/user')) as { login?: string; username?: string };
    if (kindArg) await this.store.setKind(c.remote.host, kindArg);
    await this.store.setToken(c.remote.host, t);
    return { login: user.login ?? user.username ?? '?' };
  }

  async removeToken(repoPath: string): Promise<void> {
    await this.store.removeToken((await this.ctx(repoPath)).remote.host);
  }

  /** Só deixa abrir páginas do mesmo host do remoto (PR, MR, pipeline). */
  async isAllowedUrl(repoPath: string, url: string): Promise<boolean> {
    try {
      const c = await this.ctx(repoPath);
      const u = new URL(url);
      const sameHost = u.host.toLowerCase() === c.remote.host && (u.protocol === 'https:' || (u.protocol === 'http:' && c.remote.scheme === 'http'));
      return sameHost;
    } catch {
      return false;
    }
  }

  // ---- chamadas à API --------------------------------------------------------------------------
  private async call(kind: ProviderKind, remote: ParsedRemote, token: string, method: string, path: string, body?: unknown): Promise<unknown> {
    const url = apiBase(kind, remote.host, remote.scheme) + path;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { ...authHeaders(kind, token), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error(tm(`Sem conexão com ${remote.host}.`, `No connection to ${remote.host}.`));
    }
    if (res.ok) return res.status === 204 ? null : res.json();
    let detail = '';
    try {
      const j = (await res.json()) as { message?: string | string[]; error?: string; errors?: Array<{ message?: string }> };
      detail = [typeof j.message === 'string' ? j.message : Array.isArray(j.message) ? j.message.join('; ') : '', j.error ?? '', ...(j.errors ?? []).map((e) => e.message ?? '')].filter(Boolean).join(' · ');
    } catch {
      /* corpo sem JSON */
    }
    if (res.status === 401) throw new Error(tm('Token inválido ou expirado.', 'Invalid or expired token.'));
    if (res.status === 403) throw new Error(tm(`Sem permissão (${detail || '403'}). Confira os escopos do token.`, `No permission (${detail || '403'}). Check the token scopes.`));
    if (res.status === 404) throw new Error(tm('Repositório não encontrado ou sem acesso: confira o token e as permissões.', 'Repository not found or no access: check the token and permissions.'));
    throw new Error(`${remote.host} respondeu ${res.status}${detail ? `: ${detail}` : ''}.`);
  }

  private async authed(repoPath: string): Promise<{ c: Ctx & { kind: ProviderKind }; token: string }> {
    const c = await this.ctx(repoPath);
    if (!c.kind) throw new Error(tm('Informe se este host é GitHub ou GitLab.', 'Say whether this host is GitHub or GitLab.'));
    const token = await this.store.getToken(c.remote.host);
    if (!token) throw new Error(tm('Conecte uma conta (token) para ver pull requests e o CI.', 'Connect an account (token) to see pull requests and CI.'));
    return { c: { ...c, kind: c.kind }, token };
  }

  private project(c: Ctx & { kind: ProviderKind }): string {
    return c.kind === 'github' ? `/repos/${c.remote.projectPath}` : `/projects/${encodeURIComponent(c.remote.projectPath)}`;
  }

  async listChangeRequests(repoPath: string, state: ChangeRequestState): Promise<ChangeRequest[]> {
    const { c, token } = await this.authed(repoPath);
    const path = c.kind === 'github' ? `${this.project(c)}/pulls?${listQuery('github', state)}` : `${this.project(c)}/merge_requests?${listQuery('gitlab', state)}`;
    const raw = (await this.call(c.kind, c.remote, token, 'GET', path)) as unknown[];
    const list = c.kind === 'github' ? (raw as Parameters<typeof mapGithubPull>[0][]).map(mapGithubPull) : (raw as Parameters<typeof mapGitlabMr>[0][]).map(mapGitlabMr);
    return list.filter((x) => x.state === state); // GitHub devolve mergeados junto com fechados; garante só o estado pedido
  }

  async getCiStatus(repoPath: string, sha: string): Promise<CiStatus> {
    if (!HEX.test(sha)) throw new Error(tm('Commit inválido.', 'Invalid commit.'));
    const { c, token } = await this.authed(repoPath);
    if (c.kind === 'github') {
      const runs = (await this.call('github', c.remote, token, 'GET', `${this.project(c)}/commits/${sha}/check-runs?per_page=100`).catch(() => ({ check_runs: [] }))) as { check_runs?: Parameters<typeof ciFromGithub>[0] };
      const st = (await this.call('github', c.remote, token, 'GET', `${this.project(c)}/commits/${sha}/status`).catch(() => ({ statuses: [] }))) as { statuses?: Parameters<typeof ciFromGithub>[1] };
      return ciFromGithub(runs.check_runs ?? [], st.statuses ?? []);
    }
    const pipes = (await this.call('gitlab', c.remote, token, 'GET', `${this.project(c)}/pipelines?sha=${sha}&per_page=1`)) as Parameters<typeof ciFromGitlab>[0];
    return ciFromGitlab(pipes);
  }

  // ---- criar PR/MR ------------------------------------------------------------------------------
  /** Título e descrição montados dos Conventional Commits que a branch tem a mais que a base. */
  async suggestChangeRequest(repoPath: string, baseBranch: string): Promise<ChangeRequestSuggestion> {
    if (!BRANCH.test(baseBranch)) throw new Error(tm('Nome de branch inválido.', 'Invalid branch name.'));
    const c = await this.ctx(repoPath);
    const head = (await runGit(repoPath, ['branch', '--show-current'])).stdout.trim();
    if (!head) throw new Error(tm('HEAD desanexado: troque para uma branch.', 'Detached HEAD: switch to a branch.'));
    const hasRemoteBase = (await runGit(repoPath, ['rev-parse', '--verify', '-q', `refs/remotes/${c.remoteName}/${baseBranch}`], { check: false })).code === 0;
    const range = `${hasRemoteBase ? `${c.remoteName}/${baseBranch}` : baseBranch}..HEAD`;
    const log = await runGit(repoPath, ['log', '--no-merges', '--format=%H%x1f%an%x1f%s%x1f%b%x1e', range], { check: false });
    const parsed = log.stdout
      .split('\x1e')
      .map((x) => x.replace(/^\n+/, ''))
      .filter(Boolean)
      .map((rec) => {
        const [hash = '', author = '', subject = '', body = ''] = rec.split('\x1f');
        return { ...parseCommit({ hash, author, subject, body }), subject };
      })
      .reverse(); // mais antigo primeiro
    const commits: SuggestCommit[] = parsed;
    const tickets = ticketsOf(commits);
    // linhas enxutas (sem hash nem autor: o PR já mostra os commits)
    const sections = groupCommits(parsed.slice().reverse())
      .map((g) => [`## ${g.title}`, '', ...g.items.map((c) => `- ${c.scope ? `**${c.scope}:** ` : ''}${c.title}${c.pr ? ` (#${c.pr})` : ''}${c.ticket ? ` · \`${c.ticket}\`` : ''}`)].join('\n'))
      .join('\n\n');
    const body = [tm('## Resumo', '## Summary'), '', parsed.length ? tm(`Esta branch (\`${head}\`) reúne ${parsed.length} commit(s) sobre \`${baseBranch}\`.`, `This branch (\`${head}\`) gathers ${parsed.length} commit(s) over \`${baseBranch}\`.`) : tm('Sem commits novos em relação à base.', 'No new commits compared to the base.'), '', sections, ...(tickets.length ? ['', `Refs: ${tickets.join(', ')}`] : [])].join('\n').trim() + '\n';
    const headPublished = (await runGit(repoPath, ['rev-parse', '--verify', '-q', `refs/remotes/${c.remoteName}/${head}`], { check: false })).code === 0;
    return {
      title: suggestTitle(commits, head),
      body,
      head,
      base: baseBranch,
      commits: parsed.map((p) => ({ short: p.short, subject: p.subject })),
      headPublished,
    };
  }

  async createChangeRequest(repoPath: string, input: CreateChangeRequestInput): Promise<CreatedChangeRequest> {
    const title = input.title.trim();
    if (!title) throw new Error(tm('Informe o título.', 'Provide the title.'));
    if (!BRANCH.test(input.head) || !BRANCH.test(input.base)) throw new Error(tm('Nome de branch inválido.', 'Invalid branch name.'));
    if (input.head === input.base) throw new Error(tm('A branch de origem e a de destino são a mesma.', 'The source and target branches are the same.'));
    const { c, token } = await this.authed(repoPath);
    let pushed = false;
    if (input.push) {
      const r = await runGit(repoPath, ['push', '-u', c.remoteName, input.head], { check: false, env: NO_PROMPT });
      if (r.code !== 0) throw new Error(tm('Não foi possível enviar a branch: ', 'Could not push the branch: ') + (r.stderr || r.stdout).trim().split('\n').slice(-2).join(' '));
      pushed = true;
    }
    if (c.kind === 'github') {
      const r = (await this.call('github', c.remote, token, 'POST', `${this.project(c)}/pulls`, { title, body: input.body, head: input.head, base: input.base, draft: !!input.draft })) as { html_url: string; number: number };
      return { url: r.html_url, number: r.number, pushed };
    }
    const r = (await this.call('gitlab', c.remote, token, 'POST', `${this.project(c)}/merge_requests`, {
      source_branch: input.head,
      target_branch: input.base,
      title: input.draft && !/^draft:/i.test(title) ? `Draft: ${title}` : title,
      description: input.body,
    })) as { web_url: string; iid: number };
    return { url: r.web_url, number: r.iid, pushed };
  }
}
