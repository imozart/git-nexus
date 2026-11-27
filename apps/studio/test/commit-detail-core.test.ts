// Detalhe do commit fixo (#293) e comparação (#295): divisão, arquivos, barra, cache, visitas e trechos do diff.
import { describe, expect, it } from 'vitest';
import {
  Lru, SPLIT_LIMITS, Visited, barOf, clampSize, commitsMarkdown, countLabel, groupFiles, hunkStarts, maxChanges, neighbour, nextHunk, parseSplit, resized, swapped, totalsOf, withOrient,
} from '../src/entrypoints/renderer/commit-detail-core';

const F = (path: string, added = 0, removed = 0, extra = {}) => ({ status: 'M', path, added, removed, ...extra });

describe('divisão da tela', () => {
  it('o gravado torto volta ao padrão, campo a campo; o tamanho respeita os limites da orientação', () => {
    for (const bad of [null, undefined, '', '{x', '[1]', '7']) expect(parseSplit(bad)).toEqual({ orient: 'side', size: SPLIT_LIMITS.side.def, open: true });
    expect(parseSplit(JSON.stringify({ orient: 'bottom', size: 9999, open: false }))).toEqual({ orient: 'bottom', size: SPLIT_LIMITS.bottom.max, open: false });
    expect(parseSplit(JSON.stringify({ orient: 'lixo', size: 'x' }))).toEqual({ orient: 'side', size: SPLIT_LIMITS.side.def, open: true });
    expect(clampSize('side', 10)).toBe(SPLIT_LIMITS.side.min);
    expect(clampSize('side', NaN)).toBe(SPLIT_LIMITS.side.def);
  });
  it('trocar a orientação leva o tamanho padrão dela; arrastar soma e limita', () => {
    const p = parseSplit(JSON.stringify({ orient: 'side', size: 600 }));
    expect(withOrient(p, 'bottom')).toEqual({ orient: 'bottom', size: SPLIT_LIMITS.bottom.def, open: true });
    expect(resized(p, 50).size).toBe(650);
    expect(resized(p, 5000).size).toBe(SPLIT_LIMITS.side.max);
    expect(resized(p, -5000).size).toBe(SPLIT_LIMITS.side.min);
  });
});

describe('arquivos', () => {
  const files = [F('src/b.ts', 3, 1), F('README.md', 1), F('src/a.ts', 0, 4), { status: 'R', path: 'lib/novo.ts', oldPath: 'old/velho.ts', added: 0, removed: 0 }, F('src/deep/x.ts', 2)];
  it('sem agrupar, a lista inteira numa só; o filtro olha o caminho novo e o antigo, sem diferenciar maiúscula', () => {
    expect(groupFiles(files, '', false)).toEqual([{ dir: '', files }]);
    expect(groupFiles(files, 'SRC/A', false)[0]!.files.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(groupFiles(files, 'velho', false)[0]!.files.map((f) => f.path)).toEqual(['lib/novo.ts']);
    expect(groupFiles(files, 'nada', false)).toEqual([]);
  });
  it('agrupa por pasta: raiz primeiro, depois as pastas em ordem', () => {
    const g = groupFiles(files, '', true);
    expect(g.map((x) => x.dir)).toEqual(['', 'lib', 'src', 'src/deep']);
    expect(g.find((x) => x.dir === 'src')!.files.map((f) => f.path)).toEqual(['src/b.ts', 'src/a.ts']);
  });
  it('totais, barra proporcional (pequeno ainda aparece, nunca passa de 100) e texto da contagem', () => {
    expect(totalsOf(files)).toEqual({ files: 5, added: 6, removed: 5 });
    const max = maxChanges(files);
    expect(max).toBe(4);
    expect(barOf(F('x', 3, 1), max)).toEqual({ add: 75, del: 25 });
    const small = barOf(F('y', 1, 0), 1000);
    expect(small.add + small.del).toBeGreaterThanOrEqual(8);
    expect(small.add + small.del).toBeLessThanOrEqual(100);
    expect(barOf(F('z'), max)).toEqual({ add: 0, del: 0 });
    expect(barOf(F('z', 1), 0)).toEqual({ add: 0, del: 0 });
    expect(countLabel({ added: 3, removed: 1 })).toBe('−1 +3');
    expect(countLabel({})).toBe('');
  });
});

describe('cache e visitas', () => {
  it('o cache guarda os últimos N: usar renova, passar do limite tira o mais antigo', () => {
    const c = new Lru<number>(3);
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    expect(c.get('a')).toBe(1); // a é o mais recente agora
    c.set('d', 4); // sai o b
    expect(c.has('b')).toBe(false);
    expect([c.has('a'), c.has('c'), c.has('d')]).toEqual([true, true, true]);
    expect(c.size).toBe(3);
    c.clear();
    expect(c.get('a')).toBeUndefined();
    const big = new Lru<number>(20);
    for (let i = 0; i < 50; i++) big.set(String(i), i);
    expect(big.size).toBe(20);
  });
  it('"voltar ao anterior" desfaz as visitas em ordem e não empilha repetido', () => {
    const v = new Visited();
    v.visit('a'); v.visit('b'); v.visit('b'); v.visit('c');
    expect(v.size).toBe(3);
    expect(v.back()).toBe('b');
    expect(v.back()).toBe('a');
    expect(v.back()).toBeNull();
    const w = new Visited(3);
    for (const h of ['1', '2', '3', '4', '5']) w.visit(h);
    expect(w.size).toBe(3);
  });
});

describe('trechos e arquivos do diff', () => {
  const diff = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '+b', '@@ -9 +9 @@', '-c', '+d', '@@ -20 +20 @@', ' z'].join('\n');
  it('acha as linhas dos trechos e salta entre eles sem dar a volta', () => {
    const s = hunkStarts(diff);
    expect(s).toEqual([3, 6, 9]);
    expect(nextHunk(s, -1, 1)).toBe(3);
    expect(nextHunk(s, 3, 1)).toBe(6);
    expect(nextHunk(s, 9, 1)).toBeNull();
    expect(nextHunk(s, 9, -1)).toBe(6);
    expect(nextHunk(s, 3, -1)).toBeNull();
    expect(hunkStarts('')).toEqual([]);
  });
  it('o arquivo vizinho', () => {
    const p = ['a', 'b', 'c'];
    expect(neighbour(p, 'a', 1)).toBe('b');
    expect(neighbour(p, 'c', 1)).toBeNull();
    expect(neighbour(p, 'a', -1)).toBeNull();
    expect(neighbour(p, '', 1)).toBe('a');
    expect(neighbour(p, '', -1)).toBe('c');
  });
});

describe('comparação', () => {
  it('a lista em Markdown e a troca de lados', () => {
    expect(commitsMarkdown([{ shortHash: 'abc1234', subject: 'feat: x' }, { shortHash: 'def5678', subject: 'fix: y' }])).toBe('- abc1234 feat: x\n- def5678 fix: y');
    expect(commitsMarkdown([])).toBe('');
    expect(swapped('main', 'feat')).toEqual({ base: 'feat', target: 'main' });
  });
});
