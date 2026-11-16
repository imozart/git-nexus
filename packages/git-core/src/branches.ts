import { NO_PROMPT } from './repo-status.js';
import { runGit } from './runner.js';
import type { BranchActionResult, BranchInfo, BranchList, CreateBranchInput, PullMode } from './types/ipc.js';
import { tm } from './messages.js';

// Branches locais e remotas: listar (com recentes), trocar, criar a partir da versão mais recente, excluir, merge, rebase e pull.
// Operações que podem parar no meio (merge/rebase com conflito) não lançam erro: devolvem `conflicted` e o app leva a pessoa à tela certa.

const RS = '\x1e';
const FS = '\x1f';

/** Referência segura para virar argumento do git: nada que comece com "-" (seria lida como opção) e só caracteres de nome de ref. */
export function isSafeRef(ref: string): boolean {
  return /^[A-Za-z0-9._/@{}^~+#-]+$/.test(ref) && !ref.startsWith('-');
}
function assertRef(ref: string): void {
  if (!isSafeRef(ref)) throw new Error(tm(`Referência inválida: ${ref}`, `Invalid reference: ${ref}`));
}

/** `ahead 2, behind 1` | `ahead 2` | `behind 1` | `gone` | vazio. */
export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  return {
    ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
    gone: /gone/.test(track),
  };
}

/** Saída de `git for-each-ref refs/heads refs/remotes` no formato de `BRANCH_FORMAT`. `remotes` = nomes dos remotos (o nome pode ter "/"). */
export function parseBranchRefs(raw: string, remotes: string[]): BranchInfo[] {
  const byLength = [...remotes].sort((a, b) => b.length - a.length);
  const out: BranchInfo[] = [];
  for (const rec of raw.split(RS)) {
    const [ref = '', hash = '', upstream = '', track = '', date = '0', head = '', symref = '', subject = ''] = rec.replace(/^\n+/, '').split(FS);
    if (!ref) continue;
    const tracking = parseTrack(track);
    if (ref.startsWith('refs/heads/')) {
      const name = ref.slice('refs/heads/'.length);
      out.push({ name, short: name, kind: 'local', current: head === '*', upstream: upstream || null, ...tracking, hash, date: Number(date), subject });
    } else if (ref.startsWith('refs/remotes/')) {
      const full = ref.slice('refs/remotes/'.length);
      if (symref || /\/HEAD$/.test(full)) continue; // origin/HEAD é um apontador, não uma branch
      const remote = byLength.find((r) => full.startsWith(`${r}/`)) ?? full.split('/')[0]!;
      out.push({ name: full, short: full.slice(remote.length + 1), kind: 'remote', remote, current: false, upstream: null, ahead: 0, behind: 0, gone: false, hash, date: Number(date), subject });
    }
  }
  return out;
}

/** Branches visitadas há pouco, da mais recente para a mais antiga, lidas de "checkout: moving from A to B" do reflog. */
export function parseRecentCheckouts(reflogSubjects: string, existing: Set<string>, current: string, limit = 5): string[] {
  const seen = new Set<string>();
  for (const line of reflogSubjects.split('\n')) {
    // Nome de ref do git não tem espaço, então \S+ resolve sem ambiguidade em tempo linear (com (.+) a regex ficava polinomial).
    const m = /^checkout: moving from (\S+) to (\S+)$/.exec(line.trim());
    if (!m) continue;
    for (const name of [m[2]!, m[1]!]) {
      if (name !== current && existing.has(name)) seen.add(name);
      if (seen.size >= limit) return [...seen];
    }
  }
  return [...seen];
}

const BRANCH_FORMAT =
  ['%(refname)', '%(objectname:short)', '%(upstream:short)', '%(upstream:track,nobracket)', '%(committerdate:unix)', '%(HEAD)', '%(symref)', '%(contents:subject)'].join('%1f') + '%1e';

