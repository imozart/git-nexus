import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abortOperation, cherryPickCommit, continueOperation, getInProgress, revertCommit, runGit } from '../src/index.js';

let root: string;
let n = 0;
const g = (cwd: string, ...a: string[]) => runGit(cwd, a);
const out = async (cwd: string, ...a: string[]) => (await g(cwd, ...a)).stdout.trim();

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-commitops-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function repo(): Promise<string> {
  const dir = join(root, `r${++n}`);
  await runGit(root, ['init', '-b', 'main', dir]);
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']] as const) await g(dir, 'config', k, v);
  writeFileSync(join(dir, 'a.txt'), 'base\n');
  await g(dir, 'add', '.');
  await g(dir, 'commit', '-qm', 'base');
  return dir;
}
const commitFile = async (dir: string, f: string, c: string, msg: string): Promise<string> => {
  writeFileSync(join(dir, f), c);
  await g(dir, 'add', '.');
  await g(dir, 'commit', '-qm', msg);
  return out(dir, 'rev-parse', 'HEAD');
};

describe('cherry-pick', () => {
  it('aplica o commit de outra branch na atual, com a mesma mensagem e novo hash', async () => {
    const dir = await repo();
    await g(dir, 'checkout', '-q', '-b', 'feature');
    const sha = await commitFile(dir, 'novo.txt', 'novo\n', 'feat: novo arquivo');
    await g(dir, 'checkout', '-q', 'main');
    await commitFile(dir, 'outro.txt', 'x\n', 'feat: algo na main'); // a main andou: o commit novo não é o mesmo
    const r = await cherryPickCommit(dir, sha);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/cherry-pick/);
    expect(readFileSync(join(dir, 'novo.txt'), 'utf8')).toBe('novo\n');
    expect(await out(dir, 'log', '-1', '--format=%s')).toBe('feat: novo arquivo');
    expect(await out(dir, 'rev-parse', 'HEAD')).not.toBe(sha);
    expect(await getInProgress(dir)).toBeNull();
  });

  it('conflito: devolve conflicted, a operação fica em andamento e abortar volta ao estado anterior', async () => {
    const dir = await repo();
    await g(dir, 'checkout', '-q', '-b', 'feature');
    const sha = await commitFile(dir, 'a.txt', 'da feature\n', 'feat: muda a');
    await g(dir, 'checkout', '-q', 'main');
    const antes = await commitFile(dir, 'a.txt', 'da main\n', 'feat: muda a na main');
    const r = await cherryPickCommit(dir, sha);
    expect(r).toMatchObject({ ok: false, conflicted: true });
    expect(await getInProgress(dir)).toBe('cherry-pick');
    // enquanto está parado, outra operação é recusada com explicação
    expect((await revertCommit(dir, antes)).message).toMatch(/andamento/);
    const a = await abortOperation(dir);
    expect(a.ok).toBe(true);
    expect(await getInProgress(dir)).toBeNull();
    expect(await out(dir, 'rev-parse', 'HEAD')).toBe(antes);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('da main\n');
  });

  it('conflito resolvido: continuar cria o commit com a mensagem original', async () => {
    const dir = await repo();
    await g(dir, 'checkout', '-q', '-b', 'feature');
    const sha = await commitFile(dir, 'a.txt', 'da feature\n', 'feat: muda a');
    await g(dir, 'checkout', '-q', 'main');
    await commitFile(dir, 'a.txt', 'da main\n', 'feat: muda a na main');
    await cherryPickCommit(dir, sha);
    expect((await continueOperation(dir)).ok).toBe(false); // ainda com conflito: não deixa continuar
    writeFileSync(join(dir, 'a.txt'), 'resolvido\n');
    await g(dir, 'add', 'a.txt');
    const c = await continueOperation(dir);
    expect(c.ok).toBe(true);
    expect(await getInProgress(dir)).toBeNull();
    expect(await out(dir, 'log', '-1', '--format=%s')).toBe('feat: muda a');
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('resolvido\n');
  });

  it('commit que já está na branch: avisa e não deixa a operação aberta', async () => {
    const dir = await repo();
    const sha = await commitFile(dir, 'b.txt', 'b\n', 'feat: b');
    const r = await cherryPickCommit(dir, sha); // já está no HEAD
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/já estão/);
    expect(await getInProgress(dir)).toBeNull();
  });

  it('commit de merge usa o primeiro pai (-m 1)', async () => {
    const dir = await repo();
    await g(dir, 'checkout', '-q', '-b', 'lado');
    await commitFile(dir, 'lado.txt', 'l\n', 'feat: lado');
    await g(dir, 'checkout', '-q', 'main');
    await commitFile(dir, 'main.txt', 'm\n', 'feat: main');
    await g(dir, 'merge', '--no-ff', '-m', 'merge lado', 'lado');
    const mergeSha = await out(dir, 'rev-parse', 'HEAD');
    await g(dir, 'checkout', '-q', '-b', 'outra', 'main~1'); // antes do merge
    const r = await cherryPickCommit(dir, mergeSha);
    expect(r.ok, r.message).toBe(true);
    expect(existsSync(join(dir, 'lado.txt'))).toBe(true);
  });

  it('hash inválido é recusado antes de rodar qualquer coisa', async () => {
    const dir = await repo();
    await expect(cherryPickCommit(dir, '--abort')).rejects.toThrow(/inválido/i);
    await expect(revertCommit(dir, 'xyz; rm -rf')).rejects.toThrow(/inválido/i);
  });
});

