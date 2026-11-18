<script setup lang="ts">
export interface GnTab {
  id: string;
  title: string;
  subtitle?: string;
  closable?: boolean;
}

const props = defineProps<{ tabs: GnTab[]; modelValue: string }>();
const emit = defineEmits<{
  (e: 'update:modelValue', id: string): void;
  (e: 'close', id: string): void;
}>();

/** Teclado (padrão de abas): setas, Home e End trocam de aba e levam o foco; Enter e espaço ativam. Só a aba ativa entra na ordem do Tab. */
function onKey(e: KeyboardEvent, i: number): void {
  if (e.target !== e.currentTarget) return; // teclas do botão de fechar não trocam de aba
  const n = props.tabs.length;
  const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'Enter' || e.key === ' ' ? i : -1;
  if (to < 0) return;
  e.preventDefault();
  emit('update:modelValue', props.tabs[to]!.id);
  ((e.currentTarget as HTMLElement).parentElement?.children[to] as HTMLElement | undefined)?.focus();
}
</script>

<template>
  <div class="gn-tabs" role="tablist">
    <div
      v-for="(t, i) in tabs"
      :key="t.id"
      class="gn-tab"
      :class="{ 'gn-tab--active': t.id === modelValue }"
      role="tab"
      :aria-selected="t.id === modelValue"
      :tabindex="t.id === modelValue ? 0 : -1"
      @keydown="onKey($event, i)"
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
  &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: -2px; }
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