async function remoteNames(repoPath: string): Promise<string[]> {
  const r = await runGit(repoPath, ['remote'], { check: false });
  return r.code === 0
    ? r.stdout
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

/** O remoto padrão e a branch principal dele (origin/main): onde nasce "a versão mais recente". */
async function defaultRemoteBranch(repoPath: string, remotes: string[], remoteBranches: BranchInfo[]): Promise<string | null> {
  for (const remote of remotes) {
    const r = await runGit(repoPath, ['symbolic-ref', '--short', '-q', `refs/remotes/${remote}/HEAD`], { check: false });
    const ref = r.stdout.trim();
    if (r.code === 0 && ref && remoteBranches.some((b) => b.name === ref)) return ref;
  }
  const names = new Set(remoteBranches.map((b) => b.name));
  for (const remote of remotes) for (const base of ['main', 'master', 'develop']) if (names.has(`${remote}/${base}`)) return `${remote}/${base}`;
  return null;
}

const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

export async function listBranches(repoPath: string): Promise<BranchList> {
  const remotes = await remoteNames(repoPath);
  const [refs, sym, head, tags, reflog] = await Promise.all([
    runGit(repoPath, ['for-each-ref', `--format=${BRANCH_FORMAT}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes'], { check: false }),
    runGit(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD'], { check: false }),
    runGit(repoPath, ['rev-parse', '--short', 'HEAD'], { check: false }),
    runGit(repoPath, ['for-each-ref', '--format=%(refname:short)', '--sort=-creatordate', '--count=60', 'refs/tags'], { check: false }),
    runGit(repoPath, ['reflog', '-n', '400', '--format=%gs'], { check: false }),
  ]);
  const all = refs.code === 0 ? parseBranchRefs(refs.stdout, remotes) : [];
  const locals = all.filter((b) => b.kind === 'local');
  const remoteBranches = all.filter((b) => b.kind === 'remote');
  const current = sym.code === 0 ? sym.stdout.trim() : '';
  return {
    current,
    detached: !current,
    head: head.code === 0 ? head.stdout.trim() : '',
    locals: locals.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name)),
    remotes: remoteBranches.sort((a, b) => a.name.localeCompare(b.name)),
    remoteNames: remotes,
    recent: reflog.code === 0 ? parseRecentCheckouts(reflog.stdout, new Set(locals.map((b) => b.name)), current) : [],
    tags: tags.code === 0 ? lines(tags.stdout) : [],
    defaultRemoteBranch: await defaultRemoteBranch(repoPath, remotes, remoteBranches),
  };
}

// ---------------------------------------------------------------- operações

const firstError = (s: string) => {
  const ls = lines(s);
  return (ls.find((l) => /^(error|fatal):/i.test(l)) ?? ls[0] ?? '').replace(/^(error|fatal):\s*/i, '');
};

/** Traduz as falhas mais comuns do git em uma frase que diz o que fazer. */
function explain(out: string, fallback: string): string {
  if (/would be overwritten|Your local changes|local changes to the following files/i.test(out))
    return tm('Há alterações locais que seriam sobrescritas: faça commit ou guarde (stash) antes.', 'Local changes would be overwritten: commit or stash them first.');
  if (/unmerged files|You have unmerged paths|needs merge/i.test(out)) return tm('Há conflitos a resolver antes.', 'There are conflicts to resolve first.');
  if (/not fully merged/i.test(out)) return tm('A branch tem commits que não estão em nenhuma outra.', 'The branch has commits that are not in any other branch.');
  if (/Authentication failed|could not read Username|Permission denied|Could not resolve host|unable to access/i.test(out))
    return tm('Não consegui falar com o remoto (rede ou credencial).', 'Could not reach the remote (network or credentials).');
  return firstError(out) || fallback;
}

const hadConflict = (out: string) => /CONFLICT|Automatic merge failed|could not apply|Resolve all conflicts/i.test(out);
const upToDate = (out: string) => /Already up to date|Already up-to-date|Current branch .* is up to date/i.test(out);

async function currentBranch(repoPath: string): Promise<string> {
  const r = await runGit(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD'], { check: false });
  return r.code === 0 ? r.stdout.trim() : '';
}

async function hasLocal(repoPath: string, name: string): Promise<boolean> {
  return (await runGit(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { check: false })).code === 0;
}

/** Separa "origin/feat/x" em remoto e branch, usando os remotos reais (que podem ter "/"). */
async function splitRemoteRef(repoPath: string, ref: string): Promise<{ remote: string; branch: string } | null> {
  const remotes = (await remoteNames(repoPath)).sort((a, b) => b.length - a.length);
  const remote = remotes.find((r) => ref.startsWith(`${r}/`));
  return remote ? { remote, branch: ref.slice(remote.length + 1) } : null;
}

/** Troca de branch. Para uma remota (origin/x), usa a local de mesmo nome se existir; senão cria uma local que acompanha a remota. */
export async function checkoutBranch(repoPath: string, ref: string, kind: 'local' | 'remote'): Promise<BranchActionResult> {
  assertRef(ref);
  let args: string[];
  let name = ref;
  if (kind === 'remote') {
    const parts = await splitRemoteRef(repoPath, ref);
    if (!parts) return { ok: false, message: tm(`Não encontrei o remoto de ${ref}.`, `Could not find the remote of ${ref}.`) };
    name = parts.branch;
    args = (await hasLocal(repoPath, parts.branch)) ? ['checkout', parts.branch] : ['checkout', '--track', ref];
  } else {
    args = ['checkout', ref];
  }
  const r = await runGit(repoPath, args, { check: false });
  if (r.code !== 0) return { ok: false, message: explain(r.stderr + r.stdout, tm('Não foi possível trocar de branch.', 'Could not switch branches.')) };
  return { ok: true, message: tm(`Agora em '${name}'.`, `Now on '${name}'.`) };
}

/** Vai para uma tag ou commit (HEAD desanexado). */
export async function checkoutRevision(repoPath: string, rev: string): Promise<BranchActionResult> {
  const target = rev.trim();
  if (!target) return { ok: false, message: tm('Informe uma tag ou um commit.', 'Enter a tag or a commit.') };
  assertRef(target);
  const found = await runGit(repoPath, ['rev-parse', '--verify', '--quiet', `${target}^{commit}`], { check: false });
  if (found.code !== 0) return { ok: false, message: tm(`Não encontrei a tag ou o commit '${target}'.`, `Could not find the tag or commit '${target}'.`) };
  const r = await runGit(repoPath, ['checkout', '--detach', target], { check: false });
  if (r.code !== 0) return { ok: false, message: explain(r.stderr + r.stdout, tm('Não foi possível trocar.', 'Could not switch.')) };
  return { ok: true, message: tm(`HEAD desanexado em '${target}'.`, `Detached HEAD at '${target}'.`) };
}

/**
 * Cria uma branch. Com `fetch` e uma base remota (origin/main), busca a base antes: a branch nasce da versão MAIS RECENTE do remoto, não da
 * cópia local que pode estar velha. Nunca configura "acompanhar" (uma branch nova de origin/main não deve dar pull da main).
 */
export async function createBranch(repoPath: string, input: CreateBranchInput): Promise<BranchActionResult> {
  const name = input.name.trim();
  const base = input.base.trim() || 'HEAD';
  if (!name) return { ok: false, message: tm('Informe o nome da branch.', 'Enter the branch name.') };
  const valid = await runGit(repoPath, ['check-ref-format', '--branch', name], { check: false });
  if (valid.code !== 0 || !isSafeRef(name)) return { ok: false, message: tm(`'${name}' não é um nome de branch válido.`, `'${name}' is not a valid branch name.`) };
  if (await hasLocal(repoPath, name)) return { ok: false, message: tm(`Já existe uma branch chamada '${name}'.`, `A branch named '${name}' already exists.`) };
  assertRef(base);

  let warning: string | undefined;
  const remote = input.fetch ? await splitRemoteRef(repoPath, base) : null;
  if (remote) {
    const f = await runGit(repoPath, ['fetch', remote.remote, remote.branch], { check: false, env: NO_PROMPT });
    if (f.code !== 0) {
      warning = tm(`Não consegui buscar '${base}' agora: usei a última cópia local, que pode estar desatualizada.`, `Could not fetch '${base}' now: used the last local copy, which may be out of date.`);
    }
  }
  const exists = await runGit(repoPath, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { check: false });
  if (exists.code !== 0) return { ok: false, message: tm(`Não encontrei '${base}'.`, `Could not find '${base}'.`) };

  const args = input.checkout === false ? ['branch', '--no-track', name, base] : ['checkout', '-b', name, '--no-track', base];
  const r = await runGit(repoPath, args, { check: false });
  if (r.code !== 0) return { ok: false, message: explain(r.stderr + r.stdout, tm('Não foi possível criar a branch.', 'Could not create the branch.')) };
  const from = base === 'HEAD' ? tm('da branch atual', 'from the current branch') : tm(`a partir de '${base}'`, `from '${base}'`);
  return { ok: true, message: tm(`Branch '${name}' criada ${from}.`, `Branch '${name}' created ${from}.`), ...(warning ? { warning } : {}) };
}

/** Exclui uma branch LOCAL (a atual não). Se tiver commits que não estão em outra branch, pede confirmação extra (`needsForce`). */
export async function deleteBranch(repoPath: string, name: string, force = false): Promise<BranchActionResult> {
  assertRef(name);
  if ((await currentBranch(repoPath)) === name) return { ok: false, message: tm('Não dá para excluir a branch atual: troque de branch antes.', 'You cannot delete the current branch: switch first.') };
  const r = await runGit(repoPath, ['branch', force ? '-D' : '-d', name], { check: false });
  if (r.code !== 0) {
    const out = r.stderr + r.stdout;
    if (!force && /not fully merged/i.test(out)) return { ok: false, needsForce: true, message: explain(out, '') };
    return { ok: false, message: explain(out, tm('Não foi possível excluir.', 'Could not delete.')) };
  }
  return { ok: true, message: tm(`Branch '${name}' excluída.`, `Branch '${name}' deleted.`) };
}

/** Traz `ref` para a branch atual (merge). Conflito não é erro: o merge fica em andamento e o app abre a tela de conflitos. */
export async function mergeBranch(repoPath: string, ref: string): Promise<BranchActionResult> {
  assertRef(ref);
  const r = await runGit(repoPath, ['merge', '--no-edit', ref], { check: false });
  const out = r.stderr + r.stdout;
  if (r.code === 0) return { ok: true, message: upToDate(out) ? tm('Já estava atualizado.', 'Already up to date.') : tm(`Merge de '${ref}' concluído.`, `Merged '${ref}'.`) };
  if (hadConflict(out)) {
    return { ok: false, conflicted: true, message: tm(`Merge de '${ref}' parou por conflitos: resolva-os na tela de conflitos.`, `Merging '${ref}' stopped on conflicts: resolve them in the conflicts view.`) };
  }
  return { ok: false, message: explain(out, tm('Não foi possível fazer o merge.', 'Could not merge.')) };
}

/** Reaplica a branch atual sobre `ref`. Reescreve o histórico da branch atual; conflito deixa o rebase em andamento. */
export async function rebaseOntoBranch(repoPath: string, ref: string): Promise<BranchActionResult> {
  assertRef(ref);
  const r = await runGit(repoPath, ['rebase', ref], { check: false });
  const out = r.stderr + r.stdout;
  if (r.code === 0) return { ok: true, message: upToDate(out) ? tm('Já estava atualizado.', 'Already up to date.') : tm(`Rebase sobre '${ref}' concluído.`, `Rebased onto '${ref}'.`) };
  if (hadConflict(out)) {
    return { ok: false, conflicted: true, message: tm(`O rebase sobre '${ref}' parou por conflitos: resolva-os e continue o rebase.`, `Rebasing onto '${ref}' stopped on conflicts: resolve them and continue the rebase.`) };
  }
  return { ok: false, message: explain(out, tm('Não foi possível fazer o rebase.', 'Could not rebase.')) };
}

/** `git pull` de uma branch remota para a atual, com rebase ou merge. */
export async function pullBranch(repoPath: string, remoteRef: string, mode: PullMode): Promise<BranchActionResult> {
  assertRef(remoteRef);
  const parts = await splitRemoteRef(repoPath, remoteRef);
  if (!parts) return { ok: false, message: tm(`Não encontrei o remoto de ${remoteRef}.`, `Could not find the remote of ${remoteRef}.`) };
  const args = ['pull', mode === 'rebase' ? '--rebase' : '--no-rebase', ...(mode === 'merge' ? ['--no-edit'] : []), parts.remote, parts.branch];
  const r = await runGit(repoPath, args, { check: false, env: NO_PROMPT });
  const out = r.stderr + r.stdout;
  if (r.code === 0) return { ok: true, message: upToDate(out) ? tm('Já estava atualizado.', 'Already up to date.') : tm(`Atualizado com '${remoteRef}'.`, `Updated from '${remoteRef}'.`) };
  if (hadConflict(out)) return { ok: false, conflicted: true, message: tm('O pull parou por conflitos: resolva-os na tela de conflitos.', 'The pull stopped on conflicts: resolve them in the conflicts view.') };
  return { ok: false, message: explain(out, tm('Não foi possível atualizar.', 'Could not update.')) };
}
