import { emitGitProgress, progressReader } from './progress.js';
import { NO_PROMPT, getRepoSummary } from './repo-status.js';
import { runGit } from './runner.js';
import { SYNC_COMMITS_LIMIT } from './types/ipc.js';
import type { BaseComparison, BranchActionResult, BranchInfo, BranchList, CreateBranchInput, PullMode, SyncCommit, SyncCommits, SyncResult, UpdateMethod } from './types/ipc.js';
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

/**
 * A branch atual em relação à base do remoto (a mesma que o app usa em "nova branch a partir da mais recente": o `origin/HEAD` ou main/master/develop).
 * Responde "quantos commits estou atrás da main?", que o upstream não responde: branches criadas pelo app não acompanham a main (`--no-track`).
 * `null` quando não se aplica: HEAD desanexado, sem remoto ou sem base, e quando a atual É a base (a main local, ou uma branch que acompanha a
 * própria base: aí o upstream já diz tudo).
 */
export async function compareWithBase(repoPath: string): Promise<BaseComparison | null> {
  const cur = await currentBranch(repoPath);
  if (!cur) return null;
  const remotes = await remoteNames(repoPath);
  if (!remotes.length) return null;
  const refs = await runGit(repoPath, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/remotes'], { check: false });
  const remoteBranches = refs.code === 0 ? parseBranchRefs(refs.stdout, remotes) : [];
  const base = await defaultRemoteBranch(repoPath, remotes, remoteBranches);
  const info = base ? remoteBranches.find((b) => b.name === base) : undefined;
  if (!base || !info) return null;
  const up = await runGit(repoPath, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${cur}`], { check: false });
  if (up.stdout.trim() === base || cur === info.short) return null;
  const counts = await runGit(repoPath, ['rev-list', '--left-right', '--count', `${base}...HEAD`], { check: false });
  const m = /^(\d+)\s+(\d+)/.exec(counts.stdout.trim());
  if (counts.code !== 0 || !m) return null; // sem commits ainda (HEAD sem commit) ou sem histórico em comum legível
  return { base, short: info.short, behind: Number(m[1]), ahead: Number(m[2]) };
}

// ---------------------------------------------------------------- operações

const firstError = (s: string) => {
  const ls = lines(s);
  return (ls.find((l) => /^(error|fatal):/i.test(l)) ?? ls[0] ?? '').replace(/^(error|fatal):\s*/i, '');
};

/** Traduz as falhas mais comuns do git em uma frase que diz o que fazer. */
export function explain(out: string, fallback: string): string {
  if (/would be overwritten|Your local changes|local changes to the following files/i.test(out))
    return tm('Há alterações locais que seriam sobrescritas: faça commit ou guarde (stash) antes.', 'Local changes would be overwritten: commit or stash them first.');
  if (/unmerged files|You have unmerged paths|needs merge/i.test(out)) return tm('Há conflitos a resolver antes.', 'There are conflicts to resolve first.');
  if (/not fully merged/i.test(out)) return tm('A branch tem commits que não estão em nenhuma outra.', 'The branch has commits that are not in any other branch.');
  if (/Authentication failed|could not read Username|Permission denied|Could not resolve host|unable to access/i.test(out))
    return tm('Não consegui falar com o remoto (rede ou credencial).', 'Could not reach the remote (network or credentials).');
  return firstError(out) || fallback;
}

export const hadConflict = (out: string) => /CONFLICT|Automatic merge failed|could not apply|Resolve all conflicts/i.test(out);
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

// ---------------------------------------------------------------- sincronizar com o remoto (painel de sincronização)

/** O upstream (referência completa, ex.: refs/remotes/origin/feat/x) da branch, ou null se não tem. */
async function upstreamRef(repoPath: string, branch: string): Promise<string | null> {
  const r = await runGit(repoPath, ['for-each-ref', '--format=%(upstream)', `refs/heads/${branch}`], { check: false });
  return r.stdout.trim() || null;
}

async function refExists(repoPath: string, ref: string): Promise<boolean> {
  return (await runGit(repoPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { check: false })).code === 0;
}

async function logCommits(repoPath: string, range: string[]): Promise<SyncCommit[]> {
  const r = await runGit(repoPath, ['log', `-n${SYNC_COMMITS_LIMIT}`, `--format=%h%x1f%an%x1f%at%x1f%s%x1e`, ...range], { check: false });
  if (r.code !== 0) return [];
  const out: SyncCommit[] = [];
  for (const rec of r.stdout.split(RS)) {
    const [hash = '', author = '', date = '0', subject = ''] = rec.replace(/^\n+/, '').split(FS);
    if (hash) out.push({ hash, author, date: Number(date), subject });
  }
  return out;
}

/**
 * Os commits que chegam (`HEAD..upstream`) e os que saem (`upstream..HEAD`). Sem upstream (ou com a remota apagada), "os que saem" são os que
 * ainda não existem em nenhum remoto: é o que "Publicar branch" vai enviar.
 */
export async function getSyncCommits(repoPath: string): Promise<SyncCommits> {
  const cur = await currentBranch(repoPath);
  if (!cur) return { incoming: [], outgoing: [] };
  const up = await upstreamRef(repoPath, cur);
  if (up && (await refExists(repoPath, up))) {
    const [incoming, outgoing] = await Promise.all([logCommits(repoPath, [`HEAD..${up}`]), logCommits(repoPath, [`${up}..HEAD`])]);
    return { incoming, outgoing };
  }
  return { incoming: [], outgoing: await logCommits(repoPath, ['HEAD', '--not', '--remotes']) };
}

/** Em qual remoto publicar uma branch sem upstream: o `origin`, ou o único remoto. Mais de um (sem origin) é ambíguo: null. */
function publishRemote(remotes: string[]): string | null {
  if (remotes.includes('origin')) return 'origin';
  return remotes.length === 1 ? remotes[0]! : null;
}

/**
 * Envia a branch atual para o remoto. NUNCA forçado: se o remoto tem commits que a branch não tem, o git recusa e a mensagem manda atualizar antes.
 * Com upstream, envia para a branch dele (mesmo que o nome local seja outro); sem upstream (ou com a remota apagada), publica e cria o upstream.
 */
export async function pushRepo(repoPath: string): Promise<BranchActionResult> {
  const cur = await currentBranch(repoPath);
  if (!cur) return { ok: false, message: tm('HEAD desanexado: crie uma branch antes de enviar.', 'Detached HEAD: create a branch before pushing.') };
  if (!isSafeRef(cur)) return { ok: false, message: tm(`Nome de branch não suportado para enviar: ${cur}`, `Branch name not supported for pushing: ${cur}`) };
  const remotes = await remoteNames(repoPath);
  if (!remotes.length) return { ok: false, message: tm('O repositório não tem remoto configurado.', 'The repository has no remote configured.') };

  const up = await upstreamRef(repoPath, cur);
  const owner = up ? [...remotes].sort((a, b) => b.length - a.length).find((r) => up.startsWith(`refs/remotes/${r}/`)) : undefined;
  const target = owner && up ? { remote: owner, branch: up.slice(`refs/remotes/${owner}/`.length) } : null;
  const remote = target?.remote ?? publishRemote(remotes);
  if (!remote) {
    return {
      ok: false,
      message: tm('Há mais de um remoto e a branch não tem upstream: envie pelo terminal escolhendo o remoto.', 'There is more than one remote and the branch has no upstream: push from the terminal choosing the remote.'),
    };
  }
  const branch = target?.branch ?? cur;
  const publishing = !target || !(await refExists(repoPath, up!));

  const onStderr = progressReader((p) => emitGitProgress({ repoPath, op: 'push', phase: p.phase, percent: p.percent }));
  const args = ['push', '--progress', ...(publishing ? ['-u'] : []), remote, `${cur}:refs/heads/${branch}`];
  const r = await runGit(repoPath, args, { check: false, env: NO_PROMPT, onStderr });
  const out = r.stderr + r.stdout;
  if (r.code === 0) {
    if (/Everything up-to-date/i.test(out)) return { ok: true, message: tm('Nada a enviar: já está em dia.', 'Nothing to push: already up to date.') };
    return {
      ok: true,
      message: publishing ? tm(`Branch '${cur}' publicada em '${remote}'.`, `Branch '${cur}' published to '${remote}'.`) : tm(`Enviado para '${remote}/${branch}'.`, `Pushed to '${remote}/${branch}'.`),
    };
  }
  if (/\[remote rejected\]|pre-receive hook declined|protected branch/i.test(out)) {
    return { ok: false, message: tm(`O remoto recusou o envio: ${firstError(out) || 'regra do servidor'}`, `The remote refused the push: ${firstError(out) || 'server rule'}`) };
  }
  if (/\[rejected\]|non-fast-forward|fetch first|tip of your current branch is behind/i.test(out)) {
    return { ok: false, message: tm('O remoto tem commits que você ainda não tem: atualize a branch antes de enviar.', 'The remote has commits you do not have yet: update the branch before pushing.') };
  }
  return { ok: false, message: explain(out, tm('Não foi possível enviar.', 'Could not push.')) };
}

/** Branches que nunca recebem envio forçado, nem com `--force-with-lease`: o histórico delas é de todo mundo. */
const PROTECTED = /^(main|master|develop|development|trunk|release\/.+)$/;

/**
 * Envio forçado SEGURO (`git push --force-with-lease`), para depois de reescrever o histórico da branch (rebase, amend). Diferente do `--force`,
 * o git recusa se o remoto recebeu commits que esta cópia ainda não viu (ele compara com o valor que a branch remota tinha na última busca,
 * que aqui é passado explicitamente), então ninguém tem o trabalho apagado sem saber. Nunca na branch principal ou de release, nunca sem upstream
 * e nunca com HEAD desanexado. Não faz fetch antes: seria o mesmo que pular a proteção.
 */
export async function pushWithLease(repoPath: string): Promise<BranchActionResult> {
  const cur = await currentBranch(repoPath);
  if (!cur) return { ok: false, message: tm('HEAD desanexado: crie uma branch antes de enviar.', 'Detached HEAD: create a branch before pushing.') };
  if (!isSafeRef(cur)) return { ok: false, message: tm(`Nome de branch não suportado para enviar: ${cur}`, `Branch name not supported for pushing: ${cur}`) };
  const remotes = await remoteNames(repoPath);
  const up = await upstreamRef(repoPath, cur);
  const owner = up ? [...remotes].sort((a, b) => b.length - a.length).find((r) => up.startsWith(`refs/remotes/${r}/`)) : undefined;
  if (!up || !owner || !(await refExists(repoPath, up))) {
    return { ok: false, message: tm('A branch ainda não foi publicada: use o envio normal (Publicar branch). Não há o que forçar.', 'The branch has not been published yet: use the normal push (Publish branch). There is nothing to force.') };
  }
  const branch = up.slice(`refs/remotes/${owner}/`.length);
  const base = (await listBranches(repoPath)).defaultRemoteBranch; // ex.: origin/main
  if (PROTECTED.test(branch) || PROTECTED.test(cur) || (base && base === `${owner}/${branch}`)) {
    return {
      ok: false,
      message: tm(`'${branch}' é uma branch principal: o envio forçado é recusado aqui. Se for mesmo necessário, faça pelo terminal.`, `'${branch}' is a main branch: forced push is refused here. If it is really needed, do it from the terminal.`),
    };
  }
  const expected = (await runGit(repoPath, ['rev-parse', up])).stdout.trim();
  const onStderr = progressReader((p) => emitGitProgress({ repoPath, op: 'push', phase: p.phase, percent: p.percent }));
  const r = await runGit(repoPath, ['push', '--progress', `--force-with-lease=refs/heads/${branch}:${expected}`, owner, `${cur}:refs/heads/${branch}`], { check: false, env: NO_PROMPT, onStderr });
  const out = r.stderr + r.stdout;
  if (r.code === 0) {
    if (/Everything up-to-date/i.test(out)) return { ok: true, message: tm('Nada a enviar: já está em dia.', 'Nothing to push: already up to date.') };
    return { ok: true, message: tm(`Histórico reescrito enviado para '${owner}/${branch}' (com segurança).`, `Rewritten history pushed to '${owner}/${branch}' (safely).`) };
  }
  if (/stale info|\[rejected\].*(stale|fetch first)|remote ref .* (has|is) /i.test(out)) {
    return {
      ok: false,
      message: tm(
        'O remoto recebeu commits que você ainda não viu, então nada foi substituído. Busque do remoto, confira o que chegou e, se ainda fizer sentido, envie de novo.',
        'The remote received commits you have not seen yet, so nothing was replaced. Fetch from the remote, check what arrived and, if it still makes sense, push again.',
      ),
    };
  }
  if (/\[remote rejected\]|pre-receive hook declined|protected branch/i.test(out)) {
    return { ok: false, message: tm(`O remoto recusou o envio: ${firstError(out) || 'regra do servidor'}`, `The remote refused the push: ${firstError(out) || 'server rule'}`) };
  }
  return { ok: false, message: explain(out, tm('Não foi possível enviar.', 'Could not push.')) };
}

/** Há um stash? (o commit do topo, ou null). Serve para saber se `stash push` guardou algo: sem alterações ele não cria nada. */
async function stashTop(repoPath: string): Promise<string | null> {
  const r = await runGit(repoPath, ['rev-parse', '-q', '--verify', 'refs/stash'], { check: false });
  return r.code === 0 ? r.stdout.trim() : null;
}

const STASH_NAME = 'GitNexus: guardado antes de atualizar';

/**
 * Atualiza a branch atual com o upstream, como o "Update" do IntelliJ: **guarda as alterações locais (stash), atualiza e as devolve no fim**.
 * `ff` só avança (recusa se divergiu), `merge` mescla e `rebase` reaplica os commits locais. Conflito não é erro: fica em andamento e o app abre
 * a tela certa. As alterações guardadas nunca se perdem: se a atualização falha antes de mudar algo, voltam na hora; se para por conflito, ou se
 * é a devolução que conflita, continuam no stash e a mensagem diz isso.
 *
 * O stash é feito aqui, e não com `git pull --autostash`, para ter controle do que dizer em cada desfecho (voltou limpo, conflitou, a atualização
 * falhou) e porque o `--autostash` do pull com merge só existe a partir do Git 2.27.
 */
export async function updateRepo(repoPath: string, method: UpdateMethod): Promise<BranchActionResult> {
  const cur = await currentBranch(repoPath);
  if (!cur) return { ok: false, message: tm('HEAD desanexado: nada a atualizar.', 'Detached HEAD: nothing to update.') };
  if (!(await upstreamRef(repoPath, cur))) return { ok: false, message: tm('A branch não tem upstream configurado: publique-a primeiro.', 'The branch has no upstream configured: publish it first.') };

  // 1) guarda as alterações locais (se houver)
  const before = await stashTop(repoPath);
  const pushed = await runGit(repoPath, ['stash', 'push', '-m', STASH_NAME], { check: false });
  if (pushed.code !== 0) return { ok: false, message: explain(pushed.stderr + pushed.stdout, tm('Não foi possível guardar as alterações locais.', 'Could not stash the local changes.')) };
  const stashed = (await stashTop(repoPath)) !== before;

  // 2) atualiza
  const flags = method === 'ff' ? ['--ff-only'] : method === 'merge' ? ['--no-rebase', '--no-edit'] : ['--rebase'];
  const onStderr = progressReader((p) => emitGitProgress({ repoPath, op: 'pull', phase: p.phase, percent: p.percent }));
  const r = await runGit(repoPath, ['pull', '--progress', ...flags], { check: false, env: NO_PROMPT, onStderr });
  const out = r.stderr + r.stdout;

  if (r.code !== 0) {
    if (hadConflict(out)) {
      // merge/rebase parou no meio: não dá para devolver o stash agora; ele fica guardado até a pessoa resolver
      const kept = stashed ? tm(' Suas alterações locais ficaram guardadas no stash: aplique-as depois (git stash pop).', ' Your local changes are saved in the stash: apply them afterwards (git stash pop).') : '';
      return { ok: false, conflicted: true, message: tm('A atualização parou por conflitos: resolva-os na tela de conflitos.', 'The update stopped on conflicts: resolve them in the conflicts view.') + kept };
    }
    const restored = stashed ? await restoreStash(repoPath) : true;
    const why = /not possible to fast-forward|diverging|divergent/i.test(out)
      ? tm('A branch divergiu do remoto: atualize com merge ou com rebase.', 'The branch diverged from the remote: update with a merge or a rebase.')
      : /no such ref was fetched|couldn't find remote ref/i.test(out)
        ? tm('A branch remota foi apagada: publique a branch de novo.', 'The remote branch was deleted: publish the branch again.')
        : explain(out, tm('Não foi possível atualizar.', 'Could not update.'));
    const lost = restored ? '' : tm(' Suas alterações locais continuam no stash (git stash pop).', ' Your local changes are still in the stash (git stash pop).');
    return { ok: false, message: why + lost };
  }

  // 3) devolve as alterações guardadas
  const done = upToDate(out)
    ? tm('Já estava atualizado.', 'Already up to date.')
    : method === 'ff'
      ? tm('Atualizado (fast-forward).', 'Updated (fast-forward).')
      : method === 'merge'
        ? tm('Atualizado com merge.', 'Updated with a merge.')
        : tm('Atualizado com rebase.', 'Updated with a rebase.');
  if (!stashed) return { ok: true, message: done };
  if (await restoreStash(repoPath)) return { ok: true, message: done + tm(' Suas alterações locais foram guardadas e devolvidas.', ' Your local changes were stashed and restored.') };
  return {
    ok: false,
    conflicted: true,
    message: tm(
      'A branch foi atualizada, mas as suas alterações locais conflitaram ao voltar: resolva os conflitos (as alterações também continuam guardadas no stash).',
      'The branch was updated, but your local changes conflicted when coming back: resolve the conflicts (the changes are also still saved in the stash).',
    ),
  };
}

/**
 * "Atualizar" em lote (lista de repositórios): é o MESMO caminho do painel do repositório (`updateRepo` por fast-forward), com a mesma regra
 * de guardar e devolver as alterações locais e os mesmos textos. Antes era um `pull --ff-only` à parte, que falhava com alterações locais.
 * Aqui ficam só as recusas que não valem a pena tentar (HEAD desanexado, sem upstream, conflitos em andamento).
 */
export async function pullRepo(repoPath: string): Promise<SyncResult> {
  const s = await getRepoSummary(repoPath);
  if (s.detached) return { ok: false, message: tm('HEAD desanexado: nada a atualizar.', 'Detached HEAD: nothing to update.') };
  if (!s.upstream) return { ok: false, message: tm('A branch não tem upstream configurado.', 'The branch has no upstream configured.') };
  if (s.conflicted) return { ok: false, message: tm('Há conflitos a resolver antes de atualizar.', 'There are conflicts to resolve before updating.') };
  const r = await updateRepo(repoPath, 'ff');
  return { ok: r.ok, message: r.message };
}

/** Devolve o stash do topo à árvore de trabalho. `true` se voltou limpo (o stash some); `false` se conflitou (o stash continua guardado). */
async function restoreStash(repoPath: string): Promise<boolean> {
  let r = await runGit(repoPath, ['stash', 'pop', '--index'], { check: false });
  // com --index o git tenta repor também o que estava no índice (staged); se isso não der, repõe sem separar staged de não staged
  if (r.code !== 0 && !/CONFLICT/i.test(r.stderr + r.stdout) && (await stashTop(repoPath))) r = await runGit(repoPath, ['stash', 'pop'], { check: false });
  return r.code === 0;
}
