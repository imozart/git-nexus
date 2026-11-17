// Submódulos (git submodule): listar com o estado de cada um, inicializar e atualizar. Nada aqui apaga trabalho: atualizar recusa o submódulo
// que tem alterações locais ou commits que não estão no que o repositório registrou (o git deixaria esses commits para trás, soltos).
import { join } from 'node:path';
import { remoteEnv } from './askpass.js';
import { remoteErrorText } from './askpass-pure.js';
import { tm } from './messages.js';
import { runGit } from './runner.js';
import type { BranchActionResult, SubmoduleInfo, SubmoduleState } from './types/ipc.js';

const STATE: Record<string, SubmoduleState> = { '-': 'uninitialized', '+': 'outdated', U: 'conflict', ' ': 'ok' };

/** Lê `git submodule status`: `[-+U ]<sha> <caminho> (<descrição>)`. O prefixo diz o estado; o caminho pode ter espaços. */
export function parseSubmoduleStatus(out: string): Array<{ path: string; sha: string; state: SubmoduleState; describe?: string }> {
  const rows: Array<{ path: string; sha: string; state: SubmoduleState; describe?: string }> = [];
  for (const line of out.split('\n')) {
    const m = /^([ +\-U])([0-9a-f]{40,64}) (.+?)(?: \(([^)]*)\))?\s*$/.exec(line);
    if (!m) continue;
    rows.push({ state: STATE[m[1]!]!, sha: m[2]!, path: m[3]!, ...(m[4] ? { describe: m[4] } : {}) });
  }
  return rows;
}

/** Lê o `.gitmodules` (saída de `git config -z --get-regexp`): nome → caminho, endereço e branch. */
export function parseGitmodules(out: string): Map<string, { path?: string; url?: string; branch?: string }> {
  const byName = new Map<string, { path?: string; url?: string; branch?: string }>();
  for (const rec of out.split('\0')) {
    const nl = rec.indexOf('\n');
    if (nl < 0) continue;
    const key = rec.slice(0, nl);
    const value = rec.slice(nl + 1);
    const m = /^submodule\.(.+)\.(path|url|branch)$/i.exec(key);
    if (!m) continue;
    const cur = byName.get(m[1]!) ?? {};
    cur[m[2]!.toLowerCase() as 'path' | 'url' | 'branch'] = value;
    byName.set(m[1]!, cur);
  }
  return byName;
}

/** O commit que o repositório registra para o submódulo (a entrada "gitlink" do índice). */
async function recordedSha(repoPath: string, path: string): Promise<string | null> {
  const r = await runGit(repoPath, ['ls-files', '-s', '--', path], { check: false });
  const m = /^160000 ([0-9a-f]{40,64}) \d\t/.exec(r.stdout);
  return m ? m[1]! : null;
}

async function isDirty(repoPath: string, path: string): Promise<boolean> {
  const r = await runGit(join(repoPath, path), ['status', '--porcelain'], { check: false });
  return r.code === 0 && r.stdout.trim().length > 0;
}

/** Submódulos do repositório (só o primeiro nível), com o estado de cada um. Vazio se não há `.gitmodules`. */
export async function getSubmodules(repoPath: string): Promise<SubmoduleInfo[]> {
  const st = await runGit(repoPath, ['submodule', 'status'], { check: false });
  if (st.code !== 0) return [];
  const rows = parseSubmoduleStatus(st.stdout);
  if (!rows.length) return [];
  const cfg = await runGit(repoPath, ['config', '-f', '.gitmodules', '-z', '--get-regexp', '^submodule\\..*\\.(path|url|branch)$'], { check: false });
  const byPath = new Map<string, { name: string; url?: string; branch?: string }>();
  for (const [name, c] of parseGitmodules(cfg.code === 0 ? cfg.stdout : '')) if (c.path) byPath.set(c.path, { name, url: c.url, branch: c.branch });
  return Promise.all(
    rows.map(async (r) => {
      const meta = byPath.get(r.path);
      return {
        name: meta?.name ?? r.path,
        path: r.path,
        url: meta?.url ?? '',
        ...(meta?.branch ? { branch: meta.branch } : {}),
        state: r.state,
        sha: r.sha,
        ...(r.describe ? { describe: r.describe } : {}),
        dirty: r.state === 'uninitialized' ? false : await isDirty(repoPath, r.path),
      } satisfies SubmoduleInfo;
    }),
  );
}

