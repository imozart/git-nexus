<script setup lang="ts">
// Botão só de ícone (navegação, fechar, reordenar...). Sem texto visível, então `label` é OBRIGATÓRIO: vira o aria-label e, por padrão, o
// tooltip (`title`, que pode levar o atalho: "Próxima diferença (F7)"). Mesmos eixos do GnButton: `tone` (cor) e `variant` (preenchimento);
// o padrão é leve (`ghost`), porque botão de ícone é ação de apoio.
import GnButton, { type GnTone } from './GnButton.vue';
import GnIcon from './GnIcon.vue';
import type { GnIconName } from './icons';

withDefaults(
  defineProps<{
    icon: GnIconName;
    label: string;
    title?: string;
    tone?: GnTone;
    variant?: 'primary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
    disabled?: boolean;
  }>(),
  { title: undefined, tone: undefined, variant: 'ghost', size: 'sm', disabled: false },
);
</script>

<template>
  <GnButton class="gn-icon-btn" :variant="variant" :tone="tone" :size="size" :disabled="disabled" :aria-label="label" :title="title ?? label">
    <GnIcon :name="icon" />
  </GnButton>
</template>

<style scoped lang="scss">
// quadrado: sem o respiro lateral do botão com texto
.gn-icon-btn.gn-btn { padding: 2px 6px; justify-content: center; }
.gn-icon-btn.gn-btn--md { padding: 6px 8px; }
</style>
