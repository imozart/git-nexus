<script setup lang="ts">
// Ícone decorativo (aria-hidden): o texto ou o rótulo do botão que o contém é quem fala. Herda a cor do texto (`currentColor`).
// `size` em px; sem ele o ícone mede 1em, isto é, acompanha o tamanho da fonte do botão (12px no pequeno, 13px no padrão).
import { ICONS, type GnIconName } from './icons';

withDefaults(defineProps<{ name: GnIconName; size?: number }>(), { size: undefined });
</script>

<template>
  <svg
    class="gn-icon"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="d in ICONS[name]" :key="d" :d="d" />
  </svg>
</template>

<style scoped lang="scss">
.gn-icon { width: 1em; height: 1em; flex: none; }
</style>