/** Só caminhos que são submódulos de verdade: nada que a interface mande vira argumento solto do git. */
async function pick(repoPath: string, paths: string[] | undefined): Promise<{ list: SubmoduleInfo[]; chosen: SubmoduleInfo[] }> {
  const list = await getSubmodules(repoPath);
  if (!paths?.length) return { list, chosen: list };
  const wanted = new Set(paths);
  return { list, chosen: list.filter((s) => wanted.has(s.path)) };
}

const noSubmodules = (): BranchActionResult => ({ ok: false, message: tm('Este repositório não tem submódulos.', 'This repository has no submodules.') });

/** `git submodule update --init --recursive`: baixa os submódulos que ainda não foram inicializados (e os aninhados). */
export async function initSubmodules(repoPath: string, paths?: string[]): Promise<BranchActionResult> {
  const { chosen } = await pick(repoPath, paths);
  if (!chosen.length) return noSubmodules();
  const todo = chosen.filter((s) => s.state === 'uninitialized');
  if (!todo.length) return { ok: true, message: tm('Todos os submódulos já estão inicializados.', 'All submodules are already initialized.') };
  const r = await runGit(repoPath, ['submodule', 'update', '--init', '--recursive', '--', ...todo.map((s) => s.path)], { check: false, env: remoteEnv() });
  if (r.code !== 0) return { ok: false, message: remoteErrorText(r.stderr, tm('Não foi possível inicializar os submódulos.', 'Could not initialize the submodules.')) };
  return { ok: true, message: tm(`Inicializado${todo.length > 1 ? 's' : ''}: ${todo.map((s) => s.path).join(', ')}.`, `Initialized: ${todo.map((s) => s.path).join(', ')}.`) };
}

/** Por que um submódulo NÃO deve ser atualizado agora (ou null se pode). */
async function whyNotUpdate(repoPath: string, s: SubmoduleInfo): Promise<string | null> {
  if (s.state === 'conflict') return tm('tem conflito', 'has a conflict');
  if (s.dirty) return tm('tem alterações locais', 'has local changes');
  if (s.state !== 'outdated') return null;
  const rec = await recordedSha(repoPath, s.path);
  if (!rec) return null;
  const dir = join(repoPath, s.path);
  // o commit registrado ainda não existe aqui: a atualização o busca. Existindo, o commit atual precisa estar nele (senão haveria commits só locais)
  if ((await runGit(dir, ['cat-file', '-e', `${rec}^{commit}`], { check: false })).code !== 0) return null;
  const anc = await runGit(dir, ['merge-base', '--is-ancestor', 'HEAD', rec], { check: false });
  return anc.code === 0 ? null : tm('tem commits que o repositório não registrou', 'has commits the repository has not recorded');
}

/**
 * `git submodule update --recursive`: leva cada submódulo ao commit que o repositório registra (o caso típico: depois de um pull que mudou o
 * registro). Pula, explicando, os que têm alterações locais, conflito ou commits próprios: nada é descartado.
 */
export async function updateSubmodules(repoPath: string, paths?: string[]): Promise<BranchActionResult> {
  const { chosen } = await pick(repoPath, paths);
  if (!chosen.length) return noSubmodules();
  const skipped: string[] = [];
  const todo: SubmoduleInfo[] = [];
  for (const s of chosen) {
    if (s.state === 'uninitialized') continue; // inicializar é outra ação
    if (s.state === 'ok') continue; // já está no commit registrado: não há o que atualizar
    const why = await whyNotUpdate(repoPath, s);
    if (why) skipped.push(`${s.path} (${why})`);
    else todo.push(s);
  }
  const note = skipped.length ? tm(` Não atualizados: ${skipped.join('; ')}.`, ` Not updated: ${skipped.join('; ')}.`) : '';
  if (!todo.length) {
    return { ok: skipped.length === 0, message: (skipped.length ? tm('Nada foi atualizado.', 'Nothing was updated.') : tm('Os submódulos já estão no commit registrado.', 'The submodules are already at the recorded commit.')) + note };
  }
  const r = await runGit(repoPath, ['submodule', 'update', '--recursive', '--', ...todo.map((s) => s.path)], { check: false, env: remoteEnv() });
  if (r.code !== 0) return { ok: false, message: remoteErrorText(r.stderr, tm('Não foi possível atualizar os submódulos.', 'Could not update the submodules.')) + note };
  return { ok: true, message: tm(`Atualizado${todo.length > 1 ? 's' : ''}: ${todo.map((s) => s.path).join(', ')}.`, `Updated: ${todo.map((s) => s.path).join(', ')}.`) + note };
}
