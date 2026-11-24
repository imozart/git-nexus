import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchHistoryStream, type HistoryHit } from '../src/index.js';

// Medição da busca na história (fase 9 da #233). Por padrão um repositório pequeno (rápido na CI); `GN_HIST_COMMITS=20000` mede o tamanho que a issue pede.
// `GN_HIST_KEEP=1` guarda o repositório em <TEMP>/gitnexus-hist-<N> para repetir (apague depois). Imprime `HIST <o que> <ms>`.
const N = Number(process.env.GN_HIST_COMMITS ?? 1500);
const KEEP = process.env.GN_HIST_KEEP === '1';
let root: string;
let repo: string;

function build(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  execFileSync('git', ['config', 'core.fsmonitor', 'false'], { cwd: dir }); // sem o daemon do Git (um por repositório) segurando a pasta
  // fast-import: milhares de commits em segundos, de uma vez só (cada commit parte do anterior); o commit 1 tem RARO (só nele) e a cada 50 há um MARCADOR
  const parts: string[] = [];
  for (let i = 1; i <= N; i++) {
    const msg = `mudança ${i}`;
    const body = ['texto ' + i, ...(i === 1 ? ['RARO'] : []), ...(i % 50 === 0 ? ['MARCADOR ' + i] : []), ''].join('\n');
    const when = 1_700_000_000 + i * 60;
    parts.push(
      [
        'commit refs/heads/main',
        `author P <p@e.com> ${when} +0000`,
        `committer P <p@e.com> ${when} +0000`,
        `data ${Buffer.byteLength(msg)}`,
        msg,
        `M 100644 inline d${i % 20}/f${i}.txt`,
        `data ${Buffer.byteLength(body)}`,
        body,
        '',
      ].join('\n'),
    );
  }
  execFileSync('git', ['fast-import', '--quiet', '--force'], { cwd: dir, input: parts.join(''), maxBuffer: 1 << 28 });
  execFileSync('git', ['reset', '-q', '--hard'], { cwd: dir });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-hist-perf-'));
  const kept = join(tmpdir(), `gitnexus-hist-${N}`);
  if (KEEP && existsSync(join(kept, '.git'))) repo = kept;
  else {
    repo = KEEP ? kept : join(root, 'repo');
    build(repo);
  }
}, 600_000);
afterAll(() => rmSync(root, { recursive: true, force: true }), 300_000);

describe(`busca na história em ${N} commits`, () => {
  it('o primeiro lote chega logo e a busca completa acha o que o Git acha', async () => {
    const t0 = Date.now();
    let first = -1;
    const hits: HistoryHit[] = [];
    const r = await searchHistoryStream(repo, { text: 'MARCADOR', limit: 1000 }, {
      onBatch: (h) => {
        if (first < 0) first = Date.now() - t0;
        hits.push(...h);
      },
    });
    const ms = Date.now() - t0;
    const want = Math.floor(N / 50);
    console.log(`HIST ${N} commits: primeiro-lote ${first} ms; página de ${hits.length} commits em ${ms} ms (examinados ${r.done.examined}/${r.done.total})`);
    expect(r.done.ok).toBe(true);
    expect(hits).toHaveLength(Math.min(want, 1000));
    expect(hits.every((h) => h.kind === 'added')).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('varrer a história inteira atrás de um texto que só está no primeiro commit', async () => {
    const t0 = Date.now();
    const r = await searchHistoryStream(repo, { text: 'RARO' });
    const ms = Date.now() - t0;
    console.log(`HIST ${N} commits: varredura completa (texto no commit mais antigo) ${ms} ms`);
    expect(r.hits.map((h) => h.subject)).toEqual(['mudança 1']);
    expect(r.done).toMatchObject({ ok: true, examined: N, total: N, truncated: false });
  }, 300_000);

  it('cancelar a varredura encerra o git em poucos milissegundos', async () => {
    const ctl = new AbortController();
    const t0 = Date.now();
    const p = searchHistoryStream(repo, { text: 'texto que nunca existe', caseSensitive: true }, { signal: ctl.signal });
    await new Promise((r) => setTimeout(r, 30));
    const tc = Date.now();
    ctl.abort();
    const r = await p;
    const cancel = Date.now() - tc;
    console.log(`HIST ${N} commits: cancelar ${cancel} ms (a busca já corria há ${tc - t0} ms)`);
    expect(r.done.cancelled).toBe(true);
    // a meta é 100 ms; a folga é para máquina carregada (o Windows leva ~50 ms só para encerrar o processo)
    expect(cancel).toBeLessThan(1000);
  }, 120_000);

  it('a primeira página de 200 commits e o "carregar mais"', async () => {
    const t0 = Date.now();
    const a = await searchHistoryStream(repo, { text: 'texto', mode: 'lines', limit: 200 });
    const m1 = Date.now() - t0;
    expect(a.done).toMatchObject({ count: 200, truncated: true, truncatedReason: 'limit' });
    const t1 = Date.now();
    const b = await searchHistoryStream(repo, { text: 'texto', mode: 'lines', limit: 200, skip: a.done.nextSkip });
    const m2 = Date.now() - t1;
    console.log(`HIST ${N} commits: página 1 (200 commits) ${m1} ms; página 2 ${m2} ms`);
    expect(b.hits).toHaveLength(200);
    expect(new Set([...a.hits, ...b.hits].map((h) => h.hash)).size).toBe(400);
  }, 120_000);
});
