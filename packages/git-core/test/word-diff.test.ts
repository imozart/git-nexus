import { describe, expect, it } from 'vitest';
import { buildMerge, pairMarks, spaceOnlyConflicts, squashSpace, wordDiff } from '../src/pure.js';

const cut = (s: string, rs: Array<{ start: number; end: number }>) => rs.map((r) => s.slice(r.start, r.end));

describe('destaque por palavra', () => {
  it('marca só a palavra ou o símbolo que mudou, nos dois lados', () => {
    const a = 'const total = price * qty;';
    const b = 'const total = cost * qty;';
    const d = wordDiff(a, b);
    expect(cut(a, d.a)).toEqual(['price']);
    expect(cut(b, d.b)).toEqual(['cost']);
  });

  it('a vírgula ou o ponto e vírgula que faltou aparece como diferença, e linhas iguais não têm marca', () => {
    expect(cut('foo(a, b)', wordDiff('foo(a, b)', 'foo(a b)').a)).toEqual([',']);
    expect(wordDiff('igual', 'igual')).toEqual({ a: [], b: [] });
    const d = wordDiff('x = 1', 'x = 1;');
    expect(d.a).toEqual([]);
    expect(cut('x = 1;', d.b)).toEqual([';']);
  });

  it('uma sequência alterada vira um trecho só (palavras e espaços entre elas)', () => {
    const a = 'return alpha beta gamma;';
    const b = 'return one two three;';
    expect(cut(b, wordDiff(a, b).b)).toEqual(['one two three']);
  });

  it('com "ignorar espaços", linhas que só diferem neles não têm destaque; sem isso, têm', () => {
    expect(wordDiff('a  =  1', 'a = 1', { ignoreSpace: true })).toEqual({ a: [], b: [] });
    expect(wordDiff('a  =  1', 'a = 1').a.length).toBeGreaterThan(0);
    expect(wordDiff('a=1', 'a = 1', { ignoreSpace: true })).toEqual({ a: [], b: [] });
    // e a palavra que mudou continua marcada
    const d = wordDiff('  nome = "x"', 'nome = "y"', { ignoreSpace: true });
    expect(cut('  nome = "x"', d.a)).toEqual(['x']);
  });

  it('acentos e letras fora do ASCII contam como palavra (não quebram no meio)', () => {
    const d = wordDiff('olá mundo', 'olá mundão');
    expect(cut('olá mundo', d.a)).toEqual(['mundo']);
    expect(cut('olá mundão', d.b)).toEqual(['mundão']);
  });

  it('linha enorme não é comparada por palavra', () => {
    const long = 'x'.repeat(3000);
    expect(wordDiff(long, long + 'y')).toEqual({ a: [], b: [] });
  });
});

describe('marcas do trecho (pares de linhas)', () => {
  it('compara por palavra só as linhas que mudaram de um lado para o outro', () => {
    const mine = ['a', 'let x = 1;', 'c'];
    const theirs = ['a', 'let x = 2;', 'c', 'novo'];
    const m = pairMarks(mine, theirs);
    expect(cut('let x = 1;', m.mine.get(1)!)).toEqual(['1']);
    expect(cut('let x = 2;', m.theirs.get(1)!)).toEqual(['2']);
    expect(m.mine.has(0)).toBe(false);
    expect(m.theirs.has(3)).toBe(false); // linha que só existe de um lado: a linha inteira já é a diferença
  });

  it('ignorando espaços, linhas reindentadas não são pares diferentes', () => {
    const m = pairMarks(['  foo();'], ['foo();'], { ignoreSpace: true });
    expect(m.mine.size + m.theirs.size).toBe(0);
    const n = pairMarks(['  foo();'], ['foo();']);
    expect(n.mine.size + n.theirs.size).toBeGreaterThan(0);
  });

  it('trecho enorme fica sem destaque por palavra', () => {
    const big = Array.from({ length: 500 }, (_, i) => `l${i}`);
    const m = pairMarks(big, big.map((l) => l + 'x'));
    expect(m.mine.size + m.theirs.size).toBe(0);
  });
});

describe('conflito que só difere em espaço', () => {
  const lines = (...l: string[]) => l.join('\n') + '\n';

  it('reconhece a reindentação e a linha em branco a mais, mas não uma mudança de verdade', () => {
    const base = lines('a', 'if (x) {', 'f();', '}', 'b', 'z = 1', 'c');
    const mine = lines('a', 'if (x) {', '    f();', '}', 'b', 'z = 2', 'c');
    const theirs = lines('a', 'if (x) {', '\tf();', '', '}', 'b', 'z = 3', 'c');
    const m = buildMerge({ base, mine, theirs });
    expect(m.conflicts).toHaveLength(2);
    expect(spaceOnlyConflicts(m)).toEqual([m.conflicts[0]]);
  });

  it('squashSpace tira todo tipo de espaço em branco', () => {
    expect(squashSpace(' a \t b\r\n c ')).toBe('abc');
  });
});
