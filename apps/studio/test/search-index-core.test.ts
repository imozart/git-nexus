import { describe, expect, it } from 'vitest';
import { ageText } from '../src/entrypoints/renderer/search-index-core';

describe('ageText (a idade do índice)', () => {
  const now = Date.UTC(2026, 10, 25, 12, 0, 0);
  it('segundos viram "agora", minutos, horas e dias', () => {
    expect(ageText(now - 5_000, now, 'pt-BR')).toBe('agora');
    expect(ageText(now - 3 * 60_000, now, 'pt-BR')).toBe('há 3 minutos');
    expect(ageText(now - 2 * 3_600_000, now, 'pt-BR')).toBe('há 2 horas');
    expect(ageText(now - 4 * 86_400_000, now, 'pt-BR')).toBe('há 4 dias');
  });
  it('segue o idioma', () => {
    expect(ageText(now - 3 * 60_000, now, 'en')).toBe('3 minutes ago');
  });
  it('relógio adiantado não vira idade negativa', () => {
    expect(ageText(now + 60_000, now, 'pt-BR')).toBe('agora');
  });
});
