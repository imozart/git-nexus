// Filtros do Grafo (#294) contra o Git de verdade, com oráculos que NÃO repetem a tradução do filtro: cada resultado é conferido por outro caminho do Git (rev-list, %an, contagem
// de pais, ^origin/main) ou por uma propriedade (todos os autores são o pedido). Repositório com merges, três autores, uma branch ainda não mesclada, tags, remoto e uma renomeação.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { activeFilterCount, buildLogArgs, filterBreaksGraph, getAuthors, getHistory, getHistoryCount, isDefaultFilter, type CommitInfo, type HistoryFilter } from '../src/index.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

let root: string;
let R: string;
const sh = (...a: string[]) => execFileSync('git', a, { cwd: R, encoding: 'utf8' }).trim();
const days = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
let n = 0;
function commit(who: string, msg: string, file: string, date: string): void {
  mkdirSync(join(R, file, '..'), { recursive: true });
  writeFileSync(join(R, file), `${++n}\n`);
  sh('add', '.');
  const email = `${who.toLowerCase()}@e.com`;
  execFileSync('git', ['commit', '-qm', msg], { cwd: R, env: { ...process.env, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}
const ids = (l: CommitInfo[]) => l.map((c) => c.hash);
const log = (f?: HistoryFilter) => getHistory(R, 1000, 0, f);
const rl = (...a: string[]) => sh('rev-list', ...a).split('\n').filter(Boolean);
const names = async (f?: HistoryFilter) => (await log(f)).map((c) => c.subject);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-filtros-'));
  const bare = join(root, 'o.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  R = join(root, 'r');
  execFileSync('git', ['init', '-q', '-b', 'main', R]);
  for (const [k, v] of [['commit.gpgsign', 'false'], ['core.fsmonitor', 'false'], ['core.autocrlf', 'false'], ['user.name', 'Ana'], ['user.email', 'ana@e.com']]) sh('config', k!, v!);
  sh('remote', 'add', 'origin', bare);
  commit('Ana', 'c1 raiz', 'src/a.txt', days(60));
  sh('tag', 'v1');
  commit('Bia', 'c2 docs', 'docs/b.txt', days(50));
  sh('checkout', '-qb', 'feat');
  commit('Caio', 'c3 feat um', 'src/f1.txt', days(40));
  commit('Caio', 'c4 feat dois', 'src/f2.txt', days(39));
  sh('checkout', '-q', 'main');
  commit('Bia', 'c5 main', 'docs/c.txt', days(30));
  execFileSync('git', ['merge', '--no-ff', '-m', 'c6 merge feat', 'feat'], { cwd: R, env: { ...process.env, GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'ana@e.com', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'ana@e.com', GIT_AUTHOR_DATE: days(29), GIT_COMMITTER_DATE: days(29) } });
  renameSync(join(R, 'src/a.txt'), join(R, 'src/z.txt'));
  sh('add', '-A');
  execFileSync('git', ['commit', '-qm', 'c7 renomeia a para z'], { cwd: R, env: { ...process.env, GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'ana@e.com', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'ana@e.com', GIT_AUTHOR_DATE: days(20), GIT_COMMITTER_DATE: days(20) } });
  sh('push', '-qu', 'origin', 'main'); // até aqui publicado
  sh('checkout', '-qb', 'outra');
  commit('Dani', 'c8 outra branch', 'docs/o.txt', days(10));
  sh('checkout', '-q', 'main');
  commit('Bia', 'c9 local um', 'src/z.txt', days(2));
  commit('Ana', 'c10 local dois', 'docs/b.txt', days(1));
  sh('tag', '-a', 'v2', '-m', 'dois');
});
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

describe('escopo das referências', () => {
  it('padrão = só o que o branch atual alcança; "todos" soma a branch que não foi mesclada', async () => {
    expect(ids(await log({}))).toEqual(rl('HEAD', '--topo-order'));
    const all = await log({ scope: 'all' });
    expect(new Set(ids(all))).toEqual(new Set(rl('--all')));
    expect(all.map((c) => c.subject)).toContain('c8 outra branch');
    expect(await names({})).not.toContain('c8 outra branch');
  });

  it('sem filtro nenhum (quem chama como antes) continua devolvendo todas as referências', async () => {
    expect(new Set(ids(await getHistory(R, 1000)))).toEqual(new Set(rl('--all')));
  });

  it('só os branches locais, e uma escolha de branches (com a lista vazia, volta ao atual)', async () => {
    expect(new Set(ids(await log({ scope: 'local' })))).toEqual(new Set(rl('--branches', 'HEAD')));
    expect(new Set(ids(await log({ scope: 'chosen', branches: ['outra'] })))).toEqual(new Set(rl('outra')));
    expect(new Set(ids(await log({ scope: 'chosen', branches: ['outra', 'feat'] })))).toEqual(new Set(rl('outra', 'feat')));
    expect(ids(await log({ scope: 'chosen', branches: [] }))).toEqual(ids(await log({})));
  });

  it('mostrar remotos e tags soma o que elas alcançam (com remoto na frente do local, ele aparece)', async () => {
    sh('update-ref', 'refs/remotes/origin/ponta', rl('outra')[0]!);
    expect(new Set(ids(await log({ remotes: true })))).toEqual(new Set(rl('HEAD', '--remotes')));
    expect(new Set(ids(await log({ remotes: true })))).toContain(rl('outra')[0]!);
    expect(new Set(ids(await log({ tags: true })))).toEqual(new Set(rl('HEAD', '--tags')));
    sh('update-ref', '-d', 'refs/remotes/origin/ponta');
  });

  it('só o que ainda não foi publicado = o que o remoto não tem (oráculo: HEAD ^origin/main)', async () => {
    const want = rl('HEAD', '^origin/main');
    expect(want.length).toBe(2);
    expect(new Set(ids(await log({ unpublished: true })))).toEqual(new Set(want));
    expect((await names({ unpublished: true })).sort()).toEqual(['c10 local dois', 'c9 local um']);
  });
});

describe('autor, período, caminho e merges', () => {
  it('o autor casa por nome ou e-mail, sem diferenciar maiúscula, e só devolve commits dele', async () => {
    const bia = await log({ scope: 'all', author: 'BIA' });
    expect(bia.length).toBe(3);
    expect(bia.every((c) => c.author === 'Bia')).toBe(true);
    expect(ids(await log({ scope: 'all', author: 'caio@e.com' })).length).toBe(2);
    expect(await log({ author: 'ninguem' })).toEqual([]);
  });

  it('o período corta nas pontas (desde/até) e combina com o autor', async () => {
    const recent = await log({ scope: 'all', since: days(25).slice(0, 10) });
    expect(recent.every((c) => c.date * 1000 >= Date.now() - 26 * 86_400_000)).toBe(true);
    expect(new Set(ids(recent))).toEqual(new Set(rl('--all', `--since=${days(25).slice(0, 10)}`)));
    const old = await log({ scope: 'all', until: days(45).slice(0, 10) });
    expect((await names({ scope: 'all', until: days(45).slice(0, 10) })).sort()).toEqual(['c1 raiz', 'c2 docs'].sort());
    expect(old.length).toBe(2);
    expect((await log({ scope: 'all', author: 'bia', since: days(45).slice(0, 10) })).every((c) => c.author === 'Bia')).toBe(true);
  });

  it('a pasta ou o arquivo: só commits que mexem nele (como `git log -- caminho`), e a lista continua ligada pelos pais (traçado possível)', async () => {
    const docs = await log({ scope: 'all', path: 'docs' });
    expect(new Set(ids(docs))).toEqual(new Set(rl('--all', '--', 'docs')));
    const set = new Set(ids(docs));
    for (const c of docs) for (const p of c.parents) expect(set.has(p), `pai ${p.slice(0, 7)} de "${c.subject}" fora da lista`).toBe(true); // --parents religa os pais
    expect(ids(await log({ path: 'src/z.txt' }))).toEqual(rl('HEAD', '--topo-order', '--', 'src/z.txt'));
  });

  it('sem merges tira os de dois pais (e só eles)', async () => {
    const all = await log({ scope: 'all' });
    const merges = all.filter((c) => c.parents.length > 1).map((c) => c.hash);
    expect(merges.length).toBe(1);
    const no = await log({ scope: 'all', noMerges: true });
    expect(new Set(ids(no))).toEqual(new Set(ids(all).filter((h) => !merges.includes(h))));
  });

  it('"simplificar" (--simplify-by-decoration) mantém todo commit que branch ou tag aponta, e só vale com um caminho', async () => {
    const all = await log({ scope: 'all' });
    const touching = await log({ scope: 'all', path: 'docs' });
    const decorated = touching.filter((c) => c.refs.length > 0).map((c) => c.hash); // os que têm referência E mexem na pasta
    const simple = new Set(ids(await log({ scope: 'all', path: 'docs', simplify: true })));
    expect(decorated.length).toBeGreaterThan(1);
    for (const h of decorated) expect(simple.has(h), `commit com referência ${h.slice(0, 7)} fora do resumo`).toBe(true);
    expect(ids(await log({ scope: 'all', simplify: true }))).toEqual(ids(all)); // sem caminho, a opção não entra
  });

  it('as combinações valem juntas (autor + pasta + sem merges + só não publicados)', async () => {
    const f: HistoryFilter = { scope: 'all', author: 'ana', path: 'docs', noMerges: true };
    const got = await log(f);
    const want = rl('--all', '--author=ana', '--no-merges', '--', 'docs');
    expect(new Set(ids(got))).toEqual(new Set(want));
    expect((await names({ author: 'ana', unpublished: true })).sort()).toEqual(['c10 local dois']);
  });

  it('a ordem por data lista do mais recente ao mais antigo; a topológica põe os filhos antes dos pais', async () => {
    const byDate = await log({ scope: 'all', order: 'date' });
    expect(ids(byDate)).toEqual(rl('--all', '--date-order'));
    const topo = await log({ scope: 'all' });
    const pos = new Map(ids(topo).map((h, i) => [h, i]));
    for (const c of topo) for (const p of c.parents) expect(pos.get(p)! > pos.get(c.hash)!).toBe(true);
  });
});

describe('contagem, páginas e autores', () => {
  it('"N de M": o filtro conta o que mostra e o total é o do repositório inteiro', async () => {
    const all = rl('--all').length;
    expect(await getHistoryCount(R, { scope: 'all' })).toEqual({ count: all, total: all });
    const cur = await getHistoryCount(R, {});
    expect(cur.count).toBe(rl('HEAD').length);
    expect(cur.total).toBe(all);
    expect((await getHistoryCount(R, { author: 'bia', scope: 'all' })).count).toBe(3);
    expect((await getHistoryCount(R, { path: 'docs', scope: 'all' })).count).toBe((await log({ path: 'docs', scope: 'all' })).length);
  });

  it('a paginação com filtro completa a lista sem repetir nem faltar', async () => {
    const f: HistoryFilter = { scope: 'all', noMerges: true };
    const whole = ids(await log(f));
    const paged = [...ids(await getHistory(R, 3, 0, f)), ...ids(await getHistory(R, 3, 3, f)), ...ids(await getHistory(R, 3, 6, f)), ...ids(await getHistory(R, 3, 9, f))];
    expect(paged).toEqual(whole);
  });

  it('os autores, do mais ativo ao menos, com e-mail', async () => {
    const a = await getAuthors(R);
    expect(a.map((x) => [x.name, x.count])).toEqual([['Bia', 3], ['Ana', 4], ['Caio', 2], ['Dani', 1]].sort((x, y) => (y[1] as number) - (x[1] as number)));
    expect(a.find((x) => x.name === 'Caio')!.email).toBe('caio@e.com');
  });
});

describe('segurança e conta dos filtros', () => {
  it('valor que viraria opção do Git, caminho que sai do repositório e data torta são recusados antes de chegar ao Git', async () => {
    expect(buildLogArgs({ scope: 'chosen', branches: ['--upload-pack=x'] })).toMatchObject({ error: { code: 'badRevision' } });
    expect(buildLogArgs({ scope: 'chosen', branches: ['a..b'] })).toMatchObject({ error: { code: 'badRevision' } });
    expect(buildLogArgs({ path: '../fora' })).toMatchObject({ error: { code: 'badPath' } });
    expect(buildLogArgs({ path: ':(top)x' })).toMatchObject({ error: { code: 'badPath' } });
    expect(buildLogArgs({ since: '$(rm -rf /)' })).toMatchObject({ error: { code: 'badDate' } });
    expect(buildLogArgs({ author: 'a\nb' })).toMatchObject({ error: { code: 'badAuthor' } });
    await expect(log({ scope: 'chosen', branches: ['-x'] })).rejects.toThrow(/inválido/);
  });

  it('autor e datas entram grudados na opção (um valor com "-" na frente não vira opção) e o caminho vai literal depois do --', () => {
    const b = buildLogArgs({ author: '--exec=x', since: '2026-01-01', path: 'a*b/c' }) as { args: string[]; pathspec: string[] };
    expect(b.args).toContain('--author=--exec=x');
    expect(b.args).toContain('--since=2026-01-01');
    expect(b.args.every((a) => !a.startsWith('--exec'))).toBe(true);
    expect(b.pathspec).toEqual([':(literal)a*b/c']);
  });

  it('um autor com sinal de menos ou texto de regex não quebra o git (devolve vazio, não erro)', async () => {
    expect(await log({ author: '-x' })).toEqual([]);
    expect(await log({ author: '(' })).toEqual([]);
  });

  it('padrão, quantos filtros estão ligados e o que tira o traçado de lanes', () => {
    expect(isDefaultFilter(undefined)).toBe(true);
    expect(isDefaultFilter({ scope: 'current', author: '  ' })).toBe(true);
    expect(isDefaultFilter({ scope: 'all' })).toBe(false);
    expect(activeFilterCount({ scope: 'all', author: 'a', since: 'x', until: 'y', noMerges: true, path: 'p' })).toBe(5); // período conta como um
    expect(activeFilterCount({})).toBe(0);
    expect(filterBreaksGraph({ author: 'a' })).toBe(true);
    expect(filterBreaksGraph({ noMerges: true })).toBe(true);
    expect(filterBreaksGraph({ scope: 'all', path: 'x', since: '2026-01-01', remotes: true })).toBe(false);
  });
});
