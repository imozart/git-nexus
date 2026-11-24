import { describe, expect, it } from 'vitest';
import type { RepositoryMeta, SearchBatchEvent, SearchDone, SearchHit } from '@git-nexus/git-core/pure';
import { createMultiSearcher, defaultConcurrency, subId, type MultiDeps, type RunOne } from '../src/worker/multi-search';

const repo = (id: string, path = `/r/${id}`): RepositoryMeta => ({ id, name: id, path, lastOpenedAt: 0 }) as RepositoryMeta;
const hit = (file: string, line: number): SearchHit => ({ file, line, text: 'x', ranges: [[0, 1]], before: [], after: [] });
const doneOf = (id: string, patch: Partial<SearchDone> = {}): SearchDone => ({ id, ok: true, dialect: 'fixed', hits: 0, files: 0, skipped: [], cancelled: false, truncated: false, ms: 1, ...patch });

type Ev = { event: 'searchBatch'; data: SearchBatchEvent } | { event: 'searchDone'; data: SearchDone };

/** Monta um orquestrador com um "git" de mentira e devolve os eventos e quando cada repositório terminou. */
function setup(run: RunOne, exists: MultiDeps['exists'] = async () => true) {
  const events: Ev[] = [];
  let finished: () => void = () => undefined;
  const all = new Promise<void>((res) => (finished = res));
  const searcher = createMultiSearcher({
    run,
    exists,
    emit: (e) => {
      events.push(e);
    },
  });
  const dones = (): SearchDone[] => events.filter((e): e is Extract<Ev, { event: 'searchDone' }> => e.event === 'searchDone').map((e) => e.data);
  const waitFor = async (n: number): Promise<void> => {
    for (let i = 0; i < 400 && dones().length < n; i++) await new Promise((r) => setTimeout(r, 5));
    finished();
  };
  const batches = (): SearchBatchEvent[] => events.filter((e): e is Extract<Ev, { event: 'searchBatch' }> => e.event === 'searchBatch').map((e) => e.data);
  return { searcher, events, dones, batches, waitFor, all };
}

/** Um "git" que devolve `n` ocorrências em lotes de 10 e respeita o cancelamento. */
const emitting =
  (n: number, delay = 0): RunOne =>
  async (path, _q, { id, signal, onBatch }) => {
    let sent = 0;
    while (sent < n) {
      if (signal.aborted) return { done: doneOf(id, { cancelled: true, hits: sent }) };
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const k = Math.min(10, n - sent);
      onBatch(Array.from({ length: k }, (_, i) => hit(`${path}/f.ts`, sent + i + 1)));
      sent += k;
    }
    return { done: doneOf(id, { hits: sent, files: 1 }) };
  };

