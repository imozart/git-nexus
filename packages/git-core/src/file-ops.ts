import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DiffMode, DiscardScope, FileSides } from './types/ipc.js';
import type { EncodingChoice, FileEncoding, FileEncodingInfo } from './file-encoding.js';
import { decodeText, detectEncodingOf, encodeText, resolveEncoding } from './encoding.js';
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
  encoding: 'utf-8',
  detectedEncoding: 'utf-8',
  invalid: false,
  ...over,
});

/** Bytes de `git show <spec>` (sem decodificar); `null` se não existe. */
async function gitShowBytes(repoPath: string, spec: string): Promise<Buffer | null> {
  const r = await runGit(repoPath, ['show', spec], { check: false });
  return r.code === 0 ? r.bytes : null;
}

const TOO_LARGE = 'too-large';

/** Bytes do arquivo no disco; `null` se não existe/não é arquivo; marcador especial se for grande demais. */
async function readWorkingBytes(repoPath: string, file: string): Promise<Buffer | null | typeof TOO_LARGE> {
  const abs = resolveInsideRepo(repoPath, file);
  try {
    const s = await stat(abs);
    if (!s.isFile()) return null;
    return s.size > MAX_TEXT_BYTES ? TOO_LARGE : await readFile(abs);
  } catch {
    return null;
  }
}

/** As duas versões (em bytes) que o modo compara: antiga (HEAD ou índice) e nova (índice ou disco). */
async function loadSideBytes(repoPath: string, file: string, mode: DiffMode): Promise<[Buffer | null | typeof TOO_LARGE, Buffer | null | typeof TOO_LARGE]> {
  if (mode === 'staged') return Promise.all([gitShowBytes(repoPath, `HEAD:${file}`), gitShowBytes(repoPath, `:${file}`)]);
  return Promise.all([gitShowBytes(repoPath, mode === 'head' ? `HEAD:${file}` : `:${file}`), readWorkingBytes(repoPath, file)]);
}

const normalizeMode = (m: DiffMode | boolean): DiffMode => (m === true ? 'staged' : m === false ? 'index' : m);
const isBuffer = (b: Buffer | null | typeof TOO_LARGE): b is Buffer => b !== null && b !== TOO_LARGE;

/**
 * Codificação do arquivo no disco (ou, se ele não existe, no índice/HEAD): é a que as gravações usam quando a interface não
 * informa uma, para que regravar o arquivo nunca mude os bytes que não foram editados.
 */
async function detectForFile(repoPath: string, file: string): Promise<FileEncoding> {
  const [working, index, head] = await Promise.all([readWorkingBytes(repoPath, file), gitShowBytes(repoPath, `:${file}`), gitShowBytes(repoPath, `HEAD:${file}`)]);
  return detectEncodingOf(isBuffer(working) ? working : null, index, head);
}

/**
 * Duas versões do arquivo, conforme o modo:
 *  - head  : HEAD x working tree (padrão da interface)
 *  - index : índice x working tree
 *  - staged: HEAD x índice
 * (`boolean` por compatibilidade: false = index, true = staged)
 */
export async function getFileSides(repoPath: string, file: string, modeArg: DiffMode | boolean, encoding?: EncodingChoice): Promise<FileSides> {
  if (file.endsWith('/')) return empty({ isDirectory: true });
  const [oldB, newB] = await loadSideBytes(repoPath, file, normalizeMode(modeArg));

  if (oldB === TOO_LARGE || newB === TOO_LARGE) return empty({ tooLarge: true });
  if ((oldB?.length ?? 0) > MAX_TEXT_BYTES || (newB?.length ?? 0) > MAX_TEXT_BYTES) return empty({ tooLarge: true });

  // a mais nova primeiro: é a que a pessoa está vendo
  const detected = detectEncodingOf(newB, oldB);
  const enc = resolveEncoding(encoding, detected);
  const wide = enc === 'utf-16le' || enc === 'utf-16be'; // UTF-16 tem bytes 0 de verdade; nas outras, byte 0 = binário
  if (!wide && (oldB?.includes(0) || newB?.includes(0))) return empty({ binary: true });

  const o = oldB ? decodeText(oldB, enc) : { text: '', invalid: false };
  const n = newB ? decodeText(newB, enc) : { text: '', invalid: false };
  if (o.text.includes('\u0000') || n.text.includes('\u0000')) return empty({ binary: true });
  return empty({
    oldText: o.text,
    newText: n.text,
    isNew: oldB === null,
    isDeleted: newB === null,
    encoding: enc,
    detectedEncoding: detected,
    invalid: o.invalid || n.invalid,
  });
}

/** Só a codificação do arquivo (para o rodapé quando o diff está no modo unificado, que não carrega as duas versões). */
export async function getFileEncoding(repoPath: string, file: string, modeArg: DiffMode | boolean, encoding?: EncodingChoice): Promise<FileEncodingInfo> {
  const none: FileEncodingInfo = { encoding: 'utf-8', detected: 'utf-8', invalid: false };
  if (file.endsWith('/')) return none;
  const [oldB, newB] = await loadSideBytes(repoPath, file, normalizeMode(modeArg));
  const detected = detectEncodingOf(isBuffer(newB) ? newB : null, isBuffer(oldB) ? oldB : null);
  const enc = resolveEncoding(encoding, detected);
  const invalid = [oldB, newB].some((b) => isBuffer(b) && decodeText(b, enc).invalid);
  return { encoding: enc, detected, invalid };
}

/**
 * Grava `content` como a versão do arquivo no ÍNDICE (stage), sem tocar no disco: base do stage por linha/trecho.
 * Preserva o modo do arquivo (executável etc.). Conteúdo vazio de um arquivo que não existe no HEAD remove a entrada.
 */
export async function writeIndexContent(repoPath: string, file: string, content: string, encoding?: EncodingChoice): Promise<void> {
  resolveInsideRepo(repoPath, file); // valida o caminho
  const inHead = await exists(repoPath, ['cat-file', '-e', `HEAD:${file}`]);
  const ls = await runGit(repoPath, ['ls-files', '-s', '--', file], { check: false });
  const mode = /^(\d{6}) /.exec(ls.stdout)?.[1] ?? '100644';
  if (content === '' && !inHead) {
    if (ls.stdout.trim()) await runGit(repoPath, ['rm', '--cached', '-f', '-q', '--', file]);
    return;
  }
  // na codificação do arquivo (a escolhida ou a detectada): nada de regravar tudo como UTF-8; se um caractere não existir nela, lança antes de gravar
  const bytes = encodeText(content, resolveEncoding(encoding, await detectForFile(repoPath, file)));
  const h = await runGit(repoPath, ['hash-object', '-w', '--no-filters', '--stdin'], { stdin: bytes });
  await runGit(repoPath, ['update-index', '--add', '--cacheinfo', `${mode},${h.stdout.trim()},${file}`]);
}

export async function writeWorkingFile(repoPath: string, file: string, content: string, encoding?: EncodingChoice): Promise<void> {
  const abs = resolveInsideRepo(repoPath, file);
  // codifica ANTES de tocar no disco: se um caractere não existir na codificação do arquivo, o arquivo fica como estava
  const bytes = encodeText(content, resolveEncoding(encoding, await detectForFile(repoPath, file)));
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
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
