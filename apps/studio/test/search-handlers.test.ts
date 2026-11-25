import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit } from '@git-nexus/git-core';
import type { HistoryBatchEvent, HistoryDone, SearchBatchEvent, SearchDone } from '@git-nexus/git-core/pure';
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

describe('startMultiSearch (vários repositórios)', () => {
  const mk = async (name: string, files: Record<string, string>): Promise<{ id: string; path: string }> => {
    const p = join(root, name);
    await runGit(root, ['init', '-b', 'main', p]);
    for (const [f, c] of Object.entries(files)) writeFileSync(join(p, f), c);
    const meta = (await handlers.addRepositoryPath(p)) as { id: string; path: string };
    return meta;
  };
  const sub = (id: string, repoId: string) => `${id}#${repoId}`;
  const waitAll = async (id: string, ids: string[]): Promise<Record<string, SearchDone>> => {
    const out: Record<string, SearchDone> = {};
    for (const r of ids) out[r] = await done(sub(id, r));
    return out;
  };

  it('procura em cada repositório do catálogo, com o id <busca>#<repo> e o repoId; um indisponível e um id de fora ficam de lado', async () => {
    const a = await mk('mr-a', { 'a.txt': 'alvo aqui\n' });
    const b = await mk('mr-b', { 'b.txt': 'nada\nalvo la\nalvo de novo\n' });
    const gone = await mk('mr-gone', { 'g.txt': 'alvo\n' });
    rmSync(gone.path, { recursive: true, force: true });
    const started = (await handlers.startMultiSearch([a.id, b.id, gone.id, '/etc', 'nao-existe'], { pattern: 'alvo' }, 'm1')) as { repos: Array<{ repoId: string; id: string }>; rejected: string[] };
    expect(started.rejected).toEqual(['/etc', 'nao-existe']); // só o catálogo: um caminho digitado no lugar do id nunca roda
    expect(started.repos.map((r) => r.id)).toEqual([sub('m1', a.id), sub('m1', b.id), sub('m1', gone.id)]);
    const d = await waitAll('m1', [a.id, b.id, gone.id]);
    expect(d[a.id]).toMatchObject({ ok: true, hits: 1, repoId: a.id });
    expect(d[b.id]).toMatchObject({ ok: true, hits: 2, repoId: b.id });
    expect(d[gone.id]).toMatchObject({ ok: false, reason: 'unavailable' });
    const batch = events.filter((e): e is { event: 'searchBatch'; data: SearchBatchEvent } => e.event === 'searchBatch' && e.data.id.startsWith('m1#'));
    expect(batch.every((e) => e.data.repoId && e.data.id === sub('m1', e.data.repoId))).toBe(true);
    expect(batch.map((e) => e.data.hits.length).reduce((x, y) => x + y, 0)).toBe(3);
  });

  it('"sem a revisão" aparece só no repositório que não a tem (não é erro dos outros)', async () => {
    const a = await mk('mr-rev-a', { 'a.txt': 'alvo\n' });
    const b = await mk('mr-rev-b', { 'b.txt': 'alvo\n' });
    for (const [r, tag] of [[a, true], [b, false]] as const) {
      await runGit(r.path, ['add', '.']);
      await runGit(r.path, ['-c', 'user.name=T', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'x']);
      if (tag) await runGit(r.path, ['tag', 'v9']);
    }
    await handlers.startMultiSearch([a.id, b.id], { pattern: 'alvo', scope: 'revision', revision: 'v9' }, 'm2');
    const d = await waitAll('m2', [a.id, b.id]);
    expect(d[a.id]).toMatchObject({ ok: true, hits: 1 });
    expect(d[b.id]).toMatchObject({ ok: false, reason: 'noRevision' });
  });

  it('cancelSearch(id#repo) para só aquele; cancelSearch(id) para todos', async () => {
    const a = await mk('mr-c-a', { 'a.txt': 'alvo\n' });
    await handlers.startMultiSearch([a.id], { pattern: 'alvo' }, 'm3');
    await handlers.cancelSearch('m3');
    const d = await done(sub('m3', a.id));
    expect(d.repoId).toBe(a.id);
    await expect(handlers.cancelSearch(sub('m3', 'x'))).resolves.toBeUndefined();
  });
});

