// Busca no conteúdo dos arquivos do repositório (git grep) e o trecho ao redor de uma ocorrência.
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { MAX_PATTERN, parseGrepOutput } from './content-search-pure.js';
import { decodeText, detectEncoding } from './encoding.js';
import { tm } from './messages.js';
import { runGit } from './runner.js';
import type { ContentSearch, ContentSearchResult, FileContext } from './types/ipc.js';

/**
 * `git grep` na árvore de trabalho: arquivos rastreados e os novos ainda não ignorados (`--untracked`), sem binários (`-I`).
 * O texto vai depois de `-e` (um padrão que começa com "-" não vira opção) e os filtros de caminho depois de `--`.
 */
export async function searchContent(repoPath: string, q: ContentSearch): Promise<ContentSearchResult> {
  const pattern = q.pattern;
  if (!pattern.trim()) return { ok: true, matches: [], files: 0, truncated: false };
  if (pattern.length > MAX_PATTERN) return { ok: false, message: tm(`O texto procurado passa de ${MAX_PATTERN} caracteres.`, `The search text is longer than ${MAX_PATTERN} characters.`), matches: [], files: 0, truncated: false };
  const paths = (q.paths ?? '').split(/\s+/).filter(Boolean);
  const args = [
    'grep', '-z', '-n', '-I', '--no-color', '--untracked',
    q.regex ? '--extended-regexp' : '--fixed-strings',
    ...(q.caseSensitive ? [] : ['--ignore-case']),
    ...(q.wholeWord ? ['--word-regexp'] : []),
    '-e', pattern,
    '--', ...paths,
  ];
  const r = await runGit(repoPath, args, { check: false });
  // 0 = achou, 1 = não achou; qualquer outro código é erro (expressão regular inválida, caminho fora do repositório...)
  if (r.code > 1) {
    const detail = r.stderr.trim().split('\n').find((l) => l.trim()) ?? '';
    return { ok: false, message: q.regex ? tm(`Expressão regular inválida: ${detail}`, `Invalid regular expression: ${detail}`) : detail || tm('A busca falhou.', 'The search failed.'), matches: [], files: 0, truncated: false };
  }
  const { matches, truncated } = parseGrepOutput(r.stdout);
  return { ok: true, matches, files: new Set(matches.map((m) => m.file)).size, truncated };
}

/** Quantas linhas mostrar antes e depois da ocorrência, no máximo. */
export const MAX_CONTEXT_RADIUS = 20;

/**
 * As linhas ao redor de `line` (1 = primeira) de um arquivo da árvore de trabalho, na codificação detectada. O caminho tem que ficar DENTRO do
 * repositório: a interface nunca consegue ler outro lugar do disco por aqui.
 */
export async function getFileContext(repoPath: string, file: string, line: number, radius = 6): Promise<FileContext> {
  const root = resolve(repoPath);
  const full = resolve(root, file);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) throw new Error(tm('Arquivo fora do repositório.', 'File outside the repository.'));
  // um atalho (link simbólico) dentro do repositório que aponta para fora também não vale
  const realRel = relative(await realpath(root), await realpath(full));
  if (!realRel || realRel.startsWith('..') || isAbsolute(realRel)) throw new Error(tm('Arquivo fora do repositório.', 'File outside the repository.'));
  const bytes = await readFile(full);
  const text = decodeText(bytes, detectEncoding(bytes)).text;
  const all = text.split(/\r\n|\n|\r/);
  // o fim de linha do último texto não abre uma linha a mais
  if (all.length > 1 && all[all.length - 1] === '') all.pop();
  const r = Math.min(Math.max(0, Math.floor(radius)), MAX_CONTEXT_RADIUS);
  const target = Math.min(Math.max(1, Math.floor(line)), all.length);
  const start = Math.max(1, target - r);
  const end = Math.min(all.length, target + r);
  return { file, line: target, start, lines: all.slice(start - 1, end), total: all.length };
}
