// Núcleo PURO do i18n (sem Vue, sem localStorage): busca de chave, interpolação, plural e escolha do idioma.

export type Locale = 'pt-BR' | 'en';
export type Dict = Record<string, string>;
export type Vars = Record<string, string | number>;

/** Bandeira de cada idioma (desenhada por `FlagIcon.vue`; o Windows não renderiza emoji de bandeira). */
export type FlagCode = 'br' | 'us';

/** `label` é o nome do idioma NELE MESMO (não se traduz); `short` é o código curto mostrado no botão. */
export const LOCALES: Array<{ id: Locale; label: string; short: string; flag: FlagCode }> = [
  { id: 'pt-BR', label: 'Português (Brasil)', short: 'PT', flag: 'br' },
  { id: 'en', label: 'English', short: 'EN', flag: 'us' },
];

/** Idioma inicial: o salvo, senão o do sistema (qualquer "pt" → pt-BR) e, por último, inglês. */
export function pickLocale(saved: string | null | undefined, navigatorLanguage: string | undefined): Locale {
  if (saved === 'pt-BR' || saved === 'en') return saved;
  return (navigatorLanguage ?? '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

/**
 * Traduz `key`: tenta o idioma atual, depois o português (idioma-fonte) e, se nem assim existir, devolve a própria chave
 * (aparece na tela, o que denuncia uma chave esquecida). `{nome}` é substituído por `vars.nome`.
 * Formas de plural: "um item|{n} itens" — com `vars.n`, escolhe pela regra do idioma (Intl.PluralRules).
 */
export function translate(dicts: Record<Locale, Dict>, locale: Locale, key: string, vars?: Vars): string {
  const raw = dicts[locale][key] ?? dicts['pt-BR'][key] ?? key;
  let text = raw;
  if (raw.includes('|') && vars && typeof vars.n === 'number') {
    const forms = raw.split('|');
    const cat = new Intl.PluralRules(locale).select(vars.n); // 'one' | 'other' | ...
    text = forms[cat === 'one' ? 0 : Math.min(1, forms.length - 1)]!;
  }
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Placeholders `{x}` de uma tradução (para o teste que confere que os idiomas usam as mesmas variáveis). */
export function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
}
