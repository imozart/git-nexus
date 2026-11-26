import { describe, expect, it } from 'vitest';
import type { RepoSummary, RepositoryMeta } from '@git-nexus/git-core/pure';
import { DEFAULT_HOME_PREFS, filterRepos, needsAttention, nextSort, parseHomePrefs, sortRepos, type HomeSummaries } from '../src/entrypoints/renderer/home-core';

const meta = (id: string, name: string, lastOpenedAt = 0): RepositoryMeta => ({ id, name, path: `C:\\r\\${name}`, lastOpenedAt, isWsl: false }) as RepositoryMeta;
const sum = (o: Partial<RepoSummary> = {}): RepoSummary => ({
  branch: 'main', detached: false, upstream: 'origin/main', gone: false, lastFetch: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, lastCommit: null, stash: 0, ...o,
});
const at = (d: number) => ({ subject: 's', author: 'a', date: d });

const repos = [meta('1', 'zeta', 10), meta('2', 'Alfa', 30), meta('3', 'beta', 20), meta('4', 'gama', 5), meta('5', 'delta', 40)];
const sums: HomeSummaries = {
  '1': sum({ behind: 5, lastCommit: at(100) }),
  '2': sum({ unstaged: 2, untracked: 3, branch: 'feat/x', lastCommit: at(300) }),
  '3': sum({ upstream: null, lastCommit: at(200) }),
  '4': { error: 'não é um repositório' },
  // '5': ainda carregando
};
const ids = (l: RepositoryMeta[]) => l.map((r) => r.id).join('');

describe('ordenar a lista da tela inicial', () => {
  it('por última abertura, nome (sem diferenciar maiúscula), alterações, atraso e atividade', () => {
    expect(ids(sortRepos(repos, sums, 'opened', 'desc'))).toBe('52314');
    expect(ids(sortRepos(repos, sums, 'name', 'asc'))).toBe('23541'); // Alfa, beta, delta, gama, zeta
    expect(ids(sortRepos(repos, sums, 'name', 'desc'))).toBe('14532');
    expect(ids(sortRepos(repos, { ...sums, '5': sum({ unstaged: 1 }) }, 'changes', 'desc')).startsWith('25')).toBe(true); // 5 alterações, depois 1
    expect(ids(sortRepos(repos, sums, 'behind', 'desc')).startsWith('1')).toBe(true);
    expect(ids(sortRepos(repos, sums, 'activity', 'desc')).slice(0, 3)).toBe('231');
    expect(ids(sortRepos(repos, sums, 'branch', 'asc')).slice(0, 2)).toBe('23'); // feat/x antes de main (empate de main: pelo nome)
  });

  it('quem ainda não tem dado (carregando ou com erro) vai sempre para o fim, em qualquer direção', () => {
    for (const dir of ['asc', 'desc'] as const) {
      for (const s of ['changes', 'behind', 'activity', 'branch'] as const) expect(ids(sortRepos(repos, sums, s, dir)).slice(-2)).toBe('54'); // empate: pelo nome (delta, gama)
    }
  });

  it('é estável (empate desempata pelo nome) e não altera a lista recebida', () => {
    const copia = [...repos];
    const a = sortRepos(repos, sums, 'behind', 'asc');
    expect(repos).toEqual(copia);
    expect(ids(a)).toBe(ids(sortRepos([...repos].reverse(), sums, 'behind', 'asc')));
  });

  it('clicar no cabeçalho: a mesma coluna inverte, outra começa na direção natural', () => {
    expect(nextSort({ sort: 'name', dir: 'asc' }, 'name')).toEqual({ sort: 'name', dir: 'desc' });
    expect(nextSort({ sort: 'name', dir: 'desc' }, 'name')).toEqual({ sort: 'name', dir: 'asc' });
    expect(nextSort({ sort: 'name', dir: 'asc' }, 'changes')).toEqual({ sort: 'changes', dir: 'desc' });
    expect(nextSort({ sort: 'changes', dir: 'desc' }, 'branch')).toEqual({ sort: 'branch', dir: 'asc' });
  });
});

describe('filtrar a lista da tela inicial', () => {
  it('sem filtro e sem busca, devolve todos', () => expect(filterRepos(repos, sums, [], '')).toEqual(repos));

  it('"só com pendências" mantém o comportamento de antes: alterações, à frente/atrás, branch apagada, e quem ainda não se sabe', () => {
    expect(ids(filterRepos(repos, sums, ['pending'], ''))).toBe('1245'); // 3 está limpo e em dia
    expect(needsAttention(sum())).toBe(false);
    expect(needsAttention(sum({ gone: true }))).toBe(true);
    expect(needsAttention(sum({ ahead: 1 }))).toBe(true);
    expect(needsAttention(undefined)).toBe(true);
  });

  it('"atrás do remoto", "sem upstream" e "com conflito" exigem o resumo', () => {
    expect(ids(filterRepos(repos, sums, ['behind'], ''))).toBe('1');
    expect(ids(filterRepos(repos, sums, ['no-upstream'], ''))).toBe('3');
    expect(ids(filterRepos(repos, { ...sums, '2': sum({ conflicted: 1 }) }, ['conflict'], ''))).toBe('2');
    expect(ids(filterRepos([meta('9', 'x')], {}, ['behind'], ''))).toBe(''); // sem resumo: não dá para afirmar
    expect(ids(filterRepos([meta('9', 'x')], { '9': sum({ detached: true, upstream: null }) }, ['no-upstream'], ''))).toBe(''); // HEAD solto não é "sem upstream"
  });

  it('vários filtros valem juntos e a busca olha nome e caminho', () => {
    expect(ids(filterRepos(repos, sums, ['pending', 'behind'], ''))).toBe('1');
    expect(ids(filterRepos(repos, sums, [], 'ALF'))).toBe('2');
    expect(ids(filterRepos(repos, sums, [], 'c:\\r\\gama'))).toBe('4');
    expect(ids(filterRepos(repos, sums, ['behind'], 'alfa'))).toBe('');
  });
});

describe('preferências lembradas', () => {
  it('lê o salvo; valor torto, desconhecido ou ausente volta ao padrão, campo por campo', () => {
    expect(parseHomePrefs(null)).toEqual(DEFAULT_HOME_PREFS);
    expect(parseHomePrefs('{não é json')).toEqual(DEFAULT_HOME_PREFS);
    expect(parseHomePrefs('[1,2]')).toEqual(DEFAULT_HOME_PREFS);
    expect(parseHomePrefs(JSON.stringify({ sort: 'behind', dir: 'asc', density: 'table', filters: ['conflict', 'pending', 'inventado'] }))).toEqual({ sort: 'behind', dir: 'asc', density: 'table', filters: ['pending', 'conflict'] });
    expect(parseHomePrefs(JSON.stringify({ sort: 'inventado', density: 'gigante', dir: 'x', filters: 'pending' }))).toEqual(DEFAULT_HOME_PREFS);
    expect(parseHomePrefs(JSON.stringify({ sort: 'name' })).dir).toBe('asc'); // sem direção salva: a natural da coluna
  });
});
