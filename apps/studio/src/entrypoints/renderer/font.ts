// Fontes do app: a escolha da fonte da interface, da fonte do código e das ligaduras fica guardada e vira os atributos `data-font-ui`,
// `data-font-code` e `data-ligatures` do <html>, que os tokens do ui-kit usam (tokens.scss). A mudança vale na hora, sem recarregar.
import { ref, watch } from 'vue';
import { pickFontPref, pickLigaturesPref, type FontPref, type LigaturesPref } from './font-core';

export { FONT_PREFS, LIGATURES_PREFS, type FontPref, type LigaturesPref } from './font-core';

const KEY_UI = 'gitnexus.fontUi';
const KEY_CODE = 'gitnexus.fontCode';
const KEY_LIGATURES = 'gitnexus.ligatures';

export const fontUi = ref<FontPref>(pickFontPref(localStorage.getItem(KEY_UI)));
export const fontCode = ref<FontPref>(pickFontPref(localStorage.getItem(KEY_CODE)));
export const ligatures = ref<LigaturesPref>(pickLigaturesPref(localStorage.getItem(KEY_LIGATURES)));

/** Sobe a cada mudança de fonte ou de ligaduras (e quando o navegador termina de carregar uma face nova): o editor re-mede os caracteres. */
export const fontRevision = ref(0);
const bump = () => fontRevision.value++;

/** Guarda só o que foge do padrão: o padrão não precisa de chave (e um valor inválido que estava guardado some). */
const keep = (key: string, value: string, padrao: string) => (value === padrao ? localStorage.removeItem(key) : localStorage.setItem(key, value));

const html = document.documentElement;
watch(fontUi, (v) => (keep(KEY_UI, v, 'jetbrains'), (html.dataset.fontUi = v), bump()), { immediate: true });
watch(fontCode, (v) => (keep(KEY_CODE, v, 'jetbrains'), (html.dataset.fontCode = v), bump()), { immediate: true });
watch(ligatures, (v) => (keep(KEY_LIGATURES, v, 'off'), (html.dataset.ligatures = v), bump()), { immediate: true });
document.fonts?.addEventListener('loadingdone', bump);

export const setFontUi = (v: FontPref): FontPref => (fontUi.value = v);
export const setFontCode = (v: FontPref): FontPref => (fontCode.value = v);
export const setLigatures = (v: LigaturesPref): LigaturesPref => (ligatures.value = v);

/** Volta aos três padrões (JetBrains Mono na interface e no código, ligaduras desligadas) e apaga o que estava guardado. */
export function resetFonts(): void {
  fontUi.value = 'jetbrains';
  fontCode.value = 'jetbrains';
  ligatures.value = 'off';
  for (const k of [KEY_UI, KEY_CODE, KEY_LIGATURES]) localStorage.removeItem(k); // na hora (os watch rodam depois e não guardam o padrão)
}
