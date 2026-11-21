import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getConflictHistory, runGit } from '../src/index.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const g = (cwd: string, ...a: string[]) => runGit(cwd, a, { check: false });
const lines = (...l: string[]) => l.join('\n') + '\n';

async function conflicted(): Promise<string> {
  const r = mkdtempSync(join(tmpdir(), 'gitnexus-hist-'));
  dirs.push(r);
  await g(r, 'init', '-b', 'main');
  for (const [k, v] of [['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) await g(r, 'config', k!, v!);
  const save = async (name: string, msg: string, content: string) => {
    writeFileSync(join(r, 'f.txt'), content);
    await g(r, 'config', 'user.name', name);
    await g(r, 'add', '-A');
    await g(r, 'commit', '-m', msg);
  };
  await save('Base', 'cria o arquivo', lines('a', 'b', 'c', 'd'));
  await g(r, 'checkout', '-b', 'outro');
  await save('Bia', 'troca o c na origin', lines('a', 'b', 'C-da-origin', 'd'));
  await g(r, 'checkout', 'main');
  await save('Caio', 'troca o c na main', lines('a', 'b', 'c-da-main', 'd'));
  await g(r, 'merge', 'outro');
  return r;
}

describe('histórico do trecho em conflito', () => {
  it('devolve o último commit que mexeu nas linhas, de cada lado', async () => {
    const r = await conflicted();
    const ours = await getConflictHistory(r, 'f.txt', 'ours', 3, 3);
    expect(ours).toMatchObject({ author: 'Caio', subject: 'troca o c na main' });
    expect(ours!.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isNaN(Date.parse(ours!.date))).toBe(false);
    expect(await getConflictHistory(r, 'f.txt', 'theirs', 3, 3)).toMatchObject({ author: 'Bia', subject: 'troca o c na origin' });
  });

  it('trecho que ninguém mexeu desde o começo aponta o commit que criou o arquivo', async () => {
    const r = await conflicted();
    expect(await getConflictHistory(r, 'f.txt', 'ours', 1, 2)).toMatchObject({ author: 'Base', subject: 'cria o arquivo' });
  });

  it('intervalo inválido, fora do arquivo ou sem operação em andamento volta nulo; caminho fora do repositório é recusado', async () => {
    const r = await conflicted();
    expect(await getConflictHistory(r, 'f.txt', 'ours', 0, 2)).toBeNull();
    expect(await getConflictHistory(r, 'f.txt', 'ours', 5, 3)).toBeNull();
    expect(await getConflictHistory(r, 'f.txt', 'ours', 40, 50)).toBeNull();
    await expect(getConflictHistory(r, '../fora.txt', 'ours', 1, 1)).rejects.toThrow();
    await g(r, 'merge', '--abort');
    expect(await getConflictHistory(r, 'f.txt', 'theirs', 3, 3)).toBeNull(); // sem MERGE_HEAD não há "lado que chega"
  });
});
