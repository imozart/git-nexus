import type { CommitInfo } from './types/ipc.js';
import { runGit } from './runner.js';

const FS = '\x1f';
const RS = '\x1e';

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

/** Uma página do histórico (`--topo-order`: filhos antes dos pais, como o desenho de lanes precisa). `skip` pula os já carregados (a lista pede mais ao rolar). */
export async function getHistory(repoPath: string, limit = 300, skip = 0): Promise<CommitInfo[]> {
  const format = ['%H', '%P', '%an', '%ae', '%at', '%D', '%s'].join('%x1f') + '%x1e';
  const args = ['log', '--all', '--topo-order', `-n${limit}`, ...(skip > 0 ? [`--skip=${Math.floor(skip)}`] : []), `--format=${format}`];
  const [r, local] = await Promise.all([runGit(repoPath, args, { check: false }), localOnlyCommits(repoPath)]);
  if (r.code !== 0) return []; // repositório sem commits
  const list = parseLog(r.stdout);
  return local ? list.map((c) => ({ ...c, local: local.has(c.hash) })) : list;
}
