import type { SearchHit } from '@git-nexus/git-core/pure';
import { describe, expect, it } from 'vitest';
import { ROW_H, ResultModel, changedOutside, clampSplit, formatDuration, hitIndexes, hitKey, marksOf, pieces, readOnlyReason, scrollToRow, seedFromSelection, stepFile, stepHit, windowRange } from '../src/entrypoints/renderer/search-window-core';

const hit = (file: string, line: number, text = 'x', ranges: Array<[number, number]> = [[0, 1]], extra: Partial<SearchHit> = {}): SearchHit => ({ file, line, text, ranges, before: [], after: [], ...extra });

describe('modelo dos resultados', () => {
  it('agrupa por arquivo (pelo nome, mesmo que o arquivo volte em outro lote) e conta', () => {
    const m = new ResultModel();
    m.add([hit('a.ts', 1), hit('a.ts', 5), hit('b.ts', 2)]);
    m.add([hit('a.ts', 9)]);
    expect(m.total).toBe(4);
    expect(m.files).toBe(2);
    expect(m.hitsOf('a.ts').map((h) => h.line)).toEqual([1, 5, 9]);
    const rows = m.rows();
    expect(rows.map((r) => r.key)).toEqual(['f:a.ts', 'a.ts:1', 'a.ts:5', 'a.ts:9', 'f:b.ts', 'b.ts:2']);
    expect(rows[0]).toMatchObject({ kind: 'file', count: 3, collapsed: false });
  });

  it('arquivo recolhido mostra só o cabeçalho', () => {
    const m = new ResultModel();
    m.add([hit('a.ts', 1), hit('b.ts', 2)]);
    expect(m.rows(new Set(['a.ts'])).map((r) => r.key)).toEqual(['f:a.ts', 'f:b.ts', 'b.ts:2']);
  });

  it('limpa', () => {
    const m = new ResultModel();
    m.add([hit('a.ts', 1)]);
    m.clear();
    expect([m.total, m.files, m.rows().length]).toEqual([0, 0, 0]);
  });
});

describe('janela da lista virtualizada', () => {
  it('monta só o que está na tela mais a folga e nunca passa do total', () => {
    expect(windowRange(0, 240, 5000)).toEqual({ start: 0, end: 10 + 8 });
    expect(windowRange(24 * 1000, 240, 5000)).toEqual({ start: 1000 - 8, end: 1010 + 8 });
    expect(windowRange(24 * 4995, 240, 5000)).toMatchObject({ end: 5000 });
    expect(windowRange(0, 240, 3)).toEqual({ start: 0, end: 3 });
    expect(windowRange(-50, 240, 100).start).toBe(0);
  });

  it('o número de linhas montadas não cresce com o total (5 mil ou 500 mil)', () => {
    const w = (n: number) => {
      const r = windowRange(24 * 2000, 480, n);
      return r.end - r.start;
    };
    expect(w(5000)).toBe(w(500_000));
    expect(w(5000)).toBeLessThan(50);
  });

  it('rolar até a linha só quando ela não está visível', () => {
    expect(scrollToRow(3, 0, 240)).toBeNull();
    expect(scrollToRow(50, 0, 240)).toBe(50 * ROW_H + ROW_H - 240);
    expect(scrollToRow(2, 24 * 10, 240)).toBe(2 * ROW_H);
  });
});

describe('teclado na lista', () => {
  const m = new ResultModel();
  m.add([hit('a.ts', 1), hit('a.ts', 5), hit('b.ts', 2), hit('c.ts', 7)]);
  const rows = m.rows();

  it('↓ e ↑ pulam os cabeçalhos; sem seleção, ↓ vai à primeira e ↑ à última', () => {
    expect(rows[stepHit(rows, null, 1)]!.key).toBe('a.ts:1');
    expect(rows[stepHit(rows, null, -1)]!.key).toBe('c.ts:7');
    expect(rows[stepHit(rows, 'a.ts:5', 1)]!.key).toBe('b.ts:2'); // pula "f:b.ts"
    expect(rows[stepHit(rows, 'b.ts:2', -1)]!.key).toBe('a.ts:5');
  });

  it('nos extremos fica onde está; F3 (wrap) dá a volta', () => {
    expect(rows[stepHit(rows, 'c.ts:7', 1)]!.key).toBe('c.ts:7');
    expect(rows[stepHit(rows, 'a.ts:1', -1)]!.key).toBe('a.ts:1');
    expect(rows[stepHit(rows, 'c.ts:7', 1, true)]!.key).toBe('a.ts:1');
    expect(rows[stepHit(rows, 'a.ts:1', -1, true)]!.key).toBe('c.ts:7');
  });

  it('sem resultado devolve -1', () => {
    expect(stepHit([], null, 1)).toBe(-1);
    expect(stepFile([], null, 1)).toBe(-1);
    expect(hitIndexes([])).toEqual([]);
  });

  it('Ctrl+Alt+↓/↑ vão à primeira ocorrência do arquivo vizinho', () => {
    expect(rows[stepFile(rows, 'a.ts:5', 1)]!.key).toBe('b.ts:2');
    expect(rows[stepFile(rows, 'c.ts:7', -1)]!.key).toBe('b.ts:2');
    expect(rows[stepFile(rows, 'b.ts:2', -1)]!.key).toBe('a.ts:1');
    expect(rows[stepFile(rows, 'c.ts:7', 1)]!.key).toBe('c.ts:7');
    expect(rows[stepFile(rows, null, 1)]!.key).toBe('a.ts:1');
  });

  it('a chave é arquivo:linha', () => {
    expect(hitKey({ file: 'a/b.ts', line: 12 })).toBe('a/b.ts:12');
  });
});

