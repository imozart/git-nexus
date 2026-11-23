import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ariaShortcut, fieldRows, isMultiline, pushHistory, regexProblem, shortcutLabel, stepHistory, toggleForKey, toggleTip, type KeyLike } from '../src/search-field-core';

const key = (code: string, o: Partial<KeyLike> = {}): KeyLike => ({ code, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...o });

describe('atalhos das opções', () => {
  it('Alt+C, Alt+O e Alt+X ligam diferenciar caixa, palavra inteira e regex (pela tecla física)', () => {
    expect(toggleForKey(key('KeyC'), false)).toBe('case');
    expect(toggleForKey(key('KeyO'), false)).toBe('word');
    expect(toggleForKey(key('KeyX'), false)).toBe('regex');
    expect(toggleForKey(key('KeyZ'), false)).toBeNull();
  });

  it('sem Alt, com Shift ou com Ctrl/⌘ não é atalho (Ctrl+C continua copiando)', () => {
    expect(toggleForKey(key('KeyC', { altKey: false }), false)).toBeNull();
    expect(toggleForKey(key('KeyC', { altKey: false, ctrlKey: true }), false)).toBeNull();
    expect(toggleForKey(key('KeyC', { shiftKey: true }), false)).toBeNull();
    expect(toggleForKey(key('KeyC', { metaKey: true }), false)).toBeNull();
  });

  it('AltGr (ABNT2, ISO) digita caracteres e nunca é atalho: Ctrl+Alt no Windows, AltGraph no Linux', () => {
    expect(toggleForKey(key('KeyC', { ctrlKey: true }), false)).toBeNull();
    expect(toggleForKey(key('KeyC', { getModifierState: (k) => k === 'AltGraph' }), false)).toBeNull();
    expect(toggleForKey(key('KeyC', { getModifierState: () => false }), false)).toBe('case');
  });

  it('no macOS o atalho é ⌘+Alt (Alt sozinho digita "ç", "ø"…)', () => {
    expect(toggleForKey(key('KeyC', { metaKey: true }), true)).toBe('case');
    expect(toggleForKey(key('KeyC'), true)).toBeNull();
    expect(toggleForKey(key('KeyC', { metaKey: true, ctrlKey: true }), true)).toBeNull();
  });

  it('a dica traz o nome e o atalho do sistema', () => {
    expect(shortcutLabel('regex', false)).toBe('Alt+X');
    expect(shortcutLabel('regex', true)).toBe('⌘⌥X');
    expect(toggleTip('Palavra inteira', 'word', false)).toBe('Palavra inteira (Alt+O)');
    expect(ariaShortcut('case', false)).toBe('Alt+C');
    expect(ariaShortcut('case', true)).toBe('Meta+Alt+C');
  });
});

describe('regex e várias linhas', () => {
  it('regex válida não tem problema; inválida devolve a mensagem sem o prefixo', () => {
    expect(regexProblem('a+b')).toBeNull();
    expect(regexProblem('')).toBeNull();
    const msg = regexProblem('(');
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/^Invalid regular expression/i);
    expect(regexProblem('[')).toBeTruthy();
  });

  it('quebra de linha liga a busca de várias linhas e o campo cresce até 4 linhas', () => {
    expect(isMultiline('a\nb')).toBe(true);
    expect(isMultiline('a\r\nb')).toBe(true);
    expect(isMultiline('ab')).toBe(false);
    expect(fieldRows('ab')).toBe(1);
    expect(fieldRows('a\nb\nc')).toBe(3);
    expect(fieldRows('1\n2\n3\n4\n5\n6')).toBe(4);
  });
});

describe('histórico do campo', () => {
  it('guarda sem vazios nem repetidos (a repetida sobe para o fim) e respeita o limite', () => {
    expect(pushHistory(['a', 'b'], 'a')).toEqual(['b', 'a']);
    expect(pushHistory(['a'], '   ')).toEqual(['a']);
    expect(pushHistory(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });

  it('↑ vai para o mais antigo, ↓ volta até o rascunho, e no limite não faz nada', () => {
    const h = ['um', 'dois', 'três'];
    let cur = { index: -1, draft: '' };
    const up = stepHistory(h, cur, 'rascunho', -1)!;
    expect([up.value, up.cursor.index]).toEqual(['três', 2]);
    cur = up.cursor;
    const up2 = stepHistory(h, cur, 'três', -1)!;
    expect(up2.value).toBe('dois');
    const up3 = stepHistory(h, up2.cursor, 'dois', -1)!;
    expect(up3.value).toBe('um');
    expect(stepHistory(h, up3.cursor, 'um', -1)).toBeNull();
    const down = stepHistory(h, up3.cursor, 'um', 1)!;
    expect(down.value).toBe('dois');
    const back = stepHistory(h, { index: 2, draft: 'rascunho' }, 'três', 1)!;
    expect([back.value, back.cursor.index]).toEqual(['rascunho', -1]);
    expect(stepHistory(h, { index: -1, draft: '' }, 'x', 1)).toBeNull();
    expect(stepHistory([], { index: -1, draft: '' }, 'x', -1)).toBeNull();
  });
});

describe('GnSearchField (contrato do componente)', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'components', 'GnSearchField.vue'), 'utf8').replace(/\r\n/g, '\n');
  it('campo role=searchbox com nome, erro em role=alert ligado por aria-describedby e opções com aria-pressed', () => {
    expect(src).toContain('role="searchbox"');
    expect(src).toContain(':aria-label="label"');
    expect(src).toContain('role="alert"');
    expect(src).toContain(':aria-describedby="error ? errId : undefined"');
    expect(src).toContain(':aria-pressed="b.on"');
    expect(src).toContain(':aria-keyshortcuts');
  });
  it('sem v-html, sem texto fixo (o kit não traduz: tudo chega por props) e só com tokens do kit', () => {
    expect(src).not.toContain('v-html');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
