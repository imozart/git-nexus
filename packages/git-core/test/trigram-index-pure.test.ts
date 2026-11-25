import { describe, expect, it } from 'vitest';
import {
  CorruptIndexError,
  TrigramCollector,
  checksum,
  decodePostings,
  encodePostings,
  intersect,
  literalKeys,
  maskMatcher,
  masksAreSimple,
  planTrigrams,
  regexRequiredRuns,
  sortGitPaths,
  trigramKey,
} from '../src/index.js';
import { INDEX_RULE, suggestIndex } from '../src/pure.js';

const enc = (s: string) => new TextEncoder().encode(s);
const keys = (s: string) => [...new TrigramCollector().collect(enc(s))].sort((a, b) => a - b);
const k = (s: string) => trigramKey(s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2));

describe('trigramas de um conteúdo', () => {
  it('tira os distintos, sem diferenciar maiúsculas e sem janelas que cruzam a quebra de linha', () => {
    expect(keys('abcabc')).toEqual([k('abc'), k('bca'), k('cab')].sort((a, b) => a - b));
    expect(keys('ABC')).toEqual(keys('abc'));
    expect(keys('ab\ncd')).toEqual([]); // nenhuma janela de 3 bytes dentro de uma linha
    expect(keys('abc\r\ndef')).toEqual([k('abc'), k('def')].sort((a, b) => a - b));
  });

  it('CRLF e LF geram o mesmo conjunto (o core.autocrlf do Windows não muda o índice)', () => {
    expect(keys('uma linha\r\noutra linha\r\n')).toEqual(keys('uma linha\noutra linha\n'));
  });

  it('é reutilizável: a segunda chamada não herda trigramas da primeira', () => {
    const c = new TrigramCollector();
    c.collect(enc('xyzxyz'));
    expect([...c.collect(enc('abc'))]).toEqual([k('abc')]);
  });

  it('trabalha em bytes: um caractere fora do ASCII entra com os bytes do UTF-8', () => {
    expect(keys('é').length).toBe(0); // 2 bytes
    expect(keys('aé').length).toBe(1); // 3 bytes
  });
});

describe('o que uma expressão exige', () => {
  const runs = (p: string) => regexRequiredRuns(p);

  it('texto simples, escapes de pontuação e classes que quebram o trecho', () => {
    expect(runs('foo.bar')).toEqual([['foo', 'bar']]);
    expect(runs('foo\\.bar')).toEqual([['foo.bar']]);
    expect(runs('foo[0-9]+bar')).toEqual([['foo', 'bar']]);
    expect(runs('^start$')).toEqual([['start']]);
  });

  it('quantificador que torna opcional tira o caractere; `+` mantém', () => {
    expect(runs('abc*def')).toEqual([['ab', 'def']]);
    expect(runs('abc?def')).toEqual([['ab', 'def']]);
    expect(runs('abc+def')).toEqual([['abc', 'def']]);
    expect(runs('abc{0,2}def')).toEqual([['ab', 'def']]);
    expect(runs('abc{2}def')).toEqual([['abc', 'def']]);
  });

  it('alternativas de nível mais alto viram um OU; grupos e alternativas de dentro de grupo não entram', () => {
    expect(runs('foo|bar')).toEqual([['foo'], ['bar']]);
    expect(runs('x(foo|bar)yyy')).toEqual([['x', 'yyy']]);
  });

  it('escapes que a análise não entende, grupo aberto e (?x) desistem', () => {
    expect(runs('\\x41bc')).toBeNull();
    expect(runs('(abc')).toBeNull();
    expect(runs('abc)')).toBeNull();
    expect(runs('\\1abc')).toBeNull();
    expect(runs('(?x) a b c')).toBeNull();
    expect(runs('[abc')).toBeNull();
  });

  it('\\b, \\d, \\w e afins só quebram o trecho', () => {
    expect(runs('\\bfoo\\b')).toEqual([['foo']]);
    expect(runs('\\d+timeout\\s*=')).toEqual([['timeout', '=']]);
  });

  it('classe com colchete e dois-pontos dentro não vaza literais', () => {
    expect(runs('a[[:alpha:]]bcd')).toEqual([['a', 'bcd']]);
    expect(runs('a[]x]bcd')).toEqual([['a', 'bcd']]);
  });
});

