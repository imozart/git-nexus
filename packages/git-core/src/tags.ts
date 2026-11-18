import { explain } from './branches.js';
import { tm } from './messages.js';
import { runGit } from './runner.js';
import { remoteEnv } from './askpass.js';
import { NO_PROMPT } from './no-prompt.js';
import type { BranchActionResult, CreateTagInput, RemoteTags, TagInfo } from './types/ipc.js';

// Tags: listar, criar (leve ou anotada), apagar (local e remota) e enviar ao remoto. Ir para uma tag é `checkoutRevision`.

const RS = '\x1e';
const FS = '\x1f';

/** Nome de tag que o git aceita (e que não vira opção da linha de comando). */
async function validName(repoPath: string, name: string): Promise<string | null> {
  const n = name.trim();
  if (!n) return tm('Informe o nome da tag.', 'Enter the tag name.');
  if (n.startsWith('-')) return tm('O nome da tag não pode começar com "-".', 'The tag name cannot start with "-".');
  const r = await runGit(repoPath, ['check-ref-format', `refs/tags/${n}`], { check: false });
  return r.code === 0 ? null : tm(`"${n}" não é um nome de tag válido (sem espaços, "..", "~", "^", ":" ou terminar com ".lock").`, `"${n}" is not a valid tag name (no spaces, "..", "~", "^", ":" or ending in ".lock").`);
}

/** Todas as tags locais, da mais nova para a mais antiga. `hash` é sempre o COMMIT para o qual a tag aponta. */
export async function listTags(repoPath: string): Promise<TagInfo[]> {
  const fmt = ['%(refname:short)', '%(objecttype)', '%(*objectname)', '%(objectname)', '%(creatordate:unix)', '%(subject)', '%(taggername)', '%(contents)'].join(FS);
  const r = await runGit(repoPath, ['for-each-ref', '--sort=-creatordate', `--format=${fmt}${RS}`, 'refs/tags'], { check: false });
  if (r.code !== 0) return [];
  return r.stdout
    .split(RS)
    .map((rec) => rec.replace(/^\n/, ''))
    .filter((rec) => rec.trim())
    .map((rec) => {
      const [name = '', type = '', peeled = '', obj = '', date = '0', subject = '', tagger = '', contents = ''] = rec.split(FS);
      const annotated = type === 'tag';
      const out: TagInfo = {
        name,
        hash: annotated ? peeled : obj,
        date: Number(date) || 0,
        subject: subject.trim(),
        annotated,
      };
      if (annotated) {
        if (tagger.trim()) out.tagger = tagger.trim();
        const msg = contents.replace(/-----BEGIN PGP SIGNATURE-----[\s\S]*$/, '').trim();
        if (msg) out.message = msg;
      }
      return out;
    });
}

/** O remoto padrão (origin, ou o primeiro). */
async function defaultRemote(repoPath: string): Promise<string | null> {
  const r = await runGit(repoPath, ['remote'], { check: false });
  const names = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return names.includes('origin') ? 'origin' : (names[0] ?? null);
}

/** Tags que existem no remoto (consulta a rede: pode falhar sem derrubar a tela). */
export async function listRemoteTags(repoPath: string): Promise<RemoteTags> {
  const remote = await defaultRemote(repoPath);
  if (!remote) return { ok: false, remote: '', names: [], message: tm('O repositório não tem remoto.', 'The repository has no remote.') };
  const r = await runGit(repoPath, ['ls-remote', '--tags', '--refs', remote], { check: false, env: NO_PROMPT });
  if (r.code !== 0) return { ok: false, remote, names: [], message: explain(r.stderr + r.stdout, tm('Não foi possível consultar o remoto.', 'Could not query the remote.')) };
  const names = r.stdout
    .split('\n')
    .map((l) => /refs\/tags\/(.+)$/.exec(l.trim())?.[1])
    .filter((n): n is string => !!n);
  return { ok: true, remote, names };
}

