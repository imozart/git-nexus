import { isAbsolute, relative, resolve } from 'node:path';
import { tm } from './messages.js';

/** Impede acesso fora do repositório (ex.: `../../x`): devolve o caminho absoluto do arquivo, ou lança erro. */
export function resolveInsideRepo(repoPath: string, filePath: string): string {
  const abs = isAbsolute(filePath) ? resolve(filePath) : resolve(repoPath, filePath);
  const rel = relative(resolve(repoPath), abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(tm('Caminho fora do repositório.', 'Path outside the repository.'));
  return abs;
}
