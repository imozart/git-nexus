import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { MergeConflictBlock } from './types/ipc.js';
import { hasConflictMarkers } from './conflict-markers.js';
import { runGit } from './runner.js';

export { hasConflictMarkers };

async function stage(repoPath: string, n: 1 | 2 | 3, file: string): Promise<string> {
  // Estágios do índice: 1 = base (ancestral), 2 = ours, 3 = theirs. Ausente => add/delete.
  const r = await runGit(repoPath, ['show', `:${n}:${file}`], { check: false });
  return r.code === 0 ? r.stdout : '';
}

export async function getMergeConflicts(repoPath: string): Promise<MergeConflictBlock[]> {
  const { stdout } = await runGit(repoPath, ['diff', '--name-only', '--diff-filter=U', '-z']);
  const files = [...new Set(stdout.split('\0').filter(Boolean))];
  return Promise.all(
    files.map(async (filePath) => {
      const [base, ours, theirs, working] = await Promise.all([
        stage(repoPath, 1, filePath),
        stage(repoPath, 2, filePath),
        stage(repoPath, 3, filePath),
        readFile(join(repoPath, filePath), 'utf8').catch(() => undefined),
      ]);
      return {
        filePath,
        ours,
        base,
        theirs,
        workingContent: working,
        hasUnresolvedMarkers: working === undefined ? true : hasConflictMarkers(working),
      };
    }),
  );
}

/** Impede escrita fora do repositório (ex.: `../../x`). */
export function resolveInsideRepo(repoPath: string, filePath: string): string {
  const abs = isAbsolute(filePath) ? resolve(filePath) : resolve(repoPath, filePath);
  const rel = relative(resolve(repoPath), abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Caminho fora do repositório.');
  return abs;
}

/** Grava o conteúdo resolvido e faz `git add`. Recusa se ainda houver marcadores. */
export async function resolveConflictFile(
  repoPath: string,
  filePath: string,
  mergedContent: string,
): Promise<boolean> {
  if (hasConflictMarkers(mergedContent)) return false;
  await writeFile(resolveInsideRepo(repoPath, filePath), mergedContent, 'utf8');
  await runGit(repoPath, ['add', '--', filePath]);
  return true;
}
