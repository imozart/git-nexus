import { defineStore } from 'pinia';
import { ref } from 'vue';

/** Estado do diálogo de configurações (a paleta, o atalho Ctrl+, e a engrenagem da barra só o abrem; o diálogo mora no App). */
export const useSettingsStore = defineStore('settings', () => {
  const isOpen = ref(false);
  const open = () => (isOpen.value = true);
  const close = () => (isOpen.value = false);
  return { isOpen, open, close };
});
