import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES, pickLocale } from '../src/entrypoints/renderer/i18n/core';

describe('idiomas cadastrados', () => {
  it('cada idioma tem nome, código curto e bandeira, sem repetir id', () => {
    expect(LOCALES.length).toBeGreaterThan(1);
    expect(new Set(LOCALES.map((l) => l.id)).size).toBe(LOCALES.length);
    for (const l of LOCALES) {
      expect(l.label.trim()).not.toBe('');
      expect(l.short).toMatch(/^[A-Z]{2,3}$/);
      expect(['br', 'us']).toContain(l.flag);
    }
  });

  it('todo idioma tem o dicionário correspondente e é aceito pela escolha inicial', () => {
    for (const l of LOCALES) {
      const file = join(__dirname, '../src/entrypoints/renderer/i18n', `${l.id}.ts`);
      expect(existsSync(file), `${l.id}.ts`).toBe(true);
      expect(pickLocale(l.id, 'xx')).toBe(l.id);
    }
  });
});
