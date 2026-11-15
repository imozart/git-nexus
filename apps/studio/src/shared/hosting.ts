// Lógica PURA da integração com GitHub / GitLab (inclusive instâncias próprias): reconhecer o remoto,
// montar endereços da API e converter as respostas. Sem rede e sem Electron: testável em Node.
import type { ChangeRequest, ChangeRequestState, CiCheck, CiState, CiStatus, ProviderKind } from '@git-nexus/git-core/pure';

export interface ParsedRemote {
  scheme: 'https' | 'http' | 'ssh';
  /** Host usado para guardar o token e escolher o provedor (inclui a porta só em http/https com porta explícita). */
  host: string;
  /** `dono/repo` (GitHub) ou `grupo/subgrupo/projeto` (GitLab). */
  projectPath: string;
}

/**
 * Entende as formas de endereço de remoto do git:
 *   https://github.com/dono/repo.git · git@github.com:dono/repo.git · ssh://git@gitlab.empresa.com:2222/grupo/sub/projeto.git
 * Credenciais embutidas na URL são descartadas (nunca são guardadas nem exibidas).
 */
export function parseRemote(raw: string): ParsedRemote | null {
  const url = raw.trim();
  const clean = (p: string) => p.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  const done = (scheme: ParsedRemote['scheme'], host: string, path: string): ParsedRemote | null => {
    const projectPath = clean(path);
    return host && projectPath.split('/').filter(Boolean).length >= 2 ? { scheme, host: host.toLowerCase(), projectPath } : null;
  };
  // forma "scp": usuario@host:caminho (sem "://")
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(url);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^[a-z]:[\\/]/i.test(url)) return done('ssh', scp[1]!, scp[2]!);
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') return done(u.protocol === 'http:' ? 'http' : 'https', u.port ? `${u.hostname}:${u.port}` : u.hostname, u.pathname);
    if (u.protocol === 'ssh:' || u.protocol === 'git+ssh:') return done('ssh', u.hostname, u.pathname);
  } catch {
    /* não é URL */
  }
  return null;
}

/** Provedor pelo nome do host; `override` vem da escolha do usuário para instâncias próprias. `null` = não reconhecido. */
export function detectKind(host: string, override?: ProviderKind): ProviderKind | null {
  if (override) return override;
  const h = host.toLowerCase().split(':')[0]!;
  if (h === 'github.com') return 'github';
  if (/(^|[.-])gitlab([.-]|$)/.test(h)) return 'gitlab';
  return null;
}

/** Endereço base da API. Instâncias próprias usam o mesmo esquema do remoto (http só se o remoto for http). */
export function apiBase(kind: ProviderKind, host: string, scheme: ParsedRemote['scheme']): string {
  const web = scheme === 'http' ? 'http' : 'https';
  if (kind === 'github') return host === 'github.com' ? 'https://api.github.com' : `${web}://${host}/api/v3`;
  return `${web}://${host}/api/v4`;
}

export function webUrl(r: ParsedRemote): string {
  return `${r.scheme === 'http' ? 'http' : 'https'}://${r.host}/${r.projectPath}`;
}

export function authHeaders(kind: ProviderKind, token: string): Record<string, string> {
  return kind === 'github'
    ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'GitNexus' }
    : { 'PRIVATE-TOKEN': token, Accept: 'application/json', 'User-Agent': 'GitNexus' };
}

// ---------------------------------------------------------------------------- PRs / MRs
interface GhPull {
  number: number;
  title: string;
  user?: { login?: string } | null;
  state: string;
  merged_at?: string | null;
  draft?: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
  html_url: string;
  created_at: string;
  updated_at: string;
}
interface GlMr {
  iid: number;
  title: string;
  author?: { username?: string } | null;
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
  source_branch: string;
  target_branch: string;
  sha?: string;
  web_url: string;
  created_at: string;
  updated_at: string;
}

export function mapGithubPull(p: GhPull): ChangeRequest {
  const state: ChangeRequestState = p.merged_at ? 'merged' : p.state === 'open' ? 'open' : 'closed';
  return { number: p.number, title: p.title, author: p.user?.login ?? '?', state, draft: !!p.draft, sourceBranch: p.head.ref, targetBranch: p.base.ref, sha: p.head.sha, url: p.html_url, createdAt: p.created_at, updatedAt: p.updated_at };
}

