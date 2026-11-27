import type { CommitInfo } from './types/ipc.js';
import { runGit } from './runner.js';
import { buildLogArgs, type HistoryFilter } from './history-filter.js';

const FS = '\x1f';
const RS = '\x1e';

/** O formato do `git log` que `parseLog` lê (hash, pais, autor, e-mail, data, referências, assunto). Quem chama `parseLog` usa ESTE formato, para os campos não se deslocarem. */
export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%D', '%s'].join('%x1f') + '%x1e';

export function parseLog(raw: string): CommitInfo[] {
  return raw
    .split(RS)
    .map((r) => r.replace(/^\n+/, ''))
    .filter((r) => r.length > 0)
    .map((rec) => {
      const [hash = '', parents = '', author = '', authorEmail = '', at = '0', refs = '', subject = ''] = rec.split(FS);
      return {
        hash,
        shortHash: hash.slice(0, 7),
        parents: parents ? parents.split(' ') : [],
        refs: refs ? refs.split(', ').filter(Boolean) : [],
        author,
        authorEmail,
        date: Number(at),
        subject,
      };
    });
}

/** Os commits que nenhum remoto alcança (ainda não publicados), ou `null` se o repositório não tem remotos (não há com o que comparar). */
async function localOnlyCommits(repoPath: string): Promise<Set<string> | null> {
  const remotes = await runGit(repoPath, ['for-each-ref', '--count=1', '--format=%(refname)', 'refs/remotes'], { check: false });
  if (remotes.code !== 0 || !remotes.stdout.trim()) return null;
  const r = await runGit(repoPath, ['rev-list', '--all', '--not', '--remotes', '-n20000'], { check: false });
  return r.code === 0 ? new Set(r.stdout.split('\n').filter(Boolean)) : null;
}

/** Sem filtro (quem chama sem escolher), a história de sempre: todas as referências. A lista do Grafo passa o filtro dela (por padrão, só o branch atual). */
const ALL: HistoryFilter = { scope: 'all' };

/** Uma página do histórico (`--topo-order`: filhos antes dos pais, como o desenho de lanes precisa). `skip` pula os já carregados (a lista pede mais ao rolar). `filter` é traduzido para o `git log` (veja `history-filter.ts`). */
export async function getHistory(repoPath: string, limit = 300, skip = 0, filter?: HistoryFilter): Promise<CommitInfo[]> {
  const built = buildLogArgs(filter ?? ALL);
  if ('error' in built) throw new Error(`Filtro inválido: ${built.error.code}${'value' in built.error ? ` (${built.error.value})` : ''}`);
  const args = ['log', ...built.args, `-n${Math.max(1, Math.floor(limit))}`, ...(skip > 0 ? [`--skip=${Math.floor(skip)}`] : []), `--format=${LOG_FORMAT}`, '--', ...built.pathspec];
  const [r, local] = await Promise.all([runGit(repoPath, args, { check: false }), localOnlyCommits(repoPath)]);
  if (r.code !== 0) return []; // repositório sem commits
  const list = parseLog(r.stdout);
  return local ? list.map((c) => ({ ...c, local: local.has(c.hash) })) : list;
}

/** Quantos commits o filtro mostra e quantos o repositório tem ao todo (todas as referências): o "N de M commits" do Grafo. Dois processos curtos, sem trazer os commits. */
export async function getHistoryCount(repoPath: string, filter?: HistoryFilter): Promise<{ count: number; total: number }> {
  const built = buildLogArgs(filter ?? ALL);
  if ('error' in built) throw new Error(`Filtro inválido: ${built.error.code}`);
  const strip = built.args.filter((a) => a !== '--topo-order' && a !== '--date-order' && a !== '--parents');
  const num = async (args: string[]) => {
    const r = await runGit(repoPath, ['rev-list', '--count', ...args], { check: false });
    return r.code === 0 ? Number(r.stdout.trim()) || 0 : 0;
  };
  const [count, total] = await Promise.all([num([...strip, '--', ...built.pathspec]), num(['--all'])]);
  return { count, total };
}

export interface AuthorCount {
  name: string;
  email: string;
  count: number;
}

/** Os autores do repositório (mais ativos primeiro, no máximo 200), para o autocompletar do filtro de autor. */
export async function getAuthors(repoPath: string): Promise<AuthorCount[]> {
  const r = await runGit(repoPath, ['shortlog', '-sne', '--all'], { check: false });
  if (r.code !== 0) return [];
  const out: AuthorCount[] = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^\s*(\d+)\t(.*?)\s*<([^>]*)>\s*$/.exec(line);
    if (m) out.push({ count: Number(m[1]), name: m[2]!, email: m[3]! });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 200);
}
