// Detalhe do commit (#293) e comparar revisões (#295) contra o Git de verdade. Oráculos que não repetem a implementação: `git log a..b`, `git diff --name-status`, `git show --stat`
// (só números), contagem por arquivo somada, hashes. Repositório com renomeação, binário, merge, arquivo grande, tag e um branch adiante e outro atrasado.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { compareRevisions, getCommitDetail, getCommitRefs, getCompareFileDiff, mergeFileStats, parseNameStatus, parseNumstat } from '../src/index.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

let root: string;
let R: string;
const sh = (...a: string[]) => execFileSync('git', a, { cwd: R, encoding: 'utf8' }).trim();
const lines = (s: string) => s.split('\n').filter(Boolean);
const rev = (r: string) => sh('rev-parse', r);
function write(file: string, text: string | Buffer) {
  mkdirSync(join(R, file, '..'), { recursive: true });
  writeFileSync(join(R, file), text);
}
function commit(msg: string) {
  sh('add', '-A');
  sh('commit', '-qm', msg);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-cmp-'));
  R = join(root, 'r');
  execFileSync('git', ['init', '-q', '-b', 'main', R]);
  for (const [k, v] of [['commit.gpgsign', 'false'], ['core.fsmonitor', 'false'], ['core.autocrlf', 'false'], ['user.name', 'Ana'], ['user.email', 'ana@e.com']]) sh('config', k!, v!);
  write('a.txt', Array.from({ length: 20 }, (_, i) => `linha ${i}`).join('\n') + '\n');
  write('docs/x.md', 'x\n');
  commit('c1 base');
  sh('tag', 'v1');
  sh('checkout', '-qb', 'feat');
  renameSync(join(R, 'a.txt'), join(R, 'b.txt')); // renomeia sem mudar
  commit('f1 renomeia a para b');
  write('b.txt', Array.from({ length: 20 }, (_, i) => (i === 3 ? 'linha 3 mudou' : `linha ${i}`)).join('\n') + '\n');
  write('img.bin', Buffer.from([0, 1, 2, 3, 0, 255, 0, 7]));
  commit('f2 muda b e cria binário');
  write('grande.txt', 'g\n'.repeat(20000)); // 20 mil linhas
  commit('f3 arquivo grande');
  sh('checkout', '-q', 'main');
  write('docs/y.md', 'y\n');
  commit('m1 na main');
  write('docs/x.md', 'x2\n');
  commit('m2 na main');
  sh('checkout', '-qb', 'lateral', 'v1');
  write('l.txt', 'l\n');
  commit('l1 lateral');
  sh('checkout', '-q', 'main');
  sh('merge', '--no-ff', '-qm', 'mg merge lateral', 'lateral');
});
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

describe('leitura da saída do Git', () => {
  it('name-status e numstat com -z, inclusive renomeação, binário e caminho com espaço', () => {
    expect(parseNameStatus('M\0a b.txt\0R100\0velho.txt\0novo.txt\0A\0img.bin\0')).toEqual([
      { status: 'M', path: 'a b.txt' },
      { status: 'R', path: 'novo.txt', oldPath: 'velho.txt' },
      { status: 'A', path: 'img.bin' },
    ]);
    const n = parseNumstat('3\t1\ta b.txt\0-\t-\timg.bin\0' + '0\t0\t\0velho.txt\0novo.txt\0');
    expect(n.get('a b.txt')).toEqual({ added: 3, removed: 1, binary: false });
    expect(n.get('img.bin')).toEqual({ added: 0, removed: 0, binary: true });
    expect(n.get('novo.txt')).toEqual({ added: 0, removed: 0, binary: false });
    expect(mergeFileStats([{ status: 'M', path: 'a b.txt' }, { status: 'M', path: 'zzz' }], n)).toEqual([{ status: 'M', path: 'a b.txt', added: 3, removed: 1 }, { status: 'M', path: 'zzz' }]);
  });
});

describe('detalhe do commit', () => {
  it('a renomeação vem como R com o nome antigo, sem contar linhas', async () => {
    const d = await getCommitDetail(R, rev('feat~2'));
    expect(d.message).toBe('f1 renomeia a para b');
    expect(d.files).toEqual([{ status: 'R', path: 'b.txt', oldPath: 'a.txt', added: 0, removed: 0 }]);
    expect(d.signature).toBe('none');
  });

  it('as contagens por arquivo somam o que `git show --shortstat` diz; o binário é marcado', async () => {
    const d = await getCommitDetail(R, rev('feat~1'));
    const sum = d.files.reduce((a, f) => ({ added: a.added + (f.added ?? 0), removed: a.removed + (f.removed ?? 0) }), { added: 0, removed: 0 });
    const stat = sh('show', '--format=', '--shortstat', rev('feat~1'));
    expect(stat).toContain(`${sum.added} insertion`);
    expect(stat).toContain(`${sum.removed} deletion`);
    expect(d.files.find((f) => f.path === 'img.bin')).toMatchObject({ status: 'A', binary: true });
    expect(d.files.find((f) => f.path === 'b.txt')).toMatchObject({ status: 'M', added: 1, removed: 1 });
  });

  it('o arquivo grande traz a contagem inteira; o merge mostra o que veio do segundo pai (primeiro pai)', async () => {
    const big = await getCommitDetail(R, rev('feat'));
    expect(big.files).toEqual([{ status: 'A', path: 'grande.txt', added: 20000, removed: 0 }]);
    const m = await getCommitDetail(R, rev('main'));
    expect(m.message).toBe('mg merge lateral');
    expect(m.files.map((f) => f.path)).toEqual(['l.txt']); // contra o primeiro pai
  });

  it('branches e tags que contêm o commit', async () => {
    const r = await getCommitRefs(R, rev('v1'));
    expect(new Set(r.branches)).toEqual(new Set(sh('branch', '-a', '--contains', rev('v1'), '--format=%(refname:short)').split('\n').filter(Boolean)));
    expect(r.tags).toEqual(['v1']);
    const f = await getCommitRefs(R, rev('feat'));
    expect(f.branches).toEqual(['feat']);
    expect(f.tags).toEqual([]);
    await expect(getCommitRefs(R, 'x; rm')).rejects.toThrow('inválido');
  });
});

