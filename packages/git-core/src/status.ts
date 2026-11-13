import type { FileEntry } from './types/ipc.js';
import { runGit } from './runner.js';

export interface GitStatus {
  branch: string;
  staged: string[];
  unstaged: string[];
  /** Subconjunto de `unstaged` que ainda não é rastreado pelo git. */
  untracked: string[];
  entries: FileEntry[];
}

/** Parse de `git status --porcelain=v1 -b -z`. */
export function parsePorcelainV1(raw: string): GitStatus {
  const parts = raw.split('\0').filter((p) => p.length > 0);
  let branch = 'HEAD';
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  const entries: FileEntry[] = [];

  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!;
    if (entry.startsWith('## ')) {
      const b = entry.slice(3);
      branch = b.startsWith('No commits yet on ')
        ? b.slice('No commits yet on '.length)
        : (b.split('...')[0] ?? b).split(' ')[0] ?? b;
      continue;
    }
    const x = entry[0]!;
    const y = entry[1]!;
    const file = entry.slice(3);
    let origPath: string | undefined;
    if (x === 'R' || x === 'C') origPath = parts[++i]; // próximo item é o caminho de origem do rename/cópia
    entries.push({ path: file, x, y, ...(origPath ? { origPath } : {}) });
    if (x === '?' && y === '?') {
      unstaged.push(file);
      untracked.push(file);
      continue;
    }
    if (x !== ' ' && x !== '?') staged.push(file);
    if (y !== ' ' && y !== '?') unstaged.push(file);
  }
  return { branch, staged, unstaged, untracked, entries };
}

export async function getGitStatus(repoPath: string): Promise<GitStatus> {
  const { stdout } = await runGit(repoPath, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=normal']);
  return parsePorcelainV1(stdout);
}
