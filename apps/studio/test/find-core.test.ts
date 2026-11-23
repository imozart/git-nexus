import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { MAX_COUNT, makeQuery, markBuckets, matchesIn, nextMatch, seedText, statsFor, type FindOptions } from '../src/entrypoints/renderer/find-core';

const opts = (text: string, o: Partial<FindOptions> = {}): FindOptions => ({ text, caseSensitive: false, wholeWord: false, regex: false, ...o });
const stateOf = (doc: string, sel?: [number, number]) => EditorState.create({ doc, selection: sel ? EditorSelection.single(sel[0], sel[1]) : undefined });
const q = (text: string, o: Partial<FindOptions> = {}) => {
  const query = makeQuery(opts(text, o));
  if (!query) throw new Error('consulta inválida: ' + text);
  return query;
};

describe('consulta', () => {
  it('vazia ou regex inválida não vira consulta; o texto sem regex é literal', () => {
    expect(makeQuery(opts(''))).toBeNull();
    expect(makeQuery(opts('(', { regex: true }))).toBeNull();
    const s = stateOf('a.c abc');
    expect(matchesIn(s, q('a.c'), 0, s.doc.length, 10).map((m) => m.from)).toEqual([0]);
    expect(matchesIn(s, q('a.c', { regex: true }), 0, s.doc.length, 10).map((m) => m.from)).toEqual([0, 4]);
  });

  it('caixa, palavra inteira e várias linhas', () => {
    const s = stateOf('Foo foo FOO foobar\nfoo');
    const n = (o: Partial<FindOptions>) => matchesIn(s, q('foo', o), 0, s.doc.length, 50).length;
    expect(n({})).toBe(5);
    expect(n({ caseSensitive: true })).toBe(3); // foo, foobar e a última linha
    expect(n({ wholeWord: true })).toBe(4);
    const multi = stateOf('um\ndois\ntrês');
    expect(matchesIn(multi, q('um\ndois'), 0, multi.doc.length, 5)).toEqual([{ from: 0, to: 7 }]);
    expect(matchesIn(multi, q('um\\ndois', { regex: true }), 0, multi.doc.length, 5)).toEqual([{ from: 0, to: 7 }]);
  });

  it('ocorrência vazia (a*) não conta', () => {
    const s = stateOf('baaab');
    expect(matchesIn(s, q('a*', { regex: true }), 0, s.doc.length, 20)).toEqual([{ from: 1, to: 4 }]);
  });
});

describe('contador', () => {
  it('total e a posição da ocorrência selecionada ("3 de 12")', () => {
    const doc = 'x a x a x a x a';
    const s = stateOf(doc, [6, 7]); // a 2ª "a"... posições 2, 6, 10, 14
    expect(statsFor(s, q('a'), null)).toEqual({ total: 4, capped: false, current: 2 });
    expect(statsFor(stateOf(doc, [0, 0]), q('a'), null).current).toBe(0);
    expect(statsFor(s, null, null)).toEqual({ total: 0, capped: false, current: 0 });
  });

  it('para de contar no máximo e avisa', () => {
    const s = stateOf('a'.repeat(MAX_COUNT + 500));
    const st = statsFor(s, q('a'), null);
    expect(st).toMatchObject({ total: MAX_COUNT, capped: true });
  });

  it('"na seleção" conta só dentro do trecho', () => {
    const s = stateOf('aa bb aa bb aa');
    expect(statsFor(s, q('aa'), { from: 3, to: 11 }).total).toBe(1);
  });
});

describe('navegação', () => {
  const doc = 'foo 1 foo 2 foo 3';
  it('Enter vai para a próxima a partir da seleção; no fim dá a volta e avisa', () => {
    const s = stateOf(doc, [0, 3]);
    expect(nextMatch(s, q('foo'), null, false)).toEqual({ from: 6, to: 9, wrapped: false });
    expect(nextMatch(stateOf(doc, [12, 15]), q('foo'), null, false)).toEqual({ from: 0, to: 3, wrapped: true });
  });

  it('Shift+Enter volta; no começo dá a volta para a última', () => {
    expect(nextMatch(stateOf(doc, [6, 9]), q('foo'), null, true)).toEqual({ from: 0, to: 3, wrapped: false });
    expect(nextMatch(stateOf(doc, [0, 3]), q('foo'), null, true)).toEqual({ from: 12, to: 15, wrapped: true });
  });

  it('sem ocorrência não vai a lugar nenhum; com o cursor no meio de um texto vai para a seguinte', () => {
    expect(nextMatch(stateOf(doc, [0, 0]), q('zzz'), null, false)).toBeNull();
    expect(nextMatch(stateOf(doc, [7, 7]), q('foo'), null, false)).toEqual({ from: 12, to: 15, wrapped: false });
  });

  it('só na seleção: navega e dá a volta dentro do trecho', () => {
    const range = { from: 5, to: 16 }; // pega o 2º e o 3º "foo"
    expect(nextMatch(stateOf(doc, [6, 9]), q('foo'), range, false)).toEqual({ from: 12, to: 15, wrapped: false });
    expect(nextMatch(stateOf(doc, [12, 15]), q('foo'), range, false)).toEqual({ from: 6, to: 9, wrapped: true });
    expect(nextMatch(stateOf(doc, [6, 9]), q('foo'), range, true)).toEqual({ from: 12, to: 15, wrapped: true });
  });
});

describe('marcas da barra de rolagem e texto inicial', () => {
  it('uma marca por faixa do arquivo que tem ocorrência (posição pela linha)', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => (i === 0 || i === 500 || i === 999 ? 'alvo' : 'x'));
    const s = stateOf(lines.join('\n'));
    const b = markBuckets(s, q('alvo'), null, 100);
    expect(b).toEqual([0, 50, 99]);
    expect(markBuckets(s, null, null)).toEqual([]);
  });

  it('preenche com a seleção de uma linha, com a palavra sob o cursor, e deixa vazio se a seleção é grande ou tem várias linhas', () => {
    expect(seedText(stateOf('let valor = 1', [4, 9]))).toBe('valor');
    expect(seedText(stateOf('let valor = 1', [6, 6]))).toBe('valor');
    expect(seedText(stateOf('a\nb', [0, 3]))).toBe('');
    expect(seedText(stateOf('x'.repeat(300), [0, 250]))).toBe('');
    expect(seedText(stateOf('   ', [1, 1]))).toBe('');
  });
});

describe('desempenho (30 mil linhas)', () => {
  it('conta, marca e navega em um arquivo de 30 mil linhas sem travar (a meta de 500 ms é medida no teste de interface)', () => {
    const doc = Array.from({ length: 30_000 }, (_, i) => `linha ${i} const valor${i % 7} = ${i};`).join('\n');
    const s = stateOf(doc, [0, 0]);
    const query = q('valor3');
    const t0 = performance.now();
    const st = statsFor(s, query, null);
    const marks = markBuckets(s, query, null);
    const next = nextMatch(s, query, null, false);
    const ms = performance.now() - t0;
    expect(st.total).toBeGreaterThan(4000);
    expect(marks.length).toBeGreaterThan(100);
    expect(next).not.toBeNull();
    // trava larga: com a cobertura ligada (v8) o código roda instrumentado e mais lento; a meta de 500 ms de ponta a ponta fica em scripts/ui-tests/tests/find-bar.mjs
    expect(ms).toBeLessThan(3000);
  });
});
