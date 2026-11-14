import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { classify, getOperations, getGitStatus, runGit, undoOperation } from '../src/index.js';

let n = 0;
const created: string[] = [];

async function newRepo(): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), `gitnexus-ops${n++}-`));
  created.push(repo);
  const g = (...a: string[]) => runGit(repo, a);
  await g('init', '-b', 'main');
  await g('config', 'user.name', 'Teste');
  await g('config', 'user.email', 't@e.com');
  await g('config', 'commit.gpgsign', 'false');
  return repo;
}
async function commitFile(repo: string, name: string, content: string, msg: string): Promise<string> {
  writeFileSync(join(repo, name), content);
  await runGit(repo, ['add', '.']);
  await runGit(repo, ['commit', '-m', msg]);
  return (await runGit(repo, ['rev-parse', 'HEAD'])).stdout.trim();
}
const head = async (repo: string) => (await runGit(repo, ['rev-parse', 'HEAD'])).stdout.trim();
const branch = async (repo: string) => (await runGit(repo, ['branch', '--show-current'])).stdout.trim();

afterAll(() => created.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('classify', () => {
  it('reconhece os tipos de entrada do reflog', () => {
    expect(classify('commit: feat: x').kind).toBe('commit');
    expect(classify('commit (initial): init').summary).toBe('Commit inicial: init');
    expect(classify('commit (amend): y').kind).toBe('amend');
    expect(classify('commit (merge): Merge branch x').kind).toBe('merge');
    expect(classify('checkout: moving from main to dev')).toMatchObject({ kind: 'checkout', from: 'main' });
    expect(classify('merge dev: Fast-forward').kind).toBe('merge');
    expect(classify('pull: Fast-forward').kind).toBe('pull');
    expect(classify('reset: moving to HEAD~1').kind).toBe('reset');
    expect(classify('reset: moving to ' + 'a'.repeat(40)).summary).toBe('Reset moving to aaaaaaa');
    expect(classify('rebase (finish): returning to refs/heads/x').kind).toBe('rebase');
    expect(classify('cherry-pick: z').kind).toBe('cherry-pick');
    expect(classify('algo estranho').kind).toBe('other');
  });
});

describe('operações e desfazer (repositório real)', () => {
  it('lista da mais nova para a mais antiga, com o estado anterior', async () => {
    const repo = await newRepo();
    const c1 = await commitFile(repo, 'a.txt', '1\n', 'um');
    const c2 = await commitFile(repo, 'a.txt', '2\n', 'dois');
    const ops = await getOperations(repo);
    expect(ops.map((o) => o.kind)).toEqual(['commit', 'commit']);
    expect(ops[0]).toMatchObject({ hash: c2, prevHash: c1, undoable: true });
    expect(ops[1]!.undoable).toBe(false); // commit inicial: não há estado anterior
  });

  it('desfazer commit devolve as alterações ao stage e é reversível (refazer)', async () => {
    const repo = await newRepo();
    const c1 = await commitFile(repo, 'a.txt', '1\n', 'um');
    const c2 = await commitFile(repo, 'a.txt', '2\n', 'dois');

    const r = await undoOperation(repo, (await getOperations(repo))[0]!.id);
    expect(r.message).toContain('stage');
    expect(await head(repo)).toBe(c1);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('2\n'); // nada se perdeu
    expect((await getGitStatus(repo)).staged).toEqual(['a.txt']);

    // o desfazer virou uma operação "reset" e pode ser desfeito
    const ops = await getOperations(repo);
    expect(ops[0]!.kind).toBe('reset');
    await undoOperation(repo, ops[0]!.id);
    expect(await head(repo)).toBe(c2);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('2\n');
  });

  it('desfazer merge fast-forward volta a branch ao ponto anterior', async () => {
    const repo = await newRepo();
    const c1 = await commitFile(repo, 'a.txt', '1\n', 'um');
    await runGit(repo, ['checkout', '-b', 'dev']);
    const c2 = await commitFile(repo, 'b.txt', 'b\n', 'dois');
    await runGit(repo, ['checkout', 'main']);
    await runGit(repo, ['merge', 'dev']);
    expect(await head(repo)).toBe(c2);

    const ops = await getOperations(repo);
    expect(ops[0]).toMatchObject({ kind: 'merge', undoable: true, prevHash: c1 });
    await undoOperation(repo, ops[0]!.id);
    expect(await head(repo)).toBe(c1);
    expect(await branch(repo)).toBe('main');
  });

  it('troca de branch: só a mais recente pode ser desfeita; operações antes dela ficam bloqueadas', async () => {
    const repo = await newRepo();
    await commitFile(repo, 'a.txt', '1\n', 'um');
    const c2 = await commitFile(repo, 'a.txt', '2\n', 'dois');
    await runGit(repo, ['checkout', '-b', 'dev']);

    let ops = await getOperations(repo);
    expect(ops[0]).toMatchObject({ kind: 'checkout', fromBranch: 'main', undoable: true });
    const blocked = ops.find((o) => o.hash === c2 && o.kind === 'commit')!;
    expect(blocked.id).not.toBe(ops[0]!.id); // mesmo hash, operações diferentes
    expect(blocked.undoable).toBe(false);
    expect(blocked.undoReason).toContain('troca de branch');
    await expect(undoOperation(repo, blocked.id)).rejects.toThrow(/troca de branch/);

    await undoOperation(repo, ops[0]!.id);
    expect(await branch(repo)).toBe('main');
    ops = await getOperations(repo);
    expect(ops[0]!.kind).toBe('checkout'); // o "voltar" também é uma troca
  });

  it('agrupa as entradas de um rebase em uma única operação', async () => {
    const repo = await newRepo();
    await commitFile(repo, 'a.txt', '1\n', 'base');
    await runGit(repo, ['checkout', '-b', 'f']);
    await commitFile(repo, 'f1.txt', 'f1\n', 'f1');
    await commitFile(repo, 'f2.txt', 'f2\n', 'f2');
    await runGit(repo, ['checkout', 'main']);
    await commitFile(repo, 'm.txt', 'm\n', 'm');
    await runGit(repo, ['checkout', 'f']);
    const before = await head(repo);
    await runGit(repo, ['rebase', 'main']);

    const ops = await getOperations(repo);
    expect(ops[0]!.kind).toBe('rebase');
    expect(ops[1]!.kind).not.toBe('rebase');
    expect(ops[0]!.prevHash).toBe(before);
    await undoOperation(repo, ops[0]!.id);
    expect(await head(repo)).toBe(before);
  });

  it('recusa desfazer durante um merge em andamento e com a lista desatualizada', async () => {
    const repo = await newRepo();
    await commitFile(repo, 'a.txt', 'x\n', 'base');
    await runGit(repo, ['checkout', '-b', 'dev']);
    await commitFile(repo, 'a.txt', 'dev\n', 'dev');
    await runGit(repo, ['checkout', 'main']);
    const c3 = await commitFile(repo, 'a.txt', 'main\n', 'main');
    await runGit(repo, ['merge', 'dev'], { check: false }); // termina com conflito (exit 1)
    await expect(undoOperation(repo, (await getOperations(repo))[0]!.id)).rejects.toThrow(/andamento/);
    await runGit(repo, ['merge', '--abort']);
    await expect(undoOperation(repo, '0:deadbeef')).rejects.toThrow(/mudou/);
  });
});
