<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

export interface MenuItem {
  id: string;
  label?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

/**
 * `above`: o menu abre de dentro de um diálogo (acima dele, na camada dos diálogos).
 * `focusFirst`: menu aberto por um botão (não pelo botão direito): o foco vai para o primeiro item, e volta ao botão ao fechar. As setas, Home e End
 * percorrem os itens habilitados em qualquer menu em que o foco já esteja.
 */
const props = defineProps<{ x: number; y: number; items: MenuItem[]; above?: boolean; focusFirst?: boolean }>();
const emit = defineEmits<{ (e: 'select', id: string): void; (e: 'close'): void }>();

const el = ref<HTMLDivElement>();
const pos = ref({ left: props.x, top: props.y });

function onOutside(ev: MouseEvent) {
  if (el.value && !el.value.contains(ev.target as Node)) emit('close');
}
const enabled = () => [...(el.value?.querySelectorAll<HTMLButtonElement>('button.ctx__item:not(:disabled)') ?? [])];
const opener = document.activeElement as HTMLElement | null;
function onKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape') emit('close');
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(ev.key) && el.value?.contains(document.activeElement)) {
    const list = enabled();
    if (!list.length) return;
    ev.preventDefault();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? list.length - 1 : ev.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next]!.focus();
  }
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
  if (props.focusFirst) enabled()[0]?.focus();
});
onBeforeUnmount(() => {
  if (props.focusFirst && el.value?.contains(document.activeElement)) opener?.focus?.();
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('blur', close);
  window.removeEventListener('resize', close);
  window.removeEventListener('wheel', close);
});
</script>

<template>
  <Teleport to="body">
    <div ref="el" class="ctx" :class="{ 'ctx--above': above }" role="menu" :style="{ left: pos.left + 'px', top: pos.top + 'px' }" @contextmenu.prevent>
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
/* aberto de dentro de um diálogo: acima dele (regra de camadas do GnDialog) */
.ctx--above { z-index: calc(var(--gn-z-dialog) + 1); }
</style>
