// Comparar duas revisões (#295) e a lista de arquivos de um commit (#293): o que o alvo tem a mais e a menos (`base..alvo`, `alvo..base`), os arquivos que mudam (com renomeação e
// contagem) e o diff de um deles. Tudo no Git; cada revisão passa por `isSafeRevision` e por `rev-parse --verify` (nunca vira opção do Git).
import { LOG_FORMAT, parseLog } from './history.js';
import { resolveInsideRepo } from './paths.js';
import { runGit } from './runner.js';
import { isSafeRevision } from './search-pure.js';
import { tm } from './messages.js';
import type { CommitFile, CommitInfo, CompareMode, CompareOk, CompareResult } from './types/ipc.js';

export type { CompareMode, CompareOk, CompareResult } from './types/ipc.js';

/** Quantos arquivos e commits a comparação traz de uma vez (o resto fica contado, e o aviso diz que há mais). */
export const COMPARE_MAX_FILES = 5000;
export const COMPARE_MAX_COMMITS = 1000;
/** O diff de um arquivo passa disto: vem cortado, com o aviso. */
export const COMPARE_MAX_DIFF = 1_500_000;

/** `--name-status -z`: `M\0caminho\0` e, nas renomeações e cópias, `R100\0antigo\0novo\0`. */
export function parseNameStatus(z: string): CommitFile[] {
  const parts = z.split('\0');
  const out: CommitFile[] = [];
  for (let i = 0; i < parts.length; ) {
    const st = parts[i++];
    if (!st) continue;
    const code = st.charAt(0);
    if (code === 'R' || code === 'C') {
      const oldPath = parts[i++];
      const path = parts[i++];
      if (oldPath !== undefined && path) out.push({ status: code, path, oldPath });
    } else {
      const path = parts[i++];
      if (path) out.push({ status: code, path });
    }
  }
  return out;
}

/** `--numstat -z`: `+\t-\tcaminho\0` (binário: `-\t-`); nas renomeações `+\t-\t\0antigo\0novo\0`. O resultado é por caminho NOVO. */
export function parseNumstat(z: string): Map<string, { added: number; removed: number; binary: boolean }> {
  const parts = z.split('\0');
  const out = new Map<string, { added: number; removed: number; binary: boolean }>();
  for (let i = 0; i < parts.length; ) {
    const head = parts[i++];
    if (!head) continue;
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(head);
    if (!m) continue;
    let path = m[3]!;
    if (!path) {
      i++; // o caminho antigo
      path = parts[i++] ?? '';
    }
    if (path) out.set(path, { added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]), binary: m[1] === '-' });
  }
  return out;
}

/** Junta estado e contagem por arquivo. */
export function mergeFileStats(files: CommitFile[], stats: ReturnType<typeof parseNumstat>): CommitFile[] {
  return files.map((f) => {
    const s = stats.get(f.path);
    return s ? { ...f, added: s.added, removed: s.removed, ...(s.binary ? { binary: true } : {}) } : f;
  });
}

/** Os arquivos de um diff, com estado, renomeação e contagem: `args` é o que escolhe o que comparar (`show -m --first-parent <hash>`, `diff a...b`). */
export async function fileChanges(repoPath: string, cmd: 'show' | 'diff', args: string[], pathspec: string[] = []): Promise<CommitFile[]> {
  const base = cmd === 'show' ? ['show', '--format=', '-m', '--first-parent'] : ['diff'];
  const tail = [...args, ...(pathspec.length ? ['--', ...pathspec] : [])];
  const [ns, num] = await Promise.all([
    runGit(repoPath, [...base, '--name-status', '-z', '--find-renames', ...tail], { check: false }),
    runGit(repoPath, [...base, '--numstat', '-z', '--find-renames', ...tail], { check: false }),
  ]);
  if (ns.code !== 0) return [];
  return mergeFileStats(parseNameStatus(ns.stdout), parseNumstat(num.code === 0 ? num.stdout : ''));
}

