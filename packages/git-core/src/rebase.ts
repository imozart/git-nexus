import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { parseLog } from './history.js';
import { unmergedFiles } from './conflicts.js';
import { isWslPath } from './wsl.js';
import { runGit } from './runner.js';
import type { RebaseAction, RebaseItem, RebasePlan, RebaseResult, RebaseState } from './types/ipc.js';

const LOG_FORMAT = ['%H', '%P', '%an', '%at', '%D', '%s'].join('%x1f') + '%x1e';
const HASH = /^[0-9a-f]{7,40}$/i;
const ACTIONS: readonly RebaseAction[] = ['pick', 'reword', 'squash', 'fixup', 'drop'];

function assertHash(h: string): void {
  if (!HASH.test(h)) throw new Error(`Hash de commit inválido: ${h}`);
}

function assertLocal(repoPath: string): void {
  if (isWslPath(repoPath)) throw new Error('O rebase interativo ainda não é suportado em repositórios WSL2.');
}

/** Commits que seriam reescritos: de `base` (exclusive) até o HEAD, do mais antigo para o mais novo. */
export async function getRebasePlan(repoPath: string, baseSpec: string): Promise<RebasePlan> {
  let base = baseSpec;
  if (/^HEAD~\d{1,3}$/.test(baseSpec)) {
    const r = await runGit(repoPath, ['rev-parse', '--verify', '-q', baseSpec], { check: false });
    if (r.code !== 0) throw new Error('O histórico tem menos commits do que o pedido (o primeiro commit não pode ser reescrito).');
    base = r.stdout.trim();
  }
  assertHash(base);
  const anc = await runGit(repoPath, ['merge-base', '--is-ancestor', base, 'HEAD'], { check: false });
  if (anc.code !== 0) throw new Error('Esse commit não está no histórico da branch atual.');

  const log = await runGit(repoPath, ['log', '--reverse', `--format=${LOG_FORMAT}`, `${base}..HEAD`]);
  const commits = parseLog(log.stdout);
  // publicados = já alcançáveis por alguma branch remota (reescrevê-los exige push --force)
  const unpub = await runGit(repoPath, ['rev-list', `${base}..HEAD`, '--not', '--remotes'], { check: false });
  const unpublished = new Set(unpub.stdout.split('\n').filter(Boolean));
  const branch = (await runGit(repoPath, ['branch', '--show-current'], { check: false })).stdout.trim();
  return {
    base: (await runGit(repoPath, ['rev-parse', base])).stdout.trim(),
    branch,
    commits: commits.map((c) => ({ ...c, published: !unpublished.has(c.hash) })),
    hasMerges: commits.some((c) => c.parents.length > 1),
  };
}

function gitDirOf(repoPath: string, out: string): string {
  const d = out.trim();
  return isAbsolute(d) ? d : join(repoPath, d);
}

