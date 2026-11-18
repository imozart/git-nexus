// i18n do renderer: idioma reativo (troca na hora, sem recarregar) e `t()` para templates e scripts.
import { computed, ref, watch } from 'vue';
import { LOCALES, SUPPORTED_LOCALES, localeDef, pickLocalePref, resolveLocale, translate, type Dict, type Locale, type LocalePref, type Vars } from './core';
import type { MessageKey } from './pt-BR';

export { LOCALES, type Locale, type LocalePref };
export type { MessageKey };

// Os dicionários vêm do catálogo: cada idioma de SUPPORTED_LOCALES lê o arquivo `<id>.ts` desta pasta (adicionar um idioma não mexe aqui).
const files = import.meta.glob<{ default: Dict }>(['./*.ts', '!./core.ts', '!./index.ts'], { eager: true });
const DICTS = Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l.id, files[`./${l.id}.ts`]?.default ?? {}])) as Record<Locale, Dict>;
const KEY = 'gitnexus.locale';

/** O que a pessoa escolheu: "system" (segue o sistema) ou um idioma fixo. Só o que foge do padrão ("system") some do localStorage. */
export const localePref = ref<LocalePref>(pickLocalePref(localStorage.getItem(KEY)));
/** O idioma em vigor (já resolvido quando a preferência é "system"). */
export const locale = ref<Locale>(resolveLocale(localePref.value, navigator.language));

watch(localePref, (p) => {
  if (p === 'system') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, p);
  locale.value = resolveLocale(p, navigator.language);
});
watch(
  locale,
  (l) => {
    const def = localeDef(l);
    document.documentElement.lang = def.id;
    document.documentElement.dir = def.dir;
    // mensagens geradas pelo núcleo/worker (erros do Git etc.) seguem o idioma da interface; sem a ponte (testes), ignora
    void window.gitNexus?.setLocale?.(l)?.catch?.(() => undefined);
  },
  { immediate: true },
);

/** Traduz uma chave. Lê `locale`, então qualquer template/computed que a use se atualiza ao trocar de idioma. */
export function t(key: MessageKey, vars?: Vars): string {
  return translate(DICTS, locale.value, key, vars);
}

/** Escolhe um idioma fixo (ou "system"). */
export const setLocalePref = (p: LocalePref) => (localePref.value = p);
export const setLocale = (l: Locale) => setLocalePref(l);
/** Código para `toLocaleString` etc. */
export const dateLocale = computed(() => localeDef(locale.value).intl);
export const localeLabel = (l: Locale) => localeDef(l).label;
