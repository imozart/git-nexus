import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { abortRebase, buildTodo, continueRebase, getRebasePlan, getRebaseState, runGit, skipRebase, startRebase } from '../src/index.js';
import type { RebaseItem } from '../src/index.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const g = (cwd: string, ...a: string[]) => runGit(cwd, a);
async function commit(repo: string, file: string, content: string, msg: string): Promise<string> {
  writeFileSync(join(repo, file), content);
  await g(repo, 'add', '.');
  await g(repo, 'commit', '-m', msg);
  return (await g(repo, 'rev-parse', 'HEAD')).stdout.trim();
}
const subjects = async (repo: string, range = 'HEAD') => (await g(repo, 'log', '--format=%s', range)).stdout.trim().split('\n').reverse();

/** Repositório com `base` e commits c1..c4 em arquivos diferentes. */
async function setup(): Promise<{ repo: string; base: string; c: string[] }> {
  const repo = mkdtempSync(join(tmpdir(), 'gitnexus-rb-'));
  dirs.push(repo);
  await g(repo, 'init', '-b', 'main');
  await g(repo, 'config', 'user.name', 'T');
  await g(repo, 'config', 'user.email', 't@e.com');
  await g(repo, 'config', 'commit.gpgsign', 'false');
  await g(repo, 'config', 'core.autocrlf', 'false');
  const base = await commit(repo, 'base.txt', 'base\n', 'base');
  const c: string[] = [];
  for (let i = 1; i <= 4; i++) c.push(await commit(repo, `f${i}.txt`, `${i}\n`, `c${i}`));
  return { repo, base, c };
}
const items = (c: string[], actions: Array<RebaseItem['action']>, extra: Record<number, string> = {}): RebaseItem[] =>
  c.map((hash, i) => ({ hash, action: actions[i]!, ...(extra[i] ? { message: extra[i] } : {}) }));

describe('buildTodo (puro)', () => {
  const f = (i: number) => `/m/${i}.txt`;
  it('pick/squash/fixup e drop viram linhas do todo', () => {
    const todo = buildTodo(
      [
        { hash: 'a', action: 'pick' },
        { hash: 'b', action: 'squash' },
        { hash: 'c', action: 'drop' },
        { hash: 'd', action: 'fixup' },
        { hash: 'e', action: 'pick' },
      ],
      f,
    );
    expect(todo).toEqual(['pick a', 'squash b', 'fixup d', 'pick e']);
  });

  it('mensagem do grupo vira um commit --amend ao final do grupo', () => {
    const todo = buildTodo(
      [
        { hash: 'a', action: 'pick', message: 'novo' },
        { hash: 'b', action: 'squash' },
        { hash: 'c', action: 'reword', message: 'outro' },
      ],
      f,
    );
    expect(todo).toEqual(['pick a', 'squash b', 'exec git commit --amend -q -F "/m/0.txt"', 'pick c', 'exec git commit --amend -q -F "/m/2.txt"']);
  });
});

