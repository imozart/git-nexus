import { describe, expect, it } from 'vitest';
import { buildMerge, emptyChoices, resolveMerge, wordDiff } from '@git-nexus/git-core/pure';
import { applyBulk, pendingSpaceOnly } from '../src/entrypoints/renderer/merge-resolver-core';
import { eolInfo, eolName, historyLine, markHtml, showInvisibles } from '../src/entrypoints/renderer/merge-compare-core';
import { escapeHtml, highlightLines } from '../src/entrypoints/renderer/syntax-lines';

const L = (...l: string[]) => l.join('\n') + '\n';

describe('destaque por palavra sobre o HTML realçado', () => {
  it('envolve só o trecho que mudou, contando a entidade (&lt;) como um caractere do texto', () => {
    expect(markHtml('abc def', [{ start: 4, end: 7 }])).toBe('abc <mark class="wd">def</mark>');
    expect(markHtml(escapeHtml('a<b'), [{ start: 1, end: 2 }])).toBe('a<mark class="wd">&lt;</mark>b');
    expect(markHtml('igual', [])).toBe('igual');
    expect(markHtml('igual', undefined)).toBe('igual');
  });

  it('a marca não atravessa os <span> do realce de sintaxe (uma marca por pedaço de texto)', () => {
    const html = '<span class="tok-keyword">const</span> x = <span class="tok-number">1</span>;';
    // "st x = 1": do 4º ao 11º caractere do texto "const x = 1;"
    const out = markHtml(html, [{ start: 3, end: 11 }]);
    expect(out).toBe('<span class="tok-keyword">con<mark class="wd">st</mark></span><mark class="wd"> x = </mark><span class="tok-number"><mark class="wd">1</mark></span>;');
    // e o texto, sem as marcas, continua o mesmo
    expect(out.replace(/<[^>]+>/g, '')).toBe('const x = 1;');
  });

  it('casa com a diferença calculada e com o realce de uma linha de verdade', () => {
    const a = 'let preco = 10;';
    const b = 'let custo = 10;';
    const d = wordDiff(a, b);
    const html = highlightLines([a], 'x.ts')[0]!;
    const marked = markHtml(html, d.a);
    expect(marked.replace(/<[^>]+>/g, '')).toBe(a);
    expect(marked).toContain('<mark class="wd">preco</mark>');
  });
});

describe('caracteres invisíveis', () => {
  it('desenha espaço e tab sem mexer nos <span>, e o fim de linha que a linha tinha', () => {
    const out = showInvisibles('<span class="tok-keyword">if</span> (x)\t', '\r\n');
    expect(out).toContain('<span class="tok-keyword">if</span><i class="inv inv--sp"> </i>(x)<i class="inv inv--tab">\t</i>');
    expect(out.endsWith('<i class="inv inv--eol inv--crlf" aria-hidden="true"></i>')).toBe(true);
    expect(showInvisibles('a', '\n')).toContain('inv--lf');
    expect(showInvisibles('a', '')).toBe('a'); // última linha sem quebra: nada a desenhar
    // os espaços dentro de um atributo (class="a b") não são tocados
    expect(showInvisibles('<span class="a b">x</span>')).toBe('<span class="a b">x</span>');
  });
});

describe('fim de linha das versões', () => {
  it('nomeia o terminador e avisa só quando as versões usam fins de linha diferentes', () => {
    expect([eolName('\n'), eolName('\r\n'), eolName('')]).toEqual(['LF', 'CRLF', '']);
    const crlf = (s: string) => s.replace(/\n/g, '\r\n');
    const base = L('a', 'b', 'c');
    const m = buildMerge({ base, mine: crlf(L('a', 'B', 'c')), theirs: L('a', 'b', 'C') });
    expect(eolInfo(m)).toMatchObject({ mine: 'CRLF', theirs: 'LF', base: 'LF', differs: true });
    const same = buildMerge({ base, mine: L('a', 'B', 'c'), theirs: L('a', 'b', 'C') });
    expect(eolInfo(same).differs).toBe(false);
  });

  it('um arquivo que só trocou LF por CRLF não gera conflito, e o resultado pode ficar LF, CRLF ou como numa das versões', () => {
    const base = L('a', 'b', 'c');
    const crlf = base.replace(/\n/g, '\r\n');
    const m = buildMerge({ base, mine: crlf, theirs: L('a', 'b', 'C') });
    expect(m.conflicts).toHaveLength(0);
    const out = (eol: 'mine' | 'theirs' | 'lf' | 'crlf') => resolveMerge(m, { ...emptyChoices(), eol }).text;
    expect(out('mine')).toBe('a\r\nb\r\nC\n'); // cada linha mantém o terminador de onde veio
    expect(out('lf')).toBe('a\nb\nC\n');
    expect(out('crlf')).toBe('a\r\nb\r\nC\r\n');
  });
});

describe('só espaço: reclassificar e resolver de uma vez', () => {
  const base = L('inicio', 'if (x) {', 'f();', '}', 'meio', 'v = 1', 'fim');
  const mine = L('inicio', 'if (x) {', '    f();', '}', 'meio', 'v = 2', 'fim');
  const theirs = L('inicio', 'if (x) {', '\tf();', '}', 'meio', 'v = 3', 'fim');
  const m = buildMerge({ base, mine, theirs });

  it('só o conflito de reindentação entra; o de valores diferentes continua para o usuário', () => {
    expect(m.conflicts).toHaveLength(2);
    expect(pendingSpaceOnly(m, emptyChoices())).toEqual([m.conflicts[0]]);
  });

  it('"resolver os que só diferem em espaço" usa a minha só nesses e não toca o resto nem o que já foi decidido', () => {
    const next = applyBulk(m, emptyChoices(), 'spaceOnly');
    expect(Object.keys(next.picks).map(Number)).toEqual([m.conflicts[0]]);
    const r = resolveMerge(m, next);
    expect(r.text).toBeNull(); // o outro conflito continua pendente
    expect(r.preview).toContain('    f();');
    // já decidido: não muda
    const decided = { ...emptyChoices(), picks: { [m.conflicts[0]!]: [] } };
    expect(applyBulk(m, decided, 'spaceOnly').picks[m.conflicts[0]!]).toEqual([]);
    expect(pendingSpaceOnly(m, next)).toEqual([]);
  });
});

describe('histórico do trecho', () => {
  it('uma linha com o commit curto, quem, quando e o assunto', () => {
    const h = { hash: 'abcdef0123456789', author: 'Bia', date: '2026-11-12T10:00:00-03:00', subject: 'troca o c' };
    expect(historyLine(h, 'en-US')).toBe('abcdef0 · Bia · 11/12/2026 · troca o c');
    expect(historyLine({ ...h, date: 'lixo' }, 'en-US')).toBe('abcdef0 · Bia · troca o c');
  });
});
