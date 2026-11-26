// O que o repositório usa, para a visão Ferramentas (#285): LFS e submódulos só aparecem de cara em quem os usa; o resto fica em "Mais ferramentas".
// Tudo é barato (arquivos e, só se há submódulos, um `git submodule status`): a visão consulta isto toda vez que abre.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { lfsPatterns } from './lfs.js';
import { getStashCount } from './repo-status.js';
import { runGit } from './runner.js';
import { getSubmodules } from './submodules.js';
import type { ToolsUsage } from './types/ipc.js';

const hasLfsFilter = async (file: string): Promise<boolean> => {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > 1_000_000) return false;
  return lfsPatterns(await readFile(file, 'utf8').catch(() => '')).length > 0;
};

/** Algum `.gitattributes` (na raiz ou em subpastas) tem `filter=lfs`. A raiz é lida direto; só se ela não decide é que se pergunta ao git pelos de subpastas. */
async function usesLfs(repoPath: string): Promise<boolean> {
  if (await hasLfsFilter(join(repoPath, '.gitattributes'))) return true;
  const r = await runGit(repoPath, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/.gitattributes'], { check: false });
  for (const f of r.stdout.split('\0').filter(Boolean)) if (f !== '.gitattributes' && (await hasLfsFilter(join(repoPath, f)))) return true;
  return false;
}

export async function getToolsUsage(repoPath: string): Promise<ToolsUsage> {
  const [lfs, hasModules, stash] = await Promise.all([
    usesLfs(repoPath).catch(() => false),
    stat(join(repoPath, '.gitmodules')).then((s) => s.isFile(), () => false),
    getStashCount(repoPath).catch(() => 0),
  ]);
  const submodulesPending = hasModules ? (await getSubmodules(repoPath).catch(() => [])).filter((s) => s.state !== 'ok').length : 0;
  return { lfs, submodules: hasModules, submodulesPending, stash };
}