describe('busca em vários repositórios (orquestrador)', () => {
  it('cada repositório devolve os seus lotes e o seu fim, com o id <busca>#<repo> e o repoId', async () => {
    const s = setup(emitting(25));
    s.searcher.start([repo('a'), repo('b'), repo('c')], { pattern: 'x' }, 'S1');
    await s.waitFor(3);
    expect(s.dones().map((d) => d.id).sort()).toEqual([subId('S1', 'a'), subId('S1', 'b'), subId('S1', 'c')]);
    expect(s.dones().every((d) => d.ok && d.hits === 25 && ['a', 'b', 'c'].includes(d.repoId!))).toBe(true);
    expect(s.batches().every((b) => b.id === subId('S1', b.repoId!))).toBe(true);
    expect(s.batches().reduce((n, b) => n + b.hits.length, 0)).toBe(75);
  });

  it('a concorrência é limitada: nunca mais que N repositórios ao mesmo tempo, e todos acabam rodando', async () => {
    let now = 0;
    let peak = 0;
    const run: RunOne = async (_p, _q, { id }) => {
      now++;
      peak = Math.max(peak, now);
      await new Promise((r) => setTimeout(r, 15));
      now--;
      return { done: doneOf(id) };
    };
    const s = setup(run);
    s.searcher.start(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((i) => repo(i)), { pattern: 'x' }, 'S', { concurrency: 3 });
    await s.waitFor(7);
    expect(s.dones()).toHaveLength(7);
    expect(peak).toBe(3);
  });

  it('o padrão é no máximo 4 e nunca mais que a metade dos núcleos (mínimo 1)', () => {
    expect([defaultConcurrency(1), defaultConcurrency(2), defaultConcurrency(4), defaultConcurrency(8), defaultConcurrency(64)]).toEqual([1, 1, 2, 4, 4]);
  });

  it('a falha de um repositório não derruba os outros: pasta sumida, Git ausente e erro viram o estado dele', async () => {
    const run: RunOne = async (path, q, hooks) => {
      if (path.endsWith('/nogit')) throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
      if (path.endsWith('/boom')) throw new Error('explodiu');
      return emitting(5)(path, q, hooks);
    };
    const s = setup(run, async (p) => !p.endsWith('/gone'));
    s.searcher.start([repo('ok1'), repo('gone'), repo('nogit'), repo('boom'), repo('ok2')], { pattern: 'x' }, 'S');
    await s.waitFor(5);
    const by = Object.fromEntries(s.dones().map((d) => [d.repoId, d]));
    expect(by.ok1).toMatchObject({ ok: true, hits: 5 });
    expect(by.ok2).toMatchObject({ ok: true, hits: 5 });
    expect(by.gone).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(by.nogit).toMatchObject({ ok: false, reason: 'noGit' });
    expect(by.boom).toMatchObject({ ok: false, message: 'explodiu' });
    expect(by.boom!.reason).toBeUndefined();
  });

  it('o limite por repositório vai para a busca de cada um (a de um só repositório já o respeita)', async () => {
    const seen: Array<number | undefined> = [];
    const run: RunOne = async (_p, q, { id }) => {
      seen.push(q.limit);
      return { done: doneOf(id) };
    };
    const s = setup(run);
    s.searcher.start([repo('a'), repo('b')], { pattern: 'x', limit: 99999, offset: 7 }, 'S');
    await s.waitFor(2);
    expect(seen).toEqual([1000, 1000]);
    const s2 = setup(run);
    seen.length = 0;
    s2.searcher.start([repo('a')], { pattern: 'x' }, 'S', { perRepoLimit: 50 });
    await s2.waitFor(1);
    expect(seen).toEqual([50]);
  });

  it('o limite global é exato e para quem ainda roda; quem não começou diz "limite global" (ninguém some em silêncio)', async () => {
    const s = setup(emitting(1000, 1));
    s.searcher.start(['a', 'b', 'c', 'd', 'e'].map((i) => repo(i)), { pattern: 'x' }, 'S', { concurrency: 2, globalLimit: 250 });
    await s.waitFor(5);
    expect(s.batches().reduce((n, b) => n + b.hits.length, 0)).toBe(250);
    const d = s.dones();
    expect(d).toHaveLength(5);
    const cut = d.filter((x) => x.reason === 'globalLimit');
    expect(cut.length).toBeGreaterThanOrEqual(3); // pelo menos os que nem começaram
    expect(cut.every((x) => x.truncated && x.truncatedReason === 'limit' && !x.cancelled)).toBe(true);
    expect(d.every((x) => !x.cancelled)).toBe(true);
  });

  it('parar só um repositório (id#repo) deixa os outros seguirem; parar a busca (id) cancela todos', async () => {
    const s = setup(emitting(2000, 2));
    s.searcher.start([repo('a'), repo('b'), repo('c')], { pattern: 'x' }, 'S', { concurrency: 3 });
    await new Promise((r) => setTimeout(r, 30));
    expect(s.searcher.cancel(subId('S', 'b'))).toBe(true);
    await s.waitFor(1);
    expect(s.dones()[0]).toMatchObject({ repoId: 'b', cancelled: true });
    expect(s.dones()).toHaveLength(1); // os outros continuam
    expect(s.searcher.cancel('S')).toBe(true);
    await s.waitFor(3);
    expect(s.dones().filter((d) => d.cancelled)).toHaveLength(3);
    expect(s.searcher.cancel('S')).toBe(false); // já acabou: nada a cancelar
    expect(s.searcher.cancel('nada#x')).toBe(false);
  });

  it('cancelar a busca antes de um repositório começar o marca como cancelado, sem rodar', async () => {
    let ran = 0;
    const run: RunOne = async (_p, _q, { id, signal }) => {
      ran++;
      await new Promise((r) => setTimeout(r, 30));
      return { done: doneOf(id, { cancelled: signal.aborted }) };
    };
    const s = setup(run);
    s.searcher.start(['a', 'b', 'c', 'd'].map((i) => repo(i)), { pattern: 'x' }, 'S', { concurrency: 1 });
    await new Promise((r) => setTimeout(r, 10));
    s.searcher.cancel('S');
    await s.waitFor(4);
    expect(ran).toBe(1);
    expect(s.dones().every((d) => d.cancelled)).toBe(true);
  });

  it('o mesmo id recomeça: a busca antiga é cancelada', async () => {
    const s = setup(emitting(2000, 2));
    s.searcher.start([repo('a')], { pattern: 'x' }, 'S');
    await new Promise((r) => setTimeout(r, 20));
    s.searcher.start([repo('a')], { pattern: 'y' }, 'S');
    await s.waitFor(1);
    expect(s.dones()[0]).toMatchObject({ cancelled: true });
    s.searcher.cancel('S');
    await s.waitFor(2);
  });

  it('"sem a revisão" vem do núcleo e chega como está (não é erro)', async () => {
    const run: RunOne = async (_p, _q, { id }) => ({ done: doneOf(id, { ok: false, reason: 'noRevision', message: 'sem a revisão v9' }) });
    const s = setup(run);
    s.searcher.start([repo('a')], { pattern: 'x', scope: 'revision', revision: 'v9' }, 'S');
    await s.waitFor(1);
    expect(s.dones()[0]).toMatchObject({ ok: false, reason: 'noRevision', repoId: 'a' });
  });
});
