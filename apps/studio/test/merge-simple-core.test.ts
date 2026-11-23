import { describe, expect, it } from 'vitest';
import { buildMerge, emptyChoices, resolveMerge } from '@git-nexus/git-core/pure';
import { applyBulk, deriveChoices, pendingSimple, recordedDiff } from '../src/entrypoints/renderer/merge-resolver-core';

const L = (...l: string[]) => l.join('\n') + '\n';

describe('resolver os simples', () => {
  // 1º: reindentação (simples) · 2º: valores diferentes (de verdade) · 3º: duas inserções na lista (simples)
  const base = L('inicio', 'f();', 'meio', 'v = 1', 'meio2', 'import a', 'import d', 'fim');
  const mine = L('inicio', '    f();', 'meio', 'v = 2', 'meio2', 'import a', 'import b', 'import d', 'fim');
  const theirs = L('inicio', 'g();', 'meio', 'v = 3', 'meio2', 'import a', 'import c', 'import d', 'fim');
  const m = buildMerge({ base, mine, theirs });

  it('lista só os pendentes que têm sugestão, cada um com a classe', () => {
    expect(m.conflicts).toHaveLength(3);
    const items = pendingSimple(m, emptyChoices());
    expect(items.map((i) => [i.idx, i.suggestion.kind])).toEqual([
      [m.conflicts[0], 'reformat'],
      [m.conflicts[2], 'insertions'],
    ]);
  });

  it('aplicar decide só esses (o de verdade continua pendente) e o que o usuário já decidiu não muda', () => {
    const next = applyBulk(m, emptyChoices(), 'simple');
    expect(Object.keys(next.picks).map(Number)).toEqual([m.conflicts[0], m.conflicts[2]]);
    const r = resolveMerge(m, next);
    expect(r.text).toBeNull();
    expect(r.pending).toEqual([m.conflicts[1]]);
    expect(r.preview).toContain('g();');
    expect(r.preview).toContain('import b\nimport c');
    const decided = { ...emptyChoices(), picks: { [m.conflicts[0]!]: [] } };
    expect(applyBulk(m, decided, 'simple').picks[m.conflicts[0]!]).toEqual([]);
    expect(pendingSimple(m, next)).toEqual([]);
  });
});

describe('arquivo preenchido pela resolução gravada (rerere)', () => {
  const base = L('a', 'x = 1', 'b', 'y = 1', 'c');
  const mine = L('a', 'x = 2', 'b', 'y = 2', 'c');
  const theirs = L('a', 'x = 3', 'b', 'y = 3', 'c');
  const m = buildMerge({ base, mine, theirs });

  it('reconstrói as escolhas: linha igual à de um lado liga ao lado, o resto vira texto digitado', () => {
    const working = L('a', 'x = 3', 'b', 'y = 2 + 3', 'c');
    const c = deriveChoices(m, working);
    expect(c).not.toBeNull();
    expect(c!.picks[m.conflicts[0]!]).toEqual([{ from: 'theirs', line: 1 }]);
    expect(c!.picks[m.conflicts[1]!]).toEqual([{ from: 'typed', text: 'y = 2 + 3' }]);
    expect(resolveMerge(m, c!).text).toBe(working);
  });

  it('a resolução pode ser "nenhuma linha" ou as duas', () => {
    expect(deriveChoices(m, L('a', 'b', 'y = 2', 'y = 3', 'c'))!.picks).toEqual({ [m.conflicts[0]!]: [], [m.conflicts[1]!]: [{ from: 'mine', line: 3 }, { from: 'theirs', line: 3 }] });
  });

  it('linha repetida junto do conflito não confunde a posição', () => {
    const b = L('a', 'x', 'z');
    const mm = buildMerge({ base: b, mine: L('a', 'x1', 'z'), theirs: L('a', 'x2', 'z') });
    const c = deriveChoices(mm, L('a', 'z', 'z'));
    expect(c).not.toBeNull();
    expect(resolveMerge(mm, c!).text).toBe(L('a', 'z', 'z'));
  });

  it('se o arquivo não for explicável pelas escolhas (perdeu linha de fora do conflito), devolve null', () => {
    expect(deriveChoices(m, L('a', 'x = 3', 'y = 2', 'c'))).toBeNull();
    expect(deriveChoices(m, L('a', 'x = 3', 'b', 'y = 2', 'c', 'sobrou'))).toBeNull();
  });

  it('respeita o fim de linha do arquivo (CRLF)', () => {
    const working = L('a', 'x = 3', 'b', 'y = 2', 'c').replace(/\n/g, '\r\n');
    const c = deriveChoices(m, working);
    expect(c?.eol).toBe('crlf');
    expect(resolveMerge(m, c!).text).toBe(working);
  });

  it('a diferença mostra só o que a resolução mudou em relação a ficar com a minha versão', () => {
    const rows = recordedDiff(m, L('a', 'x = 3', 'b', 'y = 2', 'c'));
    expect(rows.map((r) => [r.kind])).toEqual([['change']]);
    expect(recordedDiff(m, L('a', 'x = 2', 'b', 'y = 2', 'c'))).toEqual([]);
  });
});
