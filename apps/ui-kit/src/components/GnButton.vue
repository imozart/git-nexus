<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
    disabled?: boolean;
    type?: 'button' | 'submit';
  }>(),
  { variant: 'ghost', size: 'md', disabled: false, type: 'button' },
);
</script>

<template>
  <button class="gn-btn" :class="[`gn-btn--${variant}`, `gn-btn--${size}`]" :type="type" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped lang="scss">
.gn-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--gn-border);
  border-radius: var(--gn-radius);
  background: var(--gn-surface-2);
  color: var(--gn-text);
  font: inherit;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, opacity 0.12s;

  &--md { padding: 6px 14px; }
  &--sm { padding: 2px 8px; font-size: 12px; }

  &:hover:not(:disabled) { border-color: var(--gn-accent); }
  &:disabled { opacity: 0.45; cursor: not-allowed; }

  &--primary {
    background: var(--gn-accent);
    border-color: var(--gn-accent);
    color: #fff;
    &:hover:not(:disabled) { background: var(--gn-accent-hover); }
  }
  &--danger {
    color: var(--gn-danger);
    &:hover:not(:disabled) { border-color: var(--gn-danger); }
  }
  &--ghost { background: transparent; }
}
</style>
