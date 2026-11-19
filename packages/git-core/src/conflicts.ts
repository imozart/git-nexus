import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { MergeConflictBlock } from './types/ipc.js';
import { hasConflictMarkers } from './conflict-markers.js';
import { operationInProgress } from './operations.js';
import { runGit } from './runner.js';
import { tm } from './messages.js';
import { decodeText, detectEncodingOf, encodeText } from './encoding.js';

async function stage(repoPath: string, n: 1 | 2 | 3, file: string): Promise<Buffer | null> {
  // Estágios do índice: 1 = base (ancestral), 2 = ours, 3 = theirs. Ausente => add/delete.
  const r = await runGit(repoPath, ['show', `:${n}:${file}`], { check: false });
  return r.code === 0 ? r.bytes : null;
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
      const [baseB, oursB, theirsB, workingB] = await Promise.all([
        stage(repoPath, 1, filePath),
        stage(repoPath, 2, filePath),
        stage(repoPath, 3, filePath),
        readFile(join(repoPath, filePath)).catch(() => undefined),
      ]);
      // uma codificação para as quatro versões (a do arquivo em conflito), para o merge não misturar UTF-8 com Windows-1252
      const enc = detectEncodingOf(workingB, oursB, theirsB, baseB);
      const text = (b: Buffer | null | undefined) => (b ? decodeText(b, enc).text : '');
      const working = workingB ? decodeText(workingB, enc).text : undefined;
      const [base, ours, theirs] = [text(baseB), text(oursB), text(theirsB)];
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
  const abs = resolveInsideRepo(repoPath, filePath);
  // regrava na codificação do arquivo em conflito (e recusa, sem tocar nele, se um caractere não existir nela)
  const [current, ours, theirs] = await Promise.all([readFile(abs).catch(() => null), stage(repoPath, 2, filePath), stage(repoPath, 3, filePath)]);
  await writeFile(abs, encodeText(mergedContent, detectEncodingOf(current, ours, theirs)));
  await runGit(repoPath, ['add', '--', filePath]);
  return true;
}

/**
 * Arquivos de conflito já marcados como resolvidos (`git add`) cuja informação de desfazer o Git ainda guarda no índice
 * (`ls-files --resolve-undo`): dá para reabri-los enquanto a operação (merge, rebase, cherry-pick) não terminou.
 */
export async function resolvedConflictFiles(repoPath: string): Promise<string[]> {
  // o Git guarda a informação de desfazer no índice mesmo depois do commit: fora de uma operação em andamento não há o que reabrir
  if (!(await operationInProgress(repoPath))) return [];
  const r = await runGit(repoPath, ['ls-files', '--resolve-undo', '-z'], { check: false });
  if (r.code !== 0) return [];
  // cada registro: "<modo> <sha> <estágio>\t<caminho>"
  return [...new Set(r.stdout.split('\0').filter(Boolean).map((rec) => rec.slice(rec.indexOf('\t') + 1)))];
}

/** Recria o conflito original de um arquivo já resolvido (`git checkout -m`), com os marcadores no disco. Devolve false se não havia o que reabrir. */
export async function reopenConflict(repoPath: string, filePath: string): Promise<boolean> {
  resolveInsideRepo(repoPath, filePath);
  if (!(await resolvedConflictFiles(repoPath)).includes(filePath)) return false;
  const r = await runGit(repoPath, ['checkout', '-m', '--', filePath], { check: false });
  return r.code === 0 && (await unmergedFiles(repoPath)).includes(filePath);
}
