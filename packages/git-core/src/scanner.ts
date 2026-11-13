import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { RepositoryMeta } from './types/ipc.js';
import { isWslPath } from './wsl.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.cache',
  '.gradle',
  '.m2',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'dist',
  'build',
  '$RECYCLE.BIN',
  'System Volume Information',
]);

export interface ScanOptions {
  /** Profundidade máxima a partir de cada raiz (padrão 6). */
  maxDepth?: number;
  signal?: AbortSignal;
}

function repoIdFromPath(path: string): string {
  return createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 16);
}

export function toRepositoryMeta(path: string): RepositoryMeta {
  return {
    id: repoIdFromPath(path),
    name: basename(path),
    path,
    isWsl: isWslPath(path),
    lastOpenedAt: 0,
  };
}

async function hasGit(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, '.git')); // pasta (repo comum) ou arquivo (worktree/submódulo)
    return true;
  } catch {
    return false;
  }
}

/**
 * Varredura recursiva em largura/profundidade limitada. Ao achar `.git` registra o
 * diretório e NÃO desce nele (submódulos/aninhados ficam fora do MVP).
 */
export async function scanDirectories(rootPaths: string[], opts: ScanOptions = {}): Promise<RepositoryMeta[]> {
  const maxDepth = opts.maxDepth ?? 6;
  const found = new Map<string, RepositoryMeta>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (opts.signal?.aborted) return;
    if (await hasGit(dir)) {
      const meta = toRepositoryMeta(dir);
      found.set(meta.id, meta);
      return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // sem permissão / removido durante a varredura
    }
    const subdirs = entries
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !SKIP_DIRS.has(e.name))
      .map((e) => join(dir, e.name));
    await Promise.all(subdirs.map((d) => walk(d, depth + 1)));
  }

  await Promise.all(rootPaths.map((r) => walk(r, 0)));
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
