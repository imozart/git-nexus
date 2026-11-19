// Mensagens do núcleo (erros e avisos que chegam à tela) no idioma escolhido na interface.
// O núcleo não depende de Vue nem do catálogo da interface: tem o próprio dicionário POR CHAVE e por idioma (`messages/<id>.ts`), tipado, com o
// português como fonte da verdade e queda para ele quando falta a chave (mesma regra do renderer):
//
//   tm('lfs.downloaded', { pointers: 3 })        // texto no idioma atual
//   tm('texto em português', 'English text')     // FORMA ANTIGA, depreciada: só conhece dois idiomas; migre para chave
//
// Migração gradual: cada PR leva um módulo para chave; `test/messages-keys.test.ts` impede `tm(pt, en)` NOVO.
import en from './messages/en.js';
import ptBR, { type MessageKey } from './messages/pt-BR.js';

export type { MessageKey };
export type MessageLocale = string;
export type MessageVars = Record<string, string | number>;

const DICTS: Record<string, Partial<Record<MessageKey, string>>> = { 'pt-BR': ptBR, en };
const FALLBACK = 'pt-BR';

let current = FALLBACK;

/** Idioma de dicionário que atende a `locale` (id exato, senão o mesmo idioma-base: `en-GB` → en); sem correspondência, o português. */
export function resolveMessageLocale(locale: string): string {
  const norm = locale.replace(/_/g, '-');
  const exact = Object.keys(DICTS).find((id) => id.toLowerCase() === norm.toLowerCase());
  if (exact) return exact;
  const base = norm.split('-')[0]!.toLowerCase();
  return Object.keys(DICTS).find((id) => id.split('-')[0]!.toLowerCase() === base) ?? FALLBACK;
}

/** Chamado quando a pessoa troca o idioma da interface (o processo principal e o worker mantêm cada um o seu). */
export function setMessageLocale(locale: string): void {
  current = resolveMessageLocale(locale);
}

export const getMessageLocale = (): MessageLocale => current;

const ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
const SAMPLE = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 14, 21, 22, 25, 100, 101, 102, 1000];
/** Categorias de plural que o idioma usa para inteiros, na ordem fixa (as formas de "um|{n} muitos" seguem esta ordem). */
export function pluralForms(locale: string): string[] {
  const rules = new Intl.PluralRules(locale);
  const used = new Set(SAMPLE.map((n) => rules.select(n)));
  return ORDER.filter((c) => used.has(c));
}

/** Aplica `{variáveis}` e a forma de plural (com `vars.n`). Pura: serve também aos testes. */
export function formatMessage(raw: string, locale: string, vars?: MessageVars): string {
  let text = raw;
  if (raw.includes('|') && vars && typeof vars.n === 'number') {
    const forms = raw.split('|');
    const i = pluralForms(locale).indexOf(new Intl.PluralRules(locale).select(vars.n));
    text = forms[Math.max(0, Math.min(i < 0 ? forms.length - 1 : i, forms.length - 1))]!;
  }
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Texto de uma chave no idioma atual (cai no português; sem a chave em lugar nenhum, devolve a própria chave). */
export function tmKey(key: MessageKey, vars?: MessageVars, locale = current): string {
  const raw = DICTS[locale]?.[key] ?? DICTS[FALLBACK]![key] ?? key;
  return formatMessage(raw, locale, vars);
}

export { DICTS as messageDictionaries };

/** Por chave (`tm('lfs.notUsed')`, `tm('lfs.downloaded', { pointers })`) ou, DEPRECIADO, `tm(português, english)`. */
export function tm(key: MessageKey, vars?: MessageVars): string;
/** @deprecated só conhece dois idiomas: use uma chave de `messages/pt-BR.ts`. */
export function tm(pt: string, en: string): string;
export function tm(a: string, b?: string | MessageVars): string {
  if (typeof b === 'string') return current === 'en' ? b : a; // forma antiga (duas frases)
  return tmKey(a as MessageKey, b);
}
