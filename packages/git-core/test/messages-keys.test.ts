import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatMessage, messageDictionaries, pluralForms, setMessageLocale, tm, tmKey, type MessageKey } from '../src/messages';
import ptBR from '../src/messages/pt-BR';

// Mensagens do núcleo POR CHAVE (messages/<id>.ts), com as mesmas garantias do renderer: chave usada existe, sem chave morta, variáveis e plural iguais ao
// original, sem tradução vazia. E uma trava de migração: `tm(português, english)` (forma antiga, depreciada) não ganha chamada nova.
const root = join(__dirname, '..', '..', '..');
const SCAN = ['packages/git-core/src', 'packages/governance-policy/src', 'apps/studio/src'];
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' || e.name === 'dist' ? [] : e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|vue)$/.test(e.name) ? [join(dir, e.name)] : []));
}
const files = SCAN.flatMap((d) => walk(join(root, d))).filter((f) => !/[\\/]renderer[\\/]/.test(f) && !/git-core[\\/]src[\\/]messages\.ts$/.test(f));
const rel = (f: string) => relative(root, f).replace(/\\/g, '/');
const stripComments = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
const CALL = /\btm\(\s*(?:'((?:[^'\\]|\\.)*)'|`([^`]*)`|"((?:[^"\\]|\\.)*)")/g;

const used = new Map<string, string[]>(); // chave -> arquivos
const oldStyle: Record<string, number> = {};
for (const f of files) {
  const text = stripComments(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
  for (const m of text.matchAll(CALL)) {
    const lit = m[1] ?? m[2] ?? m[3]!;
    if (KEY.test(lit)) used.set(lit, [...(used.get(lit) ?? []), rel(f)]);
    else oldStyle[rel(f)] = (oldStyle[rel(f)] ?? 0) + 1;
  }
}

describe('mensagens do núcleo por chave', () => {
  it('toda chave usada em tm("area.chave") existe no português (a fonte da verdade)', () => {
    for (const [key, where] of used) expect(Object.keys(ptBR), `${key} (usada em ${where[0]})`).toContain(key);
  });

  it('não há chave morta: toda chave do português é usada em algum tm(...)', () => {
    for (const key of Object.keys(ptBR)) expect([...used.keys()], `chave morta: ${key}`).toContain(key);
  });

  it('cada tradução tem texto, só chaves que o português tem, as mesmas {variáveis} e formas de plural suficientes', () => {
    const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
    for (const [id, dict] of Object.entries(messageDictionaries)) {
      for (const [key, text] of Object.entries(dict)) {
        const pt = (ptBR as Record<string, string>)[key];
        expect(pt, `${id}: ${key} não existe no português`).toBeDefined();
        expect(text!.trim(), `${id}: ${key} vazia`).not.toBe('');
        expect(vars(text!), `${id}: ${key}`).toEqual(vars(pt!));
        if (pt!.includes('|')) expect(text!.split('|').length, `${id}: ${key} precisa de ${pluralForms(id).length} formas`).toBeGreaterThanOrEqual(pluralForms(id).length);
      }
    }
  });

  it('tm por chave segue o idioma, cai no português quando falta a chave e devolve a chave se ela não existe', () => {
    setMessageLocale('pt-BR');
    expect(tm('lfs.notUsed')).toBe('Este repositório não usa Git LFS.');
    expect(tm('lfs.downloaded', { pointers: 3 })).toBe('Baixado. Ainda como ponteiro: 3.');
    setMessageLocale('en');
    expect(tm('lfs.notUsed')).toBe('This repository does not use Git LFS.');
    expect(tm('lfs.downloaded', { pointers: 3 })).toBe('Downloaded. Still pointers: 3.');
    expect(tmKey('lfs.notUsed', undefined, 'xx')).toBe('Este repositório não usa Git LFS.'); // idioma sem dicionário: português
    expect(tm('nao.existe' as MessageKey)).toBe('nao.existe');
    setMessageLocale('pt-BR');
  });

  it('formatMessage aplica variáveis e a forma de plural do idioma', () => {
    expect(formatMessage('um arquivo|{n} arquivos', 'pt-BR', { n: 1 })).toBe('um arquivo');
    expect(formatMessage('um arquivo|{n} arquivos', 'pt-BR', { n: 4 })).toBe('4 arquivos');
    expect(formatMessage('Olá {nome}', 'en', { nome: 'Ana' })).toBe('Olá Ana');
    expect(formatMessage('Olá {nome}', 'en', {})).toBe('Olá {nome}');
  });

  it('o idioma do núcleo resolve variantes (en-GB → en) e cai no português para o que não existe', () => {
    setMessageLocale('en-GB');
    expect(tm('search.failed')).toBe('The search failed.');
    setMessageLocale('fr');
    expect(tm('search.failed')).toBe('A busca falhou.');
    setMessageLocale('pt-BR');
  });
});

describe('migração de tm(pt, en) para chave (a lista só encolhe)', () => {
  // Chamadas na forma ANTIGA, por arquivo. Cada PR de migração leva um módulo para chave e baixa o número aqui; novo `tm('texto', 'text')` falha.
  const OLD: Record<string, number> = {
    'packages/git-core/src/askpass-pure.ts': 4,
    'packages/git-core/src/branches.ts': 73,
    'packages/git-core/src/clone-pure.ts': 5,
    'packages/git-core/src/clone.ts': 8,
    'packages/git-core/src/commit-ops.ts': 17,
    'packages/git-core/src/commit.ts': 5,
    'packages/git-core/src/encoding.ts': 1,
    'packages/git-core/src/history-tools.ts': 3,
    'packages/git-core/src/operations.ts': 9,
    'packages/git-core/src/paths.ts': 1,
    'packages/git-core/src/rebase.ts': 20,
    'packages/git-core/src/repo-status.ts': 1,
    'packages/git-core/src/secrets.ts': 1,
    'packages/git-core/src/staging.ts': 3,
    'packages/git-core/src/stash.ts': 12,
    'packages/git-core/src/submodules.ts': 12,
    'packages/git-core/src/tags.ts': 23,
    'packages/governance-policy/src/index.ts': 25,
    'apps/studio/src/entrypoints/main.ts': 14,
    'apps/studio/src/worker/hosting-service.ts': 21,
    'apps/studio/src/worker/release.ts': 4,
  };

  it('nenhum arquivo ganha tm(português, english) novo: use uma chave em messages/pt-BR.ts e en.ts', () => {
    for (const [file, n] of Object.entries(oldStyle)) {
      expect(n, `${file}: ${n} tm(pt, en), permitido ${OLD[file] ?? 0}. Use tm('area.chave') com o texto em messages/pt-BR.ts e en.ts.`).toBeLessThanOrEqual(OLD[file] ?? 0);
    }
  });

  it('a lista não fica velha: quem migrou tem o número abaixado (ou a linha removida)', () => {
    for (const [file, n] of Object.entries(OLD)) expect(oldStyle[file] ?? 0, `${file} tem ${oldStyle[file] ?? 0} chamadas antigas, a lista diz ${n}: ajuste`).toBe(n);
  });
});
