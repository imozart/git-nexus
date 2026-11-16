import { describe, expect, it } from 'vitest';
import { AUTO_FETCH_MIN_MS, agoParts, dueForFetch } from '../src/entrypoints/renderer/auto-fetch-core';

const MIN = 60_000;

describe('dueForFetch', () => {
  const now = 10 * AUTO_FETCH_MIN_MS;

  it('nunca buscou nem tentou: está na hora', () => {
    expect(dueForFetch(now, undefined, null)).toBe(true);
  });

  it('respeita o intervalo mínimo desde a última tentativa do app', () => {
    expect(dueForFetch(now, now - AUTO_FETCH_MIN_MS + 1, null)).toBe(false);
    expect(dueForFetch(now, now - AUTO_FETCH_MIN_MS, null)).toBe(true);
  });

  it('uma tentativa que falhou também conta (não martela um servidor fora do ar)', () => {
    expect(dueForFetch(now, now - MIN, null)).toBe(false);
  });

  it('uma busca feita fora do app (FETCH_HEAD) também conta', () => {
    expect(dueForFetch(now, undefined, now - MIN)).toBe(false);
    expect(dueForFetch(now, now - 9 * AUTO_FETCH_MIN_MS, now - MIN)).toBe(false);
    expect(dueForFetch(now, now - MIN, now - 9 * AUTO_FETCH_MIN_MS)).toBe(false);
  });

  it('vale o mais recente dos dois', () => {
    expect(dueForFetch(now, now - 2 * AUTO_FETCH_MIN_MS, now - 3 * AUTO_FETCH_MIN_MS)).toBe(true);
  });

  it('aceita outro intervalo', () => {
    expect(dueForFetch(now, now - 2 * MIN, null, MIN)).toBe(true);
    expect(dueForFetch(now, now - 30_000, null, MIN)).toBe(false);
  });
});

describe('agoParts', () => {
  const now = 1_000_000_000_000;

  it('menos de um minuto (e relógio adiantado) vale "agora"', () => {
    expect(agoParts(now, now)).toEqual({ unit: 'now' });
    expect(agoParts(now, now - 59_999)).toEqual({ unit: 'now' });
    expect(agoParts(now, now + 5 * MIN)).toEqual({ unit: 'now' });
  });

  it('minutos, horas e dias, arredondando para baixo', () => {
    expect(agoParts(now, now - MIN)).toEqual({ unit: 'min', n: 1 });
    expect(agoParts(now, now - 59 * MIN - 59_000)).toEqual({ unit: 'min', n: 59 });
    expect(agoParts(now, now - 60 * MIN)).toEqual({ unit: 'hour', n: 1 });
    expect(agoParts(now, now - 23 * 60 * MIN)).toEqual({ unit: 'hour', n: 23 });
    expect(agoParts(now, now - 24 * 60 * MIN)).toEqual({ unit: 'day', n: 1 });
    expect(agoParts(now, now - 50 * 60 * MIN)).toEqual({ unit: 'day', n: 2 });
  });
});
