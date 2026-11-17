import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkoutBranch,
  checkoutRevision,
  compareWithBase,
  createBranch,
  deleteBranch,
  isSafeRef,
  listBranches,
  mergeBranch,
  parseBranchRefs,
  parseRecentCheckouts,
  parseTrack,
  pullBranch,
  rebaseOntoBranch,
  runGit,
} from '../src/index.js';

const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 3 })));

const g = (repo: string, ...a: string[]) => runGit(repo, a);
async function config(repo: string): Promise<void> {
  await g(repo, 'config', 'user.name', 'T');
  await g(repo, 'config', 'user.email', 't@e.com');
  await g(repo, 'config', 'commit.gpgsign', 'false');
  await g(repo, 'config', 'core.autocrlf', 'false');
}
async function commitFile(repo: string, file: string, text: string, msg: string): Promise<void> {
  writeFileSync(join(repo, file), text);
  await g(repo, 'add', '.');
  await g(repo, 'commit', '-m', msg);
}

/** Um remoto (bare) com a main, e um clone com o origin configurado. */
async function withRemote(): Promise<{ repo: string; remote: string; other: string }> {
  const remote = tmp('gn-br-remote-');
  await runGit(remote, ['init', '--bare', '-b', 'main']);
  const repo = tmp('gn-br-repo-');
  await g(repo, 'init', '-b', 'main');
  await config(repo);
  await g(repo, 'remote', 'add', 'origin', remote);
  await commitFile(repo, 'a.txt', 'um\n', 'init');
  await g(repo, 'push', '-u', 'origin', 'main');
  await g(repo, 'remote', 'set-head', 'origin', 'main');
  // outra pessoa que publica coisas no remoto
  const other = tmp('gn-br-other-');
  await runGit(other, ['clone', remote, '.']);
  await config(other);
  return { repo, remote, other };
}

describe('puros', () => {
  it('parseTrack lê adiante/atrás e "gone"', () => {
    expect(parseTrack('ahead 2, behind 1')).toEqual({ ahead: 2, behind: 1, gone: false });
    expect(parseTrack('behind 3')).toEqual({ ahead: 0, behind: 3, gone: false });
    expect(parseTrack('gone')).toEqual({ ahead: 0, behind: 0, gone: true });
    expect(parseTrack('')).toEqual({ ahead: 0, behind: 0, gone: false });
  });

  it('parseBranchRefs separa locais de remotas, ignora origin/HEAD e entende remoto com "/"', () => {
    const rec = (...f: string[]) => f.join('\x1f') + '\x1e';
    const raw =
      rec('refs/heads/feat/x', 'abc1234', 'origin/feat/x', 'ahead 1', '1700000000', '*', '', 'assunto') +
      rec('refs/remotes/origin/HEAD', 'abc1234', '', '', '1700000000', ' ', 'refs/remotes/origin/main', 'x') +
      rec('refs/remotes/origin/main', 'def5678', '', '', '1700000100', ' ', '', 'principal') +
      rec('refs/remotes/my/fork/feat/y', '0123456', '', '', '1700000200', ' ', '', 'y');
    const list = parseBranchRefs(raw, ['origin', 'my/fork']);
    expect(list.map((b) => [b.kind, b.name, b.short, b.remote ?? null])).toEqual([
      ['local', 'feat/x', 'feat/x', null],
      ['remote', 'origin/main', 'main', 'origin'],
      ['remote', 'my/fork/feat/y', 'feat/y', 'my/fork'],
    ]);
    expect(list[0]).toMatchObject({ current: true, upstream: 'origin/feat/x', ahead: 1, behind: 0 });
  });

  it('parseRecentCheckouts: mais recente primeiro, sem a atual, sem repetir e só branches que existem', () => {
    const reflog = ['checkout: moving from b to a', 'commit: x', 'checkout: moving from c to b', 'checkout: moving from a to c', 'checkout: moving from main to gone'].join('\n');
    expect(parseRecentCheckouts(reflog, new Set(['a', 'b', 'c', 'main']), 'a')).toEqual(['b', 'c', 'main']);
    expect(parseRecentCheckouts(reflog, new Set(['a', 'b', 'c', 'main']), 'a', 2)).toEqual(['b', 'c']);
  });

  it('parseRecentCheckouts roda em tempo linear com linhas patológicas (sem ReDoS)', () => {
    const hostile = 'checkout: moving from a to ' + 'a to '.repeat(20000) + '!';
    const t0 = Date.now();
    expect(parseRecentCheckouts(hostile, new Set(['a']), 'x')).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('isSafeRef recusa o que viraria opção do git', () => {
    expect(isSafeRef('feat/x-1')).toBe(true);
    expect(isSafeRef('origin/feat/x')).toBe(true);
    expect(isSafeRef('--upload-pack=calc')).toBe(false);
    expect(isSafeRef('a b')).toBe(false);
    expect(isSafeRef('a;rm')).toBe(false);
  });
});

describe('listBranches', () => {
  it('lista locais, remotas, atual, branch padrão do remoto e adiante/atrás', async () => {
    const { repo, other } = await withRemote();
    await g(repo, 'checkout', '-b', 'feat/a');
    await commitFile(repo, 'b.txt', 'b\n', 'b');
    await commitFile(other, 'o.txt', 'o\n', 'o');
    await g(other, 'push', 'origin', 'HEAD:refs/heads/feat/r');
    await g(repo, 'fetch', '--all');
    const l = await listBranches(repo);
    expect(l.current).toBe('feat/a');
    expect(l.detached).toBe(false);
    expect(l.locals.map((b) => b.name)).toEqual(['feat/a', 'main']); // a atual primeiro
    expect(l.remotes.map((b) => b.name)).toEqual(['origin/feat/r', 'origin/main']);
    expect(l.remoteNames).toEqual(['origin']);
    expect(l.defaultRemoteBranch).toBe('origin/main');
    expect(l.recent).toEqual(['main']);
    expect(l.locals.find((b) => b.name === 'main')).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 });
  });

  it('HEAD desanexado e repositório sem remoto', async () => {
    const repo = tmp('gn-br-solo-');
    await g(repo, 'init', '-b', 'main');
    await config(repo);
    await commitFile(repo, 'a.txt', 'um\n', 'init');
    await g(repo, 'tag', 'v1.0.0');
    await g(repo, 'checkout', '--detach');
    const l = await listBranches(repo);
    expect(l).toMatchObject({ current: '', detached: true, remotes: [], remoteNames: [], defaultRemoteBranch: null, tags: ['v1.0.0'] });
    expect(l.head).toMatch(/^[0-9a-f]{7,}$/);
  });
});

