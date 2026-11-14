// Benchmark OPCIONAL em repositório grande: GN_PERF=1 pnpm exec vitest run packages/git-core/test/perf.test.ts
// (por padrão fica ignorado, para não atrasar os testes normais). Imprime os tempos e confere orçamentos generosos.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getBlame,
  getFileHistory,
  getGitStatus,
  getHistory,
  getMergeConflicts,
  getOperations,
  getRebaseState,
  getRepoSummary,
  listTrackedFiles,
  runGit,
  searchHistory,
} from '../src/index.js';

const ON = process.env.GN_PERF === '1';
const FILES = Number(process.env.GN_PERF_FILES ?? 20000);
const COMMITS = Number(process.env.GN_PERF_COMMITS ?? 5000);

let repo = '';
const times: Record<string, number> = {};
async function time<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const r = await fn();
  times[name] = Math.round(performance.now() - t0);
  return r;
}

/** Monta o repositório com `git fast-import`: milhares de arquivos e commits em poucos segundos. */
async function build(): Promise<void> {
  repo = mkdtempSync(join(tmpdir(), 'gitnexus-perf-'));
  await runGit(repo, ['init', '-b', 'main']);
  await runGit(repo, ['config', 'user.name', 'Perf']);
  await runGit(repo, ['config', 'user.email', 'perf@e.com']);
  await runGit(repo, ['config', 'core.autocrlf', 'false']);
  const lines: string[] = [];
  const blob = (n: number, body: string) => lines.push(`blob\nmark :${n}\ndata ${Buffer.byteLength(body)}\n${body}`);
  // primeiro commit: todos os arquivos (em 400 pastas)
  let mark = 1;
  const marks: number[] = [];
  for (let i = 0; i < FILES; i++) {
    blob(mark, `conteudo do arquivo ${i}\n`);
    marks.push(mark++);
  }
  const big = Array.from({ length: 5000 }, (_, i) => `linha ${i}`).join('\n') + '\n';
  blob(mark, big);
  const bigMark = mark++;
  const commitHead = (msg: string, t: number) => `commit refs/heads/main\ncommitter Perf <perf@e.com> ${t} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}\n`;
  let t = 1_700_000_000;
  let first = commitHead('feat: inicial', t);
  for (let i = 0; i < FILES; i++) first += `M 100644 :${marks[i]} src/m${i % 400}/f${i}.txt\n`;
  first += `M 100644 :${bigMark} grande.txt\n`;
  lines.push(first);
  // demais commits: cada um altera 1 arquivo e a mensagem segue Conventional Commits
  const types = ['feat', 'fix', 'docs', 'refactor', 'chore'];
  for (let c = 1; c < COMMITS; c++) {
    t += 60;
    const a = (c * 7) % FILES;
    const body = `conteudo do arquivo ${a} v${c}\n`;
    blob(mark, body);
    lines.push(`${commitHead(`${types[c % 5]}(m${a % 400}): mudança ${c}`, t)}M 100644 :${mark++} src/m${a % 400}/f${a}.txt\n`);
  }
  await runGit(repo, ['fast-import', '--quiet'], { stdin: lines.join('\n') + '\n' });
  await runGit(repo, ['checkout', '-f', 'main']);
}

describe.skipIf(!ON)('desempenho em repositório grande', () => {
  beforeAll(async () => {
    const t0 = performance.now();
    await build();
    console.log(`repositório gerado em ${Math.round(performance.now() - t0)} ms (${FILES} arquivos, ${COMMITS} commits)`);
  }, 600_000);
  afterAll(() => {
    console.log('TEMPOS (ms):', JSON.stringify(times, null, 1));
    if (process.env.GN_PERF_OUT) writeFileSync(process.env.GN_PERF_OUT, JSON.stringify(times, null, 1)); // o vitest esconde o console quando passa
    rmSync(repo, { recursive: true, force: true });
  }, 180_000); // apagar milhares de arquivos pode demorar (antivírus)

  it('limpo: status, resumo, histórico, arquivos e operações', async () => {
    await time('status (limpo)', () => getGitStatus(repo));
    await time('resumo do painel', () => getRepoSummary(repo));
    const h = await time('histórico (300)', () => getHistory(repo, 300));
    expect(h.length).toBe(300);
    await time('histórico (2000)', () => getHistory(repo, 2000));
    const files = await time('listar arquivos versionados', () => listTrackedFiles(repo));
    expect(files.length).toBeGreaterThan(FILES - 1);
    await time('operações (reflog)', () => getOperations(repo, 60));
  });

  it('busca no histórico e arquivo', async () => {
    const r = await time('busca por mensagem', () => searchHistory(repo, { text: 'mudança 4242' }));
    expect(r.length).toBeGreaterThan(0);
    await time('busca por autor', () => searchHistory(repo, { author: 'Perf' }, 300));
    await time('busca por caminho', () => searchHistory(repo, { path: 'src/m7/f7.txt' }));
    await time('histórico de arquivo', () => getFileHistory(repo, 'src/m7/f7.txt'));
    await time('busca por conteúdo (pickaxe)', () => searchHistory(repo, { text: 'v4242', mode: 'content' }, 50));
    const b = await time('blame (5000 linhas)', () => getBlame(repo, 'grande.txt'));
    expect(b.length).toBe(5000);
  });

  it('com 5000 arquivos alterados e 3000 novos', async () => {
    for (let i = 0; i < 5000; i++) writeFileSync(join(repo, `src/m${i % 400}/f${i}.txt`), `alterado ${i}\n`);
    for (let i = 0; i < 3000; i++) writeFileSync(join(repo, `src/m${i % 400}/novo${i}.txt`), `novo ${i}\n`);
    const st = await time('status (8000 alterações)', () => getGitStatus(repo));
    expect(st.entries.length).toBe(8000);
    await time('resumo do painel (8000 alterações)', () => getRepoSummary(repo));
    await time('conflitos (8000 alterações)', () => getMergeConflicts(repo));
    await time('estado do rebase (8000 alterações)', () => getRebaseState(repo));
  });

  it('orçamentos generosos (uma regressão grande acende aqui)', () => {
    expect(times['status (limpo)']).toBeLessThan(5000);
    expect(times['histórico (300)']).toBeLessThan(3000);
    expect(times['listar arquivos versionados']).toBeLessThan(3000);
    expect(times['blame (5000 linhas)']).toBeLessThan(5000);
    expect(times['status (8000 alterações)']).toBeLessThan(10000);
  });
});

describe.skipIf(ON)('desempenho em repositório grande (desligado)', () => {
  it('ligue com GN_PERF=1', () => expect(ON).toBe(false));
});
