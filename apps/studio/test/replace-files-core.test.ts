import { describe, expect, it } from 'vitest';
import { makeQuery } from '../src/entrypoints/renderer/find-core';
import { applyFile, planFile, reasonCounts, scopeRefused, tally, type FilePlan } from '../src/entrypoints/renderer/replace-files-core';

const q = (text: string, o: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean } = {}) => makeQuery({ text, caseSensitive: o.caseSensitive ?? false, wholeWord: o.wholeWord ?? false, regex: o.regex ?? false })!;
const plain = { regex: false, preserveCase: false };
const lines = (...n: number[]) => new Set(n);

describe('planFile: a prévia de um arquivo', () => {
  it('o texto depois da troca por linha, com todas as ocorrências da linha e os trechos trocados', () => {
    const p = planFile('um foo e outro foo\nnada\nfoo\n', 'lf', q('foo'), 'bar', plain, lines(1, 3));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect([...p.lines.keys()]).toEqual([1, 3]);
    expect(p.lines.get(1)).toMatchObject({ count: 2, after: 'um bar e outro bar', ranges: [[3, 6], [15, 18]], clippedStart: false, clippedEnd: false });
    expect(p.lines.get(3)).toMatchObject({ count: 1, after: 'bar' });
  });

  it('modo regex: grupos e escapes; modo texto: o texto novo é literal', () => {
    const r = planFile('a1 b22\n', 'lf', q('([a-z])(\\d+)', { regex: true }), '$2$1', { regex: true, preserveCase: false }, lines(1));
    expect(r.ok && r.lines.get(1)!.after).toBe('1a 22b');
    const lit = planFile('x\n', 'lf', q('x'), '$1\\n', plain, lines(1));
    expect(lit.ok && lit.lines.get(1)!.after).toBe('$1\\n');
  });

  it('manter a caixa e quebra de linha no texto novo aparece como ⏎ sem mexer nas colunas', () => {
    const c = planFile('Foo FOO foo\n', 'lf', q('foo'), 'bar', { regex: false, preserveCase: true }, lines(1));
    expect(c.ok && c.lines.get(1)!.after).toBe('Bar BAR bar');
    const nl = planFile('a-b\n', 'lf', q('-'), '\\n', plain, lines(1)); // modo texto: o \n digitado é literal
    // em regex o \n vira quebra de linha
    const rx = planFile('a-b\n', 'lf', q('-', { regex: true }), '\\n', { regex: true, preserveCase: false }, lines(1));
    expect(nl.ok && nl.lines.get(1)!.after).toBe('a\\nb');
    expect(rx.ok && rx.lines.get(1)!.after).toBe('a⏎b');
    expect(rx.ok && rx.lines.get(1)!.ranges).toEqual([[1, 2]]);
  });

  it('arquivo CRLF: as linhas continuam batendo com as da lista', () => {
    const p = planFile('a\r\nfoo\r\nb foo\r\n', 'crlf', q('foo'), 'X', plain, lines(2, 3));
    expect(p.ok && [...p.lines.values()].map((l) => [l.line, l.after])).toEqual([[2, 'X'], [3, 'b X']]);
  });

  it('linha da lista que não casa mais no disco: o arquivo é recusado (a lista nunca é a fonte)', () => {
    const p = planFile('nada aqui\nfoo\n', 'lf', q('foo'), 'bar', plain, lines(1, 2));
    expect(p).toEqual({ ok: false, reason: 'diverged', lines: [1] });
  });

  it('ocorrência no disco em linha que a lista não tem: não é trocada (só avisada)', () => {
    const p = planFile('foo\nfoo\n', 'lf', q('foo'), 'bar', plain, lines(1));
    expect(p.ok && [...p.lines.keys()]).toEqual([1]);
    expect(p.ok && p.extraLines).toEqual([2]);
  });

  it('fim de linha misto é recusado; linha comprida é cortada em volta do trecho trocado', () => {
    expect(planFile('a\r\nb\nfoo\r\n', 'mixed', q('foo'), 'x', plain, lines(3))).toEqual({ ok: false, reason: 'mixedEol' });
    const long = 'y'.repeat(500) + 'foo' + 'z'.repeat(500) + '\n';
    const p = planFile(long, 'lf', q('foo'), 'bar', plain, lines(1));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const l = p.lines.get(1)!;
    expect(l.clippedStart && l.clippedEnd).toBe(true);
    expect(l.after.slice(l.ranges[0]![0], l.ranges[0]![1])).toBe('bar');
    expect(l.after.length).toBeLessThan(400);
  });

  it('ocorrência que atravessa linhas: conta na linha onde começa', () => {
    const p = planFile('um\ndois\ntres\n', 'lf', q('um\ndois'), 'X', plain, lines(1));
    expect(p.ok && p.lines.get(1)).toMatchObject({ count: 1, after: 'X' });
  });
});

