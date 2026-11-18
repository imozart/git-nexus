// Núcleo PURO do i18n (sem Vue, sem localStorage): catálogo de idiomas, busca de chave, interpolação, plural e escolha do idioma.

export type Dict = Record<string, string>;
export type Vars = Record<string, string | number>;
export type Dir = 'ltr' | 'rtl';

export interface LocaleDefinition {
  /** Código BCP-47 (também é o nome do arquivo do dicionário: `pt-BR.ts`). */
  id: string;
  /** Nome do idioma NELE MESMO (não se traduz). */
  label: string;
  /** Código curto mostrado no botão do cabeçalho. */
  short: string;
  /** Direção do texto (`rtl` para árabe, hebraico...). Só a infraestrutura: o layout RTL é outra revisão. */
  dir: Dir;
  /** Código para `toLocaleString`, `Intl.*` etc. */
  intl: string;
}

/**
 * CATÁLOGO ÚNICO de idiomas: daqui saem o tipo `Locale`, o seletor, a validação, os dicionários, o `lang`/`dir` do <html>, as datas e os testes.
 * Adicionar um idioma = uma linha aqui + o arquivo do dicionário (`i18n/<id>.ts`). Veja docs/I18N.md.
 */
export const SUPPORTED_LOCALES = [
  { id: 'pt-BR', label: 'Português (Brasil)', short: 'PT', dir: 'ltr', intl: 'pt-BR' },
  { id: 'en', label: 'English', short: 'EN', dir: 'ltr', intl: 'en-US' },
] as const satisfies readonly LocaleDefinition[];

export type Locale = (typeof SUPPORTED_LOCALES)[number]['id'];
/** Preferência guardada: um idioma fixo ou "system" (segue o idioma do sistema a cada abertura). */
export type LocalePref = 'system' | Locale;

/** Nome antigo do catálogo (o seletor e os comandos usam `LOCALES`): é o mesmo array. */
export const LOCALES: ReadonlyArray<LocaleDefinition & { id: Locale }> = SUPPORTED_LOCALES;

export const DEFAULT_LOCALE: Locale = 'en';

export const localeDef = (id: Locale): LocaleDefinition => LOCALES.find((l) => l.id === id)!;

/**
 * Qualquer forma de dizer o idioma (`pt_BR.UTF-8`, `pt-br`, `EN_us`, `pt-PT`) → um idioma do catálogo, ou `undefined` se não houver.
 * Id exato primeiro; senão o primeiro idioma do catálogo com o mesmo idioma-base (qualquer `pt-*` → pt-BR, `en-GB` → en).
 */
export function normalizeLocale(raw: string | null | undefined): Locale | undefined {
  const cleaned = (raw ?? '').trim().replace(/[.@].*$/, '').replace(/_/g, '-'); // pt_BR.UTF-8 → pt-BR
  if (!cleaned) return undefined;
  let tag: string;
  try {
    tag = Intl.getCanonicalLocales(cleaned)[0] ?? '';
  } catch {
    return undefined;
  }
  if (!tag) return undefined;
  const exact = LOCALES.find((l) => l.id.toLowerCase() === tag.toLowerCase());
  if (exact) return exact.id;
  const base = tag.split('-')[0]!.toLowerCase();
  return LOCALES.find((l) => l.id.split('-')[0]!.toLowerCase() === base)?.id;
}

/** Idioma do sistema (o `navigator.language`) → idioma do catálogo; sem correspondência, inglês. */
export function systemLocale(navigatorLanguage: string | undefined): Locale {
  return normalizeLocale(navigatorLanguage) ?? DEFAULT_LOCALE;
}

/** Valor guardado → preferência válida. Vazio ou desconhecido = "system"; um idioma do catálogo (mesmo em outra grafia) vira o id dele. */
export function pickLocalePref(saved: string | null | undefined): LocalePref {
  if (saved === 'system') return 'system';
  return normalizeLocale(saved) ?? 'system';
}

/** Preferência (+ idioma do sistema) → o idioma que vale agora. */
export function resolveLocale(pref: LocalePref, navigatorLanguage: string | undefined): Locale {
  return pref === 'system' ? systemLocale(navigatorLanguage) : pref;
}

/** Idioma inicial: o salvo (ou "system"), senão o do sistema (qualquer "pt" → pt-BR) e, por último, inglês. */
export function pickLocale(saved: string | null | undefined, navigatorLanguage: string | undefined): Locale {
  return resolveLocale(pickLocalePref(saved), navigatorLanguage);
}

const CATEGORY_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
const SAMPLE = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 14, 21, 22, 25, 100, 101, 102, 1000];
const formsCache = new Map<string, string[]>();
/**
 * Categorias de plural que o idioma usa para contagens inteiras, na ordem fixa zero, one, two, few, many, other. As formas de uma tradução
 * ("um item|{n} itens") vêm nesta ordem: pt e en têm duas (one, other); russo, polonês e árabe têm mais.
 */
export function pluralForms(locale: string): string[] {
  let forms = formsCache.get(locale);
  if (!forms) {
    const rules = new Intl.PluralRules(locale);
    const used = new Set(SAMPLE.map((n) => rules.select(n)));
    forms = CATEGORY_ORDER.filter((c) => used.has(c));
    formsCache.set(locale, forms);
  }
  return forms;
}

/**
 * Traduz `key`: tenta o idioma atual, depois o português (idioma-fonte) e, se nem assim existir, devolve a própria chave
 * (aparece na tela, o que denuncia uma chave esquecida). `{nome}` é substituído por `vars.nome`.
 * Formas de plural: "um item|{n} itens" — com `vars.n`, escolhe pela regra do idioma (Intl.PluralRules), na ordem de `pluralForms`.
 */
export function translate(dicts: Record<Locale, Dict>, locale: Locale, key: string, vars?: Vars): string {
  const raw = dicts[locale][key] ?? dicts['pt-BR'][key] ?? key;
  let text = raw;
  if (raw.includes('|') && vars && typeof vars.n === 'number') {
    const forms = raw.split('|');
    const i = pluralForms(locale).indexOf(new Intl.PluralRules(locale).select(vars.n));
    text = forms[Math.max(0, Math.min(i < 0 ? forms.length - 1 : i, forms.length - 1))]!;
  }
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Placeholders `{x}` de uma tradução (para o teste que confere que os idiomas usam as mesmas variáveis). */
export function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
}
