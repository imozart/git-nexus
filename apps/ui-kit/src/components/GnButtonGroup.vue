<script setup lang="ts">
// Agrupa botões que formam um par ou conjunto (anterior/próximo): bordas coladas e cantos arredondados só nas pontas. Não decide nada sobre
// os botões de dentro (tom, tamanho, ícone): serve para GnButton e GnIconButton. `label` descreve o grupo para leitores de tela.
defineProps<{ label?: string }>();
</script>

<template>
  <span class="gn-btn-group" role="group" :aria-label="label"><slot /></span>
</template>

<style scoped lang="scss">
.gn-btn-group {
  display: inline-flex;
  :slotted(.gn-btn) { border-radius: 0; margin-left: -1px; }
  :slotted(.gn-btn:first-child) { border-radius: var(--gn-radius) 0 0 var(--gn-radius); margin-left: 0; }
  :slotted(.gn-btn:last-child) { border-radius: 0 var(--gn-radius) var(--gn-radius) 0; }
  :slotted(.gn-btn:only-child) { border-radius: var(--gn-radius); }
  // o botão com foco/hover passa por cima do vizinho, para a borda colorida aparecer inteira
  :slotted(.gn-btn:hover:not(:disabled)), :slotted(.gn-btn:focus-visible) { position: relative; z-index: 1; }
}
</style>
