// Git LFS: quais arquivos do repositório são do LFS (`filter=lfs` no .gitattributes) e em que estado estão na pasta (ponteiro: ainda não baixado;
// baixado: o conteúdo de verdade). A leitura NÃO depende do git-lfs estar instalado (só lê atributos e o início dos arquivos); baixar depende.
import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { remoteEnv } from './askpass.js';
import { remoteErrorText } from './askpass-pure.js';
import { tm } from './messages.js';
import { runGit } from './runner.js';
import type { BranchActionResult, LfsFile, LfsInfo } from './types/ipc.js';

/** Quantos arquivos LFS a lista devolve (o resto entra só na contagem). */
export const MAX_LFS_FILES = 1000;
const POINTER_HEAD = 'version https://git-lfs.github.com/spec/v1';

/**
 * Lê um ponteiro LFS (o arquivo de ~130 bytes que fica no lugar do conteúdo grande): `version`, `oid sha256:<hash>` e `size <bytes>`.
 * Devolve null se o texto não é um ponteiro.
 */
export function parseLfsPointer(text: string): { oid: string; size: number } | null {
  if (!text.startsWith(POINTER_HEAD)) return null;
  const oid = /^oid sha256:([0-9a-f]{64})\s*$/m.exec(text)?.[1];
  const size = /^size (\d+)\s*$/m.exec(text)?.[1];
  return oid && size ? { oid, size: Number(size) } : null;
}

/** Padrões `filter=lfs` de um `.gitattributes` (a primeira palavra de cada linha que tem o filtro). */
export function lfsPatterns(attributes: string): string[] {
  const out: string[] = [];
  for (const raw of attributes.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.slice(1).includes('filter=lfs')) out.push(parts[0]!);
  }
  return out;
}

async function lfsVersion(repoPath: string): Promise<string | null> {
  const r = await runGit(repoPath, ['lfs', 'version'], { check: false }).catch(() => null);
  return r && r.code === 0 ? r.stdout.trim().split('\n')[0]! : null;
}

/** Lê os primeiros bytes (suficiente para um ponteiro) e o tamanho; `null` se o arquivo não existe. */
async function inspect(path: string): Promise<{ head: string; size: number } | null> {
  const st = await stat(path).catch(() => null);
  if (!st?.isFile()) return null;
  const fh = await open(path, 'r').catch(() => null);
  if (!fh) return null;
  try {
    const buf = Buffer.alloc(Math.min(200, st.size));
    await fh.read(buf, 0, buf.length, 0);
    return { head: buf.toString('utf8'), size: st.size };
  } finally {
    await fh.close();
  }
}

const emptyInfo = (installed: boolean, version?: string): LfsInfo => ({ enabled: false, installed, ...(version ? { version } : {}), patterns: [], files: [], total: 0, pointers: 0, truncated: false });

/**
 * Situação do LFS no repositório. `enabled` = algum `.gitattributes` tem `filter=lfs`. Lista os arquivos que o LFS controla, cada um como
 * `pointer` (ainda é só o ponteiro), `downloaded` (conteúdo baixado) ou `missing` (não está na pasta).
 */
export async function getLfsInfo(repoPath: string): Promise<LfsInfo> {
  const version = (await lfsVersion(repoPath)) ?? undefined;
  const installed = !!version;
  // 1) os .gitattributes do repositório: sem nenhum filter=lfs, não há mais o que olhar (o caso da maioria dos repositórios)
  const attrFiles = await runGit(repoPath, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob).gitattributes', ':(glob)**/.gitattributes'], { check: false });
  const patterns = new Set<string>();
  for (const f of attrFiles.stdout.split('\0').filter(Boolean)) {
    const info = await stat(join(repoPath, f)).catch(() => null);
    if (!info?.isFile() || info.size > 1_000_000) continue;
    for (const p of lfsPatterns(await readFile(join(repoPath, f), 'utf8').catch(() => ''))) patterns.add(p);
  }
  if (!patterns.size) return emptyInfo(installed, version);

  // 2) quais arquivos têm o filtro (o git aplica as regras de padrão, herança de pastas e exceções)
  const all = await runGit(repoPath, ['ls-files', '-z', '--cached'], { check: false });
  const names = all.stdout.split('\0').filter(Boolean);
  const attr = await runGit(repoPath, ['check-attr', '-z', '--stdin', 'filter'], { check: false, stdin: names.join('\0') + '\0' });
  const lfsNames: string[] = [];
  const parts = attr.stdout.split('\0');
  for (let i = 0; i + 2 < parts.length; i += 3) if (parts[i + 2] === 'lfs') lfsNames.push(parts[i]!);

  const shown = lfsNames.slice(0, MAX_LFS_FILES);
  let pointers = 0;
  const files: LfsFile[] = [];
  for (const path of shown) {
    const ins = await inspect(join(repoPath, path));
    if (!ins) {
      files.push({ path, state: 'missing' });
      continue;
    }
    const p = parseLfsPointer(ins.head);
    if (p) {
      pointers++;
      files.push({ path, state: 'pointer', size: p.size, oid: p.oid });
    } else files.push({ path, state: 'downloaded', size: ins.size });
  }
  return { enabled: true, installed, ...(version ? { version } : {}), patterns: [...patterns].sort(), files, total: lfsNames.length, pointers, truncated: lfsNames.length > shown.length };
}

/**
 * `git lfs pull`: baixa os arquivos LFS que estão só como ponteiro (todos, ou só os `paths`, que precisam ser arquivos LFS do repositório).
 * Precisa do git-lfs instalado; sem ele, explica o que fazer em vez de falhar com o texto do git.
 */
export async function pullLfs(repoPath: string, paths?: string[]): Promise<BranchActionResult> {
  const info = await getLfsInfo(repoPath);
  if (!info.enabled) return { ok: false, message: tm('Este repositório não usa Git LFS.', 'This repository does not use Git LFS.') };
  if (!info.installed) {
    return { ok: false, message: tm('O Git LFS não está instalado neste computador. Instale-o (git-lfs.com) para baixar os arquivos.', 'Git LFS is not installed on this computer. Install it (git-lfs.com) to download the files.') };
  }
  const known = new Set(info.files.map((f) => f.path));
  const chosen = paths?.length ? paths.filter((p) => known.has(p)) : [];
  if (paths?.length && !chosen.length) return { ok: false, message: tm('Esses arquivos não são do Git LFS.', 'Those files are not Git LFS files.') };
  if (!info.pointers && !chosen.length) return { ok: true, message: tm('Todos os arquivos LFS já estão baixados.', 'All LFS files are already downloaded.') };
  // `--include` recebe uma lista separada por vírgula; um nome com vírgula não cabe nela: baixa-se tudo nesse caso
  const include = chosen.length && !chosen.some((p) => p.includes(',')) ? [`--include=${chosen.join(',')}`] : [];
  const r = await runGit(repoPath, ['lfs', 'pull', ...include], { check: false, env: remoteEnv() });
  if (r.code !== 0) return { ok: false, message: remoteErrorText(r.stderr + r.stdout, tm('Não foi possível baixar os arquivos do Git LFS.', 'Could not download the Git LFS files.')) };
  const after = await getLfsInfo(repoPath);
  return { ok: true, message: tm(`Baixado. Ainda como ponteiro: ${after.pointers}.`, `Downloaded. Still pointers: ${after.pointers}.`) };
}
