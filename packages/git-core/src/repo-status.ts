import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { remoteErrorText } from './askpass-pure.js';
import { remoteEnv } from './askpass.js';
import { emitGitProgress, progressReader } from './progress.js';
import { runGit } from './runner.js';
import type { RepoSummary, SyncResult } from './types/ipc.js';
import { tm } from './messages.js';

/** Parse de `git status --porcelain=v2 --branch -z`. */
export function parseSummary(raw: string): RepoSummary {
  const s: RepoSummary = {
    branch: '',
    detached: false,
    upstream: null,
    gone: false,
    lastFetch: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    lastCommit: null,
    stash: 0,
  };
  const parts = raw.split('\0').filter(Boolean);
  let sawAb = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.startsWith('# branch.head ')) {
      const h = p.slice('# branch.head '.length);
      s.detached = h === '(detached)';
      s.branch = s.detached ? 'HEAD (desanexado)' : h;
    } else if (p.startsWith('# branch.upstream ')) s.upstream = p.slice('# branch.upstream '.length);
    else if (p.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(p);
      if (m) {
        sawAb = true;
        s.ahead = Number(m[1]);
        s.behind = Number(m[2]);
      }
    } else if (p.startsWith('1 ') || p.startsWith('2 ')) {
      const xy = p.slice(2, 4);
      if (xy[0] !== '.') s.staged++;
      if (xy[1] !== '.') s.unstaged++;
      if (p.startsWith('2 ')) i++; // renomeação: o próximo item é o caminho de origem
    } else if (p.startsWith('u ')) s.conflicted++;
    else if (p.startsWith('? ')) s.untracked++;
  }
  // Com upstream configurado, o git omite "branch.ab" quando a branch remota não existe mais (foi apagada).
  s.gone = s.upstream !== null && !sawAb;
  return s;
}

/**
 * Onde ficam o `FETCH_HEAD` e o registro do stash. Repositório comum (`.git` é uma pasta): os caminhos são conhecidos, sem rodar o git (a tela inicial
 * resume centenas de repositórios, e cada processo do git custa caro no Windows). Worktree e submódulo (`.git` é um arquivo): pergunta ao git, que sabe
 * onde ficam. `null` se não der para saber.
 */
type GitFiles = { fetchHead: string; stashLog: string };
async function gitFiles(repoPath: string): Promise<GitFiles | null> {
  try {
    const dotGit = join(repoPath, '.git');
    if ((await stat(dotGit)).isDirectory()) return { fetchHead: join(dotGit, 'FETCH_HEAD'), stashLog: join(dotGit, 'logs', 'refs', 'stash') };
  } catch {
    /* sem .git aqui (pasta dentro do repositório, repositório nu, WSL): pergunta ao git */
  }
  try {
    const r = await runGit(repoPath, ['rev-parse', '--git-path', 'FETCH_HEAD', '--git-path', 'logs/refs/stash'], { check: false });
    const [fetchHead, stashLog] = r.stdout.split('\n').map((l) => l.trim());
    if (r.code !== 0 || !fetchHead || !stashLog) return null;
    const abs = (p: string) => (isAbsolute(p) ? p : join(repoPath, p));
    return { fetchHead: abs(fetchHead), stashLog: abs(stashLog) };
  } catch {
    return null;
  }
}

/**
 * Quando o repositório falou com o remoto pela última vez (ms desde 1970): a data de `FETCH_HEAD`, que todo fetch e todo pull reescrevem,
 * inclusive os feitos fora do app. `null` se nunca buscou ou se não der para ler (por exemplo, repositório dentro do WSL).
 */
export async function getLastFetch(repoPath: string): Promise<number | null> {
  return fetchTime(await gitFiles(repoPath));
}

async function fetchTime(f: GitFiles | null): Promise<number | null> {
  try {
    return f ? (await stat(f.fetchHead)).mtimeMs : null;
  } catch {
    return null;
  }
}

/** Parse de `git log -1 --format=%ct%x00%an%x00%s`: o último commit do HEAD, ou null (repositório sem commits, saída vazia ou torta). */
export function parseLastCommit(raw: string): RepoSummary['lastCommit'] {
  const [ct, author, ...subject] = raw.replace(/\r?\n$/, '').split('\0');
  const secs = Number(ct);
  if (!ct || !Number.isFinite(secs) || author === undefined) return null;
  return { subject: subject.join('\0'), author, date: secs * 1000 };
}

/** O commit do HEAD (null se não há commits). Um processo curto: lê só o último commit, qualquer que seja o tamanho do histórico. */
async function getLastCommit(repoPath: string): Promise<RepoSummary['lastCommit']> {
  const r = await runGit(repoPath, ['log', '-1', '--format=%ct%x00%an%x00%s'], { check: false });
  return r.code === 0 ? parseLastCommit(r.stdout) : null;
}

/** Quantos stashes há: o git guarda um registro por stash em `logs/refs/stash` (uma linha cada); sem o arquivo, não há stash. */
async function stashCount(f: GitFiles | null): Promise<number> {
  try {
    return f ? (await readFile(f.stashLog, 'utf8')).split('\n').filter((l) => l.trim()).length : 0;
  } catch {
    return 0;
  }
}

export async function getRepoSummary(repoPath: string): Promise<RepoSummary> {
  const files = gitFiles(repoPath);
  const [r, lastFetch, lastCommit, stash] = await Promise.all([
    runGit(repoPath, ['status', '--porcelain=v2', '--branch', '-z']),
    files.then(fetchTime),
    getLastCommit(repoPath),
    files.then(stashCount),
  ]);
  return { ...parseSummary(r.stdout), lastFetch, lastCommit, stash };
}

export { NO_PROMPT } from './no-prompt.js';

/** `git fetch --all --prune`. `silent` (busca em segundo plano ou em lote): nunca pede credenciais, falha logo. */
export async function fetchRepo(repoPath: string, silent = false): Promise<SyncResult> {
  const onStderr = progressReader((p) => emitGitProgress({ repoPath, op: 'fetch', phase: p.phase, percent: p.percent }));
  const r = await runGit(repoPath, ['fetch', '--all', '--prune', '--progress'], { check: false, env: remoteEnv(silent), onStderr });
  if (r.code !== 0) return { ok: false, message: remoteErrorText(r.stderr, tm('Falha ao buscar do remoto.', 'Failed to fetch from the remote.')) };
  return { ok: true, message: 'Buscado.' };
}

const firstLine = (s: string) => s.trim().split('\n').find((l) => l.trim()) ?? '';
