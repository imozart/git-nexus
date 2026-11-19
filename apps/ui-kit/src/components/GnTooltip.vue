<script lang="ts">
// Estado compartilhado entre todas as dicas (fora do setup): só uma fica aberta por vez, e `lastClosedAt` alimenta o atraso "quente".
let openTip: { id: string; close: () => void } | null = null;
let lastClosedAt: number | null = null;
</script>

<script setup lang="ts">
// Dica de um elemento ao passar o mouse ou focar (tooltip estilizado no lugar do `title` nativo). O elemento descrito é o PAI do componente no DOM:
// o GnTooltip fica como FILHO dele (não o envolve), assim não cria caixa no layout e não quebra o que depende de :first-child / :last-child, como o
// GnButtonGroup. A dica em si vai para o <body> (Teleport), com posição fixa. Texto só por prop (sem i18n, stores nem api); só tokens --gn-*.
//
//   <GnIconButton ... />                                 usa o GnTooltip por dentro
//   <button class="tab"> ... <GnTooltip :text="t" /> </button>   uso direto
//
// O pai ganha `data-tooltip` com o texto (mesmo com a dica fechada; os testes leem por aí) e, enquanto a dica está aberta e o texto difere do
// aria-label do pai (por exemplo, quando traz o atalho), `aria-describedby`. O nome acessível do botão continua sendo o aria-label.
import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { TIP_DELAY_MS, placeTip, tipDelay, type TipSide } from '../tooltip-core';

const props = withDefaults(
  defineProps<{
    /** Texto da dica; vazio ou só espaços: não mostra nada. */
    text: string;
    /** Lado preferido (troca de lado se faltar espaço). */
    placement?: TipSide;
    /** Atraso com o mouse, em ms (no foco por teclado é sempre 0). */
    delay?: number;
    /** Desliga a dica. */
    disabled?: boolean;
  }>(),
  { placement: 'top', delay: TIP_DELAY_MS, disabled: false },
);

const id = useId();
const tip = ref<HTMLElement>();
const visible = ref(false);
const placed = ref(false);
const pos = ref({ left: 0, top: 0 });
let host: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let prevDescribedBy: string | null | undefined;

const label = () => props.text.trim();
/** Sem dica: texto vazio, `disabled`, ou o pai desabilitado. */
const off = () => !label() || props.disabled || !host || host.hasAttribute('disabled') || host.getAttribute('aria-disabled') === 'true';

const style = computed(() => (placed.value ? { left: `${pos.value.left}px`, top: `${pos.value.top}px` } : { left: '0px', top: '0px', visibility: 'hidden' as const }));

function syncAttrs(): void {
  if (!host) return;
  if (label() && !props.disabled) host.setAttribute('data-tooltip', label());
  else host.removeAttribute('data-tooltip');
  if (visible.value && label() !== (host.getAttribute('aria-label') ?? '').trim()) {
    if (prevDescribedBy === undefined) prevDescribedBy = host.getAttribute('aria-describedby');
    host.setAttribute('aria-describedby', id);
  } else restoreDescribedBy();
}
function restoreDescribedBy(): void {
  if (!host || prevDescribedBy === undefined) return;
  if (prevDescribedBy === null) host.removeAttribute('aria-describedby');
  else host.setAttribute('aria-describedby', prevDescribedBy);
  prevDescribedBy = undefined;
}

/** Mede o pai e a dica (já no DOM, escondida) e só então mostra: não pisca na posição errada. */
async function place(): Promise<void> {
  await nextTick();
  if (!visible.value || !host || !tip.value) return;
  const a = host.getBoundingClientRect();
  const t = tip.value.getBoundingClientRect();
  const p = placeTip({ left: a.left, top: a.top, width: a.width, height: a.height }, { width: t.width, height: t.height }, { width: window.innerWidth, height: window.innerHeight }, props.placement);
  pos.value = { left: p.left, top: p.top };
  placed.value = true;
}

function show(): void {
  clearTimeout(timer);
  if (off() || visible.value) return;
  if (openTip && openTip.id !== id) openTip.close();
  openTip = { id, close };
  visible.value = true;
  placed.value = false;
  syncAttrs();
  document.addEventListener('keydown', onKey); // sem stopPropagation: o Esc continua valendo para o resto do app
  window.addEventListener('scroll', close, true);
  window.addEventListener('wheel', close, true);
  void place();
}

function close(): void {
  clearTimeout(timer);
  if (!visible.value) return;
  visible.value = false;
  placed.value = false;
  lastClosedAt = Date.now();
  if (openTip?.id === id) openTip = null;
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('scroll', close, true);
  window.removeEventListener('wheel', close, true);
  syncAttrs();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}
function onEnter(): void {
  clearTimeout(timer);
  if (off()) return;
  const wait = tipDelay(Date.now(), lastClosedAt, props.delay);
  if (wait <= 0) show();
  else timer = setTimeout(show, wait);
}
function onFocusIn(): void {
  // só o foco por teclado (:focus-visible) abre; o clique já fecha pelo mousedown
  if (host?.matches(':focus-visible')) show();
}

onMounted(() => {
  // a raiz do componente é um Teleport: o que fica no lugar dele é um nó de comentário, e o pai desse nó é o elemento descrito
  host = (getCurrentInstance()?.proxy?.$el as Node | undefined)?.parentElement ?? null;
  if (!host) return;
  host.addEventListener('mouseenter', onEnter);
  host.addEventListener('mouseleave', close);
  host.addEventListener('mousedown', close);
  host.addEventListener('focusin', onFocusIn);
  host.addEventListener('focusout', close);
  syncAttrs();
});

watch(
  () => [props.text, props.disabled] as const,
  () => {
    syncAttrs();
    if (visible.value) {
      if (off()) close();
      else void place(); // o texto mudou com a dica aberta: reposiciona
    }
  },
);

onBeforeUnmount(() => {
  close();
  clearTimeout(timer);
  if (host) {
    host.removeEventListener('mouseenter', onEnter);
    host.removeEventListener('mouseleave', close);
    host.removeEventListener('mousedown', close);
    host.removeEventListener('focusin', onFocusIn);
    host.removeEventListener('focusout', close);
    host.removeAttribute('data-tooltip');
    restoreDescribedBy();
  }
  host = null;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" :id="id" ref="tip" class="gn-tooltip" role="tooltip" :style="style">{{ text.trim() }}</div>
  </Teleport>
</template>

<style scoped lang="scss">
.gn-tooltip {
  position: fixed;
  z-index: var(--gn-z-tooltip);
  max-width: 280px;
  padding: 4px 8px;
  font-size: 12px;
  line-height: 1.35;
  color: var(--gn-text);
  background: var(--gn-surface-2);
  border: 1px solid var(--gn-border);
  border-radius: var(--gn-radius-sm);
  box-shadow: var(--gn-shadow-sm);
  pointer-events: none;
  animation: gn-fade-in var(--gn-enter) ease-out;
}
</style>