describe('checkout', () => {
  it('troca para uma local e cria a local que acompanha a remota (sem duplicar)', async () => {
    const { repo, other } = await withRemote();
    await commitFile(other, 'o.txt', 'o\n', 'o');
    await g(other, 'push', 'origin', 'HEAD:refs/heads/feat/r');
    await g(repo, 'fetch', '--all');
    const r = await checkoutBranch(repo, 'origin/feat/r', 'remote');
    expect(r.ok).toBe(true);
    expect((await listBranches(repo)).current).toBe('feat/r');
    expect((await listBranches(repo)).locals.find((b) => b.name === 'feat/r')?.upstream).toBe('origin/feat/r');
    await checkoutBranch(repo, 'main', 'local');
    // com a local já existindo, usa a local (não tenta criar de novo)
    expect((await checkoutBranch(repo, 'origin/feat/r', 'remote')).ok).toBe(true);
    expect((await listBranches(repo)).current).toBe('feat/r');
  });

  it('alterações locais que seriam sobrescritas viram uma frase que diz o que fazer', async () => {
    const { repo } = await withRemote();
    await g(repo, 'checkout', '-b', 'outra');
    await commitFile(repo, 'a.txt', 'outra\n', 'muda a');
    await g(repo, 'checkout', 'main');
    writeFileSync(join(repo, 'a.txt'), 'suja\n');
    const r = await checkoutBranch(repo, 'outra', 'local');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/sobrescritas|overwritten/);
  });

  it('referência que parece opção é recusada antes de chegar ao git', async () => {
    const { repo } = await withRemote();
    await expect(checkoutBranch(repo, '--detach', 'local')).rejects.toThrow();
  });

  it('checkoutRevision vai para tag ou commit (HEAD desanexado) e recusa o que não existe', async () => {
    const { repo } = await withRemote();
    await g(repo, 'tag', 'v1.0.0');
    await commitFile(repo, 'b.txt', 'b\n', 'b');
    expect((await checkoutRevision(repo, 'v1.0.0')).ok).toBe(true);
    expect((await listBranches(repo)).detached).toBe(true);
    const bad = await checkoutRevision(repo, 'nao-existe');
    expect(bad.ok).toBe(false);
    expect((await checkoutRevision(repo, '  ')).ok).toBe(false);
  });
});