describe('startHistorySearch (busca na história)', () => {
  const hdone = async (id: string): Promise<HistoryDone> => {
    for (let i = 0; i < 400; i++) {
      const e = events.find((x) => x.event === 'historyDone' && x.data.id === id);
      if (e) return e.data as HistoryDone;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('a busca na história não terminou');
  };
  const hbatches = (id: string) => events.filter((e): e is { event: 'historyBatch'; data: HistoryBatchEvent } => e.event === 'historyBatch' && e.data.id === id);
  let hrepo: string;
  const commit = async (msg: string, content: string) => {
    writeFileSync(join(hrepo, 'f.txt'), content);
    await runGit(hrepo, ['add', '.']);
    await runGit(hrepo, ['-c', 'user.name=T', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', msg]);
  };
  beforeAll(async () => {
    hrepo = join(root, 'hist');
    await runGit(root, ['init', '-b', 'main', hrepo]);
    await commit('um', 'a\nagulha\n');
    await commit('dois', 'a\n');
    await commit('tres', 'a\nagulha\nagulha\n');
  });

  it('volta na hora; os commits chegam em lotes com o id do chamador e o fim traz o resumo', async () => {
    await handlers.startHistorySearch(hrepo, { text: 'agulha' }, 'h1');
    const d = await hdone('h1');
    expect(d).toMatchObject({ id: 'h1', ok: true, count: 3, cancelled: false, truncated: false, total: 3, examined: 3 });
    const hits = hbatches('h1').flatMap((b) => b.data.hits);
    expect(hits.map((h) => [h.subject, h.kind])).toEqual([['tres', 'added'], ['dois', 'removed'], ['um', 'added']]);
  });

  it('cancelar encerra (cancelled) e o mesmo id reiniciado cancela a anterior', async () => {
    await handlers.startHistorySearch(hrepo, { text: 'agulha' }, 'h2');
    await handlers.cancelSearch('h2');
    expect((await hdone('h2')).cancelled).toBe(true);
    await handlers.startHistorySearch(hrepo, { text: 'agulha' }, 'h3');
    await handlers.startHistorySearch(hrepo, { text: 'a', mode: 'message' }, 'h3');
    const finals: HistoryDone[] = [];
    for (let i = 0; i < 400 && finals.length < 2; i++) {
      finals.length = 0;
      finals.push(...events.filter((e): e is { event: 'historyDone'; data: HistoryDone } => e.event === 'historyDone' && e.data.id === 'h3').map((e) => e.data));
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(finals).toHaveLength(2);
  });

  it('pedido recusado chega como fim com a mensagem, sem lançar', async () => {
    await handlers.startHistorySearch(hrepo, { text: 'x', include: '../fora' }, 'h4');
    expect(await hdone('h4')).toMatchObject({ ok: false });
  });
});

describe('índice de busca (getSearchIndex / configureSearchIndex / controlSearchIndex)', () => {
  let irepo: string;
  let idata: string;
  let ih: ReturnType<typeof createHandlers>;
  const ievents: HandlerEvent[] = [];
  const state = async () => ((await ih.getSearchIndex(irepo)) as { state: string }).state;

  beforeAll(async () => {
    irepo = join(root, 'irepo');
    idata = join(root, 'idata');
    await runGit(root, ['init', '-b', 'main', irepo]);
    for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.fsmonitor', 'false']] as const) await runGit(irepo, ['config', k, v]);
    for (let f = 0; f < 30; f++) writeFileSync(join(irepo, `f${f}.txt`), `linha ${f}\n${f === 7 ? 'AGULHAUNICA\n' : ''}`);
    await runGit(irepo, ['add', '-A']);
    await runGit(irepo, ['commit', '-qm', 'tudo']);
    ih = createHandlers(idata, (e) => ievents.push(e));
  }, 60_000);

  it('começa sem índice, em modo automático, e o modo e o limite mudam', async () => {
    expect(await ih.getSearchIndex(irepo)).toMatchObject({ state: 'none', mode: 'auto', files: 0 });
    expect(await ih.configureSearchIndex(irepo, { mode: 'never' })).toMatchObject({ mode: 'never' });
    expect(await ih.configureSearchIndex(irepo, { mode: 'qualquer' as never, limitMB: 64 })).toMatchObject({ mode: 'never', limitBytes: 64 * 1024 * 1024 });
    expect(await ih.configureSearchIndex(irepo, { mode: 'auto' })).toMatchObject({ mode: 'auto' });
  });

  it('ação desconhecida é recusada', async () => {
    await expect(ih.controlSearchIndex(irepo, 'apagar-tudo' as never)).rejects.toThrow();
  });

  it('constrói em segundo plano, avisa o andamento pelo evento e as buscas passam a usar o índice', async () => {
    await ih.controlSearchIndex(irepo, 'build');
    for (let i = 0; i < 400 && (await state()) !== 'ready'; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await state()).toBe('ready');
    const fromEvents = () => ievents.filter((e) => e.event === 'searchIndex').map((e) => (e.data as { state: string }).state);
    for (let i = 0; i < 100 && fromEvents()[fromEvents().length - 1] !== 'ready'; i++) await new Promise((r) => setTimeout(r, 50)); // o evento de "pronto" sai logo depois de o estado mudar
    expect(fromEvents()).toContain('building');
    expect(fromEvents()[fromEvents().length - 1]).toBe('ready');
    await ih.startSearch(irepo, { pattern: 'AGULHAUNICA' }, 'i1');
    let d: SearchDone | undefined;
    for (let i = 0; i < 200 && !d; i++) {
      d = ievents.find((e) => e.event === 'searchDone' && e.data.id === 'i1')?.data as SearchDone | undefined;
      if (!d) await new Promise((r) => setTimeout(r, 25));
    }
    expect(d).toMatchObject({ ok: true, hits: 1, files: 1 });
    expect(d!.accelerated?.candidates).toBe(1);
  });

  it('tirar o repositório do app apaga o índice dele', async () => {
    const meta = (await ih.addRepositoryPath(irepo)) as { id: string };
    const dir = join(idata, 'search-index');
    expect(existsSync(dir)).toBe(true);
    await ih.removeRepository(meta.id);
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
    expect(await state()).toBe('none');
  });
});
