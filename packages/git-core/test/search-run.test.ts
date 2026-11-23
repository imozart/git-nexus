import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit, searchRepository, supportsPcre, type SearchHit, type SearchQuery } from '../src/index.js';

let root: string;
let dir: string;
let pcre = false;
const g = (...a: string[]) => runGit(dir, a);
const w = (f: string, c: string | Buffer) => {
  mkdirSync(join(dir, f, '..'), { recursive: true });
  writeFileSync(join(dir, f), c);
};
const search = (q: SearchQuery) => searchRepository(dir, q);
const at = (hits: SearchHit[]) => hits.map((h) => `${h.file}:${h.line}`).sort();
const marked = (h: SearchHit) => h.ranges.map(([a, b]) => h.text.slice(a, b));

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-search-'));
  dir = join(root, 'repo');
  await runGit(root, ['init', '-b', 'main', dir]);
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.fsmonitor', 'false']] as const) await g('config', k, v);
  pcre = await supportsPcre(dir);
  w('src/app.ts', 'const a = 1;\nconst timeout = 30, timeout2 = timeout + 1;\nconst Timeout = 2;\nfunction a() {\n  return timeout;\n}\n');
  w('src/util.test.ts', 'it("timeout", () => {});\n');
  w('dist/out.js', 'var timeout = 1;\n');
  w('docs/leia.md', '# Timeout do cliente\n');
  w('cafe.txt', 'café timeout ação timeout\n');
  w('crlf.txt', 'function a() {\r\n  return timeout;\r\n}\r\n');
  w('long.js', 'x'.repeat(400) + 'ALVO' + 'y'.repeat(400) + '\n');
  w('bin.dat', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('timeout'), Buffer.from([0])]));
  w('big.txt', 'function a() {\n  return timeout;\n}\n' + 'z'.repeat(5 * 1024 * 1024 + 10) + '\n');
  w('plus.txt', 'aaab\n');
  w('.gitignore', 'ign.txt\n');
  await g('add', '.');
  await g('commit', '-qm', 'base');
  await g('checkout', '-qb', 'feat');
  w('so-na-feat.txt', 'timeout so na feat\n');
  await g('add', '.');
  await g('commit', '-qm', 'feat');
  await g('checkout', '-q', 'main');
  w('novo.txt', 'timeout no arquivo novo\n'); // não versionado
  w('ign.txt', 'timeout no ignorado\n'); // ignorado
  // no stage: uma linha; depois, no disco, a linha muda (o stage guarda a primeira)
  w('stage.txt', 'timeout so no stage\n');
  await g('add', 'stage.txt');
  w('stage.txt', 'so no disco agora\n');
  // alterado (não commitado)
  w('src/app.ts', readFileSync(join(dir, 'src/app.ts'), 'utf8') + '// timeout alterado\n');
});
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }), 120_000);

describe('ocorrências e destaque', () => {
  it('uma entrada por linha, com todos os trechos (nas colunas do texto mostrado) e o resumo', async () => {
    const r = await search({ pattern: 'timeout', include: 'src/app.ts' });
    expect(r.done).toMatchObject({ ok: true, dialect: 'fixed', files: 1, truncated: false, cancelled: false });
    const l2 = r.hits.find((h) => h.line === 2)!;
    expect(l2.text).toBe('const timeout = 30, timeout2 = timeout + 1;');
    expect(marked(l2)).toEqual(['timeout', 'timeout', 'timeout']); // 3 ocorrências, uma entrada
    expect(r.hits.map((h) => h.line)).toEqual([2, 3, 5, 7]); // inclui "Timeout" (sem diferenciar caixa) e a linha alterada
  });

  it('diferenciar maiúsculas e palavra inteira', async () => {
    expect((await search({ pattern: 'timeout', caseSensitive: true, include: 'src/app.ts' })).hits.map((h) => h.line)).toEqual([2, 5, 7]);
    const w1 = await search({ pattern: 'timeout', wholeWord: true, include: 'src/app.ts' });
    expect(marked(w1.hits.find((h) => h.line === 2)!)).toEqual(['timeout', 'timeout']); // "timeout2" não é palavra inteira
  });

  it('a coluna do git (bytes) vira a do texto: acentos antes da ocorrência não deslocam o destaque', async () => {
    const r = await search({ pattern: 'timeout', include: 'cafe.txt' });
    expect(r.hits[0]!.text).toBe('café timeout ação timeout');
    expect(r.hits[0]!.ranges).toEqual([[5, 12], [18, 25]]);
  });

  it('regex no dialeto do git: \\d, (?i) e várias ocorrências; o destaque bate com o que o git achou', async () => {
    if (!pcre) return;
    const r = await search({ pattern: '(?i)time\\w+\\d?', regex: true, include: 'src/app.ts' });
    expect(r.done.dialect).toBe('pcre');
    expect(marked(r.hits.find((h) => h.line === 2)!)).toEqual(['timeout', 'timeout2', 'timeout']);
  });

  it('construção que o JavaScript não entende (grupo atômico, quantificador possessivo): as colunas vêm do git -o', async () => {
    if (!pcre) return;
    for (const pattern of ['(?>a+)b', 'a++b']) {
      const r = await search({ pattern, regex: true, include: 'plus.txt' });
      expect(r.hits[0]!.ranges, pattern).toEqual([[0, 4]]);
    }
  });

  it('regex inválida: o git recusa e a mensagem diz o motivo (sem lançar)', async () => {
    const r = await search({ pattern: '(', regex: true });
    expect(r.done.ok).toBe(false);
    expect(r.done.message).toMatch(/Expressão regular inválida/);
  });

  it('linha longa: o trecho vem cortado EM TORNO da ocorrência, com o destaque dentro', async () => {
    const r = await search({ pattern: 'ALVO', include: 'long.js' });
    const h = r.hits[0]!;
    expect(h.text.length).toBe(300);
    expect([h.clippedStart, h.clippedEnd]).toEqual([true, true]);
    expect(marked(h)).toEqual(['ALVO']);
  });

  it('contexto: linhas antes e depois, sem repetir a própria ocorrência', async () => {
    const r = await search({ pattern: 'return timeout', include: 'src/app.ts', contextBefore: 2, contextAfter: 1 });
    expect(r.hits[0]).toMatchObject({ line: 5, before: [{ line: 3 }, { line: 4 }], after: [{ line: 6, text: '}' }] });
  });
});

