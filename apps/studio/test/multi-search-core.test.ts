import { describe, expect, it } from 'vitest';
import type { RepositoryMeta, SearchDone, SearchHit } from '@git-nexus/git-core/pure';
import { ResultModel, hideTarget, isFileHidden, type Hidden } from '../src/entrypoints/renderer/search-window-core';
import {
  aliasOf,
  assignAliases,
  isActive,
  matchRepos,
  newRun,
  ownerOf,
  plainPath,
  pickAll,
  pickOpen,
  pruneIds,
  readSets,
  removeSet,
  runFromDone,
  searchOrder,
  totalsOf,
  upsertSet,
  virtualFile,
  withRepoHeaders,
  type RepoRun,
  type Slot,
} from '../src/entrypoints/renderer/multi-search-core';

const meta = (id: string, name: string, path = `C:\\dev\\${name}`): RepositoryMeta => ({ id, name, path, lastOpenedAt: 0 }) as RepositoryMeta;
const hit = (file: string, line = 1): SearchHit => ({ file, line, text: 'x', ranges: [[0, 1]], before: [], after: [] });
const done = (patch: Partial<SearchDone> = {}): SearchDone => ({ id: 'i', ok: true, dialect: 'fixed', hits: 0, files: 0, skipped: [], cancelled: false, truncated: false, ms: 5, ...patch });

describe('nomes únicos e prefixo virtual', () => {
  const slots = assignAliases([meta('1', 'api'), meta('2', 'web'), meta('3', 'api', 'D:\\outro\\api'), meta('4', 'a/b')]);
  it('repetidos ganham ~2, ~3; nome com barra não quebra o prefixo', () => {
    expect(slots.map((s) => s.alias)).toEqual(['api', 'web', 'api~2', 'a_b']);
  });
  it('marca o repositório do WSL', () => {
    expect(assignAliases([meta('w', 'w', '\\\\wsl$\\Ubuntu\\home\\x\\w')])[0]!.wsl).toBe(true);
    expect(slots[0]!.wsl).toBe(false);
  });
  it('o dono de um arquivo virtual e o caminho dele; arquivo de nome igual em dois repositórios não se confunde', () => {
    const map = new Map(slots.map((s) => [s.alias, s]));
    expect(ownerOf(virtualFile('api', 'src/app.ts'), map)).toMatchObject({ slot: { id: '1' }, rel: 'src/app.ts' });
    expect(ownerOf(virtualFile('api~2', 'src/app.ts'), map)).toMatchObject({ slot: { id: '3' }, rel: 'src/app.ts' });
    expect(ownerOf('desconhecido/x.ts', map)).toBeNull();
    expect(ownerOf('semBarra', map)).toBeNull();
    expect(virtualFile('api', 'a.ts')).not.toBe(virtualFile('api~2', 'a.ts'));
  });
  it('aliasOf e plainPath', () => {
    expect(aliasOf('api/src/a.ts')).toBe('api');
    expect(aliasOf('api')).toBe('api');
    expect(plainPath('api/src/a.ts', true)).toBe('src/a.ts');
    expect(plainPath('api', true)).toBe(''); // a pasta que é o repositório vira a raiz
    expect(plainPath('src/a.ts', false)).toBe('src/a.ts');
  });
});

