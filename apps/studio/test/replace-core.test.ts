import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { makeQuery, type FindOptions } from '../src/entrypoints/renderer/find-core';
import { MAX_REPLACE, MAX_SELECT, applyCase, collect, crlfOnly, expandTemplate, infoAt, planReplaceAll, replacementFor, selectAllMatches, type MatchInfo, type ReplaceOptions } from '../src/entrypoints/renderer/replace-core';

const find = (text: string, o: Partial<FindOptions> = {}) => {
  const query = makeQuery({ text, caseSensitive: false, wholeWord: false, regex: false, ...o });
  if (!query) throw new Error('consulta inválida: ' + text);
  return query;
};
const RX: ReplaceOptions = { regex: true, preserveCase: false };
const TXT: ReplaceOptions = { regex: false, preserveCase: false };
const mk = (doc: string, extra: Extension[] = []) => EditorState.create({ doc, extensions: [history(), EditorState.allowMultipleSelections.of(true), ...extra] });
const info = (text: string, groups: string[] = [], named: Record<string, string> | null = null): Pick<MatchInfo, 'text' | 'groups' | 'named'> => ({ text, groups, named });

describe('texto novo: grupos', () => {
  it('$1, $2, $& e $<nome> no modo regex', () => {
    expect(expandTemplate('$2:$1', info('ab@cd', ['ab', 'cd']), true)).toBe('cd:ab');
    expect(expandTemplate('[$&]', info('x'), true)).toBe('[x]');
    expect(expandTemplate('$<dia>/$<mes>', info('1-2', ['1', '2'], { dia: '1', mes: '2' }), true)).toBe('1/2');
  });

  it('grupo que não existe fica literal (como no JavaScript); nome que não existe vira vazio; $10 só se houver 10 grupos', () => {
    expect(expandTemplate('$1 $3', info('a', ['a']), true)).toBe('a $3');
    expect(expandTemplate('$<x>', info('a', ['a'], { y: '1' }), true)).toBe('');
    expect(expandTemplate('$<x>', info('a', ['a'], null), true)).toBe('$<x>');
    expect(expandTemplate('$10', info('a', ['a']), true)).toBe('a0');
    expect(expandTemplate('$10', info('a', Array.from({ length: 10 }, (_, i) => 'g' + (i + 1))), true)).toBe('g10');
  });

  it('grupo que não participou vira vazio', () => {
    expect(expandTemplate('<$1|$2>', info('a', ['a', '']), true)).toBe('<a|>');
  });

  it('$ literal: $$ e \\$; cifrão solto e no fim ficam como estão', () => {
    expect(expandTemplate('US$$ 5', info('x'), true)).toBe('US$ 5');
    expect(expandTemplate('\\$1', info('x', ['a']), true)).toBe('$1');
    expect(expandTemplate('preço $', info('x'), true)).toBe('preço $');
    expect(expandTemplate('$x', info('x'), true)).toBe('$x');
  });

  it('modo texto: o texto novo é literal (nada de grupo nem escape)', () => {
    expect(expandTemplate('$1 \\n $&', info('a', ['a']), false)).toBe('$1 \\n $&');
  });
});

describe('texto novo: escapes', () => {
  it('\\n, \\r, \\t e \\\\ no modo regex; outra barra fica como está', () => {
    expect(expandTemplate('a\\nb\\tc', info('x'), true)).toBe('a\nb\tc');
    expect(expandTemplate('a\\\\n', info('x'), true)).toBe('a\\n');
    expect(expandTemplate('\\d \\', info('x'), true)).toBe('\\d \\');
    expect(expandTemplate('a\\rb', info('x'), true)).toBe('a\rb');
  });
});

