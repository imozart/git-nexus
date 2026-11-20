import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getMergeConflicts, reopenConflict, resolveConflictFile, resolvedConflictFiles, runGit } from '../src/index.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const g = (cwd: string, ...a: string[]) => runGit(cwd, a, { check: false });

/** Merge com conflito em a.txt (e b.txt): `main` e `outro` mudam as mesmas linhas. */
async function conflicted(): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), 'gitnexus-reopen-'));
  dirs.push(repo);
  await g(repo, 'init', '-b', 'main');
  await g(repo, 'config', 'user.name', 'T');
  await g(repo, 'config', 'user.email', 't@e.com');
  await g(repo, 'config', 'commit.gpgsign', 'false');
  await g(repo, 'config', 'core.autocrlf', 'false');
  const put = async (a: string, b: string, msg: string) => {
    writeFileSync(join(repo, 'a.txt'), a);
    writeFileSync(join(repo, 'b.txt'), b);
    await g(repo, 'add', '.');
    await g(repo, 'commit', '-m', msg);
  };
  await put('base\n', 'base\n', 'base');
  await g(repo, 'checkout', '-b', 'outro');
  await put('outro\n', 'outro\n', 'outro');
  await g(repo, 'checkout', 'main');
  await put('main\n', 'main\n', 'main');
  await g(repo, 'merge', 'outro');
  return repo;
}

describe('reabrir conflito já resolvido', () => {
  it('lista os resolvidos (com a informação de desfazer do Git) e recria o conflito original', async () => {
    const repo = await conflicted();
    expect(await resolvedConflictFiles(repo)).toEqual([]); // nada resolvido ainda

    expect(await resolveConflictFile(repo, 'a.txt', 'resolvido\n')).toBe(true);
    expect(await resolvedConflictFiles(repo)).toEqual(['a.txt']);
    expect((await getMergeConflicts(repo)).map((c) => c.filePath)).toEqual(['b.txt']);

    expect(await reopenConflict(repo, 'a.txt')).toBe(true);
    const blocks = await getMergeConflicts(repo);
    expect(blocks.map((c) => c.filePath).sort()).toEqual(['a.txt', 'b.txt']);
    const a = blocks.find((c) => c.filePath === 'a.txt')!;
    expect([a.base, a.ours, a.theirs]).toEqual(['base\n', 'main\n', 'outro\n']); // as três versões originais, não a resolução
    expect(a.hasUnresolvedMarkers).toBe(true);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toMatch(/^<{7}/m);
    expect(await resolvedConflictFiles(repo)).toEqual([]);
  });

  it('arquivo que não foi resolvido (ou não existe) não é reaberto, e caminho fora do repositório é recusado', async () => {
    const repo = await conflicted();
    expect(await reopenConflict(repo, 'b.txt')).toBe(false); // ainda em conflito
    expect(await reopenConflict(repo, 'nao-existe.txt')).toBe(false);
    await expect(reopenConflict(repo, '../fora.txt')).rejects.toThrow();
  });

  it('depois que a operação termina não há mais o que reabrir', async () => {
    const repo = await conflicted();
    await resolveConflictFile(repo, 'a.txt', 'um\n');
    await resolveConflictFile(repo, 'b.txt', 'dois\n');
    await g(repo, 'commit', '-m', 'merge');
    expect(await resolvedConflictFiles(repo)).toEqual([]);
    expect(await reopenConflict(repo, 'a.txt')).toBe(false);
  });
});
