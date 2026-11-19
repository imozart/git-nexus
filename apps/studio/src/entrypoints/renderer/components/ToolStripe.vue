<script setup lang="ts">
// Faixa lateral fina com o NOME de cada painel (como as "tool windows" do IntelliJ): clicar mostra ou recolhe o painel,
// e o painel recolhido continua achável pelo nome na faixa. A dica é o GnTooltip, filho do botão (sem `title` nativo).
import { GnTooltip } from '@git-nexus/ui-kit';
export interface StripeItem {
  id: string;
  label: string;
  /** Painel aberto? */
  active: boolean;
  /** Contador opcional ao lado do nome (ex.: arquivos pendentes). */
  badge?: number;
  title?: string;
}

defineProps<{ side: 'left' | 'right'; items: StripeItem[] }>();
defineEmits<{ toggle: [id: string] }>();
</script>

<template>
  <nav class="stripe" :class="`stripe--${side}`" :aria-label="side">
    <button
      v-for="i in items"
      :key="i.id"
      type="button"
      class="stripe__btn"
      :class="{ 'stripe__btn--on': i.active }"
      :aria-pressed="i.active"
      :data-stripe="i.id"
      @click="$emit('toggle', i.id)"
    >
      <span class="stripe__label">{{ i.label }}</span>
      <span v-if="i.badge" class="stripe__badge">{{ i.badge }}</span>
      <GnTooltip :text="i.title ?? i.label" />
    </button>
  </nav>
</template>

<style scoped lang="scss">
.stripe {
  flex: none; width: 26px; display: flex; flex-direction: column; align-items: stretch; gap: 2px; padding: 6px 0; background: var(--gn-bg);
  &--left { border-right: 1px solid var(--gn-border); }
  &--right { border-left: 1px solid var(--gn-border); }
  &__btn {
    display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding: 8px 0; font: inherit; font-size: 12px; color: var(--gn-muted);
    background: none; border: none; border-left: 2px solid transparent; border-right: 2px solid transparent; cursor: pointer;
    writing-mode: vertical-rl;
    &:hover { color: var(--gn-text); background: var(--gn-surface-2); }
    &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: -2px; }
    // a marca do painel aberto fica na borda voltada para o conteúdo (na faixa da esquerda o botão está girado 180°, então é a borda "esquerda" do elemento nos dois lados)
    &--on { color: var(--gn-text); background: var(--gn-surface); font-weight: 600; border-left-color: var(--gn-accent); }
  }
  // esquerda: texto de baixo para cima (gira 180°); direita: de cima para baixo
  &--left &__btn { transform: rotate(180deg); }
  &__badge { font-size: 10px; line-height: 1; padding: 3px 1px; min-width: 14px; text-align: center; color: var(--gn-muted); background: var(--gn-surface-2); border-radius: 999px; font-weight: 400; }
}
</style>
