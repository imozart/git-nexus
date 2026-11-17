import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchRepo, pullRepo, runGit, updateRepo } from '../src/index.js';

// "Atualizar" em lote (pullRepo) e o do painel (updateRepo) são o mesmo caminho: mesma regra para alterações locais, mesmos textos.
let root: string;
let remote: string;
let n = 0;
const g = (cwd: string, ...a: string[]) => runGit(cwd, a);
const setup = async (dir: string) => {
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']] as const) await g(dir, 'config', k, v);
};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-pullbatch-'));
  remote = join(root, 'remote.git');
  await runGit(root, ['init', '--bare', '-b', 'main', remote]);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Clone `a` (o que o app atualiza) e clone `other` (outra pessoa) com um arquivo base; o remoto fica um commit à frente em `file`. */
async function scenario(remoteFile: string): Promise<{ a: string; other: string }> {
  const id = ++n;
  const seed = join(root, `seed${id}`);
  await runGit(root, ['-c', 'core.autocrlf=false', 'clone', '-q', remote, seed]);
  await setup(seed);
  writeFileSync(join(seed, 'f.txt'), 'f1\n');
  writeFileSync(join(seed, 'g.txt'), 'g1\n');
  await g(seed, 'add', '.');
  await g(seed, 'commit', '-qm', `base ${id}`);
  await g(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/main', '--force');
  const a = join(root, `a${id}`);
  await runGit(root, ['-c', 'core.autocrlf=false', 'clone', '-q', '-b', 'main', remote, a]);
  await setup(a);
  const other = join(root, `o${id}`);
  await runGit(root, ['-c', 'core.autocrlf=false', 'clone', '-q', '-b', 'main', remote, other]);
  await setup(other);
  writeFileSync(join(other, remoteFile), 'mudou no remoto\n');
  await g(other, 'commit', '-qam', 'remoto mexeu');
  await g(other, 'push', '-q', 'origin', 'main');
  await fetchRepo(a);
  return { a, other };
}

// cada cenário monta remoto + 3 clones: com a suíte inteira rodando em paralelo passa de 30 s, então o teto aqui é maior
describe('pullRepo (lote) = updateRepo (painel)', { timeout: 120_000 }, () => {
  it('com alterações locais em OUTRO arquivo: atualiza e devolve as alterações', async () => {
    const { a } = await scenario('g.txt');
    writeFileSync(join(a, 'f.txt'), 'minha edição\n');
    const r = await pullRepo(a);
    expect(r.ok, r.message).toBe(true);
    expect(r.message).toMatch(/fast-forward/);
    expect(r.message).toMatch(/guardadas e devolvidas/); // o mesmo aviso do painel
    expect(readFileSync(join(a, 'f.txt'), 'utf8')).toBe('minha edição\n');
    expect(readFileSync(join(a, 'g.txt'), 'utf8')).toBe('mudou no remoto\n');
    expect((await g(a, 'stash', 'list')).stdout.trim()).toBe(''); // nada ficou guardado
  });

  it('com alterações no MESMO arquivo: mesmo desfecho e mesmo texto do painel (conflito, alterações guardadas no stash)', async () => {
    const { a } = await scenario('f.txt');
    writeFileSync(join(a, 'f.txt'), 'minha edição\n');
    const batch = await pullRepo(a);
    expect(batch.ok).toBe(false);
    expect(batch.message).toMatch(/conflitaram|stash/i);
    expect((await g(a, 'stash', 'list')).stdout.trim()).not.toBe(''); // nada se perdeu

    // o painel (updateRepo) dá exatamente a mesma resposta no mesmo cenário
    const b = await scenario('f.txt');
    writeFileSync(join(b.a, 'f.txt'), 'minha edição\n');
    const panel = await updateRepo(b.a, 'ff');
    expect({ ok: batch.ok, message: batch.message }).toEqual({ ok: panel.ok, message: panel.message });
  });

  it('recusas que não valem a tentativa continuam: HEAD desanexado e sem upstream', async () => {
    const { a } = await scenario('g.txt');
    await g(a, 'checkout', '-q', '--detach');
    expect((await pullRepo(a)).message).toMatch(/desanexado/);
    await g(a, 'checkout', '-q', '-b', 'solta');
    expect((await pullRepo(a)).message).toMatch(/upstream/);
  });
});
