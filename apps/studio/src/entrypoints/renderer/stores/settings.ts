import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { SettingsSection } from '../settings-core';

/**
 * Estado do diálogo de configurações (a paleta, o atalho Ctrl+, e a engrenagem da barra só o abrem; o diálogo mora no App).
 * `open('git')` abre direto na seção pedida, e `open('git', 'git-sign')` também leva ao campo: é como o resto do app aponta para cá.
 */
export const useSettingsStore = defineStore('settings', () => {
  const isOpen = ref(false);
  /** A seção pedida na abertura (o diálogo a lê ao montar e a consome); `null` = a que ele mesmo escolher (Geral). */
  const target = ref<{ section: SettingsSection; field?: string } | null>(null);
  function open(section?: SettingsSection, field?: string): void {
    target.value = section ? { section, field } : null;
    isOpen.value = true;
  }
  const close = () => (isOpen.value = false);
  return { isOpen, target, open, close };
});
