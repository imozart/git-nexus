import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX, filterOptions, labelOf, optionOf, scoreMatch } from '../src/entrypoints/renderer/combo-core';

describe('scoreMatch', () => {
  it('ordena: começa com < nome do arquivo começa com < contém < letras salteadas < não casa', () => {
    expect(scoreMatch('src/app.ts', 'src')).toBe(0);
    expect(scoreMatch('src/app.ts', 'app')).toBe(1);
    expect(scoreMatch('src/miapp.ts', 'app')).toBe(2);
    expect(scoreMatch('src/application.ts', 'apn')).toBe(3);
    expect(scoreMatch('src/app.ts', 'zzz')).toBe(-1);
  });

  it('ignora maiúsculas e aceita barra invertida do Windows', () => {
    expect(scoreMatch('SRC/App.TS', 'src')).toBe(0);
    expect(scoreMatch('src\\App.ts', 'app')).toBe(1);
  });
});

describe('filterOptions', () => {
  const files = ['README.md', 'src/app.ts', 'src/App.vue', 'docs/app-guide.md', 'src/lib/util.ts', 'test/app.test.ts'];

  it('busca vazia devolve as primeiras, com o total', () => {
    const r = filterOptions(files, '', 3);
    expect(r.items.map((o) => o.value)).toEqual(['README.md', 'src/app.ts', 'src/App.vue']);
    expect(r).toMatchObject({ total: 6, hidden: 3 });
  });

  it('os melhores casamentos vêm primeiro e a ordem original vale dentro da faixa', () => {
    const r = filterOptions(files, 'app');
    // todos têm o NOME começando com "app" (faixa 1): mantém a ordem original
    expect(r.items.map((o) => o.value)).toEqual(['src/app.ts', 'src/App.vue', 'docs/app-guide.md', 'test/app.test.ts']);
    expect(r.total).toBe(4);
    expect(filterOptions(files, 'src').items[0]!.value).toBe('src/app.ts');
    // "contém" (faixa 2) vem depois de "nome começa com" (faixa 1)
    expect(filterOptions(['x/miapp.ts', 'x/app.ts'], 'app').items.map((o) => o.value)).toEqual(['x/app.ts', 'x/miapp.ts']);
  });

  it('respeita o limite e informa quantos ficaram de fora', () => {
    const r = filterOptions(files, 'a', 2);
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(r.items.length + r.hidden);
    expect(r.hidden).toBeGreaterThan(0);
  });

  it('nada encontrado', () => {
    expect(filterOptions(files, 'xyzxyz')).toEqual({ items: [], total: 0, hidden: 0 });
  });

  it('opções com rótulo: casa pelo rótulo ou pelo valor', () => {
    const opts = [{ value: 'pt-BR', label: 'Português' }, { value: 'en', label: 'English' }];
    expect(filterOptions(opts, 'port').items.map((o) => o.value)).toEqual(['pt-BR']);
    expect(filterOptions(opts, 'en').items.map((o) => o.value)).toEqual(['en']);
    expect(labelOf(optionOf('x'))).toBe('x');
    expect(labelOf(opts[0]!)).toBe('Português');
  });

  it('aguenta dezenas de milhares de arquivos: poucos itens e rápido', () => {
    const many = Array.from({ length: 60_000 }, (_, i) => `pkg${i % 300}/src/Componente${i}.ts`);
    const t0 = performance.now();
    const r = filterOptions(many, 'componente5');
    const ms = performance.now() - t0;
    expect(r.items.length).toBeLessThanOrEqual(DEFAULT_MAX);
    expect(r.total).toBeGreaterThan(r.items.length);
    expect(ms).toBeLessThan(1000); // folga enorme: a medição real é de dezenas de ms
  });
});
