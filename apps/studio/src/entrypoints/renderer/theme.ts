// Tema da interface: a escolha (Escuro / Claro / Sistema) fica guardada e vira o atributo `data-theme` do <html>, que os tokens
// (--gn-*) do ui-kit usam. Seguir o sistema acompanha a mudança na hora, sem recarregar.
import { computed, ref, watch } from 'vue';
import { pickThemePref, resolveTheme, type Theme, type ThemePref } from './theme-core';

export { THEME_PREFS, type Theme, type ThemePref } from './theme-core';

const KEY = 'gitnexus.theme';
const query = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined;

export const themePref = ref<ThemePref>(pickThemePref(localStorage.getItem(KEY)));
const systemDark = ref(query ? query.matches : true);
query?.addEventListener?.('change', (e) => (systemDark.value = e.matches));

/** O tema em vigor (já resolvido quando a escolha é "Sistema"). */
export const theme = computed<Theme>(() => resolveTheme(themePref.value, systemDark.value));

watch(themePref, (p) => localStorage.setItem(KEY, p));
watch(theme, (v) => (document.documentElement.dataset.theme = v), { immediate: true });

export const setThemePref = (p: ThemePref): ThemePref => (themePref.value = p);