describe('marcas no editor (colunas do núcleo)', () => {
  it('linha inteira: as colunas do núcleo valem como estão', () => {
    expect(marksOf(hit('a.ts', 3, 'foo bar foo', [[0, 3], [8, 11]]), 'foo bar foo')).toEqual([
      { line: 3, from: 0, to: 3 },
      { line: 3, from: 8, to: 11 },
    ]);
  });

  it('linha cortada: as colunas são do trecho; o início do trecho é achado na linha inteira', () => {
    const full = 'x'.repeat(400) + 'ALVO' + 'y'.repeat(400);
    const shown = full.slice(350, 450);
    expect(marksOf(hit('a.ts', 1, shown, [[50, 54]], { clippedStart: true, clippedEnd: true }), full)).toEqual([{ line: 1, from: 400, to: 404 }]);
  });

  it('se o trecho não está na linha (arquivo mudou), não marca nada em vez de marcar no lugar errado', () => {
    expect(marksOf(hit('a.ts', 1, 'trecho', [[0, 3]], { clippedStart: true }), 'outra coisa')).toEqual([]);
    expect(marksOf(hit('a.ts', 1, 'abc', [[0, 99]]), 'abc')).toEqual([]);
  });

  it('pedaços da lista: destaque e reticências do corte', () => {
    expect(pieces(hit('a.ts', 1, 'um dois três', [[3, 7]]))).toEqual([
      { text: 'um ', hit: false },
      { text: 'dois', hit: true },
      { text: ' três', hit: false },
    ]);
    expect(pieces(hit('a.ts', 1, 'abc', [[0, 3]], { clippedStart: true, clippedEnd: true }))).toEqual([
      { text: '…', hit: false },
      { text: 'abc', hit: true },
      { text: '…', hit: false },
    ]);
    expect(pieces(hit('a.ts', 1, '', []))).toEqual([{ text: '', hit: false }]);
  });
});

describe('divisória, tempo e texto inicial', () => {
  it('a divisória fica entre 15% e 85% (nunca esconde uma das áreas) e aceita lixo', () => {
    expect(clampSplit(0.5)).toBe(0.5);
    expect(clampSplit(0)).toBe(0.15);
    expect(clampSplit(2)).toBe(0.85);
    expect(clampSplit(Number.NaN)).toBe(0.4);
  });

  it('tempo no formato do idioma', () => {
    expect(formatDuration(200, 'pt-BR')).toBe('0,2 s');
    expect(formatDuration(1340, 'en')).toBe('1.3 s');
    expect(formatDuration(125_000, 'pt-BR')).toBe('2 min 5 s');
  });

  it('a seleção vira a busca só se for de uma linha e curta', () => {
    expect(seedFromSelection('  valor  ')).toBe('valor');
    expect(seedFromSelection('a\nb')).toBe('');
    expect(seedFromSelection('x'.repeat(201))).toBe('');
    expect(seedFromSelection('   ')).toBe('');
  });
});

describe('mudou por fora? e só leitura', () => {
  it('compara pelo hash; arquivo que sumiu também é mudança', () => {
    expect(changedOutside({ hash: 'a', size: 1 }, { hash: 'a', size: 1 })).toBe(false);
    expect(changedOutside({ hash: 'a', size: 1 }, { hash: 'b', size: 1 })).toBe(true);
    expect(changedOutside({ hash: 'a', size: 1 }, null)).toBe(true);
  });

  it('o motivo de abrir só para leitura', () => {
    const ok = { exists: true, binary: false, tooLarge: false, invalid: false, eol: 'lf' };
    expect(readOnlyReason(ok)).toBeNull();
    expect(readOnlyReason({ ...ok, eol: 'crlf' })).toBeNull();
    expect(readOnlyReason({ ...ok, eol: 'none' })).toBeNull();
    expect(readOnlyReason({ ...ok, exists: false })).toBe('missing');
    expect(readOnlyReason({ ...ok, binary: true })).toBe('binary');
    expect(readOnlyReason({ ...ok, tooLarge: true })).toBe('tooLarge');
    expect(readOnlyReason({ ...ok, invalid: true })).toBe('invalid');
    expect(readOnlyReason({ ...ok, eol: 'mixed' })).toBe('mixedEol');
  });
});
