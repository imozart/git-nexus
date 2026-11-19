// Movimento: a escolha (Sistema / Reduzido / Normal) fica guardada e vira o atributo `data-reduced-motion` do <html>, que os tokens de duração do
// ui-kit usam (tokens.scss). "Sistema" não põe atributo: vale o `prefers-reduced-motion` do sistema. Vale na hora, sem recarregar.
import { ref, watch } from 'vue';
import { isReducedMotion, motionAttribute, pickMotionPref, type MotionPref } from './motion-core';

export { MOTION_PREFS, type MotionPref } from './motion-core';

const KEY = 'gitnexus.motion';
const query = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;

export const motionPref = ref<MotionPref>(pickMotionPref(localStorage.getItem(KEY)));

/** O movimento está reduzido agora (para o que não é CSS: confete etc.). */
export const reducedMotion = (): boolean => isReducedMotion(motionPref.value, !!query?.matches);

watch(
  motionPref,
  (p) => {
    if (p === 'system') localStorage.removeItem(KEY); // o padrão não guarda chave
    else localStorage.setItem(KEY, p);
    const attr = motionAttribute(p);
    if (attr) document.documentElement.dataset.reducedMotion = attr;
    else delete document.documentElement.dataset.reducedMotion;
  },
  { immediate: true },
);

export const setMotionPref = (p: MotionPref): MotionPref => (motionPref.value = p);
