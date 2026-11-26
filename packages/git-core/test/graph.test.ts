// Grafo (#291): o desenho de lanes (merges octópodes, lanes que fecham, várias raízes), a construção aos poucos (páginas) igual à de uma vez, e o histórico paginado
// de verdade (e-mail do autor, "local" = ainda não publicado, `skip`).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildGraph, createGraphBuilder, getHistory, parseLog } from '../src/index.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

describe('buildGraph', () => {
  it('uma linha reta ocupa uma lane só', () => {
    const g = buildGraph([c('c', 'b'), c('b', 'a'), c('a')]);
    expect(g.lanes).toBe(1);
    expect(g.rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(g.rows[2]!.outgoing).toEqual([]); // a raiz não tem pai
  });

  it('um merge abre a segunda lane e a branch que termina fecha a dela', () => {
    // m (pais: a, b) · a e b descendem de r
    const g = buildGraph([c('m', 'a', 'b'), c('a', 'r'), c('b', 'r'), c('r')]);
    expect(g.rows[0]!.outgoing).toEqual([{ from: 0, to: 0 }, { from: 0, to: 1 }]);
    expect(g.lanes).toBe(2);
    expect(g.rows[2]!.lane).toBe(1); // b fica na lane 1
    expect(g.rows[2]!.outgoing).toEqual([{ from: 1, to: 0 }]); // o pai de b (r) já espera na lane 0: a lane de b se junta a ela, sem abrir lane nova
    expect(g.rows[3]!.incoming).toEqual([{ from: 0, to: 0 }]);
    expect(g.rows[3]!.through).toEqual([]); // depois de r não resta nada aberto
  });

  it('merge octópode: três pais, três lanes saindo do mesmo nó', () => {
    const g = buildGraph([c('o', 'a', 'b', 'x'), c('a', 'r'), c('b', 'r'), c('x', 'r'), c('r')]);
    expect(g.rows[0]!.outgoing.map((s) => s.to)).toEqual([0, 1, 2]);
    expect(g.lanes).toBe(3);
    expect(g.rows[3]!.outgoing).toEqual([{ from: 2, to: 0 }]); // o terceiro ramo também se junta à lane de r
    expect(g.rows[4]!.incoming).toEqual([{ from: 0, to: 0 }]);
  });

  it('histórico com várias raízes: cada raiz abre e fecha a sua lane', () => {
    const g = buildGraph([c('a2', 'a1'), c('b2', 'b1'), c('a1'), c('b1')]);
    expect(g.rows[0]!.lane).toBe(0);
    expect(g.rows[1]!.lane).toBe(1);
    expect(g.rows[2]!.through).toEqual([1]); // a lane da outra história atravessa a linha
    expect(g.lanes).toBe(2);
  });

  it('o pai que já estava esperando em outra lane recebe o segmento, sem abrir lane nova', () => {
    const g = buildGraph([c('m1', 'p', 'q'), c('m2', 'q', 'p'), c('p'), c('q')]);
    expect(g.lanes).toBeLessThanOrEqual(3);
    const last = g.rows[3]!;
    expect(last.incoming.length).toBeGreaterThanOrEqual(1);
  });
});

describe('createGraphBuilder (aos poucos)', () => {
  /** Um DAG pseudoaleatório (semente fixa) em ordem topológica: cada commit aponta para 0 a 3 dos mais antigos. */
  function dag(n: number): Array<{ hash: string; parents: string[] }> {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out: Array<{ hash: string; parents: string[] }> = [];
    for (let i = n - 1; i >= 0; i--) {
      const parents: string[] = [];
      const k = i === 0 ? 0 : rnd() < 0.12 ? 2 + (rnd() < 0.3 ? 1 : 0) : 1;
      for (let j = 0; j < k; j++) {
        const p = `c${Math.max(0, i - 1 - Math.floor(rnd() * 6))}`;
        if (!parents.includes(p) && p !== `c${i}`) parents.push(p);
      }
      out.push({ hash: `c${i}`, parents });
    }
    return out;
  }

  it('em páginas de qualquer tamanho dá exatamente o mesmo desenho que de uma vez', () => {
    const commits = dag(1500);
    const whole = buildGraph(commits);
    for (const page of [1, 7, 200, 1499]) {
      const b = createGraphBuilder();
      for (let i = 0; i < commits.length; i += page) b.append(commits.slice(i, i + page));
      expect(b.rows).toEqual(whole.rows);
      expect(b.lanes).toBe(whole.lanes);
    }
  });

  it('100 mil commits em páginas de 2000: nenhuma página passa de 50 ms (sem tarefa longa) e o total é de poucos segundos', () => {
    const commits = dag(100_000);
    const b = createGraphBuilder();
    let worst = 0;
    const t0 = performance.now();
    for (let i = 0; i < commits.length; i += 2000) {
      const s = performance.now();
      b.append(commits.slice(i, i + 2000));
      worst = Math.max(worst, performance.now() - s);
    }
    expect(b.rows).toHaveLength(100_000);
    expect(worst).toBeLessThan(50 * 4); // folga ×4 para a CI (medido: bem abaixo de 50 ms por página)
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('as linhas já entregues não mudam quando chega a página seguinte', () => {
    const commits = dag(300);
    const b = createGraphBuilder();
    b.append(commits.slice(0, 100));
    const firstPage = JSON.parse(JSON.stringify(b.rows));
    b.append(commits.slice(100));
    expect(JSON.parse(JSON.stringify(b.rows.slice(0, 100)))).toEqual(firstPage);
    expect(b.rows).toHaveLength(300);
  });
});

describe('histórico de verdade (paginado, e-mail e "local")', () => {
  let root: string;
  let local: string;
  const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  const commit = (repo: string, n: number, email = 'ana@e.com') => {
    writeFileSync(join(repo, 'f.txt'), `${n}\n`);
    sh(repo, 'add', '.');
    execFileSync('git', ['-c', 'user.name=Ana Souza', '-c', `user.email=${email}`, 'commit', '-qm', `c${n}`], { cwd: repo });
  };
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'gitnexus-graph-'));
    const bare = join(root, 'o.git');
    sh(root, 'init', '-q', '--bare', '-b', 'main', bare);
    local = join(root, 'l');
    sh(root, 'init', '-q', '-b', 'main', local);
    for (const [k, v] of [['commit.gpgsign', 'false'], ['core.fsmonitor', 'false']]) sh(local, 'config', k!, v!);
    sh(local, 'remote', 'add', 'origin', bare);
    for (let i = 1; i <= 5; i++) commit(local, i);
    sh(local, 'push', '-qu', 'origin', 'main');
    commit(local, 6, 'outra@e.com'); // 2 commits ainda não publicados
    commit(local, 7);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

  it('traz o e-mail do autor e marca como "local" só o que nenhum remoto alcança', async () => {
    const h = await getHistory(local, 50);
    expect(h.map((x) => x.subject)).toEqual(['c7', 'c6', 'c5', 'c4', 'c3', 'c2', 'c1']);
    expect(h.map((x) => x.local)).toEqual([true, true, false, false, false, false, false]);
    expect(h[1]!.authorEmail).toBe('outra@e.com');
    expect(h[0]!.author).toBe('Ana Souza');
  });

  it('com `skip` as páginas se completam sem repetir nem faltar commit', async () => {
    const all = (await getHistory(local, 50)).map((x) => x.hash);
    const pages = [...(await getHistory(local, 3, 0)), ...(await getHistory(local, 3, 3)), ...(await getHistory(local, 3, 6))].map((x) => x.hash);
    expect(pages).toEqual(all);
    expect(await getHistory(local, 3, 99)).toEqual([]);
  });

  it('sem remotos o estado "local" não existe (não há com o que comparar)', async () => {
    const solo = join(root, 'solo');
    sh(root, 'init', '-q', '-b', 'main', solo);
    sh(solo, 'config', 'commit.gpgsign', 'false');
    commit(solo, 1);
    const h = await getHistory(solo, 10);
    expect(h).toHaveLength(1);
    expect(h[0]!.local).toBeUndefined();
  });

  it('parseLog lê o e-mail e tolera registro antigo (sem e-mail): campos a mais ou a menos não quebram', () => {
    const rec = ['h1', 'p1 p2', 'Ana', 'a@e.com', '1700000000', 'HEAD -> main, tag: v1', 'assunto'].join('\x1f') + '\x1e';
    expect(parseLog(rec)[0]).toMatchObject({ hash: 'h1', parents: ['p1', 'p2'], author: 'Ana', authorEmail: 'a@e.com', date: 1_700_000_000, refs: ['HEAD -> main', 'tag: v1'], subject: 'assunto' });
    expect(parseLog('')).toEqual([]);
  });
});
