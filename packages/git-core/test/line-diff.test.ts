import { describe, expect, it } from 'vitest';
import { applyDiscard, blockRows, diffLines, splitLines } from '../src/pure.js';

const lines = (s: string) => splitLines(s).lines;
const rebuild = (rows: ReturnType<typeof diffLines>, side: 'old' | 'new') =>
  rows.flatMap((r) => (side === 'old' ? (r.oldText === undefined ? [] : [r.oldText]) : r.newText === undefined ? [] : [r.newText]));

describe('splitLines', () => {
  it('detecta EOL e newline final', () => {
    expect(splitLines('a\nb\n')).toEqual({ lines: ['a', 'b'], eol: '\n', endsWithNewline: true });
    expect(splitLines('a\r\nb')).toEqual({ lines: ['a', 'b'], eol: '\r\n', endsWithNewline: false });
    expect(splitLines('')).toEqual({ lines: [], eol: '\n', endsWithNewline: false });
  });
});

describe('diffLines', () => {
  it('sem diferenças = só linhas iguais', () => {
    const rows = diffLines(['a', 'b'], ['a', 'b']);
    expect(rows.every((r) => r.kind === 'eq' && r.block === -1)).toBe(true);
  });

  it('pareia remoção+adição como "change" e numera as linhas', () => {
    const rows = diffLines(['a', 'b', 'c'], ['a', 'B', 'c']);
    expect(rows[1]).toMatchObject({ kind: 'change', oldNo: 2, newNo: 2, oldText: 'b', newText: 'B', block: 0 });
  });

  it('adições e remoções puras', () => {
    const add = diffLines(['a'], ['a', 'x', 'y']);
    expect(add.filter((r) => r.kind === 'add').map((r) => r.newNo)).toEqual([2, 3]);
    const del = diffLines(['a', 'x', 'y'], ['a']);
    expect(del.filter((r) => r.kind === 'del').map((r) => r.oldNo)).toEqual([2, 3]);
  });

  it('arquivo novo e arquivo removido', () => {
    expect(diffLines([], ['a', 'b']).map((r) => r.kind)).toEqual(['add', 'add']);
    expect(diffLines(['a', 'b'], []).map((r) => r.kind)).toEqual(['del', 'del']);
  });

  it('propriedade: reconstrói exatamente as duas versões (aleatório)', () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let t = 0; t < 300; t++) {
      const a = Array.from({ length: rnd(25) }, () => String(rnd(6)));
      const b = Array.from({ length: rnd(25) }, () => String(rnd(6)));
      const rows = diffLines(a, b);
      expect(rebuild(rows, 'old')).toEqual(a);
      expect(rebuild(rows, 'new')).toEqual(b);
    }
  });

  it('é mínimo (LCS) em casos conhecidos', () => {
    const rows = diffLines(['a', 'b', 'c', 'd'], ['b', 'c', 'x']);
    const changed = rows.filter((r) => r.kind !== 'eq').length;
    expect(changed).toBe(2); // remove "a" + troca "d" por "x" (par = 1 linha "alterada")
  });

  it('arquivos grandes com poucas mudanças são rápidos', () => {
    const a = Array.from({ length: 50_000 }, (_, i) => `linha ${i}`);
    const b = [...a];
    b[25_000] = 'mudou';
    b.splice(40_000, 0, 'inserida');
    const t0 = Date.now();
    const rows = diffLines(a, b);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(rows.filter((r) => r.kind !== 'eq')).toHaveLength(2);
  });
});

describe('applyDiscard', () => {
  const opts = { eol: '\n' as const, endsWithNewline: true };

  it('descartar nada mantém o texto novo; tudo volta ao antigo', () => {
    const rows = diffLines(lines('a\nb\nc\n'), lines('a\nB\nc\nd\n'));
    expect(applyDiscard(rows, new Set(), opts)).toBe('a\nB\nc\nd\n');
    expect(applyDiscard(rows, new Set(rows.keys()), opts)).toBe('a\nb\nc\n');
  });

  it('descarta uma linha específica', () => {
    const rows = diffLines(lines('a\nb\nc\n'), lines('a\nB\nc\nd\n'));
    const idxD = rows.findIndex((r) => r.newText === 'd');
    expect(applyDiscard(rows, new Set([idxD]), opts)).toBe('a\nB\nc\n');
    const idxB = rows.findIndex((r) => r.newText === 'B');
    expect(applyDiscard(rows, new Set([idxB]), opts)).toBe('a\nb\nc\nd\n');
  });

  it('descarta um bloco inteiro e restaura linhas removidas', () => {
    const rows = diffLines(lines('1\n2\n3\n4\n5\n'), lines('1\n5\n'));
    expect(blockRows(rows, 0)).toHaveLength(3);
    expect(applyDiscard(rows, new Set(blockRows(rows, 0)), opts)).toBe('1\n2\n3\n4\n5\n');
    expect(applyDiscard(rows, new Set([1]), opts)).toBe('1\n2\n5\n'); // restaura só a linha "2"
  });

  it('preserva CRLF e ausência de newline final', () => {
    const rows = diffLines(lines('a\nb'), lines('a\r\nX'));
    expect(applyDiscard(rows, new Set([1]), { eol: '\r\n', endsWithNewline: false })).toBe('a\r\nb');
  });

  it('descartar tudo de um arquivo novo gera texto vazio', () => {
    const rows = diffLines([], ['x', 'y']);
    expect(applyDiscard(rows, new Set(rows.keys()), opts)).toBe('');
  });
});
