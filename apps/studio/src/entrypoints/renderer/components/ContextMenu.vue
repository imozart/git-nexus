<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

export interface MenuItem {
  id: string;
  label?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>();
const emit = defineEmits<{ (e: 'select', id: string): void; (e: 'close'): void }>();

const el = ref<HTMLDivElement>();
const pos = ref({ left: props.x, top: props.y });

function onOutside(ev: MouseEvent) {
  if (el.value && !el.value.contains(ev.target as Node)) emit('close');
}
function onKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape') emit('close');
}
const close = () => emit('close');

onMounted(async () => {
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  window.addEventListener('wheel', close, { passive: true });
  await nextTick();
  // mantém o menu dentro da janela
  const r = el.value?.getBoundingClientRect();
  if (r) pos.value = { left: Math.max(4, Math.min(props.x, innerWidth - r.width - 4)), top: Math.max(4, Math.min(props.y, innerHeight - r.height - 4)) };
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('blur', close);
  window.removeEventListener('resize', close);
  window.removeEventListener('wheel', close);
});
</script>

<template>
  <Teleport to="body">
    <div ref="el" class="ctx" role="menu" :style="{ left: pos.left + 'px', top: pos.top + 'px' }" @contextmenu.prevent>
      <template v-for="(it, i) in items" :key="i">
        <div v-if="it.separator" class="ctx__sep" />
        <button
          v-else
          class="ctx__item"
          :class="{ 'ctx__item--danger': it.danger }"
          type="button"
          role="menuitem"
          :disabled="it.disabled"
          @click="emit('select', it.id)"
        >
          {{ it.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.ctx {
  position: fixed;
  z-index: var(--gn-z-popover);
  min-width: 240px;
  padding: 4px;
  background: var(--gn-surface-2);
  border: 1px solid var(--gn-border);
  border-radius: var(--gn-radius-lg);
  box-shadow: var(--gn-shadow-md);
  animation: gn-fade-in var(--gn-enter) ease-out;
  &__sep { height: 1px; margin: 4px 6px; background: var(--gn-border); }
  &__item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    background: none;
    border: none;
    border-radius: 5px;
    color: var(--gn-text);
    font: inherit;
    cursor: pointer;
    &:hover:not(:disabled) { background: var(--gn-accent); color: #fff; }
    &:disabled { opacity: 0.4; cursor: default; }
    &--danger { color: var(--gn-danger); &:hover:not(:disabled) { background: var(--gn-danger); color: #fff; } }
  }
}
</style>
