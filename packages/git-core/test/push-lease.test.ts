import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchRepo, pushRepo, pushWithLease, runGit } from '../src/index.js';

let root: string;
let remote: string;
let n = 0;
const g = (cwd: string, ...a: string[]) => runGit(cwd, a);
const out = async (cwd: string, ...a: string[]) => (await g(cwd, ...a)).stdout.trim();
const config = async (dir: string) => {
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']] as const) await g(dir, 'config', k, v);
};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-lease-'));
  remote = join(root, 'remote.git');
  await runGit(root, ['init', '--bare', '-b', 'main', remote]);
  const seed = join(root, 'seed');
  await runGit(root, ['-c', 'core.autocrlf=false', 'clone', '-q', remote, seed]);
  await config(seed);
  writeFileSync(join(seed, 'a.txt'), 'a\n');
  await g(seed, 'add', '.');
  await g(seed, 'commit', '-qm', 'base');
  await g(seed, 'push', '-q', 'origin', 'HEAD:main');
  await g(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Clone + branch publicada `feat/x` com um commit enviado. */
async function published(): Promise<{ dir: string; branch: string }> {
  const dir = join(root, `c${++n}`);
  await runGit(root, ['-c', 'core.autocrlf=false', 'clone', '-q', '-b', 'main', remote, dir]);
  await config(dir);
  const branch = `feat/x${n}`;
  await g(dir, 'checkout', '-q', '-b', branch);
  writeFileSync(join(dir, 'f.txt'), 'um\n');
  await g(dir, 'add', '.');
  await g(dir, 'commit', '-qm', 'feat: um');
  await g(dir, 'push', '-q', '-u', 'origin', branch);
  return { dir, branch };
}
const remoteHead = (branch: string) => out(remote, 'rev-parse', `refs/heads/${branch}`);

describe('pushWithLease', () => {
  it('depois de reescrever o histórico: o envio normal recusa e o forçado seguro funciona', async () => {
    const { dir, branch } = await published();
    await g(dir, 'commit', '--amend', '-qm', 'feat: um (reescrito)');
    const reescrito = await out(dir, 'rev-parse', 'HEAD');
    expect((await pushRepo(dir)).ok).toBe(false); // o normal nunca força
    expect(await remoteHead(branch)).not.toBe(reescrito);

    const r = await pushWithLease(dir);
    expect(r.ok, r.message).toBe(true);
    expect(r.message).toMatch(/com segurança/);
    expect(await remoteHead(branch)).toBe(reescrito);
  });

  it('se o remoto recebeu commits que esta cópia não viu, RECUSA e não apaga o trabalho de ninguém', async () => {
    const { dir, branch } = await published();
    // outra pessoa envia um commit na mesma branch
    const other = join(root, `o${n}`);
    await runGit(root, ['-c', 'core.autocrlf=false', 'clone', '-q', '-b', branch, remote, other]);
    await config(other);
    writeFileSync(join(other, 'dela.txt'), 'trabalho dela\n');
    await g(other, 'add', '.');
    await g(other, 'commit', '-qm', 'feat: trabalho da outra pessoa');
    await g(other, 'push', '-q', 'origin', branch);
    const delaHead = await out(other, 'rev-parse', 'HEAD');

    await g(dir, 'commit', '--amend', '-qm', 'feat: um (reescrito)'); // sem buscar antes
    const r = await pushWithLease(dir);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/ainda não viu|nada foi substituído/);
    expect(await remoteHead(branch)).toBe(delaHead); // o commit dela continua lá

    // depois de buscar, quem decide enxerga o que vai substituir (a proteção vale para o que NÃO foi visto)
    await fetchRepo(dir);
    expect(await out(dir, 'rev-list', '--count', 'HEAD..@{u}')).toBe('2'); // o commit original (que o amend trocou) e o dela
  });

  it('nunca na branch principal ou de release', async () => {
    const dir = join(root, `c${++n}`);
    await runGit(root, ['-c', 'core.autocrlf=false', 'clone', '-q', '-b', 'main', remote, dir]);
    await config(dir);
    const antes = await remoteHead('main');
    const r = await pushWithLease(dir);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/branch principal/);
    expect(await remoteHead('main')).toBe(antes);

    await g(dir, 'checkout', '-q', '-b', 'release/1.0');
    await g(dir, 'push', '-q', '-u', 'origin', 'release/1.0');
    await g(dir, 'commit', '--amend', '-qm', 'base reescrita');
    expect((await pushWithLease(dir)).message).toMatch(/branch principal/);
  });

  it('sem upstream (não publicada) e com HEAD desanexado: avisa', async () => {
    const dir = join(root, `c${++n}`);
    await runGit(root, ['-c', 'core.autocrlf=false', 'clone', '-q', '-b', 'main', remote, dir]);
    await config(dir);
    await g(dir, 'checkout', '-q', '-b', 'solta');
    expect((await pushWithLease(dir)).message).toMatch(/ainda não foi publicada/);
    await g(dir, 'checkout', '-q', '--detach');
    expect((await pushWithLease(dir)).message).toMatch(/desanexado/);
  });

  it('já em dia: avisa que não há o que enviar', async () => {
    const { dir } = await published();
    const r = await pushWithLease(dir);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/em dia/);
  });
});
