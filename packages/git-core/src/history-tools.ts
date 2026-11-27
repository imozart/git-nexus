import { LOG_FORMAT, parseLog } from './history.js';
import { resolveInsideRepo } from './conflicts.js';
import { runGit } from './runner.js';
import { fileChanges } from './compare.js';
import type { BlameLine, CommitDetail, CommitInfo, CommitRefs, CommitSignature, FileAtRevision, HistorySearch } from './types/ipc.js';
import { tm } from './messages.js';


/** Busca no histórico: mensagem, conteúdo (adição/remoção de um texto ou regex), autor, caminho e período. */
export async function searchHistory(repoPath: string, q: HistorySearch, limit = 300): Promise<CommitInfo[]> {
  const args = ['log', '--all', '--topo-order', `-n${Math.min(Math.max(limit, 1), 2000)}`, `--format=${LOG_FORMAT}`];
  const text = q.text?.trim();
  if (text) {
    if (q.mode === 'content') args.push('-S', text); // commits que adicionam/removem esse texto
    else if (q.mode === 'regex') args.push('-G', text); // linhas alteradas que casam com a regex
    else args.push('--grep', text, '-i', '--fixed-strings');
  }
  if (q.author?.trim()) args.push('--author', q.author.trim());
  if (q.since?.trim()) args.push('--since', q.since.trim());
  if (q.until?.trim()) args.push('--until', q.until.trim());
  if (q.path?.trim()) {
    const p = q.path.trim();
    resolveInsideRepo(repoPath, p);
    args.push('--', p);
  }
  const r = await runGit(repoPath, args, { check: false });
  if (r.code !== 0) {
    if (q.mode === 'regex' && /regex|regular expression/i.test(r.stderr)) throw new Error(tm('Expressão regular inválida.', 'Invalid regular expression.'));
    return [];
  }
  return parseLog(r.stdout);
}

/** Histórico de um arquivo, seguindo renomeações. */
export async function getFileHistory(repoPath: string, file: string, limit = 300): Promise<CommitInfo[]> {
  resolveInsideRepo(repoPath, file);
  const r = await runGit(repoPath, ['log', '--follow', `-n${limit}`, `--format=${LOG_FORMAT}`, '--', file], { check: false });
  return r.code === 0 ? parseLog(r.stdout) : [];
}

/** Arquivos versionados (para o seletor de arquivo). */
export async function listTrackedFiles(repoPath: string): Promise<string[]> {
  const r = await runGit(repoPath, ['ls-files', '-z'], { check: false });
  return r.code === 0 ? r.stdout.split('\0').filter(Boolean) : [];
}

const hex = /^[0-9a-f]{7,40}$/i;
function assertHash(h: string): void {
  if (!hex.test(h)) throw new Error(tm(`Hash de commit inválido: ${h}`, `Invalid commit hash: ${h}`));
}

const SIGNATURE: Record<string, CommitSignature> = { G: 'good', U: 'good', B: 'bad', X: 'bad', Y: 'bad', R: 'bad', E: 'unknown', N: 'none' };

/** Mensagem completa, estado da assinatura e arquivos alterados de um commit (o primeiro pai, em merges), com renomeação (caminho antigo) e contagem +/- por arquivo. */
export async function getCommitDetail(repoPath: string, hash: string): Promise<CommitDetail> {
  assertHash(hash);
  const [head, files] = await Promise.all([runGit(repoPath, ['show', '-s', '--format=%G?%x00%B', hash]), fileChanges(repoPath, 'show', [hash])]);
  const nul = head.stdout.indexOf('\0');
  const flag = nul > 0 ? head.stdout.slice(0, nul).trim() : 'N';
  return { hash, message: (nul >= 0 ? head.stdout.slice(nul + 1) : head.stdout).trim(), files, signature: SIGNATURE[flag] ?? 'none' };
}

