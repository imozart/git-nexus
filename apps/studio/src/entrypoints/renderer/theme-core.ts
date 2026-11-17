// Tema da interface (escuro, claro ou o do sistema): a parte pura, sem DOM, para testar.
export type ThemePref = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

/** Ordem em que as opções aparecem. */
export const THEME_PREFS: readonly ThemePref[] = ['system', 'dark', 'light'];

/** Escolha guardada → preferência válida. Sem valor (ou valor desconhecido) fica o escuro, o tema que o app sempre teve. */
export function pickThemePref(stored: string | null | undefined): ThemePref {
  return THEME_PREFS.includes(stored as ThemePref) ? (stored as ThemePref) : 'dark';
}

/** Preferência + o que o sistema usa agora → o tema que vale. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}
