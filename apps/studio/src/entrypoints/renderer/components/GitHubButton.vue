<script setup lang="ts">
// Botão no padrão do GitHub: a marca (Octicon "mark-github", sem alterações de forma ou proporção, só a cor do texto
// do botão) à esquerda do rótulo, no tamanho/forma do botão padrão do Primer (32px, cantos de 6px, 14px/500).
// Diretrizes de uso da marca: https://github.com/logos
defineEmits<{ (e: 'click'): void }>();
</script>

<template>
  <button type="button" class="ghbtn" @click="$emit('click')">
    <svg class="ghbtn__mark" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
      />
    </svg>
    <slot />
  </button>
</template>

<style scoped lang="scss">
.ghbtn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
  color: var(--gn-text);
  background: var(--gn-surface-2);
  border: 1px solid var(--gn-border);
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  &:hover { border-color: var(--gn-muted); background: var(--gn-surface); }
  &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: 2px; }
  &__mark { flex: none; }
}
</style>