describe('manter a caixa', () => {
  it('foo→bar, Foo→Bar, FOO→BAR; mistura e sem letras não mudam', () => {
    expect(applyCase('bar', 'foo')).toBe('bar');
    expect(applyCase('bar', 'Foo')).toBe('Bar');
    expect(applyCase('bar', 'FOO')).toBe('BAR');
    expect(applyCase('bar', 'fOo')).toBe('bar');
    expect(applyCase('Bar', '123')).toBe('Bar');
    expect(applyCase('bar', 'fOO')).toBe('bar');
    expect(applyCase('', 'FOO')).toBe('');
  });

  it('com acento e substituição de várias palavras', () => {
    expect(applyCase('ação', 'AÇÃO')).toBe('AÇÃO');
    expect(applyCase('ação nova', 'Ação')).toBe('Ação nova');
  });

  it('aplicado a cada ocorrência de "substituir todas"', () => {
    const s = mk('foo Foo FOO fOo');
    const plan = planReplaceAll(s, find('foo'), null, 'bar', { regex: false, preserveCase: true });
    const next = s.update({ changes: plan.changes }).state;
    expect(next.doc.toString()).toBe('bar Bar BAR bar');
  });
});

describe('substituir todas', () => {
  it('conta, troca tudo e não busca de novo o que acabou de pôr (a→aa)', () => {
    const s = mk('a b a b a');
    const plan = planReplaceAll(s, find('a'), null, 'aa', TXT);
    expect(plan.count).toBe(3);
    expect(s.update({ changes: plan.changes }).state.doc.toString()).toBe('aa b aa b aa');
  });

  it('grupos e escapes por ocorrência (regex)', () => {
    const s = mk('ana@x.com\nbia@y.org');
    const plan = planReplaceAll(s, find('(\\w+)@(\\w+)', { regex: true }), null, '$2:$1\\n', RX);
    expect(s.update({ changes: plan.changes }).state.doc.toString()).toBe('x:ana\n.com\ny:bia\n.org');
  });

  it('uma única transação: UM Ctrl+Z desfaz a substituição inteira', () => {
    let s = mk('foo foo foo\nfoo');
    const plan = planReplaceAll(s, find('foo'), null, 'bar', TXT);
    s = s.update({ changes: plan.changes, userEvent: 'input.replace.all' }).state;
    expect(s.doc.toString()).toBe('bar bar bar\nbar');
    let after = s;
    expect(undo({ state: s, dispatch: (tr) => (after = tr.state) })).toBe(true);
    expect(after.doc.toString()).toBe('foo foo foo\nfoo');
  });

  it('só dentro do trecho ("na seleção")', () => {
    const s = mk('foo | foo | foo');
    const plan = planReplaceAll(s, find('foo'), { from: 5, to: 10 }, 'X', TXT);
    expect(plan.count).toBe(1);
    expect(s.update({ changes: plan.changes }).state.doc.toString()).toBe('foo | X | foo');
  });

  it('ocorrência de várias linhas e ocorrência vazia (a*) ignorada', () => {
    const s = mk('um\ndois\ntrês');
    const plan = planReplaceAll(s, find('um\ndois'), null, 'X', TXT);
    expect(s.update({ changes: plan.changes }).state.doc.toString()).toBe('X\ntrês');
    const s2 = mk('baaab');
    const p2 = planReplaceAll(s2, find('a*', { regex: true }), null, '-', RX);
    expect(p2.count).toBe(1);
    expect(s2.update({ changes: p2.changes }).state.doc.toString()).toBe('b-b');
  });

  it('texto novo vazio apaga as ocorrências', () => {
    const s = mk('a-b-c');
    expect(s.update({ changes: planReplaceAll(s, find('-'), null, '', TXT).changes }).state.doc.toString()).toBe('abc');
  });

  it('recusa acima do limite (e diz) em vez de travar o editor', () => {
    const s = mk('a'.repeat(MAX_REPLACE + 5));
    expect(planReplaceAll(s, find('a'), null, 'b', TXT)).toMatchObject({ tooMany: true, count: 0 });
  });
});

