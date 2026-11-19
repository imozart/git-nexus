import { describe, expect, it } from 'vitest';
import { buildMerge, emptyChoices, presetPicks, resolveMerge, type PickedLine } from '@git-nexus/git-core/pure';
import { hasTyped, layoutResult, lineSpan, orient, resolvedCount, selectedLines, sideLabels, theirsFirst, togglePick, typedPicks } from '../src/entrypoints/renderer/merge-resolver-core';
import { escapeHtml, highlightLines } from '../src/entrypoints/renderer/syntax-lines';

const L = (...l: string[]) => l.join('\n') + '\n';

describe('lados do resolvedor', () => {
  const block = { base: 'b', ours: 'o', theirs: 't' };

  it('merge e cherry-pick: "minha" é a ours; no REBASE os lados trocam (a minha é o commit reaplicado)', () => {
    expect(orient(block, false)).toEqual({ base: 'b', mine: 'o', theirs: 't', swapped: false });
    expect(orient(block, true)).toEqual({ base: 'b', mine: 't', theirs: 'o', swapped: true });
  });

  const working = L('a', '<<<<<<< HEAD', 'x', '=======', 'y', '>>>>>>> feature/novo', 'z');
  const rebaseWorking = L('<<<<<<< HEAD', 'x', '=======', 'y', '>>>>>>> 1a2b3c4 (ajusta o tempo de espera)');

  it('rótulos vêm dos marcadores do Git: no merge, HEAD é a minha e o branch é a que chega', () => {
    expect(sideLabels(working, false)).toEqual({ mine: 'HEAD', theirs: 'feature/novo' });
  });

  it('no rebase o commit reaplicado é a "minha" e o branch de destino (HEAD) é a "que chega"', () => {
    expect(sideLabels(rebaseWorking, true)).toEqual({ mine: '1a2b3c4 (ajusta o tempo de espera)', theirs: 'HEAD' });
  });

  it('sem marcadores no arquivo os rótulos ficam vazios', () => {
    expect(sideLabels(undefined, false)).toEqual({ mine: '', theirs: '' });
    expect(sideLabels(L('a', 'b'), true)).toEqual({ mine: '', theirs: '' });
  });
});

describe('escolha linha a linha', () => {
  const pick = (from: 'mine' | 'theirs', line: number): PickedLine => ({ from, line });

  it('marca e desmarca, sempre minhas em ordem e depois as da origin', () => {
    let p = togglePick(undefined, 'theirs', 4);
    p = togglePick(p, 'mine', 2);
    p = togglePick(p, 'mine', 1);
    expect(p).toEqual([pick('mine', 1), pick('mine', 2), pick('theirs', 4)]);
    p = togglePick(p, 'mine', 1);
    expect(p).toEqual([pick('mine', 2), pick('theirs', 4)]);
    expect(togglePick(togglePick(undefined, 'mine', 0), 'mine', 0)).toEqual([]); // desmarcar a última é uma decisão ("nenhuma")
  });

  it('a ordem trocada põe as da origin primeiro', () => {
    const p = togglePick(togglePick(undefined, 'mine', 0, 'theirs'), 'theirs', 3, 'theirs');
    expect(p).toEqual([pick('theirs', 3), pick('mine', 0)]);
    expect(theirsFirst(p)).toBe(true);
    expect(theirsFirst([pick('mine', 0), pick('theirs', 3)])).toBe(false);
    expect(theirsFirst([pick('mine', 0)], true)).toBe(true); // só um lado: vale o padrão informado
  });

  it('seleção por lado e detecção de linha digitada', () => {
    const p = [pick('mine', 1), pick('theirs', 5)];
    expect([...selectedLines(p, 'mine')]).toEqual([1]);
    expect([...selectedLines(p, 'theirs')]).toEqual([5]);
    expect(hasTyped(p)).toBe(false);
    expect(hasTyped([{ from: 'typed', text: 'x' }])).toBe(true);
  });

  it('marcar uma linha de um conflito editado à mão descarta o texto digitado', () => {
    const p = togglePick([{ from: 'typed', text: 'feito à mão' }], 'mine', 2);
    expect(p).toEqual([pick('mine', 2)]);
  });

  it('texto digitado vira linhas (sem a linha vazia do fim) e vazio vira "nenhuma linha"', () => {
    expect(typedPicks('a\nb\n')).toEqual([{ from: 'typed', text: 'a' }, { from: 'typed', text: 'b' }]);
    expect(typedPicks('a\r\nb')).toEqual([{ from: 'typed', text: 'a' }, { from: 'typed', text: 'b' }]);
    expect(typedPicks('')).toEqual([]);
    expect(typedPicks('\n')).toEqual([{ from: 'typed', text: '' }]);
  });
});

describe('resultado por segmento', () => {
  const base = L('inicio', 'x', 'meio', 'fim');
  const mine = L('inicio', 'm1', 'm2', 'meio', 'fim');
  const theirs = L('inicio', 't1', 'meio', 'FIM');
  const m = buildMerge({ base, mine, theirs });
  const idx = m.conflicts[0]!;

  it('numera o arquivo final e dá o intervalo de linhas de cada região', () => {
    const r = resolveMerge(m, { ...emptyChoices(), picks: { [idx]: presetPicks(m, idx, 'both') } });
    const lay = layoutResult(m, r);
    expect(lay.map((s) => s.first)).toEqual([1, 2, 5, 6]);
    expect(lineSpan(lay[idx]!)).toEqual({ from: 2, to: 4 });
    expect(r.text).toBe(L('inicio', 'm1', 'm2', 't1', 'meio', 'FIM'));
    expect(lay[idx]!.offset).toBe(1);
  });

  it('um conflito resolvido como "nenhuma" não tem linhas, mas continua no mapa', () => {
    const r = resolveMerge(m, { ...emptyChoices(), picks: { [idx]: [] } });
    const lay = layoutResult(m, r);
    expect(lay[idx]!.lines).toHaveLength(0);
    expect(lay[idx]!.first).toBe(2);
    expect(lineSpan(lay[idx]!)).toEqual({ from: 2, to: 2 });
    expect(resolvedCount(m, { ...emptyChoices(), picks: { [idx]: [] } })).toBe(1);
    expect(resolvedCount(m, emptyChoices())).toBe(0);
  });
});

describe('realce de sintaxe por linha', () => {
  it('escapa o HTML e mantém uma entrada por linha, com classes tok-*', () => {
    const out = highlightLines(['const a = "<b>" // x', 'let n = 1'], 'x.ts');
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('tok-keyword');
    expect(out[0]).toContain('&lt;b&gt;');
    expect(out[0]).not.toContain('<b>');
    expect(out[1]).toContain('tok-number');
  });

  it('o texto das linhas é preservado (sem as marcas) e comentário de várias linhas é realçado nas duas', () => {
    const lines = ['/* um', 'dois */ let x = 1;'];
    const out = highlightLines(lines, 'a.js');
    expect(out.map((h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<'))).toEqual(lines);
    expect(out[0]).toContain('tok-comment');
    expect(out[1]).toContain('tok-comment');
  });

  it('arquivo sem gramática (ou vazio) volta só escapado', () => {
    expect(highlightLines(['a < b', ''], 'LEIAME.txt')).toEqual(['a &lt; b', '']);
    expect(highlightLines([], 'x.ts')).toEqual([]);
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
  });
});
