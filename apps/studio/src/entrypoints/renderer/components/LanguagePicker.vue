<script setup lang="ts">
// Seletor de idioma: botão com a bandeira do idioma atual e uma lista flutuante de cantos arredondados (no lugar do <select> nativo,
// cuja lista o sistema desenha e não dá para estilizar).
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { LOCALES, locale, setLocale, t, type Locale } from '../i18n';
import FlagIcon from './FlagIcon.vue';

const open = ref(false);
const root = ref<HTMLElement>();
const list = ref<HTMLElement>();
const current = computed(() => LOCALES.find((l) => l.id === locale.value)!);

function onDocDown(e: MouseEvent): void {
  if (root.value && !root.value.contains(e.target as Node)) close();
}
function toggle(): void {
  open.value ? close() : show();
}
async function show(): Promise<void> {
  open.value = true;
  document.addEventListener('mousedown', onDocDown, true);
  await nextTick();
  (list.value?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.value?.querySelector<HTMLElement>('[role="option"]'))?.focus();
}
function close(refocus = false): void {
  open.value = false;
  document.removeEventListener('mousedown', onDocDown, true);
  if (refocus) root.value?.querySelector<HTMLElement>('.lang__btn')?.focus();
}
function pick(id: Locale): void {
  setLocale(id);
  close(true);
}
function onKey(e: KeyboardEvent): void {
  const items = [...(list.value?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (e.key === 'Escape') {
    e.preventDefault();
    close(true);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
}
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown, true));
</script>

<template>
  <div ref="root" class="lang" @keydown="onKey">
    <button type="button" class="lang__btn" aria-haspopup="listbox" :aria-expanded="open" :title="t('core.language')" :aria-label="`${t('core.language')}: ${current.label}`" @click="toggle">
      <FlagIcon :code="current.flag" />
      <span class="lang__code">{{ current.short }}</span>
      <svg class="lang__caret" viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <ul v-if="open" ref="list" class="lang__list" role="listbox" :aria-label="t('core.language')">
      <li
        v-for="l in LOCALES"
        :key="l.id"
        role="option"
        tabindex="0"
        class="lang__opt"
        :aria-selected="l.id === locale"
        @click="pick(l.id)"
        @keydown.enter.prevent="pick(l.id)"
        @keydown.space.prevent="pick(l.id)"
      >
        <FlagIcon :code="l.flag" />
        <span class="lang__name">{{ l.label }}</span>
        <svg v-if="l.id === locale" class="lang__check" viewBox="0 0 12 10" width="12" height="10" aria-hidden="true"><path d="M1 5.2l3.2 3.2L11 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </li>
    </ul>
  </div>
</template>

<style scoped lang="scss">
.lang {
  position: relative;
  margin: 6px 0 6px 10px;
  display: flex;
  &__btn {
    display: inline-flex; align-items: center; gap: 7px; padding: 0 9px; font: inherit; font-size: 12px; font-weight: 600;
    color: var(--gn-muted); background: var(--gn-surface); border: 1px solid var(--gn-border); border-radius: 999px; cursor: pointer;
    transition: border-color 0.12s, color 0.12s;
    &:hover, &[aria-expanded='true'] { color: var(--gn-text); border-color: var(--gn-accent); }
    &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: 1px; }
  }
  &__caret { opacity: 0.7; }
  &__list {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 60; min-width: 100%; width: max-content; margin: 0; padding: 5px; list-style: none;
    background: var(--gn-surface-2); border: 1px solid var(--gn-border); border-radius: 12px; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38);
  }
  &__opt {
    display: flex; align-items: center; gap: 10px; padding: 7px 10px; font-size: 13px; color: var(--gn-text); border-radius: 8px; cursor: pointer; outline: none;
    &:hover, &:focus-visible { background: rgba(79, 134, 247, 0.18); }
    &[aria-selected='true'] { font-weight: 600; }
  }
  &__name { flex: 1; white-space: nowrap; }
  &__check { color: var(--gn-accent); }
}
</style>
