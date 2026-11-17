// Regras (puras) do confete da primeira abertura depois de uma atualização: quando comemorar e a física das peças.
// Sem Vue, sem DOM: dá para testar. O desenho no canvas fica em components/ConfettiRain.vue.

/** Cores das peças (as do confete do GitHub Discussions, que servem nos temas claro e escuro). */
export const CONFETTI_COLORS = ['#f85149', '#f0883e', '#e3b341', '#3fb950', '#58a6ff', '#a371f7', '#db61a2'] as const;

/** Atraso máximo (ms) para uma peça começar a cair: espalha a chuva em vez de despejar tudo de uma vez. */
export const CONFETTI_MAX_DELAY_MS = 1500;

/** Comemora só na primeira abertura de uma versão diferente da anterior; a primeira instalação (sem versão anterior) não comemora. */
export function shouldCelebrate(prev: string | null | undefined, current: string): boolean {
  return !!prev && !!current && prev !== current;
}

export interface Piece {
  /** Coluna de origem (px). */
  x: number;
  /** Largura e altura (px); o retângulo gira, o círculo usa só a largura. */
  w: number;
  h: number;
  round: boolean;
  color: string;
  /** Espera antes de começar a cair (ms). */
  delay: number;
  /** Velocidade de queda (px/s). */
  speed: number;
  /** Balanço lateral: amplitude (px), frequência (rad/s) e fase (rad). */
  sway: number;
  swayFreq: number;
  phase: number;
  /** Giro: ângulo inicial (rad) e velocidade (rad/s). */
  rot: number;
  spin: number;
}

/** Quantas peças para a largura da janela (janela estreita não precisa de tanta, larga não passa do teto). */
export function pieceCount(width: number): number {
  return Math.min(180, Math.max(60, Math.round(width / 7)));
}

const between = (rand: () => number, min: number, max: number) => min + rand() * (max - min);

/** Sorteia as peças. `rand` (0 ≤ n < 1) é injetável para o teste ser determinístico. */
export function makePieces(count: number, width: number, rand: () => number = Math.random): Piece[] {
  return Array.from({ length: count }, (): Piece => {
    const round = rand() < 0.3;
    const w = between(rand, 6, 11);
    return {
      x: rand() * width,
      w,
      h: round ? w : between(rand, 4, 7),
      round,
      color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)]!,
      delay: rand() * CONFETTI_MAX_DELAY_MS,
      speed: between(rand, 260, 480),
      sway: between(rand, 8, 36),
      swayFreq: between(rand, 1.5, 4),
      phase: rand() * Math.PI * 2,
      rot: rand() * Math.PI * 2,
      spin: between(rand, -9, 9),
    };
  });
}

export interface PiecePose {
  x: number;
  y: number;
  rot: number;
  /** Já começou a cair e ainda não saiu pelo rodapé. */
  visible: boolean;
}

/** Onde a peça está `ms` milissegundos depois do início da chuva: nasce logo acima do topo e cai até passar do rodapé. */
export function pieceAt(p: Piece, ms: number, height: number): PiecePose {
  const t = (ms - p.delay) / 1000;
  const y = -p.h - 4 + p.speed * Math.max(0, t);
  return { x: p.x + Math.sin(p.phase + p.swayFreq * Math.max(0, t)) * p.sway, y, rot: p.rot + p.spin * Math.max(0, t), visible: t >= 0 && y < height + p.w };
}

/** Todas as peças já passaram do rodapé: a animação acabou. */
export function rainFinished(pieces: readonly Piece[], ms: number, height: number): boolean {
  return pieces.every((p) => ms >= p.delay && !pieceAt(p, ms, height).visible);
}
