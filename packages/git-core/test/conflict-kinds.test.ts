import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  classifyConflict,
  getConflictImage,
  getMergeConflicts,
  mergedMode,
  parseLfsPointer,
  parseUnmerged,
  reopenConflict,
  resolveConflictFile,
  resolveConflictSide,
  runGit,
  unmergedFiles,
} from '../src/index.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const g = (cwd: string, ...a: string[]) => runGit(cwd, a, { check: false });
const body = (tag: string) => Array.from({ length: 10 }, (_, i) => `linha ${i + 1} do arquivo ${tag}`).join('\n') + '\n';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

async function repo(): Promise<string> {
  const r = mkdtempSync(join(tmpdir(), 'gitnexus-kinds-'));
  dirs.push(r);
  await g(r, 'init', '-b', 'main');
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) await g(r, 'config', k!, v!);
  return r;
}
const commit = async (r: string, msg: string) => {
  await g(r, 'add', '-A');
  await g(r, 'commit', '-m', msg);
};
/** Cria `base` em main, e duas pontas: `outro` (theirs) e `main` (ours); `a`/`b` mexem no repositório de cada lado. */
async function diverge(setup: (r: string) => Promise<void> | void, ours: (r: string) => Promise<void> | void, theirs: (r: string) => Promise<void> | void): Promise<string> {
  const r = await repo();
  await setup(r);
  await commit(r, 'base');
  await g(r, 'checkout', '-b', 'outro');
  await theirs(r);
  await commit(r, 'outro');
  await g(r, 'checkout', 'main');
  await ours(r);
  await commit(r, 'main');
  await g(r, 'merge', 'outro');
  return r;
}
const put = (r: string, f: string, c: string | Buffer) => writeFileSync(join(r, f), c);
const rmf = (r: string, f: string) => rmSync(join(r, f));
const block = async (r: string, f: string) => (await getMergeConflicts(r)).find((b) => b.filePath === f)!;

