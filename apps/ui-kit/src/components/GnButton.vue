<script setup lang="ts">
// Botão do app. Dois eixos independentes:
//  - `variant` é o PREENCHIMENTO: `primary` (sólido), `ghost` (sem fundo) ou o padrão (contorno em tom claro);
//  - `tone` é a COR, com o mesmo vocabulário do GnBadge: neutral | accent | success | warn | danger.
// A cor tem significado, não é enfeite: accent = navegar/atualizar, success = confirmar (commit), warn = atenção (conflitos),
// danger = destrutivo. Neutral é tudo o que não pede destaque. `variant="danger"` continua valendo e equivale a `tone="danger"`.
import { computed } from 'vue';

export type GnTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger';

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'ghost' | 'danger';
    tone?: GnTone;
    size?: 'sm' | 'md';
    disabled?: boolean;
    type?: 'button' | 'submit';
  }>(),
  { variant: 'ghost', size: 'md', disabled: false, type: 'button' },
);

/** Sem `tone` explícito: `primary` é azul (como sempre foi) e `danger` é vermelho; o resto é neutro. */
const effectiveTone = computed<GnTone>(() => props.tone ?? (props.variant === 'danger' ? 'danger' : props.variant === 'primary' ? 'accent' : 'neutral'));
const solid = computed(() => props.variant === 'primary');
</script>

<template>
  <button class="gn-btn" :class="[`gn-btn--${size}`, `gn-btn--tone-${effectiveTone}`, { 'gn-btn--solid': solid, 'gn-btn--ghost': variant === 'ghost' && effectiveTone === 'neutral' }]" :type="type" :disabled="disabled">
    <slot />
  </button>
</template>

<style scoped lang="scss">
.gn-btn {
  // --tone: cor do botão · --on-tone: texto sobre o preenchimento sólido (escuro nos tons claros, para manter o contraste)
  --tone: var(--gn-muted);
  --on-tone: #fff;
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
  &--ghost { background: transparent; }

  // Tons: define a cor e, quando houver, o texto sobre o fundo sólido.
  &--tone-accent { --tone: var(--gn-accent); }
  &--tone-success { --tone: var(--gn-success); --on-tone: #0d1a11; }
  &--tone-warn { --tone: var(--gn-warn); --on-tone: #1c1503; }
  &--tone-danger { --tone: var(--gn-danger); --on-tone: #200a09; }

  // Contorno colorido (padrão para tom diferente de neutral): fundo levemente tingido, texto clareado para manter o contraste no tema escuro.
  &--tone-accent, &--tone-success, &--tone-warn, &--tone-danger {
    color: color-mix(in srgb, var(--tone) 70%, #fff);
    border-color: color-mix(in srgb, var(--tone) 50%, var(--gn-border));
    background: color-mix(in srgb, var(--tone) 12%, var(--gn-surface-2));
    &:hover:not(:disabled) {
      border-color: var(--tone);
      background: color-mix(in srgb, var(--tone) 20%, var(--gn-surface-2));
    }
  }

  // Sólido (`variant="primary"`): preenchimento na cor do tom.
  &--solid {
    background: var(--tone);
    border-color: var(--tone);
    color: var(--on-tone);
    &:hover:not(:disabled) {
      background: color-mix(in srgb, var(--tone) 82%, #fff);
      border-color: color-mix(in srgb, var(--tone) 82%, #fff);
    }
  }
  // O primary azul sempre teve texto branco e o hover do token; continua igual.
  &--solid.gn-btn--tone-accent {
    --on-tone: #fff;
    &:hover:not(:disabled) { background: var(--gn-accent-hover); border-color: var(--gn-accent-hover); }
  }
}
</style>