describe('estado de cada repositório', () => {
  const slot = assignAliases([meta('1', 'api')])[0]!;
  const base = newRun(slot);
  it('começa na fila e termina conforme o worker conta', () => {
    expect(base.state).toBe('queued');
    expect(isActive(base.state)).toBe(true);
    expect(runFromDone(base, done({ hits: 4, files: 2 }))).toMatchObject({ state: 'done', hits: 4, files: 2 });
    expect(runFromDone(base, done({ cancelled: true }))).toMatchObject({ state: 'cancelled' });
    expect(runFromDone(base, done({ ok: false, reason: 'unavailable' }))).toMatchObject({ state: 'unavailable' });
    expect(runFromDone(base, done({ ok: false, reason: 'noGit' }))).toMatchObject({ state: 'noGit' });
    expect(runFromDone(base, done({ ok: false, reason: 'noRevision', message: 'sem a revisão v9' }))).toMatchObject({ state: 'noRevision', message: 'sem a revisão v9' });
    expect(runFromDone(base, done({ ok: false, message: 'ruim' }))).toMatchObject({ state: 'error', message: 'ruim' });
  });
  it('diz quando foi cortado: limite do repositório, global ou tempo', () => {
    expect(runFromDone(base, done({ truncated: true, truncatedReason: 'limit' })).cut).toBe('limit');
    expect(runFromDone(base, done({ truncated: true, truncatedReason: 'limit', reason: 'globalLimit' })).cut).toBe('global');
    expect(runFromDone(base, done({ truncated: true, truncatedReason: 'time' })).cut).toBe('time');
    expect(runFromDone(base, done()).cut).toBeUndefined();
  });
  it('totais para o contador', () => {
    const runs: RepoRun[] = [
      { ...base, state: 'done', hits: 3, cut: 'limit' },
      { ...base, state: 'running', hits: 0 },
      { ...base, state: 'unavailable', hits: 0 },
      { ...base, state: 'noRevision', hits: 0 },
    ];
    expect(totalsOf(runs)).toEqual({ repos: 4, withHits: 1, active: 1, failed: 1, cut: 1 }); // "sem a revisão" não é falha
  });
});

describe('lista com um cabeçalho por repositório', () => {
  const slots = assignAliases([meta('1', 'api'), meta('2', 'web'), meta('3', 'lib')]);
  const runs = new Map<string, RepoRun>(slots.map((s) => [s.alias, { ...newRun(s), state: 'done' as const }]));
  const model = new ResultModel();
  // os lotes chegam misturados, pois os repositórios correm juntos
  model.add([hit('web/a.ts', 1), hit('api/a.ts', 1), hit('web/a.ts', 5), hit('api/b/c.ts', 2), hit('web/z.ts', 3)]);

  it('junta por repositório, na ordem pedida, e cada cabeçalho conta as ocorrências e os arquivos', () => {
    const rows = withRepoHeaders(model.rows({ group: 'file' }), slots, runs, new Set());
    const heads = rows.filter((r) => r.kind === 'repo');
    expect(heads.map((h) => [h.kind === 'repo' && h.alias, h.kind === 'repo' && h.count, h.kind === 'repo' && h.files])).toEqual([['api', 2, 2], ['web', 3, 2], ['lib', 0, 0]]);
    // as linhas de cada repositório ficam logo abaixo do cabeçalho dele
    const order = rows.map((r) => (r.kind === 'repo' ? `[${r.alias}]` : r.kind === 'file' ? r.file : r.kind === 'hit' ? `h:${r.file}:${r.hit.line}` : r.kind));
    expect(order).toEqual(['[api]', 'api/a.ts', 'h:api/a.ts:1', 'api/b/c.ts', 'h:api/b/c.ts:2', '[web]', 'web/a.ts', 'h:web/a.ts:1', 'h:web/a.ts:5', 'web/z.ts', 'h:web/z.ts:3', '[lib]']);
  });
  it('recolher o repositório esconde o que tem dentro, mas o cabeçalho continua contando', () => {
    const rows = withRepoHeaders(model.rows({ group: 'file' }), slots, runs, new Set(['web']));
    expect(rows.some((r) => r.kind !== 'repo' && 'file' in r && r.file.startsWith('web/'))).toBe(false);
    expect(rows.find((r) => r.kind === 'repo' && r.alias === 'web')).toMatchObject({ collapsed: true, count: 3 });
  });
  it('arquivo recolhido não zera a contagem do repositório; agrupar por pasta e lista plana também funcionam', () => {
    const closed = new Set(['f:web/a.ts']);
    const r1 = withRepoHeaders(model.rows({ group: 'file', collapsed: closed }), slots, runs, new Set());
    expect(r1.find((r) => r.kind === 'repo' && r.alias === 'web')).toMatchObject({ count: 3, files: 2 });
    const r2 = withRepoHeaders(model.rows({ group: 'folder' }), slots, runs, new Set());
    expect(r2.find((r) => r.kind === 'repo' && r.alias === 'api')).toMatchObject({ count: 2 });
    const r3 = withRepoHeaders(model.rows({ group: 'flat' }), slots, runs, new Set());
    expect(r3.find((r) => r.kind === 'repo' && r.alias === 'web')).toMatchObject({ count: 3, files: 2 });
  });
  it('o estado e o motivo vão no cabeçalho (repositório sem ocorrência também aparece)', () => {
    const r = new Map(runs);
    r.set('lib', { ...newRun(slots[2]!), state: 'unavailable', message: 'sumiu' });
    const head = withRepoHeaders([], slots, r, new Set()).find((x) => x.kind === 'repo' && x.alias === 'lib');
    expect(head).toMatchObject({ state: 'unavailable', message: 'sumiu', count: 0 });
  });
  it('ocultar o repositório (a "pasta" dele) tira tudo o que é dele e só dele', () => {
    const head = withRepoHeaders([], slots, runs, new Set()).find((x) => x.kind === 'repo' && x.alias === 'api')!;
    const target = hideTarget(head, 'dir')!;
    expect(target).toEqual({ kind: 'dir', key: 'api' });
    const hidden: Hidden = { hits: new Set(), files: new Set(), dirs: new Set([target.key]) };
    expect(isFileHidden('api/a.ts', hidden)).toBe(true);
    expect(isFileHidden('api/b/c.ts', hidden)).toBe(true);
    expect(isFileHidden('web/a.ts', hidden)).toBe(false);
    expect(hideTarget(head, 'hit')).toBeNull();
  });
});

