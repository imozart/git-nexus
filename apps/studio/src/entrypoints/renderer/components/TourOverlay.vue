<script setup lang="ts">
// Passeio do primeiro uso (#288): destaca o controle de verdade de cada passo, na tela em que a pessoa está, com um cartão (Voltar, Próximo e Pular).
// Não é um diálogo modal: o fundo só escurece (não captura cliques), o controle destacado continua clicável, Esc pula e o foco volta para onde estava.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { GnButton } from '@git-nexus/ui-kit';
import { t } from '../i18n';
import { placeCard, type Box } from '../tour-core';
import { shortcutLabel } from '../stores/commands';
import { useTourStore } from '../stores/tour';

const tour = useTourStore();
/** A tecla de comando do sistema (Ctrl, ou ⌘ no macOS), para os textos dos passos. */
const mod = shortcutLabel('Mod');
const card = ref<HTMLElement>();
const target = ref<Box | null>(null);
const pos = ref({ left: 0, top: 0, centered: true });

/** O controle do passo atual, se estiver na tela (visível e com tamanho). */
function findTarget(): HTMLElement | null {
  const els = [...document.querySelectorAll<HTMLElement>(tour.current.target)];
  return els.find((e) => e.getClientRects().length > 0 && e.offsetParent !== null) ?? null;
}

function measure(): void {
  const el = findTarget();
  if (el) {
    const r = el.getBoundingClientRect();
    const pad = 6;
    target.value = { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
  } else {
    target.value = null;
  }
  const c = card.value?.getBoundingClientRect();
  pos.value = placeCard(target.value, { width: c?.width ?? 380, height: c?.height ?? 190 }, { width: window.innerWidth, height: window.innerHeight });
}

async function settle(): Promise<void> {
  await nextTick();
  findTarget()?.scrollIntoView?.({ block: 'nearest' }); // o controle fora da área rolada entra na vista antes de medir
  measure();
  await nextTick();
  measure(); // o cartão já tem o tamanho do texto deste passo
  card.value?.querySelector<HTMLElement>('[data-tour-primary]')?.focus();
}

watch(
  () => [tour.active, tour.step] as const,
  ([on]) => {
    if (on) void settle();
  },
  { immediate: true, flush: 'post' },
);
window.addEventListener('resize', measure);
onBeforeUnmount(() => window.removeEventListener('resize', measure));

const spotStyle = computed(() => (target.value ? { left: `${target.value.left}px`, top: `${target.value.top}px`, width: `${target.value.width}px`, height: `${target.value.height}px` } : undefined));
const cardStyle = computed(() => ({ left: `${pos.value.left}px`, top: `${pos.value.top}px` }));

/** Esc pula; o Tab circula só entre os botões do cartão (o resto da tela fica como está, sem armadilha de foco). */
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    tour.skip();
    return;
  }
  if (e.key !== 'Tab') return;
  const btns = [...(card.value?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
  if (!btns.length) return;
  const i = btns.indexOf(document.activeElement as HTMLElement);
  const to = e.shiftKey ? (i <= 0 ? btns.length - 1 : i - 1) : i === btns.length - 1 ? 0 : i + 1;
  e.preventDefault();
  btns[to]!.focus();
}
</script>

<template>
  <div v-if="tour.active" class="tour" data-testid="tour" @keydown.capture="onKey">
    <div v-if="spotStyle" class="tour__spot" :style="spotStyle" aria-hidden="true" data-testid="tour-spot" />
    <div v-else class="tour__dim" aria-hidden="true" />
    <section ref="card" class="tour__card" :class="{ 'tour__card--center': pos.centered }" :style="cardStyle" role="dialog" aria-modal="false" :aria-label="t('tour.label')" data-testid="tour-card">
      <p class="tour__n" data-testid="tour-progress">{{ t('tour.progress', { n: tour.step + 1, total: tour.total }) }}</p>
      <div aria-live="polite" aria-atomic="true">
        <h3 class="tour__title" data-testid="tour-title">{{ t(tour.current.title) }}</h3>
        <p class="tour__body">{{ t(tour.current.body, { mod }) }}</p>
        <p v-if="!target" class="tour__hint" data-testid="tour-notarget">{{ t('tour.noTarget') }}</p>
      </div>
      <div class="tour__btns">
        <GnButton size="sm" variant="ghost" data-testid="tour-skip" @click="tour.skip()">{{ t('tour.skip') }}</GnButton>
        <span class="tour__grow" />
        <GnButton v-if="tour.step > 0" size="sm" data-testid="tour-back" @click="tour.back()">{{ t('tour.back') }}</GnButton>
        <GnButton size="sm" variant="primary" data-tour-primary data-testid="tour-next" @click="tour.next()">{{ tour.isLast ? t('tour.done') : t('tour.next') }}</GnButton>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
// o fundo não captura cliques (o controle destacado e o resto da tela seguem utilizáveis); só o cartão recebe o mouse
.tour {
  position: fixed; inset: 0; z-index: var(--gn-z-palette); pointer-events: none;
  &__dim { position: absolute; inset: 0; background: var(--gn-backdrop); }
  &__spot {
    position: absolute; border-radius: 10px; border: 2px solid var(--gn-accent);
    box-shadow: 0 0 0 9999px var(--gn-backdrop), 0 0 0 4px color-mix(in srgb, var(--gn-accent) 30%, transparent);
    transition: left var(--gn-motion-base) ease, top var(--gn-motion-base) ease, width var(--gn-motion-base) ease, height var(--gn-motion-base) ease;
  }
  &__card {
    position: absolute; width: min(380px, calc(100vw - 24px)); padding: 14px 16px; pointer-events: auto;
    background: var(--gn-surface); color: var(--gn-text); border: 1px solid var(--gn-border); border-radius: var(--gn-radius-lg); box-shadow: var(--gn-shadow-md);
  }
  &__n { margin: 0 0 4px; font-size: 11px; color: var(--gn-muted); }
  &__title { margin: 0 0 6px; font-size: 14px; }
  &__body { margin: 0 0 10px; font-size: 12.5px; line-height: 1.45; }
  &__hint { margin: 0 0 10px; font-size: 12px; color: var(--gn-muted); }
  &__btns { display: flex; align-items: center; gap: 8px; }
  &__grow { flex: 1; }
}
</style>
