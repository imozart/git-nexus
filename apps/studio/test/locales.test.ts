import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../src/entrypoints/renderer/i18n/en';
import ptBR from '../src/entrypoints/renderer/i18n/pt-BR';
import { SUPPORTED_LOCALES, LOCALES, normalizeLocale, pickLocale, pickLocalePref, placeholders, pluralForms, resolveLocale, systemLocale, translate, type Dict, type Locale } from '../src/entrypoints/renderer/i18n/core';

// Cada idioma do catálogo precisa de um dicionário aqui (o Record<Locale, ...> faz o TypeScript reclamar se um idioma novo ficar sem ele).
const DICTS: Record<Locale, Dict> = { 'pt-BR': ptBR as Dict, en: en as Dict };

describe('catálogo único de idiomas (SUPPORTED_LOCALES)', () => {
  it('cada idioma tem código BCP-47 válido, nome nativo, código curto, direção e código Intl, sem repetir id', () => {
    expect(LOCALES.length).toBeGreaterThan(1);
    expect(new Set(LOCALES.map((l) => l.id)).size).toBe(LOCALES.length);
    for (const l of SUPPORTED_LOCALES) {
      expect(Intl.getCanonicalLocales(l.id)[0], l.id).toBe(l.id);
      expect(l.label.trim(), l.id).not.toBe('');
      expect(l.short, l.id).toMatch(/^[A-Z]{2,3}$/);
      expect(['ltr', 'rtl'], l.id).toContain(l.dir);
      expect(Intl.getCanonicalLocales(l.intl).length, l.id).toBe(1);
    }
  });

  it('não há bandeira no catálogo (bandeira é país, não idioma)', () => {
    for (const l of LOCALES) expect(Object.keys(l)).not.toContain('flag');
  });

  it('todo idioma tem o arquivo do dicionário (<id>.ts) e é aceito pela escolha inicial', () => {
    for (const l of LOCALES) {
      expect(existsSync(join(__dirname, '../src/entrypoints/renderer/i18n', `${l.id}.ts`)), `${l.id}.ts`).toBe(true);
      expect(pickLocale(l.id, 'xx')).toBe(l.id);
    }
  });
});

describe('normalização do idioma', () => {
  it.each([
    ['pt_BR.UTF-8', 'pt-BR'],
    ['pt-br', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['pt', 'pt-BR'],
    ['en', 'en'],
    ['EN_us', 'en'],
    ['en-GB', 'en'],
    ['en_US.UTF-8@euro', 'en'],
  ])('%s vira %s', (raw, esperado) => {
    expect(normalizeLocale(raw)).toBe(esperado);
  });

  it.each(['', '  ', undefined, null, 'fr-FR', 'zz', '@@@', 'pt BR!!'])('"%s" não é um idioma do catálogo', (raw) => {
    expect(normalizeLocale(raw as string | undefined)).toBeUndefined();
  });

  it('o idioma do sistema cai em inglês quando não há correspondência', () => {
    expect(systemLocale('fr-FR')).toBe('en');
    expect(systemLocale(undefined)).toBe('en');
    expect(systemLocale('pt-PT')).toBe('pt-BR');
  });
});

describe('preferência de idioma', () => {
  it('"system" ou valor desconhecido segue o sistema; um idioma guardado (em qualquer grafia) vale', () => {
    expect(pickLocalePref('system')).toBe('system');
    expect(pickLocalePref(null)).toBe('system');
    expect(pickLocalePref('klingon')).toBe('system');
    expect(pickLocalePref('pt_BR.UTF-8')).toBe('pt-BR');
    expect(pickLocalePref('en')).toBe('en');
  });

  it('resolveLocale: fixo ignora o sistema, "system" o segue', () => {
    expect(resolveLocale('en', 'pt-BR')).toBe('en');
    expect(resolveLocale('pt-BR', 'en-US')).toBe('pt-BR');
    expect(resolveLocale('system', 'pt-BR')).toBe('pt-BR');
    expect(resolveLocale('system', 'de-DE')).toBe('en');
  });

  it('pickLocale mantém a regra antiga: o salvo vale; sem salvo, qualquer pt vira pt-BR e o resto, inglês', () => {
    expect(pickLocale('en', 'pt-BR')).toBe('en');
    expect(pickLocale(null, 'pt-PT')).toBe('pt-BR');
    expect(pickLocale(null, 'es-ES')).toBe('en');
    expect(pickLocale('system', 'pt-BR')).toBe('pt-BR');
  });
});

describe('plural por idioma (Intl.PluralRules)', () => {
  it('pt e en usam duas formas (one, other); russo, polonês e árabe usam mais', () => {
    expect(pluralForms('pt-BR')).toEqual(['one', 'other']);
    expect(pluralForms('en')).toEqual(['one', 'other']);
    expect(pluralForms('ru').length).toBeGreaterThanOrEqual(3);
    expect(pluralForms('pl').length).toBeGreaterThanOrEqual(3);
    expect(pluralForms('ar').length).toBeGreaterThanOrEqual(4);
  });

  it('toda tradução com plural tem formas suficientes para as categorias do idioma, e as mesmas variáveis do português', () => {
    for (const l of LOCALES) {
      const need = pluralForms(l.id).length;
      for (const [key, pt] of Object.entries(ptBR)) {
        if (!pt.includes('|')) continue;
        const tr = DICTS[l.id][key];
        if (tr === undefined) continue; // chave ainda não traduzida: cai no português
        expect(tr.split('|').length, `${l.id}: ${key} precisa de ${need} formas (${pluralForms(l.id).join(', ')})`).toBeGreaterThanOrEqual(need);
        expect(placeholders(tr), `${l.id}: ${key}`).toEqual(placeholders(pt));
      }
    }
  });

  it('translate escolhe a forma pela ordem das categorias do idioma', () => {
    const d = { 'pt-BR': { k: 'um|{n} itens' }, en: { k: 'one|{n} items' } } as unknown as Record<Locale, Dict>;
    expect(translate(d, 'pt-BR', 'k', { n: 1 })).toBe('um');
    expect(translate(d, 'pt-BR', 'k', { n: 3 })).toBe('3 itens');
    expect(translate(d, 'en', 'k', { n: 1 })).toBe('one');
    expect(translate(d, 'en', 'k', { n: 0 })).toBe('0 items');
  });
});