describe('escolher onde: seleção, atalhos e conjuntos salvos', () => {
  const catalog = [meta('1', 'api'), meta('2', 'web'), meta('3', 'lib')];
  it('Todos, Abertos nas abas e a limpeza dos ids que saíram do catálogo', () => {
    expect(pickAll(catalog)).toEqual(['1', '2', '3']);
    expect(pickOpen(catalog, ['3', 'x', '1', '3'])).toEqual(['3', '1']);
    expect(pruneIds(['2', 'fora', '2', '1'], catalog)).toEqual(['2', '1']);
  });
  it('o repositório da aba ativa vai primeiro', () => {
    expect(searchOrder(['1', '2', '3'], '3')).toEqual(['3', '1', '2']);
    expect(searchOrder(['1', '2'], 'x')).toEqual(['1', '2']);
    expect(searchOrder(['1', '1', '2'], '1')).toEqual(['1', '2']);
  });
  it('conjuntos: salvar, trocar pelo nome (sem diferenciar caixa), remover, e ler lixo sem quebrar', () => {
    let sets = upsertSet([], 'Backend', ['1', '3']);
    sets = upsertSet(sets, 'Front', ['2']);
    sets = upsertSet(sets, 'backend', ['3']);
    expect(sets).toEqual([{ name: 'Front', ids: ['2'] }, { name: 'backend', ids: ['3'] }]);
    expect(removeSet(sets, 'Front')).toEqual([{ name: 'backend', ids: ['3'] }]);
    expect(upsertSet(sets, '   ', ['1'])).toEqual(sets);
    expect(readSets([{ name: ' A ', ids: ['1', 2, null] }, { name: 'a', ids: [] }, { ids: ['1'] }, 7, null])).toEqual([{ name: 'A', ids: ['1'] }]);
    expect(readSets('lixo')).toEqual([]);
  });
  it('o filtro do seletor acha por nome ou caminho, sem acento nem caixa', () => {
    const list = [meta('1', 'Serviço', 'C:\\x\\servico'), meta('2', 'web', 'C:\\dev\\front')];
    expect(matchRepos(list, 'SERVICO').map((r) => r.id)).toEqual(['1']);
    expect(matchRepos(list, 'dev\\fr').map((r) => r.id)).toEqual(['2']);
    expect(matchRepos(list, '  ')).toHaveLength(2);
  });
});

describe('o prefixo virtual não vaza para o disco', () => {
  it('um caminho com ".." no meio continua preso ao repositório dono (a validação do dono é quem recusa)', () => {
    const slot: Slot = assignAliases([meta('1', 'api')])[0]!;
    const o = ownerOf(virtualFile('api', '../outro/segredo.txt'), new Map([['api', slot]]))!;
    expect(o.slot.id).toBe('1');
    expect(o.rel).toBe('../outro/segredo.txt'); // vai como está para readWorkingFile/saveWorkingFile, que recusam sair da raiz
  });
});
