import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SearchIndexes, indexKey, runGit, searchRepository, type SearchHit } from '../src/index.js';

// Medição do índice de busca (fase 10 da #233). Padrão: um repositório pequeno (rápido na CI). `GN_INDEX_FILES=100000` mede o tamanho que a issue pede.
// `GN_INDEX_KEEP=1` guarda o repositório em <TEMP>/gitnexus-index-<N> (e o índice em <TEMP>/gitnexus-index-<N>-data) para repetir (apague depois).
// Imprime linhas `INDEX <o que> <valor>`. O repositório é de texto de código: ~2 KB por arquivo, 60 palavras de um vocabulário de 8 mil, e poucas palavras raras.
const N = Number(process.env.GN_INDEX_FILES ?? 2000);
const KEEP = process.env.GN_INDEX_KEEP === '1';
const SMALL = N < 20_000;
let root: string;
let repo: string;
let data: string;
let idx: SearchIndexes;
let textBytes = 0;

/** Gerador pseudoaleatório fixo: o mesmo repositório em toda execução. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  }
}
const VOCAB = (() => {
  const r = rng(7);
  return Array.from({ length: 8000 }, () => 'w' + Math.floor(r() * 36 ** 6).toString(36).padStart(5, '0'));
})();
const rareOf = (i: number) => `rare${i.toString(36)}x`;

function fileText(i: number): string {
  const r = rng(i * 7919 + 13);
  const lines: string[] = [];
  for (let l = 0; l < 30; l++) {
    const words: string[] = [];
    for (let w = 0; w < 8; w++) words.push(VOCAB[Math.floor(r() ** 2 * VOCAB.length)]!); // palavras comuns aparecem muito mais que as raras
    lines.push(`  const ${words[0]} = ${words[1]}(${words[2]}, '${words[3]} ${words[4]}'); // ${words[5]} ${words[6]} ${words[7]}`);
  }
  if (i % 50 === 0) lines.push(`// ${rareOf(i)} marca o arquivo ${i}`);
  return lines.join('\n') + '\n';
}

async function build(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  await runGit(dir, ['init', '-q', '-b', 'main']);
  await runGit(dir, ['config', 'core.fsmonitor', 'false']);
  await runGit(dir, ['config', 'core.autocrlf', 'false']);
  await runGit(dir, ['config', 'user.name', 'P']);
  await runGit(dir, ['config', 'user.email', 'p@e.com']);
  const fi = spawn('git', ['fast-import', '--quiet', '--force'], { cwd: dir, stdio: ['pipe', 'ignore', 'inherit'] });
  const done = new Promise<void>((res, rej) => {
    fi.on('error', rej);
    fi.on('close', (c) => (c === 0 ? res() : rej(new Error(`fast-import ${c}`))));
  });
  const send = async (s: string) => {
    if (!fi.stdin.write(s)) await new Promise((r) => fi.stdin.once('drain', r));
  };
  await send('commit refs/heads/main\ncommitter P <p@e.com> 1700000000 +0000\ndata 5\ntudo\n');
  for (let i = 0; i < N; i++) {
    const body = fileText(i);
    textBytes += Buffer.byteLength(body);
    await send(`M 100644 inline p${i % 200}/d${(i >> 3) % 50}/f${i}.ts\ndata ${Buffer.byteLength(body)}\n${body}\n`);
  }
  fi.stdin.end();
  await done;
  await runGit(dir, ['reset', '-q', '--hard']);
}

const waitReady = async (max = 3_600_000) => {
  const end = Date.now() + max;
  for (;;) {
    const i = await idx.info(repo);
    if (i.state === 'ready' && !i.progress) return i;
    if (i.state === 'error') throw new Error(i.message);
    if (Date.now() > end) throw new Error('índice não ficou pronto');
    await new Promise((r) => setTimeout(r, 200));
  }
};
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
const dirSize = (d: string): number => readdirSync(d).reduce((n, f) => n + statSync(join(d, f)).size, 0);

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-index-perf-'));
  const kept = join(tmpdir(), `gitnexus-index-${N}`);
  if (KEEP && existsSync(join(kept, '.git'))) {
    repo = kept;
    textBytes = -1;
  } else {
    repo = KEEP ? kept : join(root, 'repo');
    const t0 = Date.now();
    await build(repo);
    console.log(`INDEX ${N} arquivos: repositório gerado em ${Math.round((Date.now() - t0) / 1000)} s (${Math.round(textBytes / 1048576)} MB de texto)`);
  }
  data = KEEP ? join(tmpdir(), `gitnexus-index-${N}-data`) : join(root, 'data');
  idx = new SearchIndexes(data);
}, 3_600_000);

afterAll(async () => {
  await idx?.disposeAll();
  if (!KEEP) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  else rmSync(root, { recursive: true, force: true });
}, 600_000);

describe(`índice de busca em ${N} arquivos`, () => {
  it('constrói em segundo plano, com o pico de memória e o tamanho', async () => {
    const base = process.memoryUsage().rss;
    let peak = base;
    const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 100);
    const t0 = Date.now();
    const cur = await idx.info(repo);
    if (cur.state !== 'ready') await idx.control(repo, 'build');
    const info = await waitReady();
    clearInterval(timer);
    const dir = join(data, indexKey(repo));
    const size = dirSize(dir);
    const ratio = textBytes > 0 ? size / textBytes : NaN;
    console.log(`INDEX ${N} arquivos: construção ${((Date.now() - t0) / 1000).toFixed(1)} s; índice ${(size / 1048576).toFixed(1)} MB${textBytes > 0 ? ` (${ratio.toFixed(2)}× o texto de ${(textBytes / 1048576).toFixed(0)} MB)` : ''}; pico de memória do processo ${Math.round(peak / 1048576)} MB (${Math.round(base / 1048576)} MB antes de começar, +${Math.round((peak - base) / 1048576)} MB); ${info.files} arquivos`);
    expect(info.files).toBe(N);
    if (textBytes > 0) expect(ratio).toBeLessThan(1.5);
  }, 3_600_000);

  it('o resultado é o mesmo da busca sem índice, e a consulta de literal é rápida', async () => {
    const queries: string[] = [];
    for (let i = 0; i < N && queries.length < 20; i += 50) queries.push(rareOf(i)); // 1 arquivo cada
    for (let k = 0; k < 20; k++) queries.push(VOCAB[7000 - k * 40]!); // palavras pouco comuns
    const fast: number[] = [];
    let checked = 0;
    for (const [n, q] of queries.entries()) {
      const t0 = Date.now();
      const a = await searchRepository(repo, { pattern: q, caseSensitive: true, limit: 200 }, { accelerator: idx });
      fast.push(Date.now() - t0);
      expect(a.done.accelerated, q).toBeTruthy();
      if (n % 8 === 0) {
        const b = await searchRepository(repo, { pattern: q, caseSensitive: true, limit: 200 });
        const key = (h: SearchHit) => `${h.file}:${h.line}:${h.ranges.join(',')}`;
        expect(a.hits.map(key), q).toEqual(b.hits.map(key));
        checked++;
      }
    }
    const plain: number[] = [];
    for (const q of queries.slice(0, 5)) {
      const t0 = Date.now();
      await searchRepository(repo, { pattern: q, caseSensitive: true, limit: 200 });
      plain.push(Date.now() - t0);
    }
    console.log(`INDEX ${N} arquivos: consulta de literal com índice p50 ${pct(fast, 0.5)} ms, p95 ${pct(fast, 0.95)} ms (${fast.length} consultas); sem índice p50 ${pct(plain, 0.5)} ms; ${checked} conferidas contra a busca sem índice`);
    if (SMALL) expect(pct(fast, 0.95)).toBeLessThan(2000);
  }, 600_000);

  it('atualiza 100 arquivos editados e commitados', async () => {
    const before = await idx.info(repo);
    const stamp = Date.now(); // muda a cada execução: no repositório guardado (GN_INDEX_KEEP) a edição sempre altera o arquivo
    for (let i = 0; i < 100; i++) {
      const f = join(repo, `p${(i * 3) % 200}/d${((i * 3) >> 3) % 50}/f${i * 3}.ts`);
      if (!existsSync(f)) continue;
      writeFileSync(f, `// editado ${i} UNICO${i} rodada ${stamp}\n` + fileText(i * 3));
    }
    await runGit(repo, ['add', '-A']);
    await runGit(repo, ['commit', '-qm', 'edita 100']);
    const t0 = Date.now();
    // a atualização começa na próxima busca que vê o Git mudado
    const r = await searchRepository(repo, { pattern: 'UNICO7', caseSensitive: true }, { accelerator: idx });
    expect(r.hits.length).toBeGreaterThan(0);
    for (;;) {
      const i = await idx.info(repo);
      if (i.state === 'ready' && !i.progress && (i.updatedAt ?? 0) > (before.updatedAt ?? 0)) break;
      void searchRepository(repo, { pattern: 'UNICO7', caseSensitive: true }, { accelerator: idx }); // como o usuário: a atualização acompanha as buscas
      if (Date.now() - t0 > 600_000) throw new Error('atualização não terminou');
      await new Promise((rr) => setTimeout(rr, 50));
    }
    console.log(`INDEX ${N} arquivos: atualização de 100 arquivos ${Date.now() - t0} ms (inclui a busca que a disparou)`);
    const again = await searchRepository(repo, { pattern: 'UNICO7', caseSensitive: true }, { accelerator: idx });
    expect(again.done.accelerated).toBeTruthy();
    expect(again.hits.map((h) => h.file)).toEqual(r.hits.map((h) => h.file));
  }, 900_000);
});
