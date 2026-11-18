import { describe, expect, it } from 'vitest';
import { FONT_PREFS, LIGATURES_PREFS, pickFontPref, pickLigaturesPref } from '../src/entrypoints/renderer/font-core';

describe('fonte da interface e do código', () => {
  it('sem escolha guardada (ou lixo) fica a JetBrains Mono, o padrão do app', () => {
    for (const v of [null, undefined, '', 'comic', '1', 'JetBrains Mono', 'SYSTEM', ' system']) expect(pickFontPref(v), String(v)).toBe('jetbrains');
  });

  it('as duas escolhas válidas são lembradas como estão', () => {
    expect(pickFontPref('jetbrains')).toBe('jetbrains');
    expect(pickFontPref('system')).toBe('system');
  });

  it('as opções e a ordem em que aparecem', () => {
    expect(FONT_PREFS).toEqual(['jetbrains', 'system']);
  });
});

describe('ligaduras', () => {
  it('sem escolha guardada (ou lixo) ficam desligadas', () => {
    for (const v of [null, undefined, '', 'true', '1', 'yes', 'ON', ' on']) expect(pickLigaturesPref(v), String(v)).toBe('off');
  });

  it('as duas escolhas válidas são lembradas como estão', () => {
    expect(pickLigaturesPref('on')).toBe('on');
    expect(pickLigaturesPref('off')).toBe('off');
  });

  it('as opções e a ordem em que aparecem', () => {
    expect(LIGATURES_PREFS).toEqual(['off', 'on']);
  });
});
