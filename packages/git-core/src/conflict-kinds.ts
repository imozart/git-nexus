// Classificação do conflito a partir dos estágios do índice (função pura, sem Git): decide qual decisão a tela oferece.
import type { ConflictKind } from './types/ipc.js';

/** Uma linha de `git ls-files --unmerged`. */
export interface IndexEntry {
  mode: string;
  sha: string;
  stage: 1 | 2 | 3;
  path: string;
}

export const MODE_SUBMODULE = '160000';
export const MODE_SYMLINK = '120000';
export const MODE_EXEC = '100755';
export const MODE_FILE = '100644';

/** `git ls-files --unmerged -z`: registros "<modo> <sha> <estágio>\t<caminho>" separados por NUL. */
export function parseUnmerged(out: string): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const rec of out.split('\0')) {
    const m = /^(\d{6}) ([0-9a-f]{40,64}) ([123])\t([\s\S]+)$/.exec(rec);
    if (m) entries.push({ mode: m[1]!, sha: m[2]!, stage: Number(m[3]) as 1 | 2 | 3, path: m[4]! });
  }
  return entries;
}

/** Binário pelo mesmo critério do Git: um byte NUL nos primeiros 8000 bytes. */
export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

export interface KindInput {
  base?: IndexEntry;
  ours?: IndexEntry;
  theirs?: IndexEntry;
}

/**
 * Decide o tipo pelo que o índice diz. `binary`/`lfs` precisam do conteúdo (por isso as perguntas vêm de fora): só é consultado
 * quando os dois lados existem e são arquivos comuns.
 */
export function classifyConflict(i: KindInput, content: { binary: () => boolean; lfs: () => boolean }): ConflictKind {
  const { base, ours, theirs } = i;
  if (!ours && !theirs) return 'both-deleted';
  if ([base, ours, theirs].some((e) => e?.mode === MODE_SUBMODULE) && (ours?.mode === MODE_SUBMODULE || theirs?.mode === MODE_SUBMODULE)) {
    return ours && theirs ? 'submodule' : 'deleted';
  }
  if (!ours || !theirs) return 'deleted';
  // tipo/modo: os dois lados mudaram o modo em relação à base, cada um para um valor (arquivo × executável × link simbólico)
  if (ours.mode !== theirs.mode && (!base || (ours.mode !== base.mode && theirs.mode !== base.mode))) return 'mode';
  if (content.lfs()) return 'lfs';
  if (content.binary()) return 'binary';
  return base ? 'text' : 'both-added';
}

/** Modo que o resultado deve ter quando só um dos lados mudou (o outro seguiu a base): o do lado que mudou. */
export function mergedMode(base: string | undefined, ours: string, theirs: string): string {
  if (ours === theirs) return ours;
  if (base === undefined) return ours;
  return ours !== base ? ours : theirs;
}