describe('revert', () => {
  it('cria um commit que desfaz o outro, sem reescrever o histórico', async () => {
    const dir = await repo();
    const sha = await commitFile(dir, 'b.txt', 'b\n', 'feat: b');
    const antes = await out(dir, 'rev-list', '--count', 'HEAD');
    const r = await revertCommit(dir, sha);
    expect(r.ok).toBe(true);
    expect(existsSync(join(dir, 'b.txt'))).toBe(false);
    expect(await out(dir, 'rev-list', '--count', 'HEAD')).toBe(String(Number(antes) + 1));
    expect(await out(dir, 'log', '-1', '--format=%s')).toMatch(/^Revert "feat: b"/);
  });

  it('conflito no revert: para, continua depois de resolver', async () => {
    const dir = await repo();
    const sha = await commitFile(dir, 'a.txt', 'v1\n', 'feat: v1');
    await commitFile(dir, 'a.txt', 'v2\n', 'feat: v2');
    const r = await revertCommit(dir, sha);
    expect(r).toMatchObject({ ok: false, conflicted: true });
    expect(await getInProgress(dir)).toBe('revert');
    writeFileSync(join(dir, 'a.txt'), 'v2 ajustado\n');
    await g(dir, 'add', 'a.txt');
    expect((await continueOperation(dir)).ok).toBe(true);
    expect(await getInProgress(dir)).toBeNull();
    expect(await out(dir, 'log', '-1', '--format=%s')).toMatch(/^Revert/);
  });
});

describe('merge parado (mesma API de continuar e abortar)', () => {
  async function mergeConflito(): Promise<{ dir: string; antes: string }> {
    const dir = await repo();
    await g(dir, 'checkout', '-q', '-b', 'outro');
    await commitFile(dir, 'a.txt', 'outro\n', 'outro muda');
    await g(dir, 'checkout', '-q', 'main');
    const antes = await commitFile(dir, 'a.txt', 'main\n', 'main muda');
    await runGit(dir, ['merge', 'outro'], { check: false });
    return { dir, antes };
  }

  it('abortar o merge volta ao estado de antes', async () => {
    const { dir, antes } = await mergeConflito();
    expect(await getInProgress(dir)).toBe('merge');
    expect((await abortOperation(dir)).ok).toBe(true);
    expect(await getInProgress(dir)).toBeNull();
    expect(await out(dir, 'rev-parse', 'HEAD')).toBe(antes);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('main\n');
  });

  it('resolver e continuar conclui o merge com dois pais', async () => {
    const { dir } = await mergeConflito();
    writeFileSync(join(dir, 'a.txt'), 'resolvido\n');
    await g(dir, 'add', 'a.txt');
    expect((await continueOperation(dir)).ok).toBe(true);
    expect(await getInProgress(dir)).toBeNull();
    expect((await out(dir, 'rev-list', '--parents', '-n', '1', 'HEAD')).split(' ').length).toBe(3);
  });
});

describe('sem operação em andamento', () => {
  it('continuar e abortar avisam em vez de falhar', async () => {
    const dir = await repo();
    expect(await getInProgress(dir)).toBeNull();
    expect((await continueOperation(dir)).ok).toBe(false);
    expect((await abortOperation(dir)).message).toMatch(/não há operação/i);
  });
});
