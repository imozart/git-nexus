import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunkPaths, getGitStatus, runGit, stageFiles, unstageFiles } from '../src/index.js';

describe('chunkPaths', () => {
  it('respeita o número máximo e o total de caracteres por lote', () => {
    const files = Array.from({ length: 1000 }, (_, i) => `pasta/arquivo-${i}.txt`);
    const batches = chunkPaths(files, 400, 20_000);
    expect(batches.flat()).toEqual(files); // nada se perde nem se reordena
    for (const b of batches) {
      expect(b.length).toBeLessThanOrEqual(400);
      expect(b.join(' ').length).toBeLessThanOrEqual(20_000);
    }
    expect(chunkPaths([])).toEqual([]);
  });

  it('um caminho maior que o limite ainda vai sozinho em um lote', () => {
    expect(chunkPaths(['a'.repeat(50), 'b'], 10, 20)).toEqual([['a'.repeat(50)], ['b']]);
  });
});

describe('stage/unstage de milhares de arquivos (acima do limite da linha de comando)', () => {
  let repo: string;
  const N = 3000;
  const name = (i: number) => `src/modulo-com-nome-bem-longo-${i % 50}/subpasta-longa-${i % 7}/arquivo-com-nome-longo-numero-${i}.txt`;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), 'gitnexus-large-'));
    const g = (...a: string[]) => runGit(repo, a);
    await g('init', '-b', 'main');
    await g('config', 'user.name', 'T');
    await g('config', 'user.email', 't@e.com');
    await g('config', 'core.autocrlf', 'false');
    for (let i = 0; i < 50; i++) for (let j = 0; j < 7; j++) mkdirSync(join(repo, `src/modulo-com-nome-bem-longo-${i}/subpasta-longa-${j}`), { recursive: true });
    for (let i = 0; i < N; i++) writeFileSync(join(repo, name(i)), `${i}\n`);
    // nomes que parecem padrões (curinga)
    writeFileSync(join(repo, 'a[1].txt'), 'x\n');
    writeFileSync(join(repo, 'a1.txt'), 'y\n');
  }, 120_000);
  afterAll(() => rmSync(repo, { recursive: true, force: true }), 120_000);

  it('a lista de caminhos passa de 32 mil caracteres (o que quebrava no Windows)', () => {
    const total = Array.from({ length: N }, (_, i) => name(i)).join(' ').length;
    expect(total).toBeGreaterThan(32_767);
  });

  it('inclui todos no stage e depois tira todos', async () => {
    const files = Array.from({ length: N }, (_, i) => name(i));
    await stageFiles(repo, files);
    let st = await getGitStatus(repo);
    expect(st.entries.filter((e) => e.x === 'A').length).toBe(N);

    await unstageFiles(repo, files);
    st = await getGitStatus(repo);
    expect(st.entries.filter((e) => e.x === 'A').length).toBe(0);
  }, 120_000);

  it('nome com colchetes não vira curinga: só o arquivo exato é incluído', async () => {
    await stageFiles(repo, ['a[1].txt']);
    const staged = (await runGit(repo, ['diff', '--cached', '--name-only'])).stdout.trim().split('\n');
    expect(staged).toEqual(['a[1].txt']); // "a1.txt" casaria com o padrão a[1].txt se fosse tratado como curinga
    await unstageFiles(repo, ['a[1].txt']);
    expect((await runGit(repo, ['diff', '--cached', '--name-only'])).stdout.trim()).toBe('');
  });
});