describe('classificação pura (sem Git)', () => {
  const e = (stage: 1 | 2 | 3, mode = '100644', sha = 'a'.repeat(40)) => ({ mode, sha, stage, path: 'x' });
  const none = { binary: () => false, lfs: () => false };

  it('lê as linhas do ls-files --unmerged -z e ignora o que não é registro', () => {
    const sha = 'b'.repeat(40);
    const nul = '\u0000';
    expect(parseUnmerged(`100644 ${sha} 1\ta b.txt${nul}100755 ${sha} 3\tpasta/c.sh${nul}lixo${nul}`)).toEqual([
      { mode: '100644', sha, stage: 1, path: 'a b.txt' },
      { mode: '100755', sha, stage: 3, path: 'pasta/c.sh' },
    ]);
  });

  it('decide o tipo pelos estágios e modos', () => {
    expect(classifyConflict({ base: e(1) }, none)).toBe('both-deleted');
    expect(classifyConflict({ base: e(1), ours: e(2) }, none)).toBe('deleted');
    expect(classifyConflict({ theirs: e(3) }, none)).toBe('deleted'); // adicionado só num lado (rastro de renomeação)
    expect(classifyConflict({ base: e(1), ours: e(2), theirs: e(3) }, none)).toBe('text');
    expect(classifyConflict({ ours: e(2), theirs: e(3) }, none)).toBe('both-added');
    expect(classifyConflict({ base: e(1), ours: e(2), theirs: e(3) }, { binary: () => true, lfs: () => false })).toBe('binary');
    expect(classifyConflict({ base: e(1), ours: e(2), theirs: e(3) }, { binary: () => true, lfs: () => true })).toBe('lfs');
    expect(classifyConflict({ base: e(1), ours: e(2, '160000'), theirs: e(3, '160000') }, none)).toBe('submodule');
    // os dois lados mudaram o modo, cada um para um valor: escolher um
    expect(classifyConflict({ base: e(1), ours: e(2, '100755'), theirs: e(3, '120000') }, none)).toBe('mode');
    // só um lado mudou o modo: o conflito é de conteúdo (o modo se resolve sozinho)
    expect(classifyConflict({ base: e(1), ours: e(2, '100755'), theirs: e(3) }, none)).toBe('text');
  });

  it('ponteiro do LFS e modo resultante', () => {
    const oid = 'c'.repeat(64);
    expect(parseLfsPointer(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 1234\n`)).toEqual({ oid, size: 1234 });
    expect(parseLfsPointer('texto comum\n')).toBeNull();
    expect(parseLfsPointer(`version https://git-lfs.github.com/spec/v1\noid sha256:curto\nsize 1\n`)).toBeNull();
    expect(mergedMode('100644', '100755', '100644')).toBe('100755');
    expect(mergedMode('100644', '100644', '100755')).toBe('100755');
    expect(mergedMode('100755', '100644', '100755')).toBe('100644');
    expect(mergedMode(undefined, '100644', '100755')).toBe('100644');
  });
});

describe('conflitos que não são "linha contra linha" (repositório real)', () => {
  it('apagado × alterado: mostra o que sobrou, e dá para manter ou apagar', async () => {
    const mk = () => diverge((r) => put(r, 'f.txt', body('a')), (r) => put(r, 'f.txt', body('a') + 'extra\n'), (r) => rmf(r, 'f.txt'));
    const r = await mk();
    const b = await block(r, 'f.txt');
    expect(b.kind).toBe('deleted');
    expect(b.sides?.ours).toBeDefined();
    expect(b.sides?.theirs).toBeUndefined(); // "theirs" apagou
    expect(b.ours).toContain('extra'); // o texto da versão mantida
    expect(b.base).toContain('linha 1');
    expect(b.hasUnresolvedMarkers).toBe(true);

    // manter a versão alterada (a nossa)
    expect(await resolveConflictSide(r, 'f.txt', 'ours')).toBe(true);
    expect(await unmergedFiles(r)).toEqual([]);
    expect(readFileSync(join(r, 'f.txt'), 'utf8')).toContain('extra');
    expect((await g(r, 'ls-files', '-s', '--', 'f.txt')).stdout).toMatch(/^100644 .* 0\tf\.txt/);

    // apagar (ficar com o lado que apagou)
    const r2 = await mk();
    expect(await resolveConflictSide(r2, 'f.txt', 'theirs')).toBe(true);
    expect(await unmergedFiles(r2)).toEqual([]);
    expect(existsSync(join(r2, 'f.txt'))).toBe(false);
    expect((await g(r2, 'ls-files', '--', 'f.txt')).stdout.trim()).toBe('');

    // reabrir: o git checkout -m não serve quando um lado apagou, então volta o conflito original e o arquivo do lado que o mantém
    expect(await reopenConflict(r2, 'f.txt')).toBe(true);
    const again = await block(r2, 'f.txt');
    expect(again.kind).toBe('deleted');
    expect(again.sides?.theirs).toBeUndefined();
    expect(readFileSync(join(r2, 'f.txt'), 'utf8')).toContain('extra');
    expect(await resolveConflictSide(r2, 'f.txt', 'theirs')).toBe(true);
    expect((await g(r2, 'commit', '--no-edit')).code).toBe(0); // o merge conclui
  });

  it('adicionado nos dois lados com conteúdos diferentes: é texto com a base vazia', async () => {
    const r = await diverge((r) => put(r, 'z', 'z\n'), (r) => put(r, 'n.txt', 'dois\n'), (r) => put(r, 'n.txt', 'um\n'));
    const b = await block(r, 'n.txt');
    expect(b.kind).toBe('both-added');
    expect([b.base, b.ours, b.theirs]).toEqual(['', 'dois\n', 'um\n']);
    expect(await resolveConflictFile(r, 'n.txt', 'um\ndois\n')).toBe(true);
    expect(await unmergedFiles(r)).toEqual([]);
  });

  it('renomeado nos dois lados para nomes diferentes: o nome antigo e os dois novos aparecem ligados', async () => {
    const r = await diverge(
      (r) => put(r, 'f.txt', body('a')),
      async (r) => void (await g(r, 'mv', 'f.txt', 'h.txt')),
      async (r) => void (await g(r, 'mv', 'f.txt', 'g.txt')),
    );
    const blocks = await getMergeConflicts(r);
    const by = Object.fromEntries(blocks.map((b) => [b.filePath, b]));
    expect(by['f.txt']?.kind).toBe('both-deleted');
    expect(by['g.txt']?.kind).toBe('deleted');
    expect(by['h.txt']?.kind).toBe('deleted');
    expect(by['f.txt']?.relatedPaths?.sort()).toEqual(['g.txt', 'h.txt']);
    expect(by['g.txt']?.relatedPaths?.sort()).toEqual(['f.txt', 'h.txt']);

    // manter os dois nomes: o antigo some (apagado nos dois lados), os novos ficam
    expect(await resolveConflictSide(r, 'f.txt', 'ours')).toBe(true);
    expect(await resolveConflictSide(r, 'g.txt', 'theirs')).toBe(true);
    expect(await resolveConflictSide(r, 'h.txt', 'ours')).toBe(true);
    expect(await unmergedFiles(r)).toEqual([]);
    expect(existsSync(join(r, 'f.txt'))).toBe(false);
    expect(readFileSync(join(r, 'g.txt'), 'utf8')).toContain('linha 1');
    expect(readFileSync(join(r, 'h.txt'), 'utf8')).toContain('linha 1');
  });

  it('binário: informa tamanho e data de cada versão, não manda o conteúdo, e fica com o lado escolhido byte a byte', async () => {
    const ours = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const theirs = Buffer.from([0, 9, 9, 9]);
    const r = await diverge((r) => put(r, 'b.bin', Buffer.from([0, 1, 2])), (r) => put(r, 'b.bin', ours), (r) => put(r, 'b.bin', theirs));
    const b = await block(r, 'b.bin');
    expect(b.kind).toBe('binary');
    expect([b.ours, b.base, b.theirs]).toEqual(['', '', '']);
    expect(b.sides?.ours?.size).toBe(9);
    expect(b.sides?.theirs?.size).toBe(4);
    expect(b.sides?.ours?.date).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(b.sides?.theirs?.date).toMatch(/^\d{4}-\d\d-\d\dT/);

    expect(await resolveConflictSide(r, 'b.bin', 'theirs')).toBe(true);
    expect(await unmergedFiles(r)).toEqual([]);
    expect(readFileSync(join(r, 'b.bin')).equals(theirs)).toBe(true);
  });

  it('imagem: devolve a prévia de cada lado em base64 com o tipo (e só de imagem, só do que existe)', async () => {
    const r = await diverge((r) => put(r, 'i.png', Buffer.concat([PNG, Buffer.from([0])])), (r) => put(r, 'i.png', PNG), (r) => put(r, 'i.png', Buffer.concat([PNG, Buffer.from([0, 0])])));
    expect((await block(r, 'i.png')).kind).toBe('binary');
    const img = await getConflictImage(r, 'i.png', 'ours');
    expect(img?.mime).toBe('image/png');
    expect(Buffer.from(img!.base64, 'base64').equals(PNG)).toBe(true);
    expect(await getConflictImage(r, 'i.png', 'base')).not.toBeNull();
    expect(await getConflictImage(r, 'nao-existe.png', 'ours')).toBeNull();
    await expect(getConflictImage(r, '../fora.png', 'ours')).rejects.toThrow();
    const r2 = await diverge((r) => put(r, 'b.bin', Buffer.from([0, 1])), (r) => put(r, 'b.bin', Buffer.from([0, 2])), (r) => put(r, 'b.bin', Buffer.from([0, 3])));
    expect(await getConflictImage(r2, 'b.bin', 'ours')).toBeNull(); // não é uma extensão de imagem
  });

  it('ponteiro do Git LFS: tipo próprio, com o oid e o tamanho real de cada lado', async () => {
    const ptr = (c: string, size: number) => `version https://git-lfs.github.com/spec/v1\noid sha256:${c.repeat(64)}\nsize ${size}\n`;
    const r = await diverge((r) => put(r, 'big.psd', ptr('a', 10)), (r) => put(r, 'big.psd', ptr('b', 2048)), (r) => put(r, 'big.psd', ptr('c', 4096)));
    const b = await block(r, 'big.psd');
    expect(b.kind).toBe('lfs');
    expect(b.sides?.ours?.size).toBe(2048);
    expect(b.sides?.theirs?.detail).toBe(`sha256:${'c'.repeat(64)}`);
    expect(await resolveConflictSide(r, 'big.psd', 'ours')).toBe(true);
    expect(readFileSync(join(r, 'big.psd'), 'utf8')).toBe(ptr('b', 2048));
    expect(await unmergedFiles(r)).toEqual([]);
  });

  it('tipo/modo diferente nos dois lados (executável × link simbólico): escolhe-se um lado, com o modo dele', async () => {
    const r = await repo();
    put(r, 'r.sh', body('a'));
    await commit(r, 'base');
    const blob = async (c: string) => (await runGit(r, ['hash-object', '-w', '--stdin'], { stdin: c })).stdout.trim();
    const [base, exec, link] = [await blob(body('a')), await blob(body('b')), await blob('alvo')];
    // os três estágios do mesmo caminho, montados direto no índice (o que o Git deixa num conflito de tipo; o merge de verdade varia com o sistema)
    const info = `0 ${'0'.repeat(40)}\tr.sh\n100644 ${base} 1\tr.sh\n100755 ${exec} 2\tr.sh\n120000 ${link} 3\tr.sh\n`;
    await runGit(r, ['update-index', '--index-info'], { stdin: info });
    const b = await block(r, 'r.sh');
    expect(b.kind).toBe('mode');
    expect([b.sides?.ours?.mode, b.sides?.theirs?.mode]).toEqual(['100755', '120000']);
    expect(await resolveConflictSide(r, 'r.sh', 'ours')).toBe(true);
    expect(await unmergedFiles(r)).toEqual([]);
    expect((await g(r, 'ls-files', '-s', '--', 'r.sh')).stdout.trim()).toBe(`100755 ${exec} 0\tr.sh`);

    await runGit(r, ['update-index', '--index-info'], { stdin: info });
    expect(await resolveConflictSide(r, 'r.sh', 'theirs')).toBe(true);
    expect((await g(r, 'ls-files', '-s', '--', 'r.sh')).stdout.trim()).toBe(`120000 ${link} 0\tr.sh`);
  });

  it('conflito de texto em que um lado só tornou o arquivo executável: o resultado mantém o modo executável', async () => {
    const r = await repo();
    put(r, 'r.sh', body('a'));
    await commit(r, 'base');
    await g(r, 'checkout', '-b', 'outro');
    put(r, 'r.sh', body('a').replace('linha 1 ', 'theirs 1 '));
    await commit(r, 'outro');
    await g(r, 'checkout', 'main');
    put(r, 'r.sh', body('a').replace('linha 1 ', 'ours 1 '));
    chmodSync(join(r, 'r.sh'), 0o755); // no Linux o disco também precisa ser executável, senão o merge vê o arquivo como alterado
    await g(r, 'add', '-A');
    await g(r, 'update-index', '--chmod=+x', 'r.sh'); // no Windows (sem bit no disco) é o que marca o modo
    await g(r, 'commit', '-m', 'main');
    await g(r, 'merge', 'outro');
    expect((await block(r, 'r.sh')).kind).toBe('text');
    expect(await resolveConflictFile(r, 'r.sh', body('a'))).toBe(true);
    expect((await g(r, 'ls-files', '-s', '--', 'r.sh')).stdout).toMatch(/^100755 /);
  });

  it('submódulo: mostra o commit de cada lado e fica com o escolhido sem tocar na pasta', async () => {
    const sub = await repo();
    const shas: string[] = [];
    for (const n of [1, 2, 3]) {
      put(sub, 's.txt', `s${n}\n`);
      await commit(sub, `sub ${n}`);
      shas.push((await g(sub, 'rev-parse', 'HEAD')).stdout.trim());
    }
    const r = await repo();
    put(r, 'a', 'a\n');
    await commit(r, 'base');
    const link = (sha: string) => g(r, 'update-index', '--add', '--cacheinfo', `160000,${sha},m`);
    await link(shas[0]!);
    await g(r, 'commit', '-m', 'sub 1');
    await g(r, 'checkout', '-b', 'outro');
    await link(shas[1]!);
    await g(r, 'commit', '-m', 'sub 2');
    await g(r, 'checkout', 'main');
    await link(shas[2]!);
    await g(r, 'commit', '-m', 'sub 3');
    await g(r, 'merge', 'outro');
    const b = await block(r, 'm');
    expect(b.kind).toBe('submodule');
    expect(b.sides?.ours?.sha).toBe(shas[2]);
    expect(b.sides?.theirs?.sha).toBe(shas[1]);
    expect([b.ours, b.theirs]).toEqual(['', '']);
    expect(await resolveConflictSide(r, 'm', 'theirs')).toBe(true);
    expect(await unmergedFiles(r)).toEqual([]);
    expect((await g(r, 'ls-files', '-s', '--', 'm')).stdout).toContain(`160000 ${shas[1]} 0`);
  });

  it('recusa arquivo fora do repositório e devolve false para o que não está em conflito', async () => {
    const r = await diverge((r) => put(r, 'f.txt', body('a')), (r) => put(r, 'f.txt', body('b')), (r) => put(r, 'f.txt', body('c')));
    await expect(resolveConflictSide(r, '../fora', 'ours')).rejects.toThrow();
    expect(await resolveConflictSide(r, 'nao-existe.txt', 'ours')).toBe(false);
  });
});
