import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DiffMode, DiscardScope, FileSides } from './types/ipc.js';
import { resolveInsideRepo } from './conflicts.js';
import { runGit } from './runner.js';

const MAX_TEXT_BYTES = 2_000_000;

const empty = (over: Partial<FileSides> = {}): FileSides => ({
  oldText: '',
  newText: '',
  binary: false,
  tooLarge: false,
  isNew: false,
  isDeleted: false,
  isDirectory: false,
  ...over,
});

async function gitShow(repoPath: string, spec: string): Promise<string | null> {
  const r = await runGit(repoPath, ['show', spec], { check: false });
  return r.code === 0 ? r.stdout : null;
}

const TOO_LARGE = '\u0000TOO_LARGE';

/** Lê o arquivo do disco; `null` se não existe/não é arquivo; marcador especial se for grande demais. */
async function readWorking(repoPath: string, file: string): Promise<string | null> {
  const abs = resolveInsideRepo(repoPath, file);
  try {
    const s = await stat(abs);
    if (!s.isFile()) return null;
    return s.size > MAX_TEXT_BYTES ? TOO_LARGE : await readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Duas versões do arquivo, conforme o modo:
 *  - head  : HEAD x working tree (padrão da interface)
 *  - index : índice x working tree
 *  - staged: HEAD x índice
 * (`boolean` por compatibilidade: false = index, true = staged)
 */
export async function getFileSides(repoPath: string, file: string, modeArg: DiffMode | boolean): Promise<FileSides> {
  if (file.endsWith('/')) return empty({ isDirectory: true });
  const mode: DiffMode = modeArg === true ? 'staged' : modeArg === false ? 'index' : modeArg;

  let oldText: string | null;
  let newText: string | null;
  if (mode === 'staged') {
    [oldText, newText] = await Promise.all([gitShow(repoPath, `HEAD:${file}`), gitShow(repoPath, `:${file}`)]);
  } else {
    [oldText, newText] = await Promise.all([
      gitShow(repoPath, mode === 'head' ? `HEAD:${file}` : `:${file}`),
      readWorking(repoPath, file),
    ]);
  }

  if (oldText === TOO_LARGE || newText === TOO_LARGE) return empty({ tooLarge: true });
  const o = oldText ?? '';
  const n = newText ?? '';
  if (o.length > MAX_TEXT_BYTES || n.length > MAX_TEXT_BYTES) return empty({ tooLarge: true });
  if (o.includes('\u0000') || n.includes('\u0000')) return empty({ binary: true });
  return empty({ oldText: o, newText: n, isNew: oldText === null, isDeleted: newText === null });
}

export async function writeWorkingFile(repoPath: string, file: string, content: string): Promise<void> {
  const abs = resolveInsideRepo(repoPath, file);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

async function exists(repoPath: string, args: string[]): Promise<boolean> {
  return (await runGit(repoPath, args, { check: false })).code === 0;
}

/** Guarda uma cópia do que está no disco antes de um descarte destrutivo. */
async function backupWorkingCopy(repoPath: string, file: string, backupRoot: string): Promise<string | null> {
  const abs = resolveInsideRepo(repoPath, file.replace(/\/$/, ''));
  try {
    await stat(abs);
  } catch {
    return null; // nada no disco (arquivo removido)
  }
  const dest = join(backupRoot, file.replace(/\/$/, ''));
  await mkdir(dirname(dest), { recursive: true });
  await cp(abs, dest, { recursive: true });
  return dest;
}

export async function discardFile(
  repoPath: string,
  file: string,
  scope: DiscardScope,
  backupRoot: string,
): Promise<{ backup: string | null }> {
  const clean = file.replace(/\/$/, '');
  resolveInsideRepo(repoPath, clean); // valida o caminho
  const backup = await backupWorkingCopy(repoPath, file, backupRoot);

  const inIndex = await exists(repoPath, ['ls-files', '--error-unmatch', '--', clean]);
  const inHead = await exists(repoPath, ['cat-file', '-e', `HEAD:${clean}`]);

  if (!inIndex) {
    // Não rastreado: remove do disco.
    await runGit(repoPath, ['clean', '-f', '-d', '-q', '--', clean]);
  } else if (scope === 'worktree') {
    await runGit(repoPath, ['restore', '--', clean]);
  } else if (inHead) {
    await runGit(repoPath, ['restore', '--source=HEAD', '--staged', '--worktree', '--', clean]);
  } else {
    // adicionado ao índice mas inexistente no HEAD
    await runGit(repoPath, ['rm', '-f', '-q', '--', clean]);
  }
  return { backup };
}

export async function restoreBackup(repoPath: string, file: string, backup: string): Promise<void> {
  const abs = resolveInsideRepo(repoPath, file.replace(/\/$/, ''));
  await mkdir(dirname(abs), { recursive: true });
  await cp(backup, abs, { recursive: true, force: true });
}

export async function addToGitignore(repoPath: string, pattern: string): Promise<void> {
  const abs = join(repoPath, '.gitignore');
  const current = await readFile(abs, 'utf8').catch(() => '');
  const lines = current.split(/\r?\n/);
  if (lines.includes(pattern)) return;
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const sep = current === '' || current.endsWith('\n') ? '' : eol;
  await writeFile(abs, current + sep + pattern + eol, 'utf8');
}