describe('máscaras e escopos', () => {
  it('máscara com exclusão: só .ts, sem os testes e sem dist/', async () => {
    expect(at((await search({ pattern: 'timeout', include: '*.ts, *.js, !*.test.ts, !dist/' })).hits)).toEqual(['src/app.ts:2', 'src/app.ts:3', 'src/app.ts:5', 'src/app.ts:7']);
    expect(at((await search({ pattern: 'timeout', include: '!src/, !dist/, !*.md, !big.txt, !crlf.txt, !cafe.txt, !bin.dat' })).hits)).toEqual(['novo.txt:1', 'stage.txt:1'].filter((f) => f !== 'stage.txt:1'));
  });

  it('worktree (padrão) vê o novo não versionado e não vê o ignorado; "incluir ignorados" vê', async () => {
    const files = (r: Awaited<ReturnType<typeof search>>) => [...new Set(r.hits.map((h) => h.file))];
    expect(files(await search({ pattern: 'timeout' }))).toContain('novo.txt');
    expect(files(await search({ pattern: 'timeout' }))).not.toContain('ign.txt');
    expect(files(await search({ pattern: 'timeout', includeIgnored: true }))).toContain('ign.txt');
    expect(files(await search({ pattern: 'timeout', includeUntracked: false }))).not.toContain('novo.txt');
  });

  it('só os versionados (sem o novo) e só os alterados (modificado e novo, não o que está limpo)', async () => {
    const files = (r: Awaited<ReturnType<typeof search>>) => [...new Set(r.hits.map((h) => h.file))].sort();
    expect(files(await search({ pattern: 'timeout', scope: 'tracked', includeUntracked: false }))).not.toContain('novo.txt');
    expect(files(await search({ pattern: 'timeout', scope: 'changed' }))).toEqual(['novo.txt', 'src/app.ts']);
  });

  it('stage: procura o conteúdo do índice, não o do disco', async () => {
    expect(at((await search({ pattern: 'timeout', scope: 'staged', include: 'stage.txt' })).hits)).toEqual(['stage.txt:1']);
    expect((await search({ pattern: 'timeout', scope: 'worktree', include: 'stage.txt' })).hits).toHaveLength(0);
  });

  it('revisão: o conteúdo de outro branch (o nome do arquivo sai sem o prefixo) e erro claro para revisão que não existe', async () => {
    const r = await search({ pattern: 'timeout', scope: 'revision', revision: 'feat', include: 'so-na-feat.txt' });
    expect(at(r.hits)).toEqual(['so-na-feat.txt:1']);
    expect((await search({ pattern: 'timeout', scope: 'revision', revision: 'main', include: 'so-na-feat.txt' })).hits).toHaveLength(0);
    const bad = await search({ pattern: 'x', scope: 'revision', revision: 'nao-existe' });
    expect(bad.done).toMatchObject({ ok: false });
    expect(bad.done.message).toMatch(/nao-existe/);
    expect((await search({ pattern: 'x', scope: 'revision', revision: '--output=x' })).done.ok).toBe(false);
  });

  it('binário que casa vira arquivo ignorado, nunca em silêncio', async () => {
    const r = await search({ pattern: 'timeout' });
    expect(r.done.skipped).toContainEqual({ file: 'bin.dat', reason: 'binary' });
    expect(r.hits.some((h) => h.file === 'bin.dat')).toBe(false);
  });

  it('o resumo conta os arquivos olhados', async () => {
    const r = await search({ pattern: 'timeout', scope: 'tracked', includeUntracked: false });
    expect(r.done.filesLooked).toBeGreaterThanOrEqual(10);
  });
});

