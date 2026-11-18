// Fontes da interface e do código e as ligaduras: a parte pura, sem DOM, para testar.
export type FontPref = 'jetbrains' | 'system';
export type LigaturesPref = 'off' | 'on';

/** Ordem em que as opções aparecem. */
export const FONT_PREFS: readonly FontPref[] = ['jetbrains', 'system'];
export const LIGATURES_PREFS: readonly LigaturesPref[] = ['off', 'on'];

/** Valor guardado → preferência válida. Sem valor (ou valor desconhecido) fica a JetBrains Mono, o padrão do app. */
export function pickFontPref(stored: string | null | undefined): FontPref {
  return FONT_PREFS.includes(stored as FontPref) ? (stored as FontPref) : 'jetbrains';
}

/** Valor guardado → preferência válida. Sem valor (ou valor desconhecido) ficam as ligaduras desligadas. */
export function pickLigaturesPref(stored: string | null | undefined): LigaturesPref {
  return LIGATURES_PREFS.includes(stored as LigaturesPref) ? (stored as LigaturesPref) : 'off';
}
