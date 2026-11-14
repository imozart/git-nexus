// i18n do renderer: idioma reativo (troca na hora, sem recarregar) e `t()` para templates e scripts.
import { computed, ref, watch } from 'vue';
import { LOCALES, pickLocale, translate, type Dict, type Locale, type Vars } from './core';
import en from './en';
import ptBR, { type MessageKey } from './pt-BR';

export { LOCALES, type Locale };
export type { MessageKey };

const DICTS: Record<Locale, Dict> = { 'pt-BR': ptBR as Dict, en: en as Dict };
const KEY = 'gitnexus.locale';

export const locale = ref<Locale>(pickLocale(localStorage.getItem(KEY), navigator.language));
watch(
  locale,
  (l) => {
    localStorage.setItem(KEY, l);
    document.documentElement.lang = l;
  },
  { immediate: true },
);

/** Traduz uma chave. Lê `locale`, então qualquer template/computed que a use se atualiza ao trocar de idioma. */
export function t(key: MessageKey, vars?: Vars): string {
  return translate(DICTS, locale.value, key, vars);
}

export const setLocale = (l: Locale) => (locale.value = l);
/** Código para `toLocaleString` etc. */
export const dateLocale = computed(() => (locale.value === 'pt-BR' ? 'pt-BR' : 'en-US'));
export const localeLabel = (l: Locale) => LOCALES.find((x) => x.id === l)!.label;