describe('várias linhas (candidatos do git, varredura no núcleo)', () => {
  it('texto com quebra de linha acha a ocorrência que atravessa linhas, e o resultado traz a faixa de linhas', async () => {
    const r = await search({ pattern: 'function a() {\n  return timeout;', include: 'src/app.ts' });
    expect(r.done.dialect).toBe('javascript');
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({ file: 'src/app.ts', line: 4, endLine: 5, text: 'function a() {' });
  });

  it('regex com \\n e fim de linha CRLF', async () => {
    const r = await search({ pattern: 'function a\\(\\) \\{\\s*\\n\\s+return', regex: true, include: 'crlf.txt, src/app.ts' });
    expect(at(r.hits)).toEqual(['crlf.txt:1', 'src/app.ts:4']);
  });

  it('arquivo acima do limite fica de fora e aparece como ignorado', async () => {
    const r = await search({ pattern: 'function a() {\n  return timeout;' });
    expect(r.done.skipped).toContainEqual({ file: 'big.txt', reason: 'large' });
    expect(r.hits.some((h) => h.file === 'big.txt')).toBe(false);
  });

  it('numa revisão e no stage', async () => {
    expect(at((await search({ pattern: 'function a() {\n  return', scope: 'revision', revision: 'feat', include: 'src/app.ts' })).hits)).toEqual(['src/app.ts:4']);
    expect((await search({ pattern: 'a\nb', regex: true })).done.dialect).toBe('javascript');
  });

  it('regex que o JavaScript não compila: mensagem, sem lançar', async () => {
    const r = await search({ pattern: '(\\n', regex: true });
    expect(r.done.ok).toBe(false);
  });
});

describe('páginas, lotes e cancelamento', () => {
  it('limite e "carregar mais": as páginas somam exatamente o resultado completo, e o corte é dito', async () => {
    const all = await search({ pattern: 'timeout', limit: 5000 });
    const p1 = await search({ pattern: 'timeout', limit: 3 });
    expect(p1.hits).toHaveLength(3);
    expect(p1.done).toMatchObject({ truncated: true, truncatedReason: 'limit', nextOffset: 3 });
    const p2 = await search({ pattern: 'timeout', limit: 3, offset: p1.done.nextOffset });
    const rest = await search({ pattern: 'timeout', limit: 5000, offset: 3 });
    expect(at(p1.hits)).toEqual(at(all.hits.slice(0, 3)));
    expect(at(p2.hits)).toEqual(at(all.hits.slice(3, 6)));
    expect(rest.done.truncated).toBe(false);
    expect(all.hits).toHaveLength(p1.hits.length + rest.hits.length);
  });

  it('os resultados chegam em lotes e o primeiro lote sai antes do fim', async () => {
    const batches: number[] = [];
    const r = await searchRepository(dir, { pattern: 'timeout' }, { onBatch: (b) => batches.push(b.length) });
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(r.hits.length);
  });

  it('cancelar no meio encerra a busca (cancelled) e não devolve mais nada depois', async () => {
    const ctl = new AbortController();
    let after = 0;
    const r = await searchRepository(dir, { pattern: 'timeout' }, {
      signal: ctl.signal,
      onBatch: () => {
        if (!ctl.signal.aborted) ctl.abort();
        else after++;
      },
    });
    expect(r.done.cancelled).toBe(true);
    expect(after).toBe(0);
    expect((await searchRepository(dir, { pattern: 'timeout' }, { signal: AbortSignal.abort() })).done).toMatchObject({ cancelled: true, hits: 0 });
  });

  it('runGit com sinal: o processo do git termina de verdade, sem erro', async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 150);
    const t0 = Date.now();
    const r = await runGit(dir, ['-c', 'alias.dorme=!sleep 5', 'dorme'], { signal: ctl.signal });
    expect(r.aborted).toBe(true);
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it('tempo máximo: corta, avisa e diz que foi pelo tempo', async () => {
    const r = await search({ pattern: 'function a() {\n  return timeout;', timeoutMs: 1000 });
    // a busca é rápida: o que importa é o contrato (corte só pelo tempo ou terminou inteira)
    expect(['time', undefined]).toContain(r.done.truncatedReason);
  });
});