describe('quebra de linha do arquivo preservada (CRLF e LF)', () => {
  it('arquivo CRLF: \\n do texto novo entra como CRLF e nada vira LF solto', () => {
    const s = mk('a=1\r\nb=2\r\n', [EditorState.lineSeparator.of('\r\n')]);
    const plan = planReplaceAll(s, find('=', { regex: true }), null, ' =\\n  ', RX);
    const out = s.update({ changes: plan.changes }).state.sliceDoc(0);
    expect(out).toBe('a =\r\n  1\r\nb =\r\n  2\r\n');
    expect(out.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });

  it('arquivo LF continua LF', () => {
    const s = mk('a=1\nb=2\n');
    const plan = planReplaceAll(s, find('=', { regex: true }), null, '\\n', RX);
    const out = s.update({ changes: plan.changes }).state.sliceDoc(0);
    expect(out).toBe('a\n1\nb\n2\n');
    expect(out).not.toMatch(/\r/);
  });

  it('texto novo digitado com quebra de linha real (campo de várias linhas) também segue o arquivo', () => {
    const s = mk('x\r\ny', [EditorState.lineSeparator.of('\r\n')]);
    const plan = planReplaceAll(s, find('y'), null, 'a\nb', TXT);
    expect(s.update({ changes: plan.changes }).state.sliceDoc(0)).toBe('x\r\na\r\nb');
  });
});

describe('detecção do fim de linha do arquivo', () => {
  it('CRLF só quando TODAS as quebras são CRLF; LF, misto e sem quebra ficam no padrão', () => {
    expect(crlfOnly('a\r\nb\r\n')).toBe(true);
    expect(crlfOnly('a\nb\n')).toBe(false);
    expect(crlfOnly('a\r\nb\n')).toBe(false);
    expect(crlfOnly('a\r\nb\rc')).toBe(false);
    expect(crlfOnly('sem quebra')).toBe(false);
    expect(crlfOnly('')).toBe(false);
  });
});

describe('uma ocorrência', () => {
  it('infoAt acha a ocorrência com grupos e recusa um trecho que não é ocorrência', () => {
    const s = mk('x ab@cd y');
    const q = find('(\\w+)@(\\w+)', { regex: true });
    const m = infoAt(s, q, null, { from: 2, to: 7 });
    expect(m).toMatchObject({ text: 'ab@cd', groups: ['ab', 'cd'] });
    expect(replacementFor('$2.$1', m!, RX)).toBe('cd.ab');
    expect(infoAt(s, q, null, { from: 2, to: 6 })).toBeNull();
    expect(infoAt(s, q, null, { from: 0, to: 1 })).toBeNull();
  });

  it('âncora de linha (^) vale: a ocorrência é achada a partir do começo da linha', () => {
    const s = mk('a\nfoo bar');
    expect(infoAt(s, find('^foo', { regex: true }), null, { from: 2, to: 5 })).toMatchObject({ text: 'foo' });
    expect(collect(s, find('^foo', { regex: true }), 0, s.doc.length, 10)).toHaveLength(1);
  });

  it('nomeados: $<nome>', () => {
    const s = mk('2026-11-23');
    const q = find('(?<a>\\d+)-(?<m>\\d+)-(?<d>\\d+)', { regex: true });
    const m = infoAt(s, q, null, { from: 0, to: 10 })!;
    expect(replacementFor('$<d>/$<m>/$<a>', m, RX)).toBe('23/11/2026');
  });
});

describe('selecionar todas as ocorrências (vários cursores)', () => {
  it('uma seleção por ocorrência, a principal é a primeira depois do cursor', () => {
    const s = mk('foo 1 foo 2 foo 3', []).update({ selection: EditorSelection.cursor(7) }).state;
    const r = selectAllMatches(s, find('foo'), null)!;
    expect(r.count).toBe(3);
    expect(r.selection.ranges.map((x) => [x.from, x.to])).toEqual([[0, 3], [6, 9], [12, 15]]);
    expect(r.selection.mainIndex).toBe(2);
  });

  it('digitar com todas selecionadas troca todas (e um Ctrl+Z desfaz)', () => {
    let s = mk('foo 1 foo 2 foo');
    const r = selectAllMatches(s, find('foo'), null)!;
    s = s.update({ selection: r.selection }).state;
    s = s.update(s.replaceSelection('X'), { userEvent: 'input.type' }).state;
    expect(s.doc.toString()).toBe('X 1 X 2 X');
    let after = s;
    undo({ state: s, dispatch: (tr) => (after = tr.state) });
    expect(after.doc.toString()).toBe('foo 1 foo 2 foo');
  });

  it('sem ocorrência: nada; acima do teto: corta e avisa', () => {
    expect(selectAllMatches(mk('abc'), find('zzz'), null)).toBeNull();
    const big = selectAllMatches(mk('a'.repeat(MAX_SELECT + 10)), find('a'), null)!;
    expect(big).toMatchObject({ count: MAX_SELECT, capped: true });
  });
});