describe('o plano de trigramas', () => {
  it('texto fixo: todos os trigramas; menos de 3 bytes: sem filtro', () => {
    expect(planTrigrams({ pattern: 'timeout', regex: false, caseSensitive: true })).toEqual([[k('tim'), k('ime'), k('meo'), k('eou'), k('out')]]);
    expect(planTrigrams({ pattern: 'ab', regex: false, caseSensitive: true })).toBeNull();
  });

  it('regex sem trecho de 3 caracteres, ou com uma alternativa sem nada a exigir: sem filtro', () => {
    expect(planTrigrams({ pattern: 'a.b.c', regex: true, caseSensitive: true })).toBeNull();
    expect(planTrigrams({ pattern: 'foobar|ab', regex: true, caseSensitive: true })).toBeNull();
    expect(planTrigrams({ pattern: 'foobar|bazqux', regex: true, caseSensitive: true })?.length).toBe(2);
  });

  it('sem diferenciar caixa, janelas fora do ASCII e com k/s não filtram (o Git compara o Kelvin e o "ſ" de um jeito que não conhecemos)', () => {
    const ci = literalKeys('kubernetes', true);
    // "kub" e "tes" têm k/s: saem; "ube", "ber", "ern", "rne", "net", "ete" ficam
    expect(ci.sort((a, b) => a - b)).toEqual(['ube', 'ber', 'ern', 'rne', 'net', 'ete'].map(k).sort((a, b) => a - b));
    expect(literalKeys('café', true)).toEqual([k('caf')]); // as janelas com os bytes do "é" (≥ 0x80) saem; "caf" fica
  });

  it('diferenciando caixa, tudo vale (o índice é dobrado: devolve candidatos a mais, o Git decide)', () => {
    expect(literalKeys('Kubernetes', false).length).toBe(8);
  });

  it('(?i) dentro da expressão liga o cuidado mesmo com "diferenciar caixa"', () => {
    const plan = planTrigrams({ pattern: '(?i)kubernetes', regex: true, caseSensitive: true });
    // o grupo (?i) quebra o trecho e o resto vem sem as janelas com k/s
    expect(plan === null || plan[0]!.every((x) => x !== k('kub'))).toBe(true);
  });

  it('o trecho fixo da busca de várias linhas vale no lugar do padrão', () => {
    expect(planTrigrams({ pattern: 'a\nb', regex: false, caseSensitive: true, literal: 'abc' })).toEqual([[k('abc')]]);
  });
});

describe('listas de arquivos', () => {
  it('codifica e decodifica, inclusive números grandes', () => {
    const ids = [0, 1, 5, 127, 128, 300, 70_000, 16_000_000];
    expect([...decodePostings(encodePostings(ids), 17_000_000)]).toEqual(ids);
  });

  it('lista cortada, fora de ordem ou com número além do limite = índice corrompido', () => {
    expect(() => decodePostings(Uint8Array.from([0x80]), 10)).toThrow(CorruptIndexError);
    expect(() => decodePostings(encodePostings([3, 9]), 5)).toThrow(CorruptIndexError);
    expect(() => decodePostings(Uint8Array.from([1, 0]), 10)).toThrow(CorruptIndexError); // diferença 0: repetido
  });

  it('a soma de verificação muda com um byte trocado', () => {
    const a = encodePostings([1, 2, 3]);
    const b = encodePostings([1, 2, 4]);
    expect(checksum(a)).not.toBe(checksum(b));
  });

  it('interseção de listas', () => {
    expect([...intersect(Uint32Array.from([1, 3, 5, 9]), Uint32Array.from([3, 4, 9, 10]))]).toEqual([3, 9]);
    expect([...intersect(Uint32Array.from([]), Uint32Array.from([1]))]).toEqual([]);
  });
});

describe('máscaras em JavaScript', () => {
  const m = (inc: string[], exc: string[] = []) => maskMatcher({ include: inc, exclude: exc });

  it('segue o glob do Git: `**/` zero ou mais pastas, `*` não atravessa a barra', () => {
    const f = m(['**/*.ts'], ['**/dist/**']);
    expect(f('a.ts')).toBe(true);
    expect(f('src/deep/a.ts')).toBe(true);
    expect(f('src/a.js')).toBe(false);
    expect(f('dist/a.ts')).toBe(false);
    expect(f('src/dist/a.ts')).toBe(false);
    expect(m(['src/**'])('src/a/b.c')).toBe(true);
    expect(m(['src/*.c'])('src/a/b.c')).toBe(false);
  });

  it('só aceita máscaras simples', () => {
    expect(masksAreSimple(['**/*.ts', 'src/**'])).toBe(true);
    expect(masksAreSimple(['**/*.[tj]s'])).toBe(false);
    expect(masksAreSimple(['**/{a,b}'])).toBe(false);
    expect(masksAreSimple(['a\\b'])).toBe(false);
  });
});

describe('ordem do Git', () => {
  it('ordena pelos bytes do UTF-8, não pelas unidades do JavaScript', () => {
    // U+FF5E (3 bytes: EF BD 9E) vem antes do emoji (4 bytes: F0 ...) pelos bytes; em UTF-16 o emoji (D83D) viria antes de U+FF5E
    expect(sortGitPaths(['\u{1F600}', '～', 'a', 'B'])).toEqual(['B', 'a', '～', '\u{1F600}']);
  });
});

describe('quando propor o índice', () => {
  it('muitos arquivos, muito texto ou buscas lentas (mediana de pelo menos 3 medidas)', () => {
    expect(suggestIndex({ samples: 0 })).toBeNull();
    expect(suggestIndex({ files: INDEX_RULE.files + 1, samples: 0 })).toBe('files');
    expect(suggestIndex({ files: INDEX_RULE.files, samples: 0 })).toBeNull();
    expect(suggestIndex({ textBytes: INDEX_RULE.textBytes + 1, samples: 0 })).toBe('size');
    expect(suggestIndex({ medianMs: 2000, samples: 2 })).toBeNull();
    expect(suggestIndex({ medianMs: 2000, samples: 3 })).toBe('slow');
    expect(suggestIndex({ medianMs: 1500, samples: 5 })).toBeNull();
  });
});
