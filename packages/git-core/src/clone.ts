// Clonar um repositório e criar um novo (git clone / git init). O destino é sempre "pasta-mãe + nome": o app nunca escreve fora dela.
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyCloneFailure, cloneFailureMessage, gitignoreContent, isValidBranchName, isValidFolderName, repoNameFromUrl } from './clone-pure.js';
import { tm } from './messages.js';
import { emitGitProgress, progressReader } from './progress.js';
import { NO_PROMPT } from './repo-status.js';
import { runGit } from './runner.js';
import type { CloneInput, InitInput, InitResult } from './types/ipc.js';

async function isDir(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

async function isEmptyDir(path: string): Promise<boolean> {
  return (await readdir(path).catch(() => ['?'])).length === 0;
}

/** A pessoa pode digitar o nome com espaços sobrando; o resto da validação é de `isValidFolderName`. */
function folderName(name: string | undefined, fallback: string): string {
  const n = (name ?? '').trim() || fallback;
  if (!isValidFolderName(n)) throw new Error(tm(`Nome de pasta inválido: "${n}".`, `Invalid folder name: "${n}".`));
  return n;
}

/**
 * `git clone` da URL para `<parentDir>/<name>` (o nome padrão sai da URL). Mostra o andamento (`op: 'clone'`, com o caminho de destino) e, se
 * falhar, apaga a pasta que o próprio clone criou. Nunca pergunta senha: falha de autenticação vira uma mensagem que explica o que configurar.
 * Devolve o caminho do repositório criado.
 */
export async function cloneRepository(input: CloneInput): Promise<{ path: string }> {
  const url = input.url.trim();
  if (!url) throw new Error(tm('Informe o endereço do repositório.', 'Enter the repository address.'));
  // começar com "-" seria lido como opção do git
  if (url.startsWith('-')) throw new Error(tm('Endereço inválido.', 'Invalid address.'));
  const parent = input.parentDir.trim();
  if (!parent || !(await isDir(parent))) throw new Error(tm('A pasta de destino não existe.', 'The destination folder does not exist.'));
  const name = folderName(input.name, repoNameFromUrl(url));
  const branch = input.branch?.trim();
  if (branch && !isValidBranchName(branch)) throw new Error(tm(`Nome de branch inválido: "${branch}".`, `Invalid branch name: "${branch}".`));

  const dest = join(parent, name);
  const existed = await isDir(dest);
  if (existed && !(await isEmptyDir(dest))) throw new Error(cloneFailureMessage('exists', ''));
  if (!existed && (await stat(dest).catch(() => null))) throw new Error(cloneFailureMessage('exists', ''));

  const onStderr = progressReader((p) => emitGitProgress({ repoPath: dest, op: 'clone', phase: p.phase, percent: p.percent }));
  // `protocol.ext.allow=never`: o transporte "ext::" executa comandos e nunca deve valer para um endereço digitado
  // o destino vai como nome relativo, com o git rodando na pasta-mãe (funciona também para pastas do WSL)
  const args = ['-c', 'protocol.ext.allow=never', 'clone', '--progress', ...(branch ? ['--branch', branch] : []), '--', url, name];
  const r = await runGit(parent, args, { check: false, env: NO_PROMPT, onStderr });
  if (r.code !== 0) {
    if (!existed) await rm(dest, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(cloneFailureMessage(classifyCloneFailure(r.stderr), r.stderr));
  }
  return { path: dest };
}

/**
 * `git init` em `<parentDir>/<name>` (cria a pasta; sem nome, usa a própria pasta escolhida). A branch inicial é gravada no HEAD (funciona em
 * qualquer versão do git) e o `.gitignore` do modelo só é escrito se a pasta ainda não tiver um: nunca sobrescreve o da pessoa.
 */
export async function initRepository(input: InitInput): Promise<InitResult> {
  const parent = input.parentDir.trim();
  if (!parent || !(await isDir(parent))) throw new Error(tm('A pasta escolhida não existe.', 'The chosen folder does not exist.'));
  const name = (input.name ?? '').trim();
  const dir = name ? join(parent, folderName(name, '')) : parent;
  const branch = (input.branch ?? '').trim() || 'main';
  if (!isValidBranchName(branch)) throw new Error(tm(`Nome de branch inválido: "${branch}".`, `Invalid branch name: "${branch}".`));
  if (await stat(join(dir, '.git')).catch(() => null)) throw new Error(tm('Essa pasta já é um repositório Git.', 'This folder is already a Git repository.'));

  if (name) await mkdir(dir, { recursive: true });
  await runGit(dir, ['init', '--quiet']);
  await runGit(dir, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);

  let gitignore: InitResult['gitignore'] = 'none';
  const content = gitignoreContent(input.gitignore ?? 'none');
  if (content) {
    const file = join(dir, '.gitignore');
    if (await stat(file).catch(() => null)) gitignore = 'exists';
    else {
      await writeFile(file, content, 'utf8');
      gitignore = 'written';
    }
  }
  return { path: dir, gitignore };
}
