// Filtros do Grafo (#294): estado gravado, períodos, chips, favoritos.
import { describe, expect, it } from 'vitest';
import { MAX_FAVORITES, activeChips, deleteFavorite, parseBranchList, parseFavorites, parseGraphFilter, periodOf, removeChip, sameFilter, saveFavorite, withPeriod } from '../src/entrypoints/renderer/graph-filter-core';

describe('filtro gravado', () => {
  it('vazio, torto ou de outro tipo volta ao padrão; o que presta fica, campo a campo', () => {
    for (const bad of [null, undefined, '', '{x', '[1]', '"texto"', '3']) expect(parseGraphFilter(bad)).toEqual({});
    const f = parseGraphFilter(JSON.stringify({ scope: 'all', branches: ['a', 7, ' b '], remotes: true, tags: 'sim', author: '  bia ', since: '7 days ago', order: 'date', lixo: 1 }));
    expect(f).toEqual({ scope: 'all', branches: ['a', 'b'], remotes: true, author: 'bia', since: '7 days ago', order: 'date' });
    expect(parseGraphFilter(JSON.stringify({ scope: 'inventado' }))).toEqual({});
    expect(parseGraphFilter(JSON.stringify({ scope: 'current' }))).toEqual({}); // o padrão não se grava
    expect(parseGraphFilter(JSON.stringify({ author: 'x'.repeat(500) })).author).toHaveLength(200);
  });
});

describe('período', () => {
  it('os prontos preenchem só o "desde"; o intervalo é o que tem datas próprias', () => {
    expect(periodOf({})).toBe('any');
    expect(periodOf(withPeriod({}, '7d'))).toBe('7d');
    expect(periodOf(withPeriod({}, 'today'))).toBe('today');
    expect(periodOf({ since: '2026-01-01' })).toBe('custom');
    expect(periodOf({ since: '7 days ago', until: '2026-02-01' })).toBe('custom');
    expect(withPeriod({ since: '2026-01-01', until: '2026-02-01', author: 'a' }, 'any')).toEqual({ author: 'a' });
    expect(withPeriod({ since: '30 days ago' }, '7d').since).toBe('7 days ago');
    expect(withPeriod({ since: '7 days ago', author: 'a' }, 'custom')).toMatchObject({ author: 'a', since: '7 days ago' }); // abre o intervalo partindo do que havia
    expect(withPeriod({ since: '2026-01-01', until: '2026-02-01' }, 'custom')).toEqual({ since: '2026-01-01', until: '2026-02-01' }); // já era intervalo: não mexe
  });
});

describe('chips', () => {
  it('um chip por filtro ligado, na ordem; o padrão não tem chip; o resumo (simplify) só conta com caminho', () => {
    expect(activeChips({})).toEqual([]);
    expect(activeChips({ scope: 'current', author: ' ' })).toEqual([]);
    expect(activeChips({ scope: 'all', remotes: true, tags: true, author: 'a', since: 'x', path: 'p', noMerges: true, unpublished: true, simplify: true })).toEqual(['scope', 'remotes', 'tags', 'author', 'period', 'path', 'noMerges', 'unpublished', 'simplify']);
    expect(activeChips({ simplify: true })).toEqual([]);
    expect(activeChips({ until: '2026-01-01' })).toEqual(['period']);
  });

  it('remover um chip tira só o filtro dele (escopo leva os branches escolhidos; caminho leva o resumo; período leva as duas datas)', () => {
    const f = { scope: 'chosen' as const, branches: ['a'], author: 'bia', since: 's', until: 'u', path: 'p', simplify: true, noMerges: true };
    expect(removeChip(f, 'scope')).toEqual({ author: 'bia', since: 's', until: 'u', path: 'p', simplify: true, noMerges: true });
    expect(removeChip(f, 'period')).toEqual({ scope: 'chosen', branches: ['a'], author: 'bia', path: 'p', simplify: true, noMerges: true });
    expect(removeChip(f, 'path')).not.toHaveProperty('simplify');
    expect(removeChip(f, 'noMerges')).not.toHaveProperty('noMerges');
    expect(removeChip(f, 'author')).not.toHaveProperty('author');
    expect(f.author).toBe('bia'); // não altera o original
    expect(activeChips(removeChip(removeChip(f, 'scope'), 'author')).length).toBe(activeChips(f).length - 2);
  });

  it('filtros iguais, mesmo com a ordem das chaves trocada ou campo vazio', () => {
    expect(sameFilter({ author: 'a', noMerges: true }, { noMerges: true, author: 'a', path: '  ' })).toBe(true);
    expect(sameFilter({ author: 'a' }, { author: 'b' })).toBe(false);
    expect(sameFilter({}, { scope: 'current' })).toBe(true);
  });

  it('branches escolhidos digitados: vírgula ou espaço, sem repetir', () => {
    expect(parseBranchList('feat/x, v1.0  main,main')).toEqual(['feat/x', 'v1.0', 'main']);
    expect(parseBranchList('  ')).toEqual([]);
  });
});

describe('favoritos', () => {
  it('salva, substitui pelo mesmo nome (o mais recente primeiro), limita e apaga', () => {
    let l = saveFavorite([], 'Meus da semana', { author: 'ana', since: '7 days ago' });
    l = saveFavorite(l, 'Sem merges', { noMerges: true });
    l = saveFavorite(l, 'Meus da semana', { author: 'ana', since: '30 days ago' });
    expect(l.map((f) => f.name)).toEqual(['Meus da semana', 'Sem merges']);
    expect(l[0]!.filter.since).toBe('30 days ago');
    expect(saveFavorite(l, '   ', { tags: true })).toEqual(l); // nome vazio não salva
    expect(deleteFavorite(l, 'Sem merges').map((f) => f.name)).toEqual(['Meus da semana']);
    let many: ReturnType<typeof saveFavorite> = [];
    for (let i = 0; i < MAX_FAVORITES + 5; i++) many = saveFavorite(many, `f${i}`, {});
    expect(many).toHaveLength(MAX_FAVORITES);
    expect(many[0]!.name).toBe(`f${MAX_FAVORITES + 4}`);
  });

  it('o que está gravado é lido com o mesmo cuidado: torto vira lista vazia; item ruim é pulado; nome repetido fica o primeiro', () => {
    expect(parseFavorites('{x')).toEqual([]);
    expect(parseFavorites('{"a":1}')).toEqual([]);
    const l = parseFavorites(JSON.stringify([{ name: 'ok', filter: { author: 'a', scope: 'zzz' } }, 7, { name: '' }, { name: 'ok', filter: {} }, { name: 'sem filtro' }]));
    expect(l).toEqual([{ name: 'ok', filter: { author: 'a' } }, { name: 'sem filtro', filter: {} }]);
  });
});
