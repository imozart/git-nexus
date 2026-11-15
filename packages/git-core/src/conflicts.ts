import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { MergeConflictBlock } from './types/ipc.js';
import { hasConflictMarkers } from './conflict-markers.js';
import { runGit } from './runner.js';
import { tm } from './messages.js';

async function stage(repoPath: string, n: 1 | 2 | 3, file: string): Promise<string> {
  // Estágios do índice: 1 = base (ancestral), 2 = ours, 3 = theirs. Ausente => add/delete.
  const r = await runGit(repoPath, ['show', `:${n}:${file}`], { check: false });
  return r.code === 0 ? r.stdout : '';
}

/**
 * Arquivos em conflito, lidos direto do índice (entradas "unmerged"). É bem mais rápido que `git diff --diff-filter=U`,
 * que compara o conteúdo de todos os arquivos alterados: em um repositório com milhares de alterações, isso custava
 * ~3x o próprio `git status` a cada atualização da tela.
 */
export async function unmergedFiles(repoPath: string): Promise<string[]> {
  const r = await runGit(repoPath, ['ls-files', '--unmerged', '-z'], { check: false });
  // cada registro: "<modo> <sha> <estágio>\t<caminho>"
  return [...new Set(r.stdout.split('\0').filter(Boolean).map((rec) => rec.slice(rec.indexOf('\t') + 1)))];
}

export async function getMergeConflicts(repoPath: string): Promise<MergeConflictBlock[]> {
  const files = await unmergedFiles(repoPath);
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
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(tm('Caminho fora do repositório.', 'Path outside the repository.'));
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
