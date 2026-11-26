// Primeiro uso guiado (#288): o roteiro, o estado gravado e quando começa sozinho (sem Vue nem `window`, para testar).
import type { MessageKey } from './i18n';

export interface TourStep {
  id: string;
  /** O controle de verdade que o passo destaca (`data-tour="…"` no HTML). Fora da tela naquele momento, o passo só explica. */
  target: string;
  title: MessageKey;
  body: MessageKey;
}

/** Cinco passos sobre a tela real, não um tutorial à parte: onde começar, as visões, o commit, a paleta e as Configurações. */
export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'repos', target: '[data-tour="repos"]', title: 'tour.s1.title', body: 'tour.s1.body' },
  { id: 'views', target: '[data-tour="views"]', title: 'tour.s2.title', body: 'tour.s2.body' },
  { id: 'commit', target: '[data-tour="commit"]', title: 'tour.s3.title', body: 'tour.s3.body' },
  { id: 'palette', target: '[data-tour="palette"]', title: 'tour.s4.title', body: 'tour.s4.body' },
  { id: 'settings', target: '[data-tour="settings"]', title: 'tour.s5.title', body: 'tour.s5.body' },
];

export const TOUR_KEY = 'gitnexus.tour';

export interface TourState {
  /** Terminou ou foi pulado: não volta a começar sozinho. */
  done: boolean;
  /** Passo em que parou (0-based): uma sessão interrompida (o app fechou no meio) continua dali. */
  step: number;
}

/** Lê o estado gravado: vazio, torto ou fora do roteiro volta ao começo (e nunca quebra). */
export function parseTourState(raw: string | null | undefined, total = TOUR_STEPS.length): TourState {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object') {
      const o = v as Partial<Record<keyof TourState, unknown>>;
      const step = typeof o.step === 'number' && Number.isInteger(o.step) && o.step >= 0 && o.step < total ? o.step : 0;
      return { done: o.done === true, step };
    }
  } catch {
    /* gravado corrompido: começa do zero */
  }
  return { done: false, step: 0 };
}

/**
 * O passeio começa sozinho só para quem está chegando: nunca terminou nem pulou, o idioma já foi escolhido e o catálogo (já lido) está vazio. Quem tem
 * repositórios não é interrompido por uma atualização; para esses, o passeio está em Configurações e na paleta ("Rever o passeio").
 */
export function shouldAutoStart(o: { state: TourState; askingLocale: boolean; catalogLoaded: boolean; repoCount: number }): boolean {
  return !o.state.done && !o.askingLocale && o.catalogLoaded && o.repoCount === 0;
}

/** O passo anterior e o seguinte, sem passar das pontas (depois do último, `null` = acabou). */
export const prevStep = (i: number): number => Math.max(0, i - 1);
export const nextStep = (i: number, total = TOUR_STEPS.length): number | null => (i + 1 >= total ? null : i + 1);

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Onde pôr o cartão do passeio: abaixo do controle destacado, ou acima se não couber, sempre dentro da janela; sem controle (ou sem espaço de nenhum lado),
 * no centro. `card` é o tamanho do cartão; `gap` o respiro até o controle.
 */
export function placeCard(target: Box | null, card: { width: number; height: number }, view: { width: number; height: number }, gap = 14): { left: number; top: number; centered: boolean } {
  const clampX = (x: number) => Math.max(12, Math.min(x, view.width - card.width - 12));
  const center = { left: (view.width - card.width) / 2, top: Math.max(12, (view.height - card.height) / 2), centered: true };
  if (!target) return center;
  const left = clampX(target.left + target.width / 2 - card.width / 2);
  const below = target.top + target.height + gap;
  if (below + card.height + 12 <= view.height) return { left, top: below, centered: false };
  const above = target.top - gap - card.height;
  if (above >= 12) return { left, top: above, centered: false };
  // o controle ocupa a tela quase toda (um painel grande): o cartão entra sobre o canto de baixo
  return { left: clampX(target.left + 16), top: Math.max(12, view.height - card.height - 16), centered: false };
}
