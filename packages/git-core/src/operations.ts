import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from './runner.js';
import type { GitOperation, OperationKind, UndoResult } from './types/ipc.js';

const FS = '\x1f';
const RS = '\x1e';

interface RawEntry {
  /** Posição no reflog (0 = mais recente). */
  idx: number;
  hash: string;
  /** epoch em segundos (momento em que o reflog registrou a operação). */
  at: number;
  /** Assunto do reflog, ex.: "commit: feat: x" ou "checkout: moving from a to b". */
  gs: string;
}

export function parseReflog(raw: string): RawEntry[] {
  return raw
    .split(RS)
    .map((r) => r.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((rec, idx) => {
      const [hash = '', sel = '', gs = ''] = rec.split(FS);
      return { idx, hash, at: Number(/@\{(\d+)\}/.exec(sel)?.[1] ?? 0), gs };
    });
}

/** Classifica uma linha do reflog em um tipo de operação amigável. */
export function classify(gs: string): { kind: OperationKind; summary: string; from?: string } {
  const m = /^([a-z-]+)(?: \(([^)]*)\))?(?: [^:]*)?: ?(.*)$/i.exec(gs);
  const head = m?.[1] ?? gs;
  const detail = (m?.[3] ?? '').trim();
  if (head === 'commit') {
    const sub = m?.[2] ?? '';
    if (sub === 'amend') return { kind: 'amend', summary: `Amend: ${detail}` };
    if (sub === 'merge') return { kind: 'merge', summary: `Merge: ${detail}` };
    if (sub === 'initial') return { kind: 'commit', summary: `Commit inicial: ${detail}` };
    return { kind: 'commit', summary: `Commit: ${detail}` };
  }
  if (head === 'checkout') {
    const mv = /moving from (\S+) to (\S+)/.exec(gs);
    return { kind: 'checkout', summary: mv ? `Troca de branch: ${mv[1]} → ${mv[2]}` : gs, from: mv?.[1] };
  }
  if (head === 'merge') return { kind: 'merge', summary: `Merge ${gs.slice('merge '.length)}` };
  if (head === 'pull') return { kind: 'pull', summary: `Pull ${detail ? `(${detail})` : ''}`.trim() };
  if (head === 'reset') return { kind: 'reset', summary: `Reset ${gs.slice('reset: '.length).replace(/\b[0-9a-f]{40}\b/g, (h) => h.slice(0, 7))}` };
  if (head === 'rebase') return { kind: 'rebase', summary: 'Rebase' };
  if (head === 'cherry-pick') return { kind: 'cherry-pick', summary: `Cherry-pick: ${detail}` };
  if (head === 'revert') return { kind: 'revert', summary: `Revert: ${detail}` };
  if (head === 'clone') return { kind: 'other', summary: 'Clone' };
  return { kind: 'other', summary: gs };
}

/**
 * Lista as operações recentes (reflog do HEAD), da mais nova para a mais antiga.
 * Entradas consecutivas de um rebase viram UMA operação. Cada operação guarda `prevHash`,
 * o estado do HEAD imediatamente antes dela.
 */
export async function getOperations(repoPath: string, limit = 60): Promise<GitOperation[]> {
  const format = ['%H', '%gd', '%gs'].join('%x1f') + '%x1e';
  const r = await runGit(repoPath, ['reflog', 'show', '--date=unix', `--format=${format}`, `-n${limit + 80}`, 'HEAD'], { check: false });
  if (r.code !== 0) return [];
  const raw = parseReflog(r.stdout);

  // agrupa as entradas de um mesmo rebase
  const groups: RawEntry[][] = [];
  for (const e of raw) {
    const last = groups[groups.length - 1];
    if (last && e.gs.startsWith('rebase') && last[0]!.gs.startsWith('rebase')) last.push(e);
    else groups.push([e]);
  }

  const ops: GitOperation[] = [];
  groups.forEach((g, i) => {
    const newest = g[0]!;
    const info = classify(newest.gs);
    const older = groups[i + 1]?.[0];
    const prevHash = older?.hash;
    ops.push({
      id: `${newest.idx}:${newest.hash.slice(0, 12)}:${newest.at}`,
      hash: newest.hash,
      shortHash: newest.hash.slice(0, 7),
      date: newest.at,
      kind: info.kind,
      summary: info.summary,
      prevHash,
      ...(info.from ? { fromBranch: info.from } : {}),
      undoable: false,
    });
  });

  // regras de desfazer: só vale se não houver troca de branch mais nova (o reflog do HEAD não guarda de qual branch é cada entrada)
  let checkoutNewer = false;
  ops.forEach((op, i) => {
    if (op.kind === 'checkout') {
      op.undoable = i === 0 && !!op.fromBranch; // só a troca mais recente
      op.undoReason = op.undoable ? undefined : 'Só a troca de branch mais recente pode ser desfeita.';
      checkoutNewer = true;
      return;
    }
    if (!op.prevHash) {
      op.undoReason = 'Não há estado anterior para voltar.';
      return;
    }
    if (checkoutNewer) {
      op.undoReason = 'Houve troca de branch depois desta operação.';
      return;
    }
    op.undoable = true;
  });
  return ops.slice(0, limit);
}

/** Merge/rebase/cherry-pick em andamento (desfazer nesse estado só atrapalharia). */
export async function operationInProgress(repoPath: string): Promise<string | null> {
  const r = await runGit(repoPath, ['rev-parse', '--git-dir']);
  const gitDir = r.stdout.trim();
  const abs = (p: string) => (/^([a-z]:|\/|\\\\)/i.test(gitDir) ? join(gitDir, p) : join(repoPath, gitDir, p));
  for (const [file, label] of [
    ['MERGE_HEAD', 'merge'],
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
  ] as const) {
    // Caminhos WSL (UNC) também são legíveis pelo Node no Windows; em caso de dúvida, assume "nada em andamento".
    try {
      if (existsSync(abs(file))) return label;
    } catch {
      /* ignora */
    }
  }
  return null;
}

/**
 * Volta o repositório para o estado ANTERIOR à operação identificada por `id`
 * (e, portanto, também desfaz as operações mais novas). Nada se perde: o próprio desfazer entra
 * no reflog e pode ser desfeito (refazer).
 *  - troca de branch: volta para a branch anterior;
 *  - commit/amend: `reset --soft` (as alterações voltam para o stage);
 *  - demais: `reset --keep` (preserva alterações locais; aborta se houver conflito com elas).
 */
export async function undoOperation(repoPath: string, id: string): Promise<UndoResult> {
  const busy = await operationInProgress(repoPath);
  if (busy) throw new Error(`Há um ${busy} em andamento. Conclua ou aborte antes de desfazer operações.`);
  const ops = await getOperations(repoPath, 200);
  const op = ops.find((o) => o.id === id);
  if (!op) throw new Error('A lista de operações mudou. Atualize e tente de novo.');
  if (!op.undoable) throw new Error(op.undoReason ?? 'Esta operação não pode ser desfeita.');

  if (op.kind === 'checkout') {
    await runGit(repoPath, ['checkout', op.fromBranch!]);
    return { message: `Voltou para a branch ${op.fromBranch}.` };
  }
  const mode = op.kind === 'commit' || op.kind === 'amend' ? '--soft' : '--keep';
  await runGit(repoPath, ['reset', mode, op.prevHash!]);
  return {
    message:
      mode === '--soft'
        ? 'Commit desfeito: as alterações voltaram para o stage.'
        : `Estado anterior restaurado (${op.prevHash!.slice(0, 7)}).`,
  };
}
