import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchRepo, getRepoSummary, parseSummary, pullRepo, runGit } from '../src/index.js';

let root: string;
let remote: string;
let a: string; // clone principal
let b: string; // segundo clone (simula outra pessoa)
const g = (cwd: string, ...args: string[]) => runGit(cwd, args);

async function setup(cwd: string) {
  await g(cwd, 'config', 'user.name', 'T');
  await g(cwd, 'config', 'user.email', 't@e.com');
  await g(cwd, 'config', 'commit.gpgsign', 'false');
  await g(cwd, 'config', 'core.autocrlf', 'false');
}
async function commit(cwd: string, file: string, content: string, msg: string) {
  writeFileSync(join(cwd, file), content);
  await g(cwd, 'add', '.');
  await g(cwd, 'commit', '-m', msg);
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-dash-'));
  remote = join(root, 'remote.git');
  a = join(root, 'a');
  b = join(root, 'b');
  await runGit(root, ['init', '--bare', '-b', 'main', remote]);
  await runGit(root, ['clone', '-c', 'core.autocrlf=false', remote, a]);
  await setup(a);
  await commit(a, 'f.txt', '1\n', 'init');
  await g(a, 'push', '-u', 'origin', 'main');
  await runGit(root, ['clone', '-c', 'core.autocrlf=false', remote, b]);
  await setup(b);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('parseSummary', () => {
  it('lê branch, upstream, ahead/behind e contagens', () => {
    const raw = [
      '# branch.oid abc',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -3',
      '1 M. N... 100644 100644 100644 a b a.txt', // staged
      '1 .M N... 100644 100644 100644 a b b.txt', // unstaged
      '1 MM N... 100644 100644 100644 a b c.txt', // ambos
      '2 R. N... 100644 100644 100644 a b R100 novo.txt',
      'velho.txt',
      'u UU N... 100644 100644 100644 100644 a b c conflito.txt',
      '? solto.txt',
      '',
    ].join('\0');
    expect(parseSummary(raw)).toEqual({
      branch: 'feature/x',
      detached: false,
      upstream: 'origin/feature/x',
      gone: false,
      ahead: 2,
      behind: 3,
      staged: 3,
      unstaged: 2,
      untracked: 1,
      conflicted: 1,
    });
  });

  it('HEAD desanexado e sem upstream', () => {
    const s = parseSummary(['# branch.oid abc', '# branch.head (detached)', ''].join('\0'));
    expect(s).toMatchObject({ detached: true, upstream: null, gone: false, ahead: 0, behind: 0 });
  });

  it('upstream configurado sem "branch.ab": a branch remota foi apagada', () => {
    const s = parseSummary(['# branch.oid abc', '# branch.head velha', '# branch.upstream origin/velha', ''].join('\0'));
    expect(s).toMatchObject({ upstream: 'origin/velha', gone: true, ahead: 0, behind: 0 });
  });

  it('sem upstream não é "apagada"', () => {
    expect(parseSummary(['# branch.oid abc', '# branch.head nova', ''].join('\0'))).toMatchObject({ upstream: null, gone: false });
  });
});

describe('painel (repositórios reais com remoto)', () => {
  it('limpo e sincronizado', async () => {
    expect(await getRepoSummary(a)).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0 });
  });

  it('conta pendências e commits locais à frente', async () => {
    await commit(a, 'f.txt', '2\n', 'local');
    writeFileSync(join(a, 'f.txt'), '3\n');
    writeFileSync(join(a, 'novo.txt'), 'x\n');
    const s = await getRepoSummary(a);
    expect(s).toMatchObject({ ahead: 1, behind: 0, unstaged: 1, untracked: 1 });
    await g(a, 'checkout', '--', 'f.txt');
    rmSync(join(a, 'novo.txt'));
    await g(a, 'push');
  });

  it('fetch revela commits novos do remoto (behind) e o pull faz fast-forward', async () => {
    await g(b, 'pull'); // o clone b nasceu antes do commit "local" ter sido enviado
    await commit(b, 'g.txt', 'g\n', 'da outra pessoa');
    await g(b, 'push');
    expect((await getRepoSummary(a)).behind).toBe(0); // ainda não sabe
    expect(await fetchRepo(a)).toMatchObject({ ok: true });
    expect(await getRepoSummary(a)).toMatchObject({ behind: 1, ahead: 0 });
    const r = await pullRepo(a);
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('fast-forward') });
    expect(await getRepoSummary(a)).toMatchObject({ behind: 0, ahead: 0 });
    expect((await pullRepo(a)).message).toContain('atualizado');
  });

  it('branch divergida: o pull recusa e nada é alterado', async () => {
    await commit(b, 'h.txt', 'h\n', 'remoto');
    await g(b, 'push');
    await commit(a, 'i.txt', 'i\n', 'local diverge');
    await fetchRepo(a);
    const before = (await g(a, 'rev-parse', 'HEAD')).stdout;
    const r = await pullRepo(a);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('divergiu');
    expect((await g(a, 'rev-parse', 'HEAD')).stdout).toBe(before);
    expect(await getRepoSummary(a)).toMatchObject({ ahead: 1, behind: 1 });
  });

  it('remota apagada: o git diz "gone" depois do fetch --prune', async () => {
    await g(a, 'checkout', '-b', 'temporaria');
    await g(a, 'push', '-u', 'origin', 'temporaria');
    expect(await getRepoSummary(a)).toMatchObject({ upstream: 'origin/temporaria', gone: false });
    await g(b, 'push', 'origin', '--delete', 'temporaria');
    expect(await fetchRepo(a)).toMatchObject({ ok: true });
    expect(await getRepoSummary(a)).toMatchObject({ branch: 'temporaria', upstream: 'origin/temporaria', gone: true });
    await g(a, 'checkout', 'main');
  });

  it('sem upstream e com remoto inacessível', async () => {
    await g(a, 'checkout', '-b', 'solta');
    expect(await pullRepo(a)).toMatchObject({ ok: false, message: expect.stringContaining('upstream') });
    await g(a, 'remote', 'set-url', 'origin', join(root, 'nao-existe.git'));
    const f = await fetchRepo(a);
    expect(f.ok).toBe(false);
    expect(f.message.length).toBeGreaterThan(0);
  });
});
