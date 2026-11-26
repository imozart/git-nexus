// Primeiro uso guiado (#288): o estado do passeio (ativo, passo) e o que fica gravado (`gitnexus.tour`: terminou/pulou e em que passo parou).
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { TOUR_KEY, TOUR_STEPS, nextStep, parseTourState, prevStep, type TourState } from '../tour-core';

const read = (): TourState => parseTourState(typeof localStorage === 'undefined' ? null : localStorage.getItem(TOUR_KEY));

export const useTourStore = defineStore('tour', () => {
  const saved = ref<TourState>(read());
  const active = ref(false);
  const step = ref(saved.value.step);
  /** Quem tinha o foco antes do passeio: volta para lá quando ele fecha. */
  let returnFocus: HTMLElement | null = null;

  const total = TOUR_STEPS.length;
  const current = computed(() => TOUR_STEPS[step.value]!);
  const isLast = computed(() => nextStep(step.value) === null);

  function save(): void {
    saved.value = { done: saved.value.done, step: step.value };
    try {
      localStorage.setItem(TOUR_KEY, JSON.stringify(saved.value));
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
  }

  /** Começa (do passo gravado, ou do primeiro quando `restart`: "Rever o passeio"). */
  function start(restart = false): void {
    if (restart) step.value = 0;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    active.value = true;
    save();
  }
  function close(done: boolean): void {
    active.value = false;
    saved.value = { done: done || saved.value.done, step: done ? 0 : step.value };
    if (done) step.value = 0;
    try {
      localStorage.setItem(TOUR_KEY, JSON.stringify(saved.value));
    } catch {
      /* idem */
    }
    const el = returnFocus;
    returnFocus = null;
    if (el?.isConnected) el.focus();
  }
  function next(): void {
    const n = nextStep(step.value);
    if (n === null) return close(true);
    step.value = n;
    save();
  }
  function back(): void {
    step.value = prevStep(step.value);
    save();
  }
  /** Pular: conta como visto (não volta sozinho). */
  const skip = (): void => close(true);

  return { active, step, total, current, isLast, saved, start, next, back, skip, close };
});