describe('createBranch', () => {
  it('a partir da versão MAIS RECENTE do remoto: busca antes, sem acompanhar a main', async () => {
    const { repo, other } = await withRemote();
    // o remoto andou e o clone local não sabe: origin/main local está velha
    await commitFile(other, 'novo.txt', 'novo\n', 'novidade no remoto');
    await g(other, 'push', 'origin', 'main');
    const old = (await g(repo, 'rev-parse', 'origin/main')).stdout.trim();
    const r = await createBranch(repo, { name: 'feat/nova', base: 'origin/main', fetch: true });
    expect(r).toMatchObject({ ok: true });
    expect(r.warning).toBeUndefined();
    const head = (await g(repo, 'rev-parse', 'HEAD')).stdout.trim();
    const remoteTip = (await g(other, 'rev-parse', 'HEAD')).stdout.trim();
    expect(head).toBe(remoteTip);
    expect(head).not.toBe(old);
    expect((await listBranches(repo)).current).toBe('feat/nova');
    expect((await listBranches(repo)).locals.find((b) => b.name === 'feat/nova')?.upstream).toBeNull(); // --no-track
  });

  it('sem rede, usa a cópia local e avisa que pode estar velha', async () => {
    const { repo, remote } = await withRemote();
    rmSync(remote, { recursive: true, force: true, maxRetries: 3 });
    const r = await createBranch(repo, { name: 'feat/offline', base: 'origin/main', fetch: true });
    expect(r.ok).toBe(true);
    expect(r.warning).toMatch(/desatualizada|out of date/);
  });

  it('da branch atual, sem trocar (checkout=false), e recusa nome inválido, repetido ou base inexistente', async () => {
    const { repo } = await withRemote();
    expect((await createBranch(repo, { name: 'feat/b', base: 'HEAD', checkout: false })).ok).toBe(true);
    expect((await listBranches(repo)).current).toBe('main');
    expect((await createBranch(repo, { name: 'feat/b', base: 'HEAD' })).message).toMatch(/Já existe|already exists/);
    expect((await createBranch(repo, { name: 'ruim nome', base: 'HEAD' })).ok).toBe(false);
    expect((await createBranch(repo, { name: '..x', base: 'HEAD' })).ok).toBe(false);
    expect((await createBranch(repo, { name: '', base: 'HEAD' })).ok).toBe(false);
    expect((await createBranch(repo, { name: 'feat/c', base: 'nao-existe' })).ok).toBe(false);
    expect((await listBranches(repo)).locals.map((b) => b.name)).toEqual(['main', 'feat/b']);
  });
});

describe('deleteBranch', () => {
  it('exclui a local, recusa a atual e pede confirmação extra se tiver commits que só existem nela', async () => {
    const { repo } = await withRemote();
    await g(repo, 'checkout', '-b', 'feat/solta');
    await commitFile(repo, 'b.txt', 'b\n', 'so aqui');
    expect((await deleteBranch(repo, 'feat/solta')).message).toMatch(/atual|current/);
    await g(repo, 'checkout', 'main');
    const refused = await deleteBranch(repo, 'feat/solta');
    expect(refused).toMatchObject({ ok: false, needsForce: true });
    expect((await deleteBranch(repo, 'feat/solta', true)).ok).toBe(true);
    await g(repo, 'branch', 'vazia');
    expect((await deleteBranch(repo, 'vazia')).ok).toBe(true);
    expect((await listBranches(repo)).locals.map((b) => b.name)).toEqual(['main']);
  });
});