/** Os branches e as tags que contêm o commit (sob demanda: em repositório grande o Git leva um instante). */
export async function getCommitRefs(repoPath: string, hash: string, max = 40): Promise<CommitRefs> {
  assertHash(hash);
  const [br, tg] = await Promise.all([
    runGit(repoPath, ['branch', '-a', '--contains', hash, '--format=%(refname:short)'], { check: false }),
    runGit(repoPath, ['tag', '--contains', hash], { check: false }),
  ]);
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter((x) => x && !x.includes('HEAD detached') && !/\/HEAD$/.test(x));
  const branches = lines(br.code === 0 ? br.stdout : '');
  const tags = lines(tg.code === 0 ? tg.stdout : '');
  return { branches: branches.slice(0, max), tags: tags.slice(0, max), truncated: branches.length > max || tags.length > max };
}

export async function getCommitFileDiff(repoPath: string, hash: string, file: string): Promise<string> {
  assertHash(hash);
  resolveInsideRepo(repoPath, file);
  const r = await runGit(repoPath, ['show', '--format=', '--no-color', '-m', '--first-parent', hash, '--', file], { check: false });
  return r.stdout;
}

/** Parse da saída `git blame --porcelain`. */
export function parseBlame(raw: string): BlameLine[] {
  const info = new Map<string, { author: string; date: number; summary: string }>();
  const out: BlameLine[] = [];
  let cur: { hash: string; line: number } | null = null;
  for (const l of raw.split('\n')) {
    const head = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(l);
    if (head && !l.startsWith('\t')) {
      cur = { hash: head[1]!, line: Number(head[2]) };
      if (!info.has(cur.hash)) info.set(cur.hash, { author: '', date: 0, summary: '' });
      continue;
    }
    if (!cur) continue;
    if (l.startsWith('\t')) {
      const meta = info.get(cur.hash)!;
      out.push({ line: cur.line, hash: cur.hash, shortHash: cur.hash.slice(0, 7), author: meta.author, date: meta.date, summary: meta.summary, text: l.slice(1) });
      cur = null;
      continue;
    }
    const meta = info.get(cur.hash)!;
    if (l.startsWith('author ')) meta.author = l.slice(7);
    else if (l.startsWith('author-time ')) meta.date = Number(l.slice(12));
    else if (l.startsWith('summary ')) meta.summary = l.slice(8);
  }
  return out;
}

/** Autoria linha a linha. `rev` opcional (padrão: arquivo no disco, incluindo alterações locais). */
export async function getBlame(repoPath: string, file: string, rev?: string): Promise<BlameLine[]> {
  resolveInsideRepo(repoPath, file);
  const args = ['blame', '--porcelain', '-w'];
  if (rev) {
    assertHash(rev);
    args.push(rev);
  }
  args.push('--', file);
  const r = await runGit(repoPath, args, { check: false });
  if (r.code !== 0) throw new Error(r.stderr.trim() || tm('Não foi possível calcular o blame (arquivo não versionado?).', 'Could not compute the blame (untracked file?).'));
  return parseBlame(r.stdout);
}

/** Um arquivo como estava num commit (para "Arquivo nesta versão" no resultado da busca na história). */
export async function getFileAtRevision(repoPath: string, hash: string, file: string): Promise<FileAtRevision> {
  assertHash(hash);
  resolveInsideRepo(repoPath, file);
  const spec = `${hash}:${file}`;
  const size = await runGit(repoPath, ['cat-file', '-s', spec], { check: false });
  if (size.code !== 0) return { exists: false, text: '', size: 0, tooBig: false, binary: false };
  const bytes = Number(size.stdout.trim()) || 0;
  if (bytes > FILE_AT_MAX) return { exists: true, text: '', size: bytes, tooBig: true, binary: false };
  const r = await runGit(repoPath, ['cat-file', 'blob', spec], { check: false });
  if (r.code !== 0) return { exists: false, text: '', size: 0, tooBig: false, binary: false };
  // um NUL nos primeiros 8000 bytes é binário (a mesma regra do Git)
  if (r.bytes.subarray(0, 8000).includes(0)) return { exists: true, text: '', size: bytes, tooBig: false, binary: true };
  return { exists: true, text: r.stdout.replace(/^\uFEFF/, ''), size: bytes, tooBig: false, binary: false };
}

const FILE_AT_MAX = 2 * 1024 * 1024;
