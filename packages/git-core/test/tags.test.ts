import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTag, deleteTag, listRemoteTags, listTags, pushTag, runGit } from '../src/index.js';

let root: string;
let n = 0;
const g = (cwd: string, ...a: string[]) => runGit(cwd, a);
const out = async (cwd: string, ...a: string[]) => (await g(cwd, ...a)).stdout.trim();

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-tags-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function repo(withRemote = false): Promise<{ dir: string; bare?: string }> {
  const dir = join(root, `r${++n}`);
  await runGit(root, ['init', '-b', 'main', dir]);
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['tag.gpgsign', 'false']] as const) await g(dir, 'config', k, v);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  await g(dir, 'add', '.');
  await g(dir, 'commit', '-qm', 'feat: primeiro');
  if (!withRemote) return { dir };
  const bare = join(root, `bare${n}.git`);
  await runGit(root, ['init', '--bare', '-b', 'main', bare]);
  await g(dir, 'remote', 'add', 'origin', bare);
  await g(dir, 'push', '-q', '-u', 'origin', 'main');
  return { dir, bare };
}

describe('criar e listar', () => {
  it('tag leve no commit atual e tag anotada com mensagem multilinha', async () => {
    const { dir } = await repo();
    expect((await createTag(dir, { name: 'v1.0.0' })).ok).toBe(true);
    const r = await createTag(dir, { name: 'v1.1.0', message: 'Versão 1.1\n\nCom notas em duas linhas.' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/anotada/);
    const head = await out(dir, 'rev-parse', 'HEAD');
    const tags = await listTags(dir);
    expect(tags.map((t) => t.name).sort()).toEqual(['v1.0.0', 'v1.1.0']);
    const leve = tags.find((t) => t.name === 'v1.0.0')!;
    expect(leve).toMatchObject({ annotated: false, hash: head, subject: 'feat: primeiro' });
    const anot = tags.find((t) => t.name === 'v1.1.0')!;
    expect(anot).toMatchObject({ annotated: true, hash: head, tagger: 'T' }); // hash = o COMMIT, não o objeto da tag
    expect(anot.message).toBe('Versão 1.1\n\nCom notas em duas linhas.');
  });

  it('cria em outro commit (hash ou branch)', async () => {
    const { dir } = await repo();
    const first = await out(dir, 'rev-parse', 'HEAD');
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    await g(dir, 'add', '.');
    await g(dir, 'commit', '-qm', 'feat: segundo');
    expect((await createTag(dir, { name: 'antiga', target: first })).ok).toBe(true);
    expect((await listTags(dir)).find((t) => t.name === 'antiga')!.hash).toBe(first);
    expect((await createTag(dir, { name: 'na-branch', target: 'main' })).ok).toBe(true);
  });

  it('recusa nome inválido, repetido, destino inexistente e opção disfarçada', async () => {
    const { dir } = await repo();
    await createTag(dir, { name: 'v1' });
    expect((await createTag(dir, { name: '' })).message).toMatch(/nome da tag/);
    expect((await createTag(dir, { name: 'com espaço' })).ok).toBe(false);
    expect((await createTag(dir, { name: 'a..b' })).ok).toBe(false);
    expect((await createTag(dir, { name: '-d' })).message).toMatch(/"-"/);
    expect((await createTag(dir, { name: 'v1' })).message).toMatch(/Já existe/);
    expect((await createTag(dir, { name: 'novo', target: 'naoexiste' })).message).toMatch(/Não encontrei/);
    expect((await createTag(dir, { name: 'novo', target: '--all' })).ok).toBe(false);
    expect((await listTags(dir)).map((t) => t.name)).toEqual(['v1']);
  });

  it('repositório sem tags devolve lista vazia', async () => {
    const { dir } = await repo();
    expect(await listTags(dir)).toEqual([]);
  });
});

describe('remoto', () => {
  it('enviar uma tag e consultar o que o remoto tem', async () => {
    const { dir } = await repo(true);
    await createTag(dir, { name: 'v1' });
    await createTag(dir, { name: 'v2', message: 'dois' });
    expect(await listRemoteTags(dir)).toMatchObject({ ok: true, remote: 'origin', names: [] });
    expect((await pushTag(dir, 'v1')).ok).toBe(true);
    expect((await listRemoteTags(dir)).names).toEqual(['v1']);
    expect((await pushTag(dir)).ok).toBe(true); // todas
    expect((await listRemoteTags(dir)).names.sort()).toEqual(['v1', 'v2']);
  });

  it('apagar local não mexe no remoto; apagar no remoto não mexe no local', async () => {
    const { dir } = await repo(true);
    await createTag(dir, { name: 'v1' });
    await pushTag(dir, 'v1');
    const d = await deleteTag(dir, 'v1');
    expect(d.ok).toBe(true);
    expect(d.message).toMatch(/só localmente/);
    expect(await listTags(dir)).toEqual([]);
    expect((await listRemoteTags(dir)).names).toEqual(['v1']);
    const r = await deleteTag(dir, 'v1', true);
    expect(r.ok).toBe(true);
    expect((await listRemoteTags(dir)).names).toEqual([]);
  });

  it('o envio nunca força: tag com o mesmo nome em outro commit é recusada', async () => {
    const { dir, bare } = await repo(true);
    await createTag(dir, { name: 'v1' });
    await pushTag(dir, 'v1');
    writeFileSync(join(dir, 'b.txt'), 'b\n');
    await g(dir, 'add', '.');
    await g(dir, 'commit', '-qm', 'feat: segundo');
    await g(dir, 'tag', '-f', 'v1'); // a local agora aponta para outro commit
    const r = await pushTag(dir, 'v1');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/recusado|nada é forçado/);
    expect(await out(bare!, 'rev-parse', 'refs/tags/v1')).not.toBe(await out(dir, 'rev-parse', 'HEAD'));
  });

  it('sem remoto: avisa em vez de falhar', async () => {
    const { dir } = await repo();
    await createTag(dir, { name: 'v1' });
    expect((await pushTag(dir, 'v1')).message).toMatch(/não tem remoto/);
    expect(await listRemoteTags(dir)).toMatchObject({ ok: false });
    expect((await deleteTag(dir, 'v1', true)).ok).toBe(false);
  });

  it('apagar tag que não existe devolve explicação', async () => {
    const { dir } = await repo();
    expect((await deleteTag(dir, 'nao-existe')).ok).toBe(false);
    expect((await deleteTag(dir, '--force')).ok).toBe(false);
  });
});