/** Situação do rebase em andamento (se houver). */
export async function getRebaseState(repoPath: string): Promise<RebaseState> {
  const gd = gitDirOf(repoPath, (await runGit(repoPath, ['rev-parse', '--git-dir'])).stdout);
  const dir = join(gd, 'rebase-merge');
  if (!existsSync(dir)) return { inProgress: false, step: 0, total: 0, branch: '', conflicted: [] };
  const read = async (f: string) => (await readFile(join(dir, f), 'utf8').catch(() => '')).trim();
  const [step, total, head] = await Promise.all([read('msgnum'), read('end'), read('head-name')]);
  const conflicted = await unmergedFiles(repoPath);
  return { inProgress: true, step: Number(step) || 0, total: Number(total) || 0, branch: head.replace(/^refs\/heads\//, ''), conflicted };
}

/** Escreve o todo do rebase e os arquivos de mensagem; devolve as linhas. */
export function buildTodo(items: RebaseItem[], msgFile: (i: number) => string): string[] {
  const lines: string[] = [];
  let head = -1; // item que abre o grupo atual (pick/reword) para o qual uma mensagem final se aplica
  const closeGroup = () => {
    if (head >= 0 && items[head]!.message?.trim()) lines.push(`exec git commit --amend -q -F "${msgFile(head)}"`);
    head = -1;
  };
  items.forEach((it, i) => {
    if (it.action === 'drop') return;
    if (it.action === 'squash' || it.action === 'fixup') {
      lines.push(`${it.action} ${it.hash}`);
      return;
    }
    closeGroup();
    lines.push(`pick ${it.hash}`);
    head = i;
  });
  closeGroup();
  return lines;
}

function validate(items: RebaseItem[], plan: RebasePlan): void {
  const known = new Set(plan.commits.map((c) => c.hash));
  const seen = new Set<string>();
  for (const it of items) {
    assertHash(it.hash);
    if (!ACTIONS.includes(it.action)) throw new Error(`Ação inválida: ${it.action}`);
    const full = [...known].find((h) => h === it.hash || h.startsWith(it.hash));
    if (!full) throw new Error(`O commit ${it.hash.slice(0, 7)} não faz parte do rebase.`);
    if (seen.has(full)) throw new Error(`O commit ${it.hash.slice(0, 7)} aparece duas vezes.`);
    seen.add(full);
  }
  if (seen.size !== known.size) throw new Error('A lista não contém todos os commits do plano (use "drop" para descartar um commit).');
  const firstKept = items.find((i) => i.action !== 'drop');
  if (!firstKept) throw new Error('Todos os commits foram descartados; use reset se é isso o que você quer.');
  if (firstKept.action === 'squash' || firstKept.action === 'fixup') throw new Error('O primeiro commit mantido não pode ser squash/fixup: não há commit anterior para juntar.');
  for (const it of items) if (it.action === 'reword' && !it.message?.trim()) throw new Error(`Informe a nova mensagem do commit ${it.hash.slice(0, 7)} (reword).`);
}

/**
 * Executa um rebase interativo com a lista escolhida na interface (reordenar, reword, squash, fixup, drop).
 * Antes de qualquer coisa guarda um backup (`refs/gitnexus/rebase-backup/...`) e exige árvore limpa.
 * Se parar por conflito, devolve `stopped`: resolva e use `continueRebase` (ou `abortRebase`).
 */
export async function startRebase(repoPath: string, base: string, items: RebaseItem[]): Promise<RebaseResult> {
  assertLocal(repoPath);
  const state = await getRebaseState(repoPath);
  if (state.inProgress) throw new Error('Já existe um rebase em andamento. Continue ou aborte antes de começar outro.');
  const dirty = (await runGit(repoPath, ['status', '--porcelain', '--untracked-files=no'])).stdout.trim();
  if (dirty) throw new Error('Há alterações não commitadas. Faça commit ou guarde-as em um stash antes do rebase.');

  const plan = await getRebasePlan(repoPath, base);
  if (plan.hasMerges) throw new Error('O trecho tem commits de merge; o rebase interativo só funciona em histórico linear.');
  if (!plan.branch) throw new Error('HEAD desanexado: troque para uma branch antes do rebase.');
  // aceita hashes abreviados
  const full = new Map(plan.commits.map((c) => [c.hash, c.hash]));
  const norm = items.map((it) => ({ ...it, hash: [...full.keys()].find((h) => h.startsWith(it.hash.toLowerCase())) ?? it.hash }));
  validate(norm, plan);

  // backup: uma referência que mantém o estado anterior vivo (além do reflog)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `refs/gitnexus/rebase-backup/${plan.branch}/${stamp}`;
  await runGit(repoPath, ['update-ref', backup, 'HEAD']);

  const dir = await mkdtemp(join(tmpdir(), 'gitnexus-rebase-'));
  const slash = (p: string) => p.replace(/\\/g, '/');
  try {
    const msgFile = (i: number) => slash(join(dir, `msg-${i}.txt`));
    for (let i = 0; i < norm.length; i++) {
      const m = norm[i]!.message?.trim();
      if (m) await writeFile(join(dir, `msg-${i}.txt`), m + '\n', 'utf8');
    }
    const todo = join(dir, 'todo.txt');
    await writeFile(todo, buildTodo(norm, msgFile).join('\n') + '\n', 'utf8');

    const r = await runGit(
      repoPath,
      ['-c', `sequence.editor=cp "${slash(todo)}"`, '-c', 'core.editor=true', 'rebase', '-i', '--no-autosquash', plan.base],
      { check: false, env: { GIT_EDITOR: 'true' } },
    );
    const after = await getRebaseState(repoPath);
    if (r.code === 0 && !after.inProgress) return { status: 'done', message: 'Rebase concluído.', backup, state: after };
    if (after.inProgress) return { status: 'stopped', message: stoppedMessage(after), backup, state: after };
    // falhou sem deixar rebase em andamento: nada mudou
    throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join('\n') || 'O rebase falhou.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const stoppedMessage = (s: RebaseState) =>
  s.conflicted.length
    ? `Conflito em ${s.conflicted.length} arquivo(s) (passo ${s.step}/${s.total}). Resolva, inclua no commit e continue.`
    : `Rebase parado no passo ${s.step}/${s.total}.`;

async function step(repoPath: string, args: string[]): Promise<RebaseResult> {
  const before = await getRebaseState(repoPath);
  if (!before.inProgress) throw new Error('Não há rebase em andamento.');
  const r = await runGit(repoPath, ['-c', 'core.editor=true', 'rebase', ...args], { check: false, env: { GIT_EDITOR: 'true' } });
  const after = await getRebaseState(repoPath);
  if (!after.inProgress) {
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join('\n'));
    return { status: args[0] === '--abort' ? 'aborted' : 'done', message: args[0] === '--abort' ? 'Rebase abortado: tudo voltou ao estado anterior.' : 'Rebase concluído.', state: after };
  }
  return { status: 'stopped', message: stoppedMessage(after), state: after };
}

/** Continua depois de resolver os conflitos (os arquivos precisam estar no stage). */
export async function continueRebase(repoPath: string): Promise<RebaseResult> {
  const s = await getRebaseState(repoPath);
  if (s.conflicted.length) throw new Error(`Ainda há conflitos não resolvidos: ${s.conflicted.join(', ')}`);
  return step(repoPath, ['--continue']);
}

export const skipRebase = (repoPath: string) => step(repoPath, ['--skip']);
export const abortRebase = (repoPath: string) => step(repoPath, ['--abort']);