describe('plano', () => {
  it('lista do mais antigo para o mais novo e marca os publicados', async () => {
    const { repo, base, c } = await setup();
    const remote = mkdtempSync(join(tmpdir(), 'gitnexus-rb-remote-'));
    dirs.push(remote);
    await runGit(remote, ['init', '--bare', '-b', 'main']);
    await g(repo, 'remote', 'add', 'origin', remote);
    await g(repo, 'push', 'origin', `${c[1]}:refs/heads/main`); // publica até c2
    await g(repo, 'fetch', 'origin');

    const plan = await getRebasePlan(repo, base);
    expect(plan.branch).toBe('main');
    expect(plan.hasMerges).toBe(false);
    expect(plan.commits.map((x) => x.subject)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(plan.commits.map((x) => x.published)).toEqual([true, true, false, false]);
  });

  it('recusa base que não está no histórico e hash inválido', async () => {
    const { repo } = await setup();
    await expect(getRebasePlan(repo, 'deadbeefdeadbeef')).rejects.toThrow(/histórico/);
    await expect(getRebasePlan(repo, 'x; rm')).rejects.toThrow('inválido');
  });
});

describe('rebase interativo (repositório real)', () => {
  it('reordena os commits e guarda um backup', async () => {
    const { repo, base, c } = await setup();
    const before = (await g(repo, 'rev-parse', 'HEAD')).stdout.trim();
    const order = [c[2]!, c[0]!, c[3]!, c[1]!];
    const r = await startRebase(repo, base, order.map((hash) => ({ hash, action: 'pick' as const })));
    expect(r.status).toBe('done');
    expect((await subjects(repo, `${base}..HEAD`))).toEqual(['c3', 'c1', 'c4', 'c2']);
    expect((await g(repo, 'rev-parse', r.backup!)).stdout.trim()).toBe(before); // estado anterior preservado
    expect((await getRebaseState(repo)).inProgress).toBe(false);
  });

  it('squash e fixup juntam commits; a mensagem do grupo pode ser trocada', async () => {
    const { repo, base, c } = await setup();
    const r = await startRebase(repo, base, items(c, ['pick', 'squash', 'pick', 'fixup'], { 0: 'feat: c1 e c2 juntos' }));
    expect(r.status).toBe('done');
    expect(await subjects(repo, `${base}..HEAD`)).toEqual(['feat: c1 e c2 juntos', 'c3']);
    // o conteúdo de todos os commits está lá
    for (const f of ['f1.txt', 'f2.txt', 'f3.txt', 'f4.txt']) expect(existsSync(join(repo, f))).toBe(true);
  });

  it('squash sem mensagem combina as mensagens originais', async () => {
    const { repo, base, c } = await setup();
    await startRebase(repo, base, items(c, ['pick', 'squash', 'pick', 'pick']));
    const body = (await g(repo, 'log', '--format=%B', '--skip=2', '-1')).stdout; // o commit "c1 + c2"
    expect(body).toContain('c1');
    expect(body).toContain('c2');
  });

  it('drop remove o commit e o conteúdo dele; reword troca a mensagem', async () => {
    const { repo, base, c } = await setup();
    const r = await startRebase(repo, base, items(c, ['pick', 'drop', 'reword', 'pick'], { 2: 'fix: terceiro reescrito' }));
    expect(r.status).toBe('done');
    expect(await subjects(repo, `${base}..HEAD`)).toEqual(['c1', 'fix: terceiro reescrito', 'c4']);
    expect(existsSync(join(repo, 'f2.txt'))).toBe(false);
    expect(existsSync(join(repo, 'f3.txt'))).toBe(true);
  });

  it('aceita hashes abreviados', async () => {
    const { repo, base, c } = await setup();
    const r = await startRebase(repo, base.slice(0, 10), c.map((h) => ({ hash: h.slice(0, 9), action: 'pick' as const })).reverse());
    expect(r.status).toBe('done');
    expect(await subjects(repo, `${base}..HEAD`)).toEqual(['c4', 'c3', 'c2', 'c1']);
  });
});

describe('proteções', () => {
  it('recusa árvore suja (mas ignora arquivos não rastreados)', async () => {
    const { repo, base, c } = await setup();
    writeFileSync(join(repo, 'solto.txt'), 'x\n'); // não rastreado: ok
    const picks = c.map((hash) => ({ hash, action: 'pick' as const }));
    writeFileSync(join(repo, 'f1.txt'), 'sujo\n');
    await expect(startRebase(repo, base, picks)).rejects.toThrow(/não commitadas/);
    await g(repo, 'checkout', '--', 'f1.txt');
    expect((await startRebase(repo, base, picks)).status).toBe('done');
  });

  it('valida a lista: primeiro squash, commit faltando, repetido, reword sem mensagem, tudo descartado', async () => {
    const { repo, base, c } = await setup();
    await expect(startRebase(repo, base, items(c, ['squash', 'pick', 'pick', 'pick']))).rejects.toThrow(/primeiro commit mantido/);
    await expect(startRebase(repo, base, items(c.slice(1), ['pick', 'pick', 'pick']))).rejects.toThrow(/todos os commits/);
    await expect(startRebase(repo, base, [...items(c, ['pick', 'pick', 'pick', 'pick']), { hash: c[0]!, action: 'pick' }])).rejects.toThrow(/duas vezes/);
    await expect(startRebase(repo, base, items(c, ['pick', 'reword', 'pick', 'pick']))).rejects.toThrow(/nova mensagem/);
    await expect(startRebase(repo, base, items(c, ['drop', 'drop', 'drop', 'drop']))).rejects.toThrow(/descartados/);
    await expect(startRebase(repo, base, [{ hash: 'abc123def', action: 'pick' }])).rejects.toThrow();
    expect((await subjects(repo, `${base}..HEAD`))).toEqual(['c1', 'c2', 'c3', 'c4']); // nada mudou
  });

  it('recusa histórico com merge', async () => {
    const { repo, base } = await setup();
    await g(repo, 'checkout', '-b', 'lado', base);
    await commit(repo, 'lado.txt', 'l\n', 'lado');
    await g(repo, 'checkout', 'main');
    await g(repo, 'merge', '--no-ff', '-m', 'merge lado', 'lado');
    const plan = await getRebasePlan(repo, base);
    expect(plan.hasMerges).toBe(true);
    await expect(startRebase(repo, base, plan.commits.map((x) => ({ hash: x.hash, action: 'pick' as const })))).rejects.toThrow(/merge/);
  });
});

describe('conflitos', () => {
  async function conflicting() {
    const repo = mkdtempSync(join(tmpdir(), 'gitnexus-rb-conf-'));
    dirs.push(repo);
    await g(repo, 'init', '-b', 'main');
    await g(repo, 'config', 'user.name', 'T');
    await g(repo, 'config', 'user.email', 't@e.com');
    await g(repo, 'config', 'commit.gpgsign', 'false');
    await g(repo, 'config', 'core.autocrlf', 'false');
    const base = await commit(repo, 'x.txt', 'a\nb\nc\n', 'base');
    const c1 = await commit(repo, 'x.txt', 'a\nB1\nc\n', 'c1');
    const c2 = await commit(repo, 'x.txt', 'a\nB2\nc\n', 'c2'); // depende do c1: reordenar conflita
    return { repo, base, c1, c2 };
  }

  it('para no conflito, abortar devolve tudo como estava', async () => {
    const { repo, base, c1, c2 } = await conflicting();
    const before = (await g(repo, 'rev-parse', 'HEAD')).stdout.trim();
    const r = await startRebase(repo, base, [{ hash: c2, action: 'pick' }, { hash: c1, action: 'pick' }]);
    expect(r.status).toBe('stopped');
    expect(r.state).toMatchObject({ inProgress: true, branch: 'main', conflicted: ['x.txt'] });
    await expect(continueRebase(repo)).rejects.toThrow(/conflitos não resolvidos/);
    await expect(startRebase(repo, base, [{ hash: c1, action: 'pick' }, { hash: c2, action: 'pick' }])).rejects.toThrow(/em andamento/);

    const a = await abortRebase(repo);
    expect(a.status).toBe('aborted');
    expect((await g(repo, 'rev-parse', 'HEAD')).stdout.trim()).toBe(before);
    expect((await getRebaseState(repo)).inProgress).toBe(false);
  });

  it('resolve o conflito e continua até o fim', async () => {
    const { repo, base, c1, c2 } = await conflicting();
    const r = await startRebase(repo, base, [{ hash: c2, action: 'pick' }, { hash: c1, action: 'pick' }]);
    expect(r.status).toBe('stopped');
    writeFileSync(join(repo, 'x.txt'), 'a\nB2\nc\n');
    await g(repo, 'add', 'x.txt');
    let n = await continueRebase(repo);
    // o segundo commit também conflita (B1 sobre B2): resolve de novo
    if (n.status === 'stopped') {
      writeFileSync(join(repo, 'x.txt'), 'a\nB1\nc\n');
      await g(repo, 'add', 'x.txt');
      n = await continueRebase(repo);
    }
    expect(n.status).toBe('done');
    expect((await getRebaseState(repo)).inProgress).toBe(false);
    expect(readFileSync(join(repo, 'x.txt'), 'utf8')).toBe('a\nB1\nc\n');
    expect(await subjects(repo, `${base}..HEAD`)).toEqual(['c2', 'c1']);
  });

  it('pular descarta o commit que conflita', async () => {
    const { repo, base, c1, c2 } = await conflicting();
    await startRebase(repo, base, [{ hash: c2, action: 'pick' }, { hash: c1, action: 'pick' }]);
    let s = await skipRebase(repo); // pula c2 (conflitante)
    for (let i = 0; i < 3 && s.status === 'stopped'; i++) s = await skipRebase(repo);
    expect(s.status).toBe('done');
    expect((await getRebaseState(repo)).inProgress).toBe(false);
    await expect(abortRebase(repo)).rejects.toThrow(/Não há rebase/);
  });
});
