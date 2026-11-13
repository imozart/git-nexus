<script setup lang="ts">
export interface GnTab {
  id: string;
  title: string;
  subtitle?: string;
  closable?: boolean;
}

defineProps<{ tabs: GnTab[]; modelValue: string }>();
const emit = defineEmits<{
  (e: 'update:modelValue', id: string): void;
  (e: 'close', id: string): void;
}>();
</script>

<template>
  <div class="gn-tabs" role="tablist">
    <div
      v-for="t in tabs"
      :key="t.id"
      class="gn-tab"
      :class="{ 'gn-tab--active': t.id === modelValue }"
      role="tab"
      :aria-selected="t.id === modelValue"
      @click="emit('update:modelValue', t.id)"
      @auxclick.middle.prevent="t.closable && emit('close', t.id)"
    >
      <span class="gn-tab__title">{{ t.title }}</span>
      <span v-if="t.subtitle" class="gn-tab__sub">{{ t.subtitle }}</span>
      <button
        v-if="t.closable"
        class="gn-tab__close"
        type="button"
        :aria-label="`Fechar ${t.title}`"
        @click.stop="emit('close', t.id)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.gn-tabs {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  background: var(--gn-bg);
  border-bottom: 1px solid var(--gn-border);
  padding: 6px 8px 0;
}
.gn-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: var(--gn-radius) var(--gn-radius) 0 0;
  color: var(--gn-muted);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;

  &:hover { color: var(--gn-text); }
  &--active {
    background: var(--gn-surface);
    border-color: var(--gn-border);
    color: var(--gn-text);
    box-shadow: inset 0 2px 0 var(--gn-accent);
  }
  &__sub { font-size: 11px; color: var(--gn-muted); }
  &__close {
    background: none;
    border: none;
    color: inherit;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    border-radius: 4px;
    padding: 0 4px;
    &:hover { background: var(--gn-surface-2); color: var(--gn-danger); }
  }
}
</style>