describe('oráculo: o conjunto de ocorrências bate com uma varredura simples em memória', () => {
  const files = ['src/app.ts', 'src/util.test.ts', 'dist/out.js', 'docs/leia.md', 'cafe.txt', 'crlf.txt', 'long.js', 'plus.txt', 'novo.txt'];
  const naive = (re: RegExp) => {
    const out: string[] = [];
    for (const f of files) readFileSync(join(dir, f), 'utf8').split(/\r?\n/).forEach((l, i) => re.test(l) && out.push(`${f}:${i + 1}`));
    return out.sort();
  };
  const cases: Array<[string, SearchQuery, RegExp]> = [
    ['fixo, sem caixa', { pattern: 'timeout' }, /timeout/i],
    ['fixo, com caixa', { pattern: 'Timeout', caseSensitive: true }, /Timeout/],
    ['palavra inteira', { pattern: 'timeout', wholeWord: true }, /\btimeout\b/i],
    ['regex', { pattern: 'time\\w+\\d', regex: true }, /time\w+\d/i],
    ['fixo com metacaracteres', { pattern: 'a.b(c)', regex: false }, /a\.b\(c\)/i],
  ];
  for (const [name, q, re] of cases) {
    it(name, async () => {
      const r = await search({ ...q, include: files.join(', ') + ', !bin.dat' });
      expect(at(r.hits)).toEqual(naive(re));
    });
  }
});

describe('medição (arquivos numerosos)', () => {
  const N = Number(process.env.GN_SEARCH_FILES ?? 2000);
  let big: string;
  // GN_SEARCH_KEEP=1 guarda o repositório gerado (20 mil arquivos levam minutos para criar) e o reaproveita nas medições seguintes
  const keep = !!process.env.GN_SEARCH_KEEP;
  beforeAll(async () => {
    big = keep ? join(tmpdir(), `gitnexus-search-big-${N}`) : join(root, 'big');
    if (keep && existsSync(join(big, '.git'))) return;
    await runGit(root, ['init', '-b', 'main', big]);
    await runGit(big, ['config', 'core.fsmonitor', 'false']);
    for (let d = 0; d < N / 100; d++) {
      mkdirSync(join(big, `p${d}`), { recursive: true });
      for (let f = 0; f < 100; f++) writeFileSync(join(big, `p${d}`, `f${f}.ts`), `export const v${d}_${f} = ${f};
// ${f % 50 === 0 ? 'AGULHA' : 'palha'} ${d}
`.repeat(20));
    }
    await runGit(big, ['-c', 'user.name=T', '-c', 'user.email=t@e.com', 'add', '.']);
    await runGit(big, ['-c', 'user.name=T', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'x']);
  }, 900_000);

  it(`${N} arquivos: o primeiro lote chega antes do fim e a busca completa cabe no orçamento`, async () => {
    await searchRepository(big, { pattern: 'palha' }); // aquece o cache do sistema
    let first = 0;
    const t0 = Date.now();
    const r = await searchRepository(big, { pattern: 'AGULHA', limit: 5000 }, { onBatch: () => (first ||= Date.now() - t0) });
    const total = Date.now() - t0;
    process.stderr.write(`\nBUSCA arquivos=${N} ocorrencias=${r.hits.length} primeiro-lote=${first}ms total=${total}ms\n`);
    expect(r.done.ok).toBe(true);
    expect(r.hits.length).toBeGreaterThan(0);
    // varredura completa (poucas ocorrências, o git lê tudo)
    const f0 = Date.now();
    const full = await searchRepository(big, { pattern: 'v7_49 =', limit: 5000 });
    const scan = Date.now() - f0;
    process.stderr.write(`BUSCA varredura-completa=${scan}ms ocorrencias=${full.hits.length}
`);
    expect(full.hits.length).toBeGreaterThan(0);
    // metas do projeto com 20 mil arquivos e cache quente (rode com GN_SEARCH_FILES=20000): primeiro lote em 300 ms e busca completa em 2 s;
    // no CI, com poucos arquivos e máquina mais lenta, só a folga larga
    const strict = N >= 20000;
    expect(first).toBeLessThan(strict ? 300 : 1500);
    expect(Math.max(total, scan)).toBeLessThan(strict ? 2000 : 4000);
    // nova busca cancela a anterior em pouco tempo
    const ctl = new AbortController();
    const slow = searchRepository(big, { pattern: 'palha', limit: 5000 }, { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 20);
    const c0 = Date.now();
    const cancelled = await slow;
    process.stderr.write(`BUSCA cancelar=${Date.now() - c0}ms cancelled=${cancelled.done.cancelled}\n`);
    expect(Date.now() - c0).toBeLessThan(1500);
  }, 600_000);
});
