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
      const [hash = '', parents = '', author = '', at = '0', refs = '', subject = ''] = rec.split(FS);
      return {
        hash,
        shortHash: hash.slice(0, 7),
        parents: parents ? parents.split(' ') : [],
        refs: refs ? refs.split(', ').filter(Boolean) : [],
        author,
        date: Number(at),
        subject,
      };
    });
}

export async function getHistory(repoPath: string, limit = 300): Promise<CommitInfo[]> {
  const format = ['%H', '%P', '%an', '%at', '%D', '%s'].join('%x1f') + '%x1e';
  const r = await runGit(repoPath, ['log', '--all', '--topo-order', `-n${limit}`, `--format=${format}`], { check: false });
  if (r.code !== 0) return []; // repositório sem commits
  return parseLog(r.stdout);
}