describe('applyFile: o texto novo do arquivo', () => {
  it('troca só as linhas escolhidas, de uma vez (a→aa não repete)', () => {
    expect(applyFile('foo\nfoo foo\nfoo\n', 'lf', q('foo'), 'foofoo', plain, lines(1, 3))).toEqual({ text: 'foofoo\nfoo foo\nfoofoo\n', replaced: 2 });
    expect(applyFile('foo\n', 'lf', q('foo'), 'x', plain, lines()).replaced).toBe(0);
  });

  it('mantém CRLF em todas as linhas e o que não é ocorrência byte a byte (inclusive o fim sem quebra)', () => {
    const r = applyFile('a foo\r\nb\r\nfoo', 'crlf', q('foo'), 'X\\nY', { regex: true, preserveCase: false }, lines(1, 3));
    expect(r.text).toBe('a X\r\nY\r\nb\r\nX\r\nY');
    expect(r.replaced).toBe(2);
    expect(applyFile('x\n', 'lf', q('x'), 'a\\nb', { regex: true, preserveCase: false }, lines(1)).text).toBe('a\nb\n');
  });

  it('ocorrência com acento e emoji (UTF-16) troca no lugar certo', () => {
    expect(applyFile('ação 😀 ação\n', 'lf', q('ação'), 'ok', plain, lines(1)).text).toBe('ok 😀 ok\n');
  });
});

describe('totais e motivos', () => {
  const ok = (counts: Record<number, number>): FilePlan => ({ ok: true, extraLines: [], lines: new Map(Object.entries(counts).map(([l, c]) => [Number(l), { line: Number(l), count: c, after: '', ranges: [], clippedStart: false, clippedEnd: false }])) });
  it('soma só as linhas escolhidas e lista os arquivos recusados', () => {
    const plans = new Map<string, FilePlan>([['a', ok({ 1: 2, 5: 1 })], ['b', ok({ 3: 4 })], ['c', { ok: false, reason: 'changed' }], ['d', { ok: false, reason: 'binary' }]]);
    const chosen = new Map<string, Set<number>>([['a', new Set([1])], ['b', new Set()], ['c', new Set([1])], ['d', new Set([2])]]);
    expect(tally(plans, chosen)).toEqual({ replacements: 2, files: 1, refused: [{ file: 'c', reason: 'changed' }, { file: 'd', reason: 'binary' }] });
    expect(reasonCounts([{ reason: 'changed' }, { reason: 'binary' }, { reason: 'changed' }])).toEqual([{ reason: 'changed', n: 2 }, { reason: 'binary', n: 1 }]);
  });

  it('o stage e as revisões não são o arquivo do disco', () => {
    expect([scopeRefused('revision'), scopeRefused('staged'), scopeRefused('worktree'), scopeRefused('tracked'), scopeRefused('changed')]).toEqual([true, true, false, false, false]);
  });
});
