import { describe, expect, it } from 'vitest';
import { CONFETTI_COLORS, makePieces, pieceAt, pieceCount, rainFinished, shouldCelebrate } from '../src/entrypoints/renderer/confetti-core';

/** Gerador determinístico (LCG) para o sorteio das peças não mudar entre execuções. */
function seeded(seed = 7): () => number {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
}

describe('shouldCelebrate', () => {
  it('comemora quando a versão mudou', () => {
    expect(shouldCelebrate('1.13.0', '1.14.0')).toBe(true);
  });

  it('não comemora na primeira instalação (sem versão anterior)', () => {
    expect(shouldCelebrate(null, '1.14.0')).toBe(false);
    expect(shouldCelebrate(undefined, '1.14.0')).toBe(false);
    expect(shouldCelebrate('', '1.14.0')).toBe(false);
  });

  it('não comemora quando a versão é a mesma (abrir o app de novo)', () => {
    expect(shouldCelebrate('1.14.0', '1.14.0')).toBe(false);
  });

  it('não comemora sem versão atual', () => {
    expect(shouldCelebrate('1.13.0', '')).toBe(false);
  });
});

describe('pieceCount', () => {
  it('cresce com a largura, entre o piso e o teto', () => {
    expect(pieceCount(200)).toBe(60);
    expect(pieceCount(840)).toBe(120);
    expect(pieceCount(4000)).toBe(180);
  });
});

describe('makePieces', () => {
  const width = 1000;
  const pieces = makePieces(200, width, seeded());

  it('gera a quantidade pedida, dentro da largura e só com as cores da paleta', () => {
    expect(pieces).toHaveLength(200);
    for (const p of pieces) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(width);
      expect(CONFETTI_COLORS).toContain(p.color);
      expect(p.speed).toBeGreaterThan(0);
      expect(p.delay).toBeGreaterThanOrEqual(0);
    }
  });

  it('mistura círculos e retângulos; o círculo tem altura igual à largura', () => {
    expect(pieces.some((p) => p.round)).toBe(true);
    expect(pieces.some((p) => !p.round)).toBe(true);
    for (const p of pieces.filter((x) => x.round)) expect(p.h).toBe(p.w);
  });

  it('é determinístico para o mesmo sorteio', () => {
    expect(makePieces(5, width, seeded(3))).toEqual(makePieces(5, width, seeded(3)));
  });
});

describe('pieceAt', () => {
  const height = 800;
  const [p] = makePieces(1, 1000, seeded());

  it('antes do atraso a peça ainda não apareceu', () => {
    expect(pieceAt(p!, p!.delay - 1, height).visible).toBe(false);
  });

  it('nasce logo acima do topo e só desce (do topo para o rodapé)', () => {
    const start = pieceAt(p!, p!.delay, height);
    expect(start.visible).toBe(true);
    expect(start.y).toBeLessThan(0);
    let last = start.y;
    for (let ms = p!.delay + 100; ms < p!.delay + 2000; ms += 100) {
      const y = pieceAt(p!, ms, height).y;
      expect(y).toBeGreaterThan(last);
      last = y;
    }
  });

  it('o balanço lateral nunca passa da amplitude da peça', () => {
    for (let ms = p!.delay; ms < p!.delay + 3000; ms += 50) expect(Math.abs(pieceAt(p!, ms, height).x - p!.x)).toBeLessThanOrEqual(p!.sway + 1e-9);
  });

  it('some depois de passar do rodapé', () => {
    expect(pieceAt(p!, p!.delay + 60_000, height).visible).toBe(false);
  });
});

describe('rainFinished', () => {
  const height = 800;
  const pieces = makePieces(80, 1000, seeded(11));

  it('não termina enquanto ainda há peças caindo', () => {
    expect(rainFinished(pieces, 0, height)).toBe(false);
    expect(rainFinished(pieces, 1000, height)).toBe(false);
  });

  it('termina em poucos segundos, quando a última peça passa do rodapé', () => {
    expect(rainFinished(pieces, 10_000, height)).toBe(true);
    // a mais lenta (260 px/s) com o maior atraso (1,5 s) cruza 800 px em ~4,6 s
    expect(rainFinished(pieces, 4500, height)).toBe(false);
  });

  it('sem peças, já terminou', () => {
    expect(rainFinished([], 0, height)).toBe(true);
  });
});
