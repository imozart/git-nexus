// Download verificado e instalação da atualização (processo principal). Sem Electron aqui dentro: o que precisa de
// `app`/`shell` fica em main.ts, e este arquivo é testável com um `fetch` falso e uma pasta temporária.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { UpdateProgress } from '@git-nexus/git-core/pure';
import { findSha256, isAllowedUpdateUrl, isSafeAssetName } from '../shared/update';

/** Teto de segurança: nenhum pacote do GitNexus chega perto disso. */
const MAX_BYTES = 600 * 1024 * 1024;
const MAX_SUMS_BYTES = 256 * 1024;

export interface DownloadOptions {
  /** Endereço do pacote (precisa ser do GitHub do projeto). */
  url: string;
  /** Nome do arquivo na release (é o que aparece no `SHA256SUMS.txt`). */
  name: string;
  sumsUrl: string;
  destDir: string;
  repo?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (p: UpdateProgress) => void;
}

export interface Downloaded {
  file: string;
  sha256: string;
}

async function getText(f: typeof fetch, url: string, limit: number): Promise<string> {
  const res = await f(url, { headers: { 'User-Agent': 'GitNexus-update' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`O GitHub respondeu ${res.status} ao baixar ${url.split('/').pop()}.`);
  const text = await res.text();
  if (text.length > limit) throw new Error('Arquivo de hashes grande demais.');
  return text;
}

/**
 * Baixa o pacote para `destDir`, calcula o SHA-256 enquanto grava e só entrega o arquivo se o hash bater com o do
 * `SHA256SUMS.txt` da mesma release. Em qualquer falha o arquivo parcial é apagado.
 */
export async function downloadVerified(o: DownloadOptions): Promise<Downloaded> {
  const f = o.fetchImpl ?? fetch;
  if (!isSafeAssetName(o.name)) throw new Error('Nome de pacote inválido.');
  if (!isAllowedUpdateUrl(o.url, o.repo) || !isAllowedUpdateUrl(o.sumsUrl, o.repo)) throw new Error('Endereço de download não permitido.');

  const expected = findSha256(await getText(f, o.sumsUrl, MAX_SUMS_BYTES), o.name);
  if (!expected) throw new Error(`O SHA256SUMS.txt desta release não lista ${o.name}.`);

  await mkdir(o.destDir, { recursive: true });
  // Limpa baixados de versões anteriores (o diretório é só do updater).
  for (const old of await readdir(o.destDir).catch(() => [] as string[])) await rm(join(o.destDir, old), { force: true, recursive: true });

  const part = join(o.destDir, `${o.name}.part`);
  const final = join(o.destDir, o.name);
  try {
    const res = await f(o.url, { headers: { 'User-Agent': 'GitNexus-update' }, signal: AbortSignal.timeout(30 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`O GitHub respondeu ${res.status} ao baixar o pacote.`);
    const total = Number(res.headers.get('content-length') ?? 0) || 0;
    if (total > MAX_BYTES) throw new Error('Pacote grande demais.');

    const hash = createHash('sha256');
    let done = 0;
    const out = createWriteStream(part);
    const source = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
    source.on('data', (chunk: Buffer) => {
      done += chunk.length;
      if (done > MAX_BYTES) source.destroy(new Error('Pacote grande demais.'));
      hash.update(chunk);
      o.onProgress?.({ done, total });
    });
    await new Promise<void>((resolve, reject) => {
      source.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      source.pipe(out);
    });

    const actual = hash.digest('hex');
    if (actual !== expected) throw new Error('O SHA-256 do pacote não confere com o da release: o download foi descartado.');
    await rename(part, final);
    return { file: final, sha256: actual };
  } catch (e) {
    await rm(part, { force: true });
    throw e;
  }
}

/** Argumentos do instalador NSIS: silencioso, marca como atualização e reabre o app ao terminar. */
export const WINDOWS_INSTALLER_ARGS = ['/S', '--updated', '--force-run'] as const;

/**
 * Troca o AppImage em uso pelo novo: copia ao lado e renomeia por cima (rename é atômico; o processo atual continua
 * usando o inode antigo até fechar). Falha, sem mexer no original, se a pasta não for gravável.
 */
export async function replaceAppImage(downloaded: string, target: string): Promise<void> {
  const next = `${target}.new`;
  try {
    await copyFile(downloaded, next);
    await chmod(next, 0o755);
    await rename(next, target);
  } catch (e) {
    await rm(next, { force: true });
    throw new Error(`Não foi possível substituir o AppImage (${(e as Error).message}). Baixe manualmente pela página da release.`);
  }
}

/** Existe e tem tamanho > 0 (conferência antes de executar). */
export async function isReadyFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}
