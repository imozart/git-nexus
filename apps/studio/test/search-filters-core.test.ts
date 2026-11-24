import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  HISTORY_MAX,
  applySuggestion,
  buildQuery,
  changedFilters,
  emptySuggestions,
  entryOf,
  historyMatching,
  needsRevision,
  pushHistory,
  readFilters,
  readHistory,
  regexErrorAt,
  skippedCounts,
  type QueryPrefs,
} from '../src/entrypoints/renderer/search-filters-core';

const prefs = (p: Partial<QueryPrefs> = {}): QueryPrefs => ({ pattern: 'foo', regex: false, caseSensitive: false, wholeWord: false, include: '', ...DEFAULT_FILTERS, ...p });

describe('filtros viram o pedido do núcleo', () => {
  it('o padrão só diz o texto, as opções e o escopo (sem pasta, sem máscara, sem revisão)', () => {
    const q = buildQuery(prefs());
    expect(q).toMatchObject({ pattern: 'foo', scope: 'worktree', includeIgnored: false, includeUntracked: true, includeSubmodules: false, contextBefore: 0, contextAfter: 0 });
    expect(q).not.toHaveProperty('revision');
    expect(q).not.toHaveProperty('folder');
    expect(q).not.toHaveProperty('include');
  });

  it('revisão só vai quando o escopo é a revisão; pasta e máscara vão limpas; contexto vale dos dois lados', () => {
    expect(buildQuery(prefs({ scope: 'changed', revision: 'main' }))).not.toHaveProperty('revision');
    expect(buildQuery(prefs({ scope: 'revision', revision: ' v1.2 ' }))).toMatchObject({ scope: 'revision', revision: 'v1.2' });
    expect(buildQuery(prefs({ folder: './src/', include: ' *.ts, !dist/ ', context: 3 }))).toMatchObject({ folder: 'src', include: '*.ts, !dist/', contextBefore: 3, contextAfter: 3 });
    expect(buildQuery(prefs(), { limit: 100, offset: 200 })).toMatchObject({ limit: 100, offset: 200 });
  });

  it('revisão sem nome ainda não pode pesquisar', () => {
    expect(needsRevision({ scope: 'revision', revision: '  ' })).toBe(true);
    expect(needsRevision({ scope: 'revision', revision: 'main' })).toBe(false);
    expect(needsRevision({ scope: 'staged', revision: '' })).toBe(false);
  });

  it('lê filtros guardados: só valores válidos, o resto volta ao padrão', () => {
    expect(readFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(readFilters({ scope: 'lixo', context: 99, group: 'x', includeIgnored: 'sim', folder: 7 })).toEqual({ ...DEFAULT_FILTERS, context: 5 });
    expect(readFilters({ scope: 'staged', context: 2.7, group: 'folder', includeUntracked: false, includeSubmodules: true, folder: 'src' })).toMatchObject({ scope: 'staged', context: 2, group: 'folder', includeUntracked: false, includeSubmodules: true, folder: 'src' });
  });

  it('lista os filtros fora do padrão, na ordem', () => {
    expect(changedFilters(DEFAULT_FILTERS)).toEqual([]);
    expect(changedFilters({ ...DEFAULT_FILTERS, scope: 'changed', folder: 'src', includeIgnored: true, includeUntracked: false, includeSubmodules: true, context: 2, group: 'flat' })).toEqual(['scope', 'folder', 'ignored', 'untracked', 'submodules', 'context', 'group']);
  });
});

describe('histórico de pesquisas', () => {
  it('a mais recente primeiro; a repetida sobe sem duplicar; as opções contam como outra pesquisa', () => {
    let h = pushHistory([], entryOf(prefs({ pattern: 'a' })));
    h = pushHistory(h, entryOf(prefs({ pattern: 'b' })));
    h = pushHistory(h, entryOf(prefs({ pattern: 'a' })));
    expect(h.map((e) => e.pattern)).toEqual(['a', 'b']);
    h = pushHistory(h, entryOf(prefs({ pattern: 'a', caseSensitive: true })));
    expect(h.map((e) => e.pattern)).toEqual(['a', 'a', 'b']);
  });

  it('guarda as últimas 30 e não guarda texto vazio', () => {
    let h: ReturnType<typeof pushHistory> = [];
    for (let i = 0; i < 40; i++) h = pushHistory(h, entryOf(prefs({ pattern: 'p' + i })));
    expect(h).toHaveLength(HISTORY_MAX);
    expect(h[0]!.pattern).toBe('p39');
    expect(h[29]!.pattern).toBe('p10');
    expect(pushHistory(h, entryOf(prefs({ pattern: '   ' })))).toEqual(h);
  });

  it('a entrada leva tudo que refaz a pesquisa (máscara, onde, pasta); a revisão só no escopo revisão', () => {
    const e = entryOf(prefs({ pattern: 'x', regex: true, include: ' *.ts ', scope: 'revision', revision: ' main ', folder: ' src ' }));
    expect(e).toEqual({ pattern: 'x', regex: true, caseSensitive: false, wholeWord: false, include: '*.ts', scope: 'revision', revision: 'main', folder: 'src' });
    expect(entryOf(prefs({ scope: 'staged', revision: 'main' })).revision).toBe('');
  });

  it('lê o guardado ignorando lixo, e filtra pelo que foi digitado', () => {
    const raw = [{ pattern: 'ok', regex: true }, { pattern: '' }, 3, null, { pattern: 'Outro', scope: 'xx' }];
    const h = readHistory(raw);
    expect(h.map((e) => e.pattern)).toEqual(['ok', 'Outro']);
    expect(h[1]!.scope).toBe('worktree');
    expect(readHistory('nada')).toEqual([]);
    expect(historyMatching(h, 'OU').map((e) => e.pattern)).toEqual(['Outro']);
    expect(historyMatching(h, '  ')).toHaveLength(2);
  });
});

describe('mensagens', () => {
  it('diz onde a expressão regular quebra', () => {
    expect(regexErrorAt('(abc')).toBe(0);
    expect(regexErrorAt('ab(c(d)')).toBe(2);
    expect(regexErrorAt('abc)')).toBe(3);
    expect(regexErrorAt('x[abc')).toBe(1);
    expect(regexErrorAt('*abc')).toBe(0);
    expect(regexErrorAt('a|+b')).toBe(2);
    expect(regexErrorAt('(?i)abc')).toBeNull();
    expect(regexErrorAt('a\\(b')).toBeNull();
    expect(regexErrorAt('[(]x')).toBeNull();
    expect(regexErrorAt('a+?b*')).toBeNull();
  });

  it('conta o que ficou de fora por motivo', () => {
    expect(skippedCounts([{ file: 'a', reason: 'binary' }, { file: 'b', reason: 'binary' }, { file: 'c', reason: 'large' }])).toEqual({ binary: 2, large: 1 });
    expect(skippedCounts([])).toEqual({ binary: 0, large: 0 });
  });

  it('sugere só o que está apertando a busca, e a sugestão desfaz exatamente isso', () => {
    expect(emptySuggestions(prefs())).toEqual(['ignored']);
    const tight = prefs({ caseSensitive: true, wholeWord: true, regex: true, include: '*.ts', folder: 'src', scope: 'changed' });
    expect(emptySuggestions(tight)).toEqual(['case', 'word', 'regex', 'mask']);
    expect(emptySuggestions(prefs({ scope: 'staged' }))).toEqual(['scope']);
    expect(emptySuggestions(prefs({ includeUntracked: false, includeIgnored: true }))).toEqual(['untracked']);
    expect(applySuggestion('case')).toEqual({ caseSensitive: false });
    expect(applySuggestion('scope')).toEqual({ scope: 'worktree', revision: '' });
    expect(applySuggestion('ignored')).toEqual({ includeIgnored: true });
  });
});