describe('comparar revisões', () => {
  it('commits a mais e a menos conferem com `git log a..b` e `b..a`, com as contagens', async () => {
    const c = await compareRevisions(R, 'main', 'feat');
    if (!c.ok) throw new Error('esperava ok');
    expect(c.ahead.map((x) => x.hash)).toEqual(lines(sh('log', '--format=%H', 'main..feat')));
    expect(c.behind.map((x) => x.hash)).toEqual(lines(sh('log', '--format=%H', 'feat..main')));
    expect(c.aheadCount).toBe(3);
    expect(c.behindCount).toBe(lines(sh('rev-list', 'feat..main')).length);
    expect(c.baseHash).toBe(rev('main'));
    expect(c.targetHash).toBe(rev('feat'));
    expect(c.mergeBase).toBe(sh('merge-base', 'main', 'feat'));
  });

  it('arquivos: três pontos = desde o ancestral comum; dois pontos = entre os dois estados (o que o git diff diz)', async () => {
    const three = await compareRevisions(R, 'main', 'feat', 'three');
    const two = await compareRevisions(R, 'main', 'feat', 'two');
    if (!three.ok || !two.ok) throw new Error('esperava ok');
    const want = (spec: string[]) => lines(sh('diff', '--name-status', '--find-renames', ...spec)).map((l) => l.split('\t').slice(-1)[0]!).sort();
    expect(three.files.map((f) => f.path).sort()).toEqual(want(['main...feat']));
    expect(two.files.map((f) => f.path).sort()).toEqual(want(['main', 'feat']));
    expect(three.files.map((f) => f.path)).not.toContain('docs/y.md'); // o que só a main mudou não é do alvo
    expect(two.files.map((f) => f.path)).toContain('docs/y.md'); // entre os dois estados, aparece
    const ren = three.files.find((f) => f.path === 'b.txt');
    expect(ren).toMatchObject({ status: 'R', oldPath: 'a.txt' });
    expect(three.files.find((f) => f.path === 'img.bin')).toMatchObject({ status: 'A', binary: true });
    expect(three.files.find((f) => f.path === 'grande.txt')).toMatchObject({ added: 20000 });
    expect(three.mode).toBe('three');
  });

  it('trocar os lados inverte commits a mais e a menos e o estado dos arquivos', async () => {
    const a = await compareRevisions(R, 'main', 'feat', 'two');
    const b = await compareRevisions(R, 'feat', 'main', 'two');
    if (!a.ok || !b.ok) throw new Error('esperava ok');
    expect(b.aheadCount).toBe(a.behindCount);
    expect(b.behindCount).toBe(a.aheadCount);
    expect(a.files.find((f) => f.path === 'grande.txt')?.status).toBe('A');
    expect(b.files.find((f) => f.path === 'grande.txt')?.status).toBe('D');
  });

  it('tag, hash, HEAD~n e o mesmo commit (sem diferença)', async () => {
    const c = await compareRevisions(R, 'v1', 'HEAD~1');
    if (!c.ok) throw new Error('esperava ok');
    expect(c.aheadCount).toBe(lines(sh('rev-list', 'v1..HEAD~1')).length);
    const h = await compareRevisions(R, rev('v1'), 'v1');
    if (!h.ok) throw new Error('esperava ok');
    expect(h.aheadCount + h.behindCount + h.files.length).toBe(0);
  });

  it('revisão inexistente ou insegura volta como erro em dados, sem lançar e sem chegar ao Git como opção', async () => {
    expect(await compareRevisions(R, 'main', 'nao-existe')).toEqual({ ok: false, error: { code: 'notFound', value: 'nao-existe' } });
    expect(await compareRevisions(R, '--upload-pack=x', 'main')).toEqual({ ok: false, error: { code: 'badRevision', value: '--upload-pack=x' } });
    expect(await compareRevisions(R, 'a..b', 'main')).toMatchObject({ ok: false, error: { code: 'badRevision' } });
    expect(await compareRevisions(R, 'main', '')).toMatchObject({ ok: false });
  });

  it('o diff de um arquivo da comparação (com a renomeação) e a segurança dos argumentos', async () => {
    const c = await compareRevisions(R, 'v1', 'feat');
    if (!c.ok) throw new Error('esperava ok');
    const d = await getCompareFileDiff(R, c.baseHash, c.targetHash, 'three', 'b.txt', 'a.txt');
    expect(d).toContain('rename from a.txt');
    expect(d).toContain('+linha 3 mudou');
    expect(d).toBe(sh('diff', '--no-color', '--find-renames', 'v1...feat', '--', 'a.txt', 'b.txt') + '\n');
    await expect(getCompareFileDiff(R, 'main', c.targetHash, 'two', 'b.txt')).rejects.toThrow('inválido');
    await expect(getCompareFileDiff(R, c.baseHash, c.targetHash, 'two', '../fora')).rejects.toThrow();
  });
});
