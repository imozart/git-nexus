<script setup lang="ts">
// Botão do app. Dois eixos independentes:
//  - `variant` é o PREENCHIMENTO: `primary` (sólido), `ghost` (leve, sem fundo) ou o padrão (contorno em tom claro);
//  - `tone` é a COR, com o mesmo vocabulário do GnBadge: neutral | accent | success | warn | danger.
// A cor tem significado, não é enfeite:
//   sólido (`primary`)        = a ação que a pessoa veio fazer nesta tela (no máximo uma por área): azul, ou verde ao concluir, âmbar ao reescrever histórico
//   accent (contorno)         = navegar / consultar (abrir, ver, ir para)
//   success                   = confirmar / concluir (commit, marcar como resolvido, criar PR)
//   warn                      = atenção, em andamento ou que reescreve o histórico (conflitos, rebase, desfazer)
//   danger                    = destrutivo (excluir, abortar, remover)
//   neutral                   = tudo o que não pede destaque (inclui "Atualizar")
// `variant="ghost"` com um tom colorido dá o botão LEVE colorido: texto na cor do tom, sem fundo nem borda até o hover (ações repetidas em
// listas, como "Remover" em cada linha, sem encher a tela de vermelho). `variant="danger"` continua valendo e equivale a `tone="danger"`.
// Ícone dentro do botão: `<GnIcon name="check" />` antes do texto (só onde informa; veja docs/INTERFACE.md). Só ícone: use GnIconButton.
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
  { variant: undefined, tone: undefined, size: 'md', disabled: false, type: 'button' },
);

/** Sem `tone` explícito: `primary` é azul (como sempre foi) e `danger` é vermelho; o resto é neutro. */
const effectiveTone = computed<GnTone>(() => props.tone ?? (props.variant === 'danger' ? 'danger' : props.variant === 'primary' ? 'accent' : 'neutral'));
const solid = computed(() => props.variant === 'primary');
/** Neutro sem preenchimento: o padrão (sem `variant`) e `ghost`. */
const ghost = computed(() => effectiveTone.value === 'neutral' && (props.variant === undefined || props.variant === 'ghost'));
/** `ghost` com tom colorido: o botão leve colorido (só quando pedido de forma explícita). */
const ghostTone = computed(() => props.variant === 'ghost' && effectiveTone.value !== 'neutral');
</script>

<template>
  <button
    class="gn-btn"
    :class="[`gn-btn--${size}`, `gn-btn--tone-${effectiveTone}`, { 'gn-btn--solid': solid, 'gn-btn--ghost': ghost, 'gn-btn--ghost-tone': ghostTone }]"
    :type="type"
    :disabled="disabled"
  >
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
  &:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: 1px; }
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

  // Leve colorido (`variant="ghost"` + tom): sem fundo nem borda em repouso; no hover volta o contorno tingido da regra acima.
  &--ghost-tone { background: transparent; border-color: transparent; }

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
  // O azul sólido usa um azul um pouco mais escuro (--gn-accent-solid) para o texto branco passar de 4,5:1, e ESCURECE no hover (clarear
  // o fundo tirava o contraste justo quando o mouse está em cima). O azul de bordas, links e foco (--gn-accent) continua o mesmo.
  &--solid.gn-btn--tone-accent {
    --on-tone: #fff;
    background: var(--gn-accent-solid);
    border-color: var(--gn-accent-solid);
    &:hover:not(:disabled) { background: var(--gn-accent-solid-hover); border-color: var(--gn-accent-solid-hover); }
  }
}
</style>
