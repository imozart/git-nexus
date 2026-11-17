import { describe, expect, it } from 'vitest';
import { THEME_PREFS, pickThemePref, resolveTheme } from '../src/entrypoints/renderer/theme-core';

describe('tema da interface', () => {
  it('sem escolha guardada (ou lixo) fica o escuro, o tema que o app sempre teve', () => {
    expect(pickThemePref(null)).toBe('dark');
    expect(pickThemePref(undefined)).toBe('dark');
    expect(pickThemePref('')).toBe('dark');
    expect(pickThemePref('azul')).toBe('dark');
  });

  it('as três escolhas válidas são lembradas como estão', () => {
    for (const p of ['dark', 'light', 'system']) expect(pickThemePref(p)).toBe(p);
    expect([...THEME_PREFS].sort()).toEqual(['dark', 'light', 'system']);
  });

  it('escuro e claro valem sempre, não importa o que o sistema usa', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('"Sistema" acompanha o sistema', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
