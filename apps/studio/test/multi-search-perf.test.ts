import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit } from '@git-nexus/git-core';
import type { SearchDone } from '@git-nexus/git-core/pure';
import { createHandlers, type HandlerEvent } from '../src/worker/handlers';

// Metas da busca em vários repositórios (fase 8 da #233): 10 repositórios de 5 mil arquivos, primeiro lote em até 500 ms e Parar cancelando todos em até 100 ms.
// Por padrão roda pequeno (10 x 300, folga larga); `GN_MULTI_FILES=5000` mede de verdade e imprime os tempos (os arquivos só são escritos, sem commit: o git grep
// procura também os novos). `GN_MULTI_KEEP=1` guarda os repositórios gerados na pasta temporária e os reaproveita.
const REPOS = 10;
const N = Number(process.env.GN_MULTI_FILES ?? 300);
const strict = N >= 5000;
let root: string;
let handlers: ReturnType<typeof createHandlers>;
const events: HandlerEvent[] = [];
const ids: string[] = [];

beforeAll(async () => {
  const keep = !!process.env.GN_MULTI_KEEP;
  root = keep ? join(tmpdir(), `gitnexus-multi-${N}`) : mkdtempSync(join(tmpdir(), 'gitnexus-multi-'));
  handlers = createHandlers(join(root, 'data'), (e) => events.push(e));
  for (let r = 0; r < REPOS; r++) {
    const dir = join(root, `repo${r}`);
    try {
      await runGit(dir, ['rev-parse', '--git-dir']);
    } catch {
      mkdirSync(dir, { recursive: true });
      await runGit(root, ['init', '-b', 'main', dir]);
      await runGit(dir, ['config', 'core.fsmonitor', 'false']);
      for (let d = 0; d < N / 100; d++) {
        mkdirSync(join(dir, `p${d}`), { recursive: true });
        for (let f = 0; f < 100; f++) writeFileSync(join(dir, `p${d}`, `f${f}.ts`), `export const v${d}_${f} = ${f};\n// ${f % 50 === 0 ? 'AGULHA' : 'palha'} ${d}\n`.repeat(10));
      }
    }
    ids.push(((await handlers.addRepositoryPath(dir)) as { id: string }).id);
  }
}, 1_200_000);
afterAll(() => {
  if (!process.env.GN_MULTI_KEEP) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}, 120_000);

const dones = (id: string): SearchDone[] => events.filter((e): e is Extract<HandlerEvent, { event: 'searchDone' }> => e.event === 'searchDone' && e.data.id.startsWith(`${id}#`)).map((e) => e.data);
async function waitAll(id: string, ms = 120_000): Promise<void> {
  const end = Date.now() + ms;
  while (dones(id).length < REPOS && Date.now() < end) await new Promise((r) => setTimeout(r, 2));
}

describe(`vários repositórios (${REPOS} x ${N} arquivos)`, () => {
  it('o primeiro lote chega rápido, todos terminam e nenhum derruba outro', async () => {
    await handlers.startMultiSearch(ids, { pattern: 'palha' }, 'warm'); // aquece o cache do sistema
    await waitAll('warm');
    const t0 = Date.now();
    await handlers.startMultiSearch(ids, { pattern: 'AGULHA' }, 'p1');
    let first = 0;
    while (!first && Date.now() - t0 < 30_000) {
      if (events.some((e) => e.event === 'searchBatch' && e.data.id.startsWith('p1#'))) first = Date.now() - t0;
      else await new Promise((r) => setTimeout(r, 1));
    }
    await waitAll('p1');
    const total = Date.now() - t0;
    const d = dones('p1');
    process.stderr.write(`\nMULTI repositorios=${REPOS} arquivos=${N} primeiro-lote=${first}ms total=${total}ms ocorrencias=${d.reduce((n, x) => n + x.hits, 0)}\n`);
    expect(d).toHaveLength(REPOS);
    expect(d.every((x) => x.ok && !x.cancelled)).toBe(true);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(strict ? 500 : 2000);
  }, 300_000);

  it('Parar cancela todos os repositórios (em andamento e na fila) em poucos milissegundos', async () => {
    await handlers.startMultiSearch(ids, { pattern: 'ZZZ_NUNCA_EXISTE_ZZZ' }, 'p2'); // varre tudo, sem nenhum resultado: está sempre correndo
    await new Promise((r) => setTimeout(r, 40));
    const c0 = Date.now();
    await handlers.cancelSearch('p2');
    await waitAll('p2');
    const cancel = Date.now() - c0;
    const d = dones('p2');
    process.stderr.write(`MULTI cancelar-todos=${cancel}ms cancelados=${d.filter((x) => x.cancelled).length}/${REPOS}\n`);
    expect(d).toHaveLength(REPOS);
    expect(d.filter((x) => x.cancelled).length).toBeGreaterThanOrEqual(1);
    expect(d.every((x) => x.cancelled || x.ok)).toBe(true);
    expect(cancel).toBeLessThan(strict ? 100 : 1500);
  }, 120_000);

  it('o limite global corta no meio e quem não coube diz "limite global"', async () => {
    await handlers.startMultiSearch(ids, { pattern: 'palha' }, 'p3', { globalLimit: 1500, perRepoLimit: 1000 });
    await waitAll('p3');
    const d = dones('p3');
    const hits = events.filter((e): e is Extract<HandlerEvent, { event: 'searchBatch' }> => e.event === 'searchBatch' && e.data.id.startsWith('p3#')).reduce((n, e) => n + e.data.hits.length, 0);
    process.stderr.write(`MULTI limite-global=1500 recebidas=${hits} cortados=${d.filter((x) => x.reason === 'globalLimit').length}\n`);
    expect(hits).toBe(1500);
    expect(d).toHaveLength(REPOS);
    expect(d.some((x) => x.reason === 'globalLimit' && x.truncated)).toBe(true);
  }, 120_000);
});