export function mapGitlabMr(m: GlMr): ChangeRequest {
  const state: ChangeRequestState = m.state === 'merged' ? 'merged' : m.state === 'opened' ? 'open' : 'closed';
  return { number: m.iid, title: m.title, author: m.author?.username ?? '?', state, draft: !!(m.draft ?? m.work_in_progress), sourceBranch: m.source_branch, targetBranch: m.target_branch, sha: m.sha ?? '', url: m.web_url, createdAt: m.created_at, updatedAt: m.updated_at };
}

/** Parâmetro de estado da listagem (GitHub não tem "merged": vem em `closed` e é filtrado depois). */
export function listQuery(kind: ProviderKind, state: ChangeRequestState): string {
  if (kind === 'github') return `state=${state === 'open' ? 'open' : 'closed'}&sort=updated&direction=desc&per_page=50`;
  return `state=${state === 'open' ? 'opened' : state}&order_by=updated_at&sort=desc&per_page=50`;
}

// ---------------------------------------------------------------------------- CI
interface GhCheckRun { name: string; status: string; conclusion: string | null; html_url?: string }
interface GhStatus { context: string; state: string; target_url?: string | null }

function ghRunState(r: GhCheckRun): CiState {
  if (r.status !== 'completed') return 'pending';
  if (['success', 'neutral', 'skipped'].includes(r.conclusion ?? '')) return 'success';
  return 'failure'; // failure, timed_out, cancelled, action_required, stale…
}
const ghStatusState = (s: string): CiState => (s === 'success' ? 'success' : s === 'pending' ? 'pending' : 'failure');

/** Resume os resultados: qualquer falha → failure; senão qualquer pendente → pending; senão success; sem nada → none. */
export function summarize(checks: CiCheck[]): CiState {
  if (!checks.length) return 'none';
  if (checks.some((c) => c.state === 'failure')) return 'failure';
  if (checks.some((c) => c.state === 'pending')) return 'pending';
  return 'success';
}

export function ciFromGithub(runs: GhCheckRun[], statuses: GhStatus[]): CiStatus {
  const checks: CiCheck[] = [
    ...runs.map((r) => ({ name: r.name, state: ghRunState(r), url: r.html_url })),
    ...statuses.map((s) => ({ name: s.context, state: ghStatusState(s.state), url: s.target_url ?? undefined })),
  ];
  return { state: summarize(checks), checks };
}

export function ciFromGitlab(pipelines: Array<{ id: number; status: string; web_url?: string }>): CiStatus {
  const p = pipelines[0];
  if (!p) return { state: 'none', checks: [] };
  const s = p.status;
  const state: CiState = s === 'success' ? 'success' : ['failed'].includes(s) ? 'failure' : ['canceled', 'cancelled', 'skipped'].includes(s) ? 'none' : 'pending';
  return { state, checks: [{ name: `Pipeline #${p.id} (${s})`, state, url: p.web_url }] };
}

// ---------------------------------------------------------------------------- título e descrição do PR/MR
export interface SuggestCommit {
  type: string;
  scope: string;
  title: string;
  breaking: boolean;
  ticket: string | null;
  subject: string;
}

const TYPE_PRIORITY = ['feat', 'fix', 'perf', 'refactor', 'docs', 'build', 'ci', 'test', 'style', 'chore'];

/** Título sugerido: o assunto do commit (se for um só) ou "tipo: nome da branch em palavras". */
export function suggestTitle(commits: SuggestCommit[], branch: string): string {
  if (commits.length === 1) return commits[0]!.subject;
  const type = commits.some((c) => c.breaking)
    ? 'feat'
    : TYPE_PRIORITY.find((t) => commits.some((c) => c.type === t)) ?? 'chore';
  const words = branch
    .replace(/^(?:feat|feature|fix|bugfix|hotfix|docs|refactor|perf|test|build|ci|chore)\//i, '')
    .replace(/[A-Za-z]+-\d+[-_]?/g, '')
    .replace(/[-_/]+/g, ' ')
    .trim();
  const ticket = commits.map((c) => c.ticket).find(Boolean);
  const head = words || (commits[0]?.title ?? 'alterações');
  return `${type}: ${head}${ticket ? ` (${ticket})` : ''}`.slice(0, 120);
}

export function ticketsOf(commits: SuggestCommit[]): string[] {
  return [...new Set(commits.map((c) => c.ticket).filter((t): t is string => !!t))];
}