describe('merge, rebase e pull', () => {
  async function diverged(): Promise<string> {
    const { repo } = await withRemote();
    await g(repo, 'checkout', '-b', 'feat/x');
    await commitFile(repo, 'a.txt', 'da feature\n', 'feature mexe em a');
    await g(repo, 'checkout', 'main');
    await commitFile(repo, 'a.txt', 'da main\n', 'main mexe em a');
    return repo;
  }

  it('merge limpo conclui; merge com conflito não lança: devolve conflicted e deixa o merge em andamento', async () => {
    const { repo } = await withRemote();
    await g(repo, 'checkout', '-b', 'feat/ok');
    await commitFile(repo, 'novo.txt', 'n\n', 'novo');
    await g(repo, 'checkout', 'main');
    expect(await mergeBranch(repo, 'feat/ok')).toMatchObject({ ok: true });
    expect((await mergeBranch(repo, 'feat/ok')).message).toMatch(/atualizado|up to date/);

    const bad = await diverged();
    const r = await mergeBranch(bad, 'feat/x');
    expect(r).toMatchObject({ ok: false, conflicted: true });
    expect((await g(bad, 'status', '--porcelain')).stdout).toMatch(/^UU a\.txt/m);
  });

  it('rebase sobre outra branch; conflito deixa o rebase em andamento', async () => {
    const repo = await diverged();
    await g(repo, 'checkout', 'feat/x');
    const r = await rebaseOntoBranch(repo, 'main');
    expect(r).toMatchObject({ ok: false, conflicted: true });
    const { existsSync } = await import('node:fs');
    expect(existsSync(join(repo, '.git', 'rebase-merge')) || existsSync(join(repo, '.git', 'rebase-apply'))).toBe(true);
    await g(repo, 'rebase', '--abort');
    const { repo: ok } = await withRemote();
    await commitFile(ok, 'b.txt', 'b\n', 'b');
    await g(ok, 'checkout', '-b', 'feat/y', 'HEAD~1');
    await commitFile(ok, 'c.txt', 'c\n', 'c');
    expect(await rebaseOntoBranch(ok, 'main')).toMatchObject({ ok: true });
    expect((await g(ok, 'log', '--format=%s', '-3')).stdout.trim().split('\n')).toEqual(['c', 'b', 'init']);
  });

  it('pull de uma branch remota com rebase e com merge', async () => {
    const { repo, other } = await withRemote();
    await commitFile(other, 'o.txt', 'o\n', 'do outro');
    await g(other, 'push', 'origin', 'main');
    await g(repo, 'fetch', 'origin');
    await commitFile(repo, 'meu.txt', 'meu\n', 'meu');
    const reb = await pullBranch(repo, 'origin/main', 'rebase');
    expect(reb.ok).toBe(true);
    expect((await g(repo, 'log', '--format=%s', '-3')).stdout.trim().split('\n')).toEqual(['meu', 'do outro', 'init']);

    await commitFile(other, 'o2.txt', 'o2\n', 'do outro 2');
    await g(other, 'push', 'origin', 'main');
    await g(repo, 'fetch', 'origin');
    const mer = await pullBranch(repo, 'origin/main', 'merge');
    expect(mer.ok).toBe(true);
    expect((await g(repo, 'log', '--merges', '--format=%s', '-1')).stdout).toMatch(/Merge/);
    expect((await pullBranch(repo, 'semremoto/x', 'merge')).ok).toBe(false);
  });
});

describe('compareWithBase', () => {
  it('feature branch sem upstream: conta quantos commits está atrás e à frente da origin/main', async () => {
    const { repo, other } = await withRemote();
    await createBranch(repo, { name: 'feat/x', base: 'origin/main', checkout: true }); // --no-track: sem upstream
    await commitFile(repo, 'f1.txt', 'f1\n', 'feature 1');
    await commitFile(repo, 'f2.txt', 'f2\n', 'feature 2');
    await commitFile(other, 'o1.txt', 'o1\n', 'main andou 1');
    await commitFile(other, 'o2.txt', 'o2\n', 'main andou 2');
    await commitFile(other, 'o3.txt', 'o3\n', 'main andou 3');
    await g(other, 'push', 'origin', 'main');
    expect(await compareWithBase(repo)).toEqual({ base: 'origin/main', short: 'main', ahead: 2, behind: 0 }); // ainda não buscou
    await g(repo, 'fetch', 'origin');
    expect(await compareWithBase(repo)).toEqual({ base: 'origin/main', short: 'main', ahead: 2, behind: 3 });
  });

  it('não se aplica na própria base: main local, ou branch que acompanha a origin/main', async () => {
    const { repo } = await withRemote();
    expect(await compareWithBase(repo)).toBeNull(); // a main
    await g(repo, 'checkout', '-b', 'acompanha', '--track', 'origin/main');
    expect(await compareWithBase(repo)).toBeNull(); // o upstream dela já é a base
  });

  it('não se aplica com HEAD desanexado nem sem remoto', async () => {
    const { repo } = await withRemote();
    await g(repo, 'checkout', '-b', 'feat/y');
    expect(await compareWithBase(repo)).toMatchObject({ ahead: 0, behind: 0 });
    await g(repo, 'checkout', '--detach');
    expect(await compareWithBase(repo)).toBeNull();
    const lonely = tmp('gn-br-lonely-');
    await g(lonely, 'init', '-b', 'main');
    await config(lonely);
    await commitFile(lonely, 'a.txt', 'a\n', 'init');
    await g(lonely, 'checkout', '-b', 'feat/z');
    expect(await compareWithBase(lonely)).toBeNull();
  });

  it('sem origin/HEAD, acha a base por main/master/develop', async () => {
    const { repo } = await withRemote();
    await g(repo, 'remote', 'set-head', 'origin', '--delete');
    await g(repo, 'checkout', '-b', 'feat/w');
    expect(await compareWithBase(repo)).toMatchObject({ base: 'origin/main', short: 'main' });
  });
});
