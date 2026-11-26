<script setup lang="ts" generic="T extends string | number">
// Seletor segmentado: escolhe UMA opção entre poucas ("Tudo | Pendente | No commit", "Lado a lado | Unificado"). É filtro/visão, não ação:
// a opção ativa é sempre azul tingido (não sólido), para não parecer o botão principal da tela. Uma única cópia do estilo e do
// comportamento (v-model, teclado, aria) no lugar do CSS repetido em cada tela.
export interface GnSegment<V = string | number> {
  value: V;
  label: string;
  /** Tooltip da opção (ex.: o que ela compara). */
  title?: string;
  disabled?: boolean;
}

import { nextTick, ref } from 'vue';
import GnTooltip from './GnTooltip.vue';

const props = defineProps<{ modelValue: T; options: GnSegment<T>[]; ariaLabel?: string; title?: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: T): void }>();

const root = ref<HTMLElement>();

/** Setas movem a seleção para a opção vizinha habilitada (padrão de grupo de rádio); o foco acompanha a seleção, para a seta seguinte continuar dali. */
function onKey(e: KeyboardEvent, i: number) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const n = props.options.length;
  for (let k = 1; k <= n; k++) {
    const next = props.options[(i + step * k + n * k) % n];
    if (next && !next.disabled) {
      emit('update:modelValue', next.value);
      void nextTick(() => root.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
      return;
    }
  }
}
</script>

<template>
  <span ref="root" class="gn-seg" role="radiogroup" :aria-label="ariaLabel">
    <button
      v-for="(o, i) in options"
      :key="String(o.value)"
      type="button"
      role="radio"
      class="gn-seg__opt"
      :class="{ 'gn-seg__opt--on': o.value === modelValue }"
      :aria-checked="o.value === modelValue"
      :tabindex="o.value === modelValue ? 0 : -1"
      :disabled="o.disabled"
      @click="emit('update:modelValue', o.value)"
      @keydown="onKey($event, i)"
    >
      {{ o.label }}
      <GnTooltip :text="o.title ?? title ?? ''" />
    </button>
  </span>
</template>

<style scoped lang="scss">
.gn-seg {
  display: inline-flex;
  border: 1px solid var(--gn-border);
  border-radius: var(--gn-radius);
  overflow: hidden;

  &__opt {
    padding: 2px 10px;
    font: inherit;
    font-size: 12px;
    color: var(--gn-muted);
    background: none;
    border: none;
    cursor: pointer;
    & + & { border-left: 1px solid var(--gn-border); }
    &:hover:not(:disabled):not(.gn-seg__opt--on) { color: var(--gn-text); }
    &:disabled { opacity: 0.45; cursor: not-allowed; }
    &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: -2px; }
    // ativo: azul tingido com texto clareado (mesma receita do botão de contorno), contraste de 4,5:1 ou mais
    &--on {
      color: color-mix(in srgb, var(--gn-accent) 70%, var(--gn-mix));
      background: color-mix(in srgb, var(--gn-accent) 18%, var(--gn-surface-2));
    }
  }
}
</style>
