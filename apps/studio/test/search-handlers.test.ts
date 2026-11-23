import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit } from '@git-nexus/git-core';
import type { SearchBatchEvent, SearchDone } from '@git-nexus/git-core/pure';
import { createHandlers, type HandlerEvent } from '../src/worker/handlers';

// `startSearch` / `cancelSearch` no worker: o id é do chamador, os lotes e o fim sobem como eventos e cancelar encerra de verdade.
let root: string;
let repo: string;
const events: HandlerEvent[] = [];
let handlers: ReturnType<typeof createHandlers>;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-sh-'));
  repo = join(root, 'repo');
  await runGit(root, ['init', '-b', 'main', repo]);
  for (let d = 0; d < 10; d++) {
    mkdirSync(join(repo, `p${d}`));
    for (let f = 0; f < 20; f++) writeFileSync(join(repo, `p${d}`, `f${f}.txt`), 'linha agulha\noutra linha\n'.repeat(5));
  }
  handlers = createHandlers(join(root, 'data'), (e) => events.push(e));
}, 60_000);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const done = async (id: string): Promise<SearchDone> => {
  for (let i = 0; i < 400; i++) {
    const e = events.find((x) => x.event === 'searchDone' && x.data.id === id);
    if (e) return e.data as SearchDone;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('a busca não terminou');
};
const batches = (id: string) => events.filter((e): e is { event: 'searchBatch'; data: SearchBatchEvent } => e.event === 'searchBatch' && e.data.id === id);

describe('startSearch / cancelSearch', () => {
  it('volta na hora, manda os lotes com o id do chamador e termina com o resumo', async () => {
    await handlers.startSearch(repo, { pattern: 'agulha' }, 'a1');
    const d = await done('a1');
    expect(d).toMatchObject({ id: 'a1', ok: true, cancelled: false, dialect: 'fixed' });
    const total = batches('a1').reduce((n, b) => n + b.data.hits.length, 0);
    expect(total).toBe(d.hits);
    expect(d.hits).toBe(10 * 20 * 5);
    expect(d.files).toBe(200);
  });

  it('cancelar encerra a busca (cancelled) e uma busca nova com o mesmo id cancela a anterior', async () => {
    await handlers.startSearch(repo, { pattern: 'agulha' }, 'a2');
    await handlers.cancelSearch('a2');
    expect((await done('a2')).cancelled).toBe(true);
    await handlers.startSearch(repo, { pattern: 'agulha' }, 'a3');
    await handlers.startSearch(repo, { pattern: 'outra' }, 'a3');
    const finals = [];
    for (let i = 0; i < 400 && finals.length < 2; i++) {
      finals.length = 0;
      finals.push(...events.filter((e) => e.event === 'searchDone' && e.data.id === 'a3'));
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(finals.map((e) => (e.data as SearchDone).cancelled).sort()).toEqual([false, true]);
  });

  it('cancelar uma busca que não existe (ou já acabou) não faz nada', async () => {
    await expect(handlers.cancelSearch('nao-existe')).resolves.toBeUndefined();
    await expect(handlers.cancelSearch('a1')).resolves.toBeUndefined();
  });

  it('erro do pedido (revisão inválida) chega como fim com a mensagem, sem lançar', async () => {
    await handlers.startSearch(repo, { pattern: 'x', scope: 'revision', revision: '--output=x' }, 'a4');
    expect(await done('a4')).toMatchObject({ ok: false });
  });
});
