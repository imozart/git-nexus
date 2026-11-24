import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickLocale, placeholders, translate, type Dict, type Locale } from '../src/entrypoints/renderer/i18n/core';
import en from '../src/entrypoints/renderer/i18n/en';
import ptBR from '../src/entrypoints/renderer/i18n/pt-BR';

const DICTS: Record<Locale, Dict> = { 'pt-BR': ptBR as Dict, en: en as Dict };
const t = (locale: Locale, key: string, vars?: Record<string, string | number>) => translate(DICTS, locale, key, vars);

describe('translate', () => {
  it('traduz, interpola e cai no português quando falta a chave', () => {
    expect(t('pt-BR', 'update.available', { version: '1.3.0' })).toBe('Nova versão 1.3.0 disponível');
    expect(t('en', 'update.available', { version: '1.3.0' })).toBe('New version 1.3.0 available');
    const parcial: Record<Locale, Dict> = { 'pt-BR': { a: 'só em português' }, en: {} };
    expect(translate(parcial, 'en', 'a')).toBe('só em português'); // fallback
    expect(translate(parcial, 'en', 'inexistente')).toBe('inexistente'); // a própria chave denuncia o esquecimento
  });

  it('mantém {variáveis} que não foram passadas', () => {
    expect(translate({ 'pt-BR': { x: 'olá {nome}' }, en: {} }, 'pt-BR', 'x', { outro: 1 })).toBe('olá {nome}');
  });

  it('plural pela regra do idioma', () => {
    expect(t('pt-BR', 'home.changes', { n: 1 })).toBe('● 1 alteração');
    expect(t('pt-BR', 'home.changes', { n: 5 })).toBe('● 5 alterações');
    expect(t('en', 'home.changes', { n: 1 })).toBe('● 1 change');
    expect(t('en', 'home.changes', { n: 0 })).toBe('● 0 changes');
    expect(t('en', 'commit.submit', { n: 1 })).toBe('Commit (1 file)');
    expect(t('en', 'commit.submit', { n: 3 })).toBe('Commit (3 files)');
    expect(t('pt-BR', 'repos.found', { n: 2 })).toBe('2 repositórios encontrados.');
  });
});

describe('pickLocale', () => {
  it('usa o salvo; senão o idioma do sistema; senão inglês', () => {
    expect(pickLocale('en', 'pt-BR')).toBe('en');
    expect(pickLocale('pt-BR', 'en-US')).toBe('pt-BR');
    expect(pickLocale(null, 'pt-PT')).toBe('pt-BR');
    expect(pickLocale(undefined, 'PT')).toBe('pt-BR');
    expect(pickLocale(null, 'de-DE')).toBe('en');
    expect(pickLocale('fr', 'fr-FR')).toBe('en'); // idioma salvo inválido é ignorado
    expect(pickLocale(null, undefined)).toBe('en');
  });
});

describe('dicionários', () => {
  const ptKeys = Object.keys(ptBR);
  const enKeys = Object.keys(en);

  it('o inglês só tem chaves que existem no português (nada órfão)', () => {
    expect(enKeys.filter((k) => !ptKeys.includes(k))).toEqual([]);
  });

  it('cada tradução usa exatamente os mesmos {placeholders} do original', () => {
    const wrong = enKeys.filter((k) => JSON.stringify(placeholders((en as Dict)[k]!)) !== JSON.stringify(placeholders((ptBR as Dict)[k]!)));
    expect(wrong).toEqual([]);
  });

  it('as formas de plural combinam (mesma quantidade de "|")', () => {
    const wrong = enKeys.filter((k) => ((en as Dict)[k]!.match(/\|/g) ?? []).length !== (((ptBR as Dict)[k]!).match(/\|/g) ?? []).length);
    expect(wrong).toEqual([]);
  });

  it('o inglês cobre todas as superfícies migradas (sem buracos)', () => {
    // abas, janela, atualização, início, paleta, comandos e formulário de commit: tudo traduzido
    const sem = ptKeys.filter((k) => !enKeys.includes(k));
    // exceções conscientes: textos técnicos que são iguais nos dois idiomas
    const iguais = new Set(['home.fetchTitle', 'home.progress']);
    expect(sem.filter((k) => !iguais.has(k))).toEqual([]);
  });

  it('não há tradução vazia', () => {
    expect([...ptKeys, ...enKeys].filter((k) => !((ptBR as Dict)[k] ?? (en as Dict)[k])?.trim())).toEqual([]);
  });
});

describe('uso das chaves no código', () => {
  const root = join(__dirname, '..', 'src', 'entrypoints', 'renderer');
  const files: string[] = [];
  (function walk(d: string) {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(vue|ts)$/.test(n) && !p.includes(`${join('renderer', 'i18n')}`)) files.push(p);
    }
  })(root);

  it('toda chave usada em t(\'...\') existe no dicionário em português', () => {
    const used = new Map<string, string>();
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([\w.]+)'/g)) used.set(m[1]!, f);
    }
    expect(used.size).toBeGreaterThan(50); // garante que o regex achou o uso
    const missing = [...used.keys()].filter((k) => !(k in ptBR));
    expect(missing).toEqual([]);
  });

  it('toda chave do português é usada em algum lugar (sem chave morta)', () => {
    const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    // chaves montadas por template literal (ex.: commit.type.${ty}) e por TOOLS (title: 'tools.x')
    const dynamic = [/^commit\.type\./, /^tools\./, /^sw\.ro\./, /^sw\.(scope|group|sg|chip)\./, /^sw\.rp\.why\./, /^sw\.mr\.(state|cut)\./, /^hs\.mode\.hint\./, /^theme\.(system|dark|light)$/, /^font\.(jetbrains|system)$/, /^motion\.(system|reduced|normal)$/, /^sub\.state\./, /^lfs\.state\./, /^commit\.signFormat\./, /^git\.(step|method)\./];
    const unused = Object.keys(ptBR).filter((k) => !all.includes(`'${k}'`) && !dynamic.some((re) => re.test(k)));
    expect(unused).toEqual([]);
  });
});