async function resolveRev(repoPath: string, rev: string): Promise<{ hash: string } | { error: { code: 'badRevision' | 'notFound'; value: string } }> {
  const r = rev.trim();
  if (!isSafeRevision(r)) return { error: { code: 'badRevision', value: r } };
  const v = await runGit(repoPath, ['rev-parse', '--verify', '--quiet', `${r}^{commit}`], { check: false });
  const hash = v.stdout.trim();
  return v.code === 0 && /^[0-9a-f]{40,64}$/.test(hash) ? { hash } : { error: { code: 'notFound', value: r } };
}

const range = (mode: CompareMode, a: string, b: string): string[] => (mode === 'three' ? [`${a}...${b}`] : [a, b]);

/** Compara `base` com `alvo`. `three` = desde o ancestral comum (`a...b`, o que o alvo introduziu); `two` = entre os dois estados (`a b`). Revisão inválida ou inexistente volta como erro, sem lançar. */
export async function compareRevisions(repoPath: string, base: string, target: string, mode: CompareMode = 'three'): Promise<CompareResult> {
  const [b, t] = await Promise.all([resolveRev(repoPath, base), resolveRev(repoPath, target)]);
  if ('error' in b) return { ok: false, error: b.error };
  if ('error' in t) return { ok: false, error: t.error };
  const list = async (spec: string): Promise<CommitInfo[]> => {
    const r = await runGit(repoPath, ['log', `-n${COMPARE_MAX_COMMITS}`, `--format=${LOG_FORMAT}`, spec, '--'], { check: false });
    return r.code === 0 ? parseLog(r.stdout) : [];
  };
  const count = async (spec: string): Promise<number> => {
    const r = await runGit(repoPath, ['rev-list', '--count', spec, '--'], { check: false });
    return r.code === 0 ? Number(r.stdout.trim()) || 0 : 0;
  };
  const up = `${b.hash}..${t.hash}`;
  const down = `${t.hash}..${b.hash}`;
  const [ahead, behind, aheadCount, behindCount, mb, files] = await Promise.all([
    list(up),
    list(down),
    count(up),
    count(down),
    runGit(repoPath, ['merge-base', b.hash, t.hash], { check: false }),
    fileChanges(repoPath, 'diff', range(mode, b.hash, t.hash)),
  ]);
  return {
    ok: true,
    base: base.trim(),
    target: target.trim(),
    baseHash: b.hash,
    targetHash: t.hash,
    mergeBase: mb.code === 0 ? mb.stdout.trim() || null : null,
    ahead,
    behind,
    aheadCount,
    behindCount,
    files: files.slice(0, COMPARE_MAX_FILES),
    filesTotal: files.length,
    filesTruncated: files.length > COMPARE_MAX_FILES,
    mode,
  };
}

/** O diff de um arquivo da comparação (`oldPath` quando foi renomeado). Passa do limite: vem cortado, com o aviso. */
export async function getCompareFileDiff(repoPath: string, baseHash: string, targetHash: string, mode: CompareMode, file: string, oldPath?: string): Promise<string> {
  for (const h of [baseHash, targetHash]) if (!/^[0-9a-f]{40,64}$/.test(h)) throw new Error(tm(`Hash de commit inválido: ${h}`, `Invalid commit hash: ${h}`));
  const paths = [...new Set([oldPath, file].filter((p): p is string => !!p))];
  for (const p of paths) resolveInsideRepo(repoPath, p);
  const r = await runGit(repoPath, ['diff', '--no-color', '--find-renames', ...range(mode, baseHash, targetHash), '--', ...paths], { check: false });
  if (r.stdout.length <= COMPARE_MAX_DIFF) return r.stdout;
  return r.stdout.slice(0, COMPARE_MAX_DIFF) + '\n' + tm('… (diff cortado: arquivo muito grande)', '… (diff truncated: file too large)') + '\n';
}
