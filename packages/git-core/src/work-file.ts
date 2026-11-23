// Leitura e gravação SEGURAS de um arquivo do working tree, para a janela de pesquisa (que edita o arquivo no mesmo lugar):
//  - `readWorkingFile` devolve o texto na codificação detectada, o fim de linha, e uma "impressão" do que está no disco (tamanho, data e hash);
//  - `saveWorkingFile` grava de forma ATÔMICA (arquivo temporário na mesma pasta + rename: uma queda no meio nunca deixa o arquivo pela metade),
//    na codificação e com o fim de linha do arquivo, mantém o modo (executável), recusa quando um caractere não existe na codificação (nada é gravado)
//    e quando o arquivo mudou por fora desde a leitura (a impressão não bate), a menos que `force`.
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { resolveInsideRepo } from './conflicts.js';
import { EncodingError, decodeText, detectEncodingOf, encodeText, resolveEncoding } from './encoding.js';
import type { EncodingChoice } from './file-encoding.js';
import type { Eol, SaveOptions, SaveResult, WorkingFileInfo, WorkingFileStamp } from './types/ipc.js';

/** Acima disto o arquivo abre só para leitura (e a interface não o carrega): é o mesmo limite do diff. */
export const MAX_EDIT_BYTES = 2_000_000;

const sha1 = (b: Uint8Array): string => createHash('sha1').update(b).digest('hex');

/** O fim de linha de um texto: só LF, só CRLF, misto (inclui CR solto) ou nenhum. */
export function eolOf(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(^|[^\r])\n/g) ?? []).length;
  const cr = (text.match(/\r(?!\n)/g) ?? []).length;
  if (!crlf && !lf && !cr) return 'none';
  if (crlf && !lf && !cr) return 'crlf';
  if (lf && !crlf && !cr) return 'lf';
  return 'mixed';
}

export async function readWorkingFile(repoPath: string, file: string, encoding?: EncodingChoice): Promise<WorkingFileInfo> {
  const none: WorkingFileInfo = { exists: false, binary: false, tooLarge: false, text: '', encoding: 'utf-8', detectedEncoding: 'utf-8', invalid: false, eol: 'none', size: 0, mtimeMs: 0, hash: '' };
  const abs = resolveInsideRepo(repoPath, file);
  let s;
  try {
    s = await stat(abs);
  } catch {
    return none;
  }
  if (!s.isFile()) return none;
  if (s.size > MAX_EDIT_BYTES) return { ...none, exists: true, tooLarge: true, size: s.size, mtimeMs: s.mtimeMs };
  const bytes = await readFile(abs);
  const stamp = { size: bytes.length, mtimeMs: s.mtimeMs, hash: sha1(bytes) };
  // a codificação vem dos bytes do disco (BOM, UTF-8 válido, senão Windows-1252). Arquivo só ASCII abre como UTF-8: não consulta o índice nem o HEAD (dois `git show`
  // custavam ~150 ms em cada abertura, e a escolha só importa se alguém digitar um caractere fora do ASCII nele).
  const detected = detectEncodingOf(bytes);
  const enc = resolveEncoding(encoding, detected);
  const wide = enc.startsWith('utf-16'); // também as variantes com BOM (utf-16le-bom)
  if (!wide && bytes.includes(0)) return { ...none, exists: true, binary: true, encoding: enc, detectedEncoding: detected, ...stamp };
  const d = decodeText(bytes, enc);
  if (d.text.includes('\u0000')) return { ...none, exists: true, binary: true, encoding: enc, detectedEncoding: detected, ...stamp };
  return { exists: true, binary: false, tooLarge: false, text: d.text, encoding: enc, detectedEncoding: detected, invalid: d.invalid, eol: eolOf(d.text), ...stamp };
}

/** A impressão do arquivo no disco agora (ou `null` se não existe). Para a janela perguntar "mudou por fora?" sem reler o texto. */
export async function stampWorkingFile(repoPath: string, file: string): Promise<WorkingFileStamp | null> {
  const abs = resolveInsideRepo(repoPath, file);
  try {
    const s = await stat(abs);
    if (!s.isFile()) return null;
    const bytes = await readFile(abs);
    return { size: bytes.length, mtimeMs: s.mtimeMs, hash: sha1(bytes) };
  } catch {
    return null;
  }
}

/** Grava os bytes de forma atômica: temporário na mesma pasta e `rename` por cima. Mantém o modo do arquivo que existia. */
export async function writeFileAtomic(abs: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(abs), { recursive: true });
  let mode: number | undefined;
  try {
    mode = (await stat(abs)).mode & 0o7777;
  } catch {
    /* arquivo novo */
  }
  const tmp = join(dirname(abs), `.${basename(abs)}.gn-${process.pid}-${Date.now().toString(36)}.tmp`);
  try {
    await writeFile(tmp, bytes, mode !== undefined ? { mode } : undefined);
    if (mode !== undefined && process.platform !== 'win32') await chmod(tmp, mode);
    await rename(tmp, abs);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
}

export async function saveWorkingFile(repoPath: string, file: string, content: string, opts: SaveOptions): Promise<SaveResult> {
  const abs = resolveInsideRepo(repoPath, file);
  // codifica ANTES de tocar no disco: um caractere que a codificação não tem deixa o arquivo como estava
  let bytes: Buffer;
  try {
    const current = await readWorkingFile(repoPath, file, opts.encoding);
    bytes = encodeText(content, resolveEncoding(opts.encoding, current.detectedEncoding));
  } catch (e) {
    if (e instanceof EncodingError) return { ok: false, reason: 'unencodable', message: e.message, char: e.char };
    return { ok: false, reason: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
  if (!opts.force) {
    const now = await stampWorkingFile(repoPath, file);
    if ((now?.hash ?? null) !== opts.expectHash) return { ok: false, reason: 'changed', message: 'changed', ...(now ? { stamp: now } : {}) };
  }
  try {
    await writeFileAtomic(abs, bytes);
  } catch (e) {
    return { ok: false, reason: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
  const stamp = await stampWorkingFile(repoPath, file);
  return { ok: true, stamp: stamp ?? { size: bytes.length, mtimeMs: Date.now(), hash: sha1(bytes) } };
}