/** Cria uma tag. Com `message` é anotada (guarda autor, data e texto); sem, é leve. `target` padrão: o commit atual. */
export async function createTag(repoPath: string, input: CreateTagInput): Promise<BranchActionResult> {
  const bad = await validName(repoPath, input.name);
  if (bad) return { ok: false, message: bad };
  const name = input.name.trim();
  const target = (input.target ?? '').trim() || 'HEAD';
  if (target.startsWith('-')) return { ok: false, message: tm('Destino inválido.', 'Invalid target.') };
  const found = await runGit(repoPath, ['rev-parse', '--verify', '--quiet', `${target}^{commit}`], { check: false });
  if (found.code !== 0) return { ok: false, message: tm(`Não encontrei o commit '${target}'.`, `Could not find commit '${target}'.`) };
  if ((await runGit(repoPath, ['rev-parse', '--verify', '--quiet', `refs/tags/${name}`], { check: false })).code === 0) {
    return { ok: false, message: tm(`Já existe uma tag chamada '${name}'.`, `A tag named '${name}' already exists.`) };
  }
  const message = (input.message ?? '').trim();
  const args = message ? ['tag', '-a', '--cleanup=verbatim', name, target, '-F', '-'] : ['tag', name, target];
  const r = await runGit(repoPath, args, { check: false, ...(message ? { stdin: `${message}\n` } : {}) });
  if (r.code !== 0) {
    const out = r.stderr + r.stdout;
    if (/tell me who you are|unable to auto-detect|auto-detection is disabled|empty ident/i.test(out)) {
      return { ok: false, message: tm('O git não sabe quem você é: configure user.name e user.email para criar uma tag anotada.', 'Git does not know who you are: set user.name and user.email to create an annotated tag.') };
    }
    return { ok: false, message: explain(out, tm('Não foi possível criar a tag.', 'Could not create the tag.')) };
  }
  return { ok: true, message: tm(`Tag '${name}' criada${message ? ' (anotada)' : ''}.`, `Tag '${name}' created${message ? ' (annotated)' : ''}.`) };
}

/** Apaga a tag local; com `remote`, apaga também no remoto (`git push <remote> :refs/tags/<nome>`). */
export async function deleteTag(repoPath: string, name: string, remote = false): Promise<BranchActionResult> {
  const n = name.trim();
  if (!n || n.startsWith('-')) return { ok: false, message: tm('Tag inválida.', 'Invalid tag.') };
  if (remote) {
    const where = await defaultRemote(repoPath);
    if (!where) return { ok: false, message: tm('O repositório não tem remoto.', 'The repository has no remote.') };
    const r = await runGit(repoPath, ['push', where, `:refs/tags/${n}`], { check: false, env: remoteEnv() });
    if (r.code !== 0) return { ok: false, message: explain(r.stderr + r.stdout, tm('Não foi possível apagar a tag no remoto.', 'Could not delete the tag on the remote.')) };
    return { ok: true, message: tm(`Tag '${n}' apagada no remoto (${where}).`, `Tag '${n}' deleted on the remote (${where}).`) };
  }
  const r = await runGit(repoPath, ['tag', '-d', n], { check: false });
  if (r.code !== 0) return { ok: false, message: explain(r.stderr + r.stdout, tm('Não foi possível apagar a tag.', 'Could not delete the tag.')) };
  return { ok: true, message: tm(`Tag '${n}' apagada (só localmente).`, `Tag '${n}' deleted (locally only).`) };
}

/** Envia uma tag (ou todas, sem `name`) ao remoto. Nunca força: se a tag já existe lá com outro commit, o git recusa. */
export async function pushTag(repoPath: string, name?: string): Promise<BranchActionResult> {
  const where = await defaultRemote(repoPath);
  if (!where) return { ok: false, message: tm('O repositório não tem remoto.', 'The repository has no remote.') };
  const n = name?.trim();
  if (n && n.startsWith('-')) return { ok: false, message: tm('Tag inválida.', 'Invalid tag.') };
  const r = await runGit(repoPath, n ? ['push', where, `refs/tags/${n}`] : ['push', where, '--tags'], { check: false, env: remoteEnv() });
  const out = r.stderr + r.stdout;
  if (r.code !== 0) {
    if (/already exists|rejected/i.test(out)) return { ok: false, message: tm('O remoto já tem uma tag com esse nome apontando para outro commit: o envio foi recusado (nada é forçado).', 'The remote already has a tag with that name pointing to another commit: the push was refused (nothing is forced).') };
    return { ok: false, message: explain(out, tm('Não foi possível enviar a tag.', 'Could not push the tag.')) };
  }
  return { ok: true, message: n ? tm(`Tag '${n}' enviada para ${where}.`, `Tag '${n}' pushed to ${where}.`) : tm(`Tags enviadas para ${where}.`, `Tags pushed to ${where}.`) };
}
