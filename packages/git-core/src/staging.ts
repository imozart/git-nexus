import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runGit } from './runner.js';

const MAX_UNTRACKED_BYTES = 200_000;

/**
 * Divide uma lista de caminhos em lotes que cabem na linha de comando: o Windows limita tudo a ~32 mil caracteres,
 * e "incluir tudo" em um repositório com milhares de arquivos passava disso e falhava.
 */
export function chunkPaths(files: string[], maxCount = 400, maxChars = 20_000): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let chars = 0;
  for (const f of files) {
    if (cur.length && (cur.length >= maxCount || chars + f.length + 1 > maxChars)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(f);
    chars += f.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

// `--literal-pathspecs`: os caminhos vêm do status e são nomes exatos; sem isso um arquivo chamado "a[1].txt" ou "*.md"
// seria tratado como padrão (curinga).
export async function stageFiles(repoPath: string, files: string[]): Promise<void> {
  for (const batch of chunkPaths(files)) await runGit(repoPath, ['--literal-pathspecs', 'add', '--', ...batch]);
}

export async function unstageFiles(repoPath: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  // `restore --staged` falha em repositório sem commits; nesse caso usa `rm --cached`.
  const hasHead = (await runGit(repoPath, ['rev-parse', '--verify', 'HEAD'], { check: false })).code === 0;
  for (const batch of chunkPaths(files)) {
    if (hasHead) await runGit(repoPath, ['--literal-pathspecs', 'restore', '--staged', '--', ...batch]);
    else await runGit(repoPath, ['--literal-pathspecs', 'rm', '--cached', '-r', '--', ...batch]);
  }
}

/** `staged`: false = não staged (índice x disco) · true = staged (HEAD x índice) · 'head' = tudo local (HEAD x disco). */
export async function getFileDiff(repoPath: string, file: string, staged: boolean | 'head'): Promise<string> {
  if (staged === 'head') {
    const r = await runGit(repoPath, ['diff', '--no-color', 'HEAD', '--', file], { check: false });
    if (r.code === 0) {
      if (r.stdout) return r.stdout;
    } else {
      // repositório sem commits: mostra o que está no índice
      const cached = await runGit(repoPath, ['diff', '--no-color', '--cached', '--', file], { check: false });
      if (cached.stdout) return cached.stdout;
    }
  } else {
    const { stdout } = await runGit(repoPath, ['diff', '--no-color', ...(staged ? ['--cached'] : []), '--', file]);
    if (stdout || staged) return stdout;
  }

  // Arquivo não rastreado: mostra o conteúdo como adição.
  try {
    const abs = join(repoPath, file);
    const s = await stat(abs);
    if (!s.isFile()) return '';
    if (s.size > MAX_UNTRACKED_BYTES) return `(arquivo novo, ${s.size} bytes — grande demais para pré-visualizar)`;
    const text = await readFile(abs, 'utf8');
    if (text.includes('\0')) return '(arquivo binário novo)';
    return `(arquivo novo, não rastreado)\n` + text.split('\n').map((l) => '+' + l).join('\n');
  } catch {
    return '';
  }
}
