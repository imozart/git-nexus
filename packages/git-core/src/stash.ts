import { resolveInsideRepo } from './conflicts.js';
import { runGit } from './runner.js';
import type { StashEntry, StashFile } from './types/ipc.js';

const FS = '\x1f';
const RS = '\x1e';

/** "On main: nome" / "WIP on main: abc1234 assunto" → branch e mensagem. */
export function parseStashSubject(gs: string): { branch: string; message: string; named: boolean } {
  const m = /^(WIP on|On) ([^:]+): ?(.*)$/.exec(gs);
  if (!m) return { branch: '', message: gs, named: false };
  const wip = m[1] === 'WIP on';
  return { branch: m[2]!, message: wip ? m[3]!.replace(/^[0-9a-f]{7,40} /, '') : m[3]!, named: !wip };
}

export async function listStashes(repoPath: string): Promise<StashEntry[]> {
  const format = ['%gd', '%H', '%ct', '%gs'].join('%x1f') + '%x1e';
  const r = await runGit(repoPath, ['stash', 'list', `--format=${format}`], { check: false });
  if (r.code !== 0) return [];
  return r.stdout
    .split(RS)
    .map((x) => x.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((rec, index) => {
      const [ref = '', hash = '', at = '0', gs = ''] = rec.split(FS);
      const p = parseStashSubject(gs);
      return { index, ref, hash, date: Number(at), branch: p.branch, message: p.message, named: p.named };
    });
}

export interface CreateStashOptions {
  message?: string;
  includeUntracked?: boolean;
  /** Mantém no índice o que já está em stage. */
  keepIndex?: boolean;
  /** Guarda só estes caminhos (padrão: tudo). */
  paths?: string[];
}

export async function createStash(repoPath: string, opts: CreateStashOptions = {}): Promise<StashEntry> {
  const args = ['stash', 'push'];
  if (opts.includeUntracked) args.push('--include-untracked');
  if (opts.keepIndex) args.push('--keep-index');
  const msg = opts.message?.trim();
  if (msg) args.push('-m', msg);
  if (opts.paths?.length) {
    for (const p of opts.paths) resolveInsideRepo(repoPath, p.replace(/\/$/, ''));
    args.push('--', ...opts.paths.map((p) => p.replace(/\/$/, '')));
  }
  const r = await runGit(repoPath, args);
  if (/No local changes to save/i.test(r.stdout + r.stderr)) throw new Error('Não há alterações locais para guardar.');
  const [top] = await listStashes(repoPath);
  if (!top) throw new Error('O git não criou o stash.');
  return top;
}

/** Arquivos de um stash: rastreados (`ref^1` x `ref`) e não rastreados (`ref^3`, quando guardados com -u). */
export async function getStashFiles(repoPath: string, ref: string): Promise<StashFile[]> {
  assertRef(ref);
  const files: StashFile[] = [];
  const tracked = await runGit(repoPath, ['diff', '--name-status', '-z', '--no-renames', `${ref}^1`, ref]);
  const parts = tracked.stdout.split('\0').filter(Boolean);
  for (let i = 0; i + 1 < parts.length; i += 2) files.push({ path: parts[i + 1]!, status: parts[i]!.charAt(0), untracked: false });
  const un = await runGit(repoPath, ['ls-tree', '-r', '--name-only', '-z', `${ref}^3`], { check: false });
  if (un.code === 0) for (const p of un.stdout.split('\0').filter(Boolean)) files.push({ path: p, status: 'A', untracked: true });
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function getStashFileDiff(repoPath: string, ref: string, file: string): Promise<string> {
  assertRef(ref);
  const files = await getStashFiles(repoPath, ref);
  const f = files.find((x) => x.path === file);
  if (!f) return '';
  if (f.untracked) {
    const r = await runGit(repoPath, ['show', `${ref}^3:${file}`], { check: false });
    return r.stdout.split('\n').map((l) => `+${l}`).join('\n');
  }
  const r = await runGit(repoPath, ['diff', '--no-color', `${ref}^1`, ref, '--', file]);
  return r.stdout;
}

export interface ApplyResult {
  /** Aplicou com conflitos (o stash é mantido para você resolver e depois excluir). */
  conflicts: boolean;
  message: string;
}

/** Aplica o stash inteiro; `drop` = pop (remove se der certo). */
export async function applyStash(repoPath: string, ref: string, drop = false): Promise<ApplyResult> {
  assertRef(ref);
  const r = await runGit(repoPath, ['stash', drop ? 'pop' : 'apply', '--index', ref], { check: false });
  const out = (r.stdout + r.stderr).trim();
  if (r.code === 0) return { conflicts: false, message: drop ? 'Stash aplicado e removido.' : 'Stash aplicado.' };
  if (/CONFLICT|conflict/i.test(out)) return { conflicts: true, message: 'Aplicado com conflitos: resolva-os na aba Conflitos. O stash foi mantido.' };
  // --index pode falhar quando o índice atual difere; tenta sem ele
  const r2 = await runGit(repoPath, ['stash', drop ? 'pop' : 'apply', ref], { check: false });
  const out2 = (r2.stdout + r2.stderr).trim();
  if (r2.code === 0) return { conflicts: false, message: drop ? 'Stash aplicado e removido.' : 'Stash aplicado.' };
  if (/CONFLICT|conflict/i.test(out2)) return { conflicts: true, message: 'Aplicado com conflitos: resolva-os na aba Conflitos. O stash foi mantido.' };
  throw new Error(out2 || out || 'Não foi possível aplicar o stash.');
}

/**
 * Restauração parcial: traz só os arquivos escolhidos do stash para o disco (sem tocar no resto do stash).
 * Se um arquivo já tem alterações locais, recusa — a menos que `overwrite` seja true.
 */
export async function restoreStashFiles(repoPath: string, ref: string, files: string[], overwrite = false): Promise<void> {
  assertRef(ref);
  if (!files.length) throw new Error('Nenhum arquivo selecionado.');
  const all = await getStashFiles(repoPath, ref);
  const chosen = files.map((f) => {
    const hit = all.find((x) => x.path === f);
    if (!hit) throw new Error(`O arquivo não está no stash: ${f}`);
    resolveInsideRepo(repoPath, f);
    return hit;
  });
  if (!overwrite) {
    const st = await runGit(repoPath, ['status', '--porcelain', '-z', '--', ...chosen.map((c) => c.path)]);
    const dirty = st.stdout.split('\0').filter(Boolean).map((l) => l.slice(3));
    if (dirty.length) throw new Error(`Estes arquivos já têm alterações locais: ${dirty.join(', ')}. Confirme para sobrescrever.`);
  }
  for (const c of chosen) {
    if (c.status === 'D') {
      await runGit(repoPath, ['rm', '-f', '-q', '--', c.path], { check: false }); // o stash removia o arquivo
      continue;
    }
    await runGit(repoPath, ['restore', `--source=${c.untracked ? `${ref}^3` : ref}`, '--worktree', '--', c.path]);
  }
}

export async function dropStash(repoPath: string, ref: string): Promise<void> {
  assertRef(ref);
  await runGit(repoPath, ['stash', 'drop', ref]);
}

/** Renomeia: recria a entrada com a nova mensagem (git não tem "stash rename"). A posição passa a ser a do topo. */
export async function renameStash(repoPath: string, ref: string, message: string): Promise<void> {
  assertRef(ref);
  const msg = message.trim();
  if (!msg) throw new Error('Informe um nome.');
  const hash = (await runGit(repoPath, ['rev-parse', ref])).stdout.trim();
  await runGit(repoPath, ['stash', 'drop', ref]);
  await runGit(repoPath, ['stash', 'store', '-m', msg, hash]);
}

function assertRef(ref: string): void {
  if (!/^stash@\{\d+\}$/.test(ref)) throw new Error(`Referência de stash inválida: ${ref}`);
}
