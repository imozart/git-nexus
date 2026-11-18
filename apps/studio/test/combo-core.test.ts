import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX, filterOptions, groupHeaderAt, labelOf, optionOf, scoreMatch, sortByGroup } from '../src/entrypoints/renderer/combo-core';

describe('grupos de opções', () => {
  const opts = [
    { value: 'latest', label: 'Mais recente' },
    { value: 'head', label: 'Branch atual' },
    { value: 'local:main', label: 'main', group: 'Local' },
    { value: 'local:feat/a', label: 'feat/a', group: 'Local' },
    { value: 'remote:origin/main', label: 'origin/main', group: 'Remoto' },
  ];

  it('groupHeaderAt mostra o título só antes do primeiro item de cada grupo e nunca para os sem grupo', () => {
    const items = opts.map(optionOf);
    expect(items.map((_, i) => groupHeaderAt(items, i))).toEqual(['', '', 'Local', '', 'Remoto']);
    expect(groupHeaderAt(items, 99)).toBe('');
  });

  it('sortByGroup devolve os grupos juntos na ordem original, sem grupo primeiro, e mantém a ordem do filtro dentro de cada grupo', () => {
    // um filtro por relevância embaralha: o remoto veio antes de um local e o sem grupo no meio
    const shuffled = [opts[4]!, opts[2]!, opts[0]!, opts[3]!].map(optionOf);
    expect(sortByGroup(opts, shuffled).map((o) => o.value)).toEqual(['latest', 'local:main', 'local:feat/a', 'remote:origin/main']);
  });

  it('sortByGroup não perde nem repete opções e aceita lista sem grupos', () => {
    const plain = ['a', 'b', 'c'];
    expect(sortByGroup(plain, plain.map(optionOf)).map((o) => o.value)).toEqual(['a', 'b', 'c']);
    expect(sortByGroup(opts, []).length).toBe(0);
  });

  it('o filtro com grupos: só o que casa, e os grupos voltam juntos depois do sortByGroup', () => {
    const r = filterOptions(opts, 'main');
    const grouped = sortByGroup(opts, r.items);
    // "Mais recente" também casa (letras na ordem): o sem grupo vem primeiro, depois Local e Remoto
    expect(grouped.map((o) => o.value)).toEqual(['latest', 'local:main', 'remote:origin/main']);
    expect(grouped.map((o, i) => groupHeaderAt(grouped, i))).toEqual(['', 'Local', 'Remoto']);
  });
});

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
