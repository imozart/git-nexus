import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyStash,
  createStash,
  dropStash,
  getStashFileDiff,
  getStashFiles,
  listStashes,
  parseStashSubject,
  renameStash,
  restoreStashFiles,
  runGit,
} from '../src/index.js';

const dirs: string[] = [];
async function newRepo(): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), 'gitnexus-stash-'));
  dirs.push(repo);
  const g = (...a: string[]) => runGit(repo, a);
  await g('init', '-b', 'main');
  await g('config', 'user.name', 'T');
  await g('config', 'user.email', 't@e.com');
  await g('config', 'commit.gpgsign', 'false');
  await g('config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'a.txt'), 'a1\n');
  writeFileSync(join(repo, 'b.txt'), 'b1\n');
  await g('add', '.');
  await g('commit', '-m', 'init');
  return repo;
}
const read = (repo: string, f: string) => readFileSync(join(repo, f), 'utf8');
const porcelain = async (repo: string) => (await runGit(repo, ['status', '--porcelain'])).stdout;

afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
beforeEach(() => undefined);

describe('parseStashSubject', () => {
  it('separa nome, branch e o WIP padrão', () => {
    expect(parseStashSubject('On main: meu ajuste')).toEqual({ branch: 'main', message: 'meu ajuste', named: true });
    expect(parseStashSubject('WIP on dev: abc1234 feat: algo')).toEqual({ branch: 'dev', message: 'feat: algo', named: false });
    expect(parseStashSubject('estranho')).toMatchObject({ message: 'estranho', named: false });
  });
});

describe('stash com nome (repositório real)', () => {
  it('cria com nome, lista, e o disco volta limpo', async () => {
    const repo = await newRepo();
    writeFileSync(join(repo, 'a.txt'), 'a2\n');
    const e = await createStash(repo, { message: 'ajuste do login' });
    expect(e).toMatchObject({ ref: 'stash@{0}', message: 'ajuste do login', branch: 'main', named: true });
    expect(await porcelain(repo)).toBe('');
    expect((await listStashes(repo)).map((s) => s.message)).toEqual(['ajuste do login']);
  });

  it('sem alterações, avisa em português', async () => {
    const repo = await newRepo();
    await expect(createStash(repo, { message: 'nada' })).rejects.toThrow('Não há alterações locais');
  });

  it('guarda só os arquivos escolhidos e, com untracked, os novos', async () => {
    const repo = await newRepo();
    writeFileSync(join(repo, 'a.txt'), 'a2\n');
    writeFileSync(join(repo, 'b.txt'), 'b2\n');
    writeFileSync(join(repo, 'novo.txt'), 'n\n');
    await createStash(repo, { message: 'só a', paths: ['a.txt'] });
    expect(read(repo, 'a.txt')).toBe('a1\n');
    expect(read(repo, 'b.txt')).toBe('b2\n'); // não foi guardado

    await createStash(repo, { message: 'com novo', includeUntracked: true });
    expect(existsSync(join(repo, 'novo.txt'))).toBe(false);
    const list = await listStashes(repo);
    expect(list.map((s) => s.message)).toEqual(['com novo', 'só a']);
    const files = await getStashFiles(repo, 'stash@{0}');
    expect(files).toEqual([
      { path: 'b.txt', status: 'M', untracked: false },
      { path: 'novo.txt', status: 'A', untracked: true },
    ]);
    expect(await getStashFileDiff(repo, 'stash@{0}', 'b.txt')).toContain('+b2');
    expect(await getStashFileDiff(repo, 'stash@{0}', 'novo.txt')).toContain('+n');
  });

  it('restauração parcial traz só o arquivo escolhido, sem remover o stash', async () => {
    const repo = await newRepo();
    writeFileSync(join(repo, 'a.txt'), 'a2\n');
    writeFileSync(join(repo, 'b.txt'), 'b2\n');
    writeFileSync(join(repo, 'novo.txt'), 'n\n');
    await createStash(repo, { message: 'tudo', includeUntracked: true });

    await restoreStashFiles(repo, 'stash@{0}', ['b.txt', 'novo.txt']);
    expect(read(repo, 'b.txt')).toBe('b2\n');
    expect(read(repo, 'novo.txt')).toBe('n\n');
    expect(read(repo, 'a.txt')).toBe('a1\n'); // não pedido
    expect((await listStashes(repo)).length).toBe(1); // o stash continua

    // arquivo com alteração local: recusa, e só sobrescreve com confirmação
    writeFileSync(join(repo, 'b.txt'), 'local\n');
    await expect(restoreStashFiles(repo, 'stash@{0}', ['b.txt'])).rejects.toThrow(/alterações locais/);
    await restoreStashFiles(repo, 'stash@{0}', ['b.txt'], true);
    expect(read(repo, 'b.txt')).toBe('b2\n');
    await expect(restoreStashFiles(repo, 'stash@{0}', ['inexistente.txt'])).rejects.toThrow(/não está no stash/);
  });

  it('aplicar mantém o stash; pop remove', async () => {
    const repo = await newRepo();
    writeFileSync(join(repo, 'a.txt'), 'a2\n');
    await createStash(repo, { message: 'um' });
    const r1 = await applyStash(repo, 'stash@{0}');
    expect(r1).toMatchObject({ conflicts: false });
    expect(read(repo, 'a.txt')).toBe('a2\n');
    expect((await listStashes(repo)).length).toBe(1);

    await runGit(repo, ['checkout', '--', 'a.txt']);
    const r2 = await applyStash(repo, 'stash@{0}', true);
    expect(r2.message).toContain('removido');
    expect((await listStashes(repo)).length).toBe(0);
  });

  it('conflito ao aplicar: avisa e mantém o stash', async () => {
    const repo = await newRepo();
    writeFileSync(join(repo, 'a.txt'), 'stash\n');
    await createStash(repo, { message: 'conflita' });
    writeFileSync(join(repo, 'a.txt'), 'outra\n');
    await runGit(repo, ['commit', '-am', 'outra']);
    const r = await applyStash(repo, 'stash@{0}', true);
    expect(r.conflicts).toBe(true);
    expect((await listStashes(repo)).length).toBe(1);
  });

  it('renomeia e exclui', async () => {
    const repo = await newRepo();
    writeFileSync(join(repo, 'a.txt'), 'a2\n');
    await createStash(repo, { message: 'antigo' });
    writeFileSync(join(repo, 'b.txt'), 'b2\n');
    await createStash(repo, { message: 'outro' });
    await renameStash(repo, 'stash@{1}', 'novo nome');
    expect((await listStashes(repo)).map((s) => s.message)).toEqual(['novo nome', 'outro']);
    await dropStash(repo, 'stash@{0}');
    expect((await listStashes(repo)).map((s) => s.message)).toEqual(['outro']);
    await expect(renameStash(repo, 'stash@{0}', '  ')).rejects.toThrow('Informe um nome');
  });

  it('rejeita referências inválidas (nada de injeção de argumentos)', async () => {
    const repo = await newRepo();
    await expect(dropStash(repo, '--all')).rejects.toThrow('inválida');
    await expect(getStashFiles(repo, 'HEAD')).rejects.toThrow('inválida');
    await expect(createStash(repo, { message: 'x', paths: ['../fora'] })).rejects.toThrow();
  });
});
