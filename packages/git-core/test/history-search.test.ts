import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGit, searchHistoryStream, type HistoryHit, type HistoryQuery } from '../src/index.js';

// Um repositório com entradas e saídas conhecidas: o resultado tem de bater com `git log -S/-G` direto (inclusive renomeação, merge e outro branch).
let repo: string;
const git = (...a: string[]) => runGit(repo, a);
const H: Record<string, string> = {};

async function commit(msg: string, files: Record<string, string | null>, author = 'Ana <ana@e.com>', date = '') {
  for (const [f, c] of Object.entries(files)) {
    if (c === null) await git('rm', '-q', '-f', f);
    else {
      mkdirSync(join(repo, f, '..'), { recursive: true });
      writeFileSync(join(repo, f), c);
      await git('add', f);
    }
  }
  await runGit(repo, ['commit', '-q', '-m', msg, `--author=${author}`], { env: date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : undefined });
  H[msg] = (await git('rev-parse', 'HEAD')).stdout.trim();
}

const direct = async (...a: string[]) => (await git('log', '--format=%H', ...a)).stdout.split('\n').filter((l) => /^[0-9a-f]{40}$/.test(l));
async function run(q: HistoryQuery, hooks: Parameters<typeof searchHistoryStream>[2] = {}) {
  const out = await searchHistoryStream(repo, q, hooks);
  return { ...out, ids: out.hits.map((h) => h.hash) };
}
const subject = (h: HistoryHit) => h.subject;

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'gitnexus-hsearch-'));
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Beto');
  await git('config', 'user.email', 'beto@e.com');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.autocrlf', 'false');
  await git('config', 'core.fsmonitor', 'false'); // sem o daemon do Git segurando a pasta temporária
  await commit('c1 entra needle', { 'a.txt': 'alpha\nbeta needle\ngama\n' }, 'Ana <ana@e.com>', '2026-01-01T10:00:00');
  await commit('c2 outro arquivo', { 'b.txt': 'nada aqui\n' }, 'Caio <caio@e.com>', '2026-01-02T10:00:00');
  await commit('c3 troca a caixa', { 'a.txt': 'alpha\nbeta NEEDLE\ngama\n' }, 'Ana <ana@e.com>', '2026-01-03T10:00:00');
  await commit('c4 sai needle', { 'a.txt': 'alpha\nbeta\ngama\n' }, 'Ana <ana@e.com>', '2026-01-04T10:00:00');
  await git('tag', 'v1');
  await git('mv', 'a.txt', 'dir/a.txt').catch(async () => {
    mkdirSync(join(repo, 'dir'));
    await git('mv', 'a.txt', 'dir/a.txt');
  });
  await runGit(repo, ['commit', '-q', '-m', 'c5 só renomeia', '--author=Ana <ana@e.com>'], { env: { GIT_AUTHOR_DATE: '2026-01-05T10:00:00', GIT_COMMITTER_DATE: '2026-01-05T10:00:00' } });
  H['c5 só renomeia'] = (await git('rev-parse', 'HEAD')).stdout.trim();
  await commit('c6 entram dois', { 'dir/a.txt': 'alpha\nbeta\ngama\nneedle x\nneedle y\n' }, 'Ana <ana@e.com>', '2026-01-06T10:00:00');
  await git('checkout', '-q', '-b', 'feat', 'v1');
  await commit('f1 needle no feat', { 'c.txt': 'needle so no feat\n' }, 'Caio <caio@e.com>', '2026-01-07T10:00:00');
  await git('checkout', '-q', 'main');
  await runGit(repo, ['merge', '--no-ff', '-q', '-m', 'm1 merge do feat', 'feat'], { env: { GIT_AUTHOR_DATE: '2026-01-08T10:00:00', GIT_COMMITTER_DATE: '2026-01-08T10:00:00' } });
  H['m1 merge do feat'] = (await git('rev-parse', 'HEAD')).stdout.trim();
  await commit('c7 troca needle por needles', { 'dir/a.txt': 'alpha\nbeta\ngama\nneedles x\nneedle y\n' }, 'Ana <ana@e.com>', '2026-01-09T10:00:00');
  await commit('c8 binário', { 'bin.dat': 'x\u0000needle\u0000y' }, 'Caio <caio@e.com>', '2026-01-10T10:00:00');
}, 120_000);
afterAll(() => rmSync(repo, { recursive: true, force: true }), 60_000);

describe('quando entrou ou saiu (-S)', () => {
  it('bate com git log -S direto (sem diferenciar maiúsculas) e diz entrou/saiu/mudou', async () => {
    const r = await run({ text: 'needle' });
    expect(r.done.ok).toBe(true);
    expect(r.ids).toEqual(await direct('-i', '-Sneedle', 'HEAD'));
    const kind = Object.fromEntries(r.hits.map((h) => [h.subject.split(' ')[0], h.kind]));
    expect(kind).toMatchObject({ c1: 'added', c4: 'removed', c6: 'added' });
    // c7 troca "needle x" por "needles x": o texto continua 2 vezes no arquivo, então o -S não o lista (e o núcleo também não)
    expect(r.hits.map(subject)).not.toContain('c7 troca needle por needles');
    // a troca de caixa (c3) não muda o número de ocorrências sem diferenciar maiúsculas: fora, como no Git
    expect(r.hits.map(subject)).not.toContain('c3 troca a caixa');
  });
  it('contagens e arquivos de cada commit', async () => {
    const r = await run({ text: 'needle' });
    const c6 = r.hits.find((h) => h.subject.startsWith('c6'))!;
    expect(c6).toMatchObject({ added: 2, removed: 0 });
    expect(c6.files).toEqual([{ path: 'dir/a.txt', status: 'M', added: 2, removed: 0 }]);
    const c1 = r.hits.find((h) => h.subject.startsWith('c1'))!;
    expect(c1).toMatchObject({ kind: 'added', added: 1, removed: 0, parents: [] });
    const c4 = r.hits.find((h) => h.subject.startsWith('c4'))!;
    expect(c4).toMatchObject({ kind: 'removed', added: 0, removed: 1, refs: ['tag: v1'] });
  });
  it('diferenciando maiúsculas: só o c3 e o c1 mexem em "NEEDLE" / "needle"', async () => {
    const r = await run({ text: 'NEEDLE', caseSensitive: true });
    expect(r.ids).toEqual(await direct('-SNEEDLE', 'HEAD'));
    expect(r.hits.map(subject)).toEqual(['c4 sai needle', 'c3 troca a caixa']);
    const r2 = await run({ text: 'needle', caseSensitive: true });
    expect(r2.ids).toEqual(await direct('-Sneedle', 'HEAD'));
  });
  it('regex: bate com -S --pickaxe-regex', async () => {
    const r = await run({ text: 'need.e x', regex: true });
    expect(r.ids).toEqual(await direct('-i', '-Sneed.e x', '--pickaxe-regex', 'HEAD'));
    expect(r.ids.length).toBeGreaterThan(0);
  });
  it('arquivo renomeado: o -S não conta a renomeação sozinha (c5 fica de fora) e segue o arquivo com --follow', async () => {
    const r = await run({ text: 'needle' });
    expect(r.hits.map(subject)).not.toContain('c5 só renomeia');
    const f = await run({ text: 'needle', follow: true, include: 'dir/a.txt' });
    expect(f.ids).toEqual(await direct('-i', '-Sneedle', '--follow', 'HEAD', '--', 'dir/a.txt'));
    expect(f.hits.map(subject)).toContain('c1 entra needle'); // atravessa a renomeação até o commit que criou o arquivo
    expect(f.done.examined).toBeUndefined(); // com --follow não há ordem do escopo para contar
  });
  it('texto de várias linhas no -S: bate com o git log direto e conta pelo texto junto', async () => {
    const text = ['alpha', 'beta needle'].join('\n');
    const r = await run({ text, caseSensitive: true });
    expect(r.ids).toEqual(await direct('-S' + text, 'HEAD'));
    expect(r.hits.map(subject)).toEqual(['c3 troca a caixa', 'c1 entra needle']); // o c3 troca needle por NEEDLE: o texto (com a caixa) saiu
    expect(r.hits.map((h) => [h.kind, h.added, h.removed])).toEqual([['removed', 0, 1], ['added', 1, 0]]);
  });
  it('binário: o Git acha, o selo fica "unknown" e o arquivo vem marcado', async () => {
    const r = await run({ text: 'needle' });
    const bin = r.hits.find((h) => h.subject.startsWith('c8'))!;
    expect(bin.kind).toBe('unknown');
    expect(bin.files[0]).toMatchObject({ path: 'bin.dat', binary: true });
  });
});

describe('linhas alteradas que casam (-G)', () => {
  it('bate com git log -G, e a troca de caixa entra (a linha mudou)', async () => {
    const r = await run({ text: 'needle', mode: 'lines' });
    expect(r.ids).toEqual(await direct('-i', '-Gneedle', 'HEAD'));
    expect(r.hits.map(subject)).toContain('c3 troca a caixa');
    expect(r.hits.find((h) => h.subject.startsWith('c3'))!.kind).toBe('changed');
  });
  it('o texto é literal fora do modo regex', async () => {
    const r = await run({ text: 'need.e', mode: 'lines' });
    expect(r.ids).toEqual([]);
    const g = await run({ text: 'need.e', mode: 'lines', regex: true });
    expect(g.ids.length).toBeGreaterThan(0);
  });
});

describe('palavra inteira (conferida no diff)', () => {
  it('"needle" inteiro: o c7 (needle x → needles x) tira a palavra, e "needles" só entra nele', async () => {
    const w = await run({ text: 'needle', wholeWord: true });
    const plain = await run({ text: 'needle' });
    // todo commit da palavra inteira está entre os do texto (-G é só o pré-filtro)
    for (const id of w.ids) expect(await direct('-i', '-Gneedle', 'HEAD')).toContain(id);
    expect(w.hits.find((h) => h.subject.startsWith('c7'))).toMatchObject({ kind: 'removed', added: 0, removed: 1 });
    expect(plain.ids.length).toBeGreaterThan(0);
    const s = await run({ text: 'needles', wholeWord: true });
    expect(s.hits.map((h) => h.subject.split(' ')[0])).toEqual(['c7']);
    expect(s.hits[0]!.kind).toBe('added');
  });
});

describe('mensagem (--grep)', () => {
  it('bate com git log --grep, sem diferenciar maiúsculas', async () => {
    const r = await run({ text: 'NEEDLE', mode: 'message' });
    expect(r.ids).toEqual(await direct('-i', '--grep=NEEDLE', 'HEAD'));
    expect(r.hits.every((h) => h.kind === 'message')).toBe(true);
  });
  it('literal e com palavra inteira', async () => {
    expect((await run({ text: 'c.', mode: 'message' })).ids).toEqual([]);
    const w = await run({ text: 'sai', mode: 'message', wholeWord: true });
    expect(w.hits.map(subject)).toEqual(['c4 sai needle']);
  });
});

describe('escopo', () => {
  it('branch atual não vê o branch feat até o merge; "todos" vê o f1', async () => {
    await git('checkout', '-q', 'v1').catch(() => undefined);
    await git('checkout', '-q', 'main');
    const cur = await run({ text: 'needle', scope: 'branch', revision: 'feat' });
    expect(cur.hits.map(subject)).toContain('f1 needle no feat');
    const v1 = await run({ text: 'needle', scope: 'branch', revision: 'v1' });
    expect(v1.hits.map(subject)).toEqual(['c4 sai needle', 'c1 entra needle']);
    const all = await run({ text: 'needle', scope: 'all' });
    expect(all.hits.map(subject)).toContain('f1 needle no feat');
  });
  it('intervalo A..B e tags', async () => {
    const r = await run({ text: 'needle', scope: 'range', revision: 'v1..main' });
    expect(r.ids).toEqual(await direct('-i', '-Sneedle', 'v1..main'));
    expect(r.hits.map(subject)).not.toContain('c1 entra needle');
    const t = await run({ text: 'needle', scope: 'tags' });
    expect(t.ids).toEqual(await direct('-i', '-Sneedle', '--tags'));
  });
  it('revisão que não existe: erro em texto, sem rodar', async () => {
    const r = await run({ text: 'x', scope: 'branch', revision: 'nao-existe' });
    expect(r.done).toMatchObject({ ok: false, reason: 'noRevision' });
    expect(r.done.message).toMatch(/nao-existe/);
  });
  it('autor, período e arquivo', async () => {
    expect((await run({ text: 'needle', author: 'caio' })).hits.map(subject)).toEqual(['c8 binário', 'f1 needle no feat']);
    const since = await run({ text: 'needle', since: '2026-01-05', until: '2026-01-07' });
    expect(since.hits.map((h) => h.subject.split(' ')[0])).toEqual(['f1', 'c6']); // o dia 07 inteiro entra, a qualquer hora do relógio (data sem hora vale do começo ao fim do dia)
    const mask = await run({ text: 'needle', include: '*.txt, !dir/**' });
    expect(mask.ids).toEqual(await direct('-i', '-Sneedle', 'HEAD', '--', ':(glob)**/*.txt', ':(exclude,glob)dir/**'));
    const onlyFilters = await run({ text: '', author: 'Caio' });
    expect(onlyFilters.hits.map((h) => h.subject.split(' ')[0])).toEqual(['c8', 'f1', 'c2']);
    expect(onlyFilters.hits.every((h) => h.kind === 'unknown')).toBe(true);
  });
});

describe('história de um trecho (-L)', () => {
  it('traz os commits que mexeram nas linhas, com o diff, e atravessa a renomeação', async () => {
    const r = await run({ text: '', mode: 'range', lines: { file: 'dir/a.txt', start: 2, end: 2 } });
    expect(r.done.ok).toBe(true);
    expect(r.ids).toEqual(await direct('-L2,2:dir/a.txt', 'HEAD'));
    expect(r.hits.map((h) => h.subject.split(' ')[0])).toEqual(['c4', 'c3', 'c1']);
    expect(r.hits[0]!.patch).toContain('-beta NEEDLE');
    expect(r.hits[0]!.kind).toBe('changed');
  });
  it('linhas fora do arquivo: erro em texto', async () => {
    const r = await run({ text: '', mode: 'range', lines: { file: 'dir/a.txt', start: 500, end: 600 } });
    expect(r.done.ok).toBe(false);
    expect(r.done.message).toBeTruthy();
  });
});

describe('páginas, cancelamento e erros', () => {
  it('páginas de N commits com nextSkip: juntas dão a lista inteira, sem repetir nem pular', async () => {
    const all = await run({ text: 'needle', mode: 'lines', scope: 'all' });
    expect(all.done.truncated).toBe(false);
    const got: string[] = [];
    let skip = 0;
    for (let i = 0; i < 20; i++) {
      const p = await run({ text: 'needle', mode: 'lines', scope: 'all', limit: 2, skip });
      got.push(...p.ids);
      if (!p.done.truncated) break;
      expect(p.done).toMatchObject({ truncatedReason: 'limit', count: 2 });
      expect(p.done.nextSkip).toBeGreaterThan(skip);
      skip = p.done.nextSkip!;
    }
    expect(got).toEqual(all.ids);
  });
  it('páginas também com o filtro de palavra inteira (o skip conta o que o Git devolveu)', async () => {
    const all = await run({ text: 'needle', wholeWord: true, scope: 'all' });
    const got: string[] = [];
    let skip = 0;
    for (let i = 0; i < 20; i++) {
      const p = await run({ text: 'needle', wholeWord: true, scope: 'all', limit: 1, skip });
      got.push(...p.ids);
      if (!p.done.truncated) break;
      skip = p.done.nextSkip!;
    }
    expect(got).toEqual(all.ids);
  });
  it('commits examinados: o total do escopo no fim, e a posição do último achado nos lotes', async () => {
    const seen: Array<number | undefined> = [];
    const r = await run({ text: 'needle' }, { onBatch: (_h, ex) => seen.push(ex) });
    const total = Number((await git('rev-list', '--count', 'HEAD')).stdout.trim());
    expect(r.done.total).toBe(total);
    expect(r.done.examined).toBe(total);
    for (const ex of seen) if (ex !== undefined) expect(ex).toBeLessThanOrEqual(total);
  });
  it('lote chega por onBatch, na ordem, e o primeiro sai antes do fim', async () => {
    const order: string[] = [];
    const r = await run({ text: 'needle' }, { onBatch: (h) => order.push(...h.map((x) => x.hash)) });
    expect(order).toEqual(r.ids);
  });
  it('cancelar encerra o git e diz que foi cancelada', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const r = await run({ text: 'needle' }, { signal: ctl.signal });
    expect(r.done.cancelled).toBe(true);
    const ctl2 = new AbortController();
    const t0 = Date.now();
    const p = run({ text: 'needle' }, { signal: ctl2.signal });
    setTimeout(() => ctl2.abort(), 1);
    const r2 = await p;
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r2.done.ok).toBe(true);
  });
  it('expressão inválida: erro em texto (o Git recusa)', async () => {
    const r = await run({ text: '(', regex: true });
    expect(r.done.ok).toBe(false);
    expect(r.done.reason).toBe('badRegex');
    expect(r.done.message).toBeTruthy();
    const g = await run({ text: '(', regex: true, mode: 'message' });
    expect(g.done.ok).toBe(false);
  });
  it('pedido vazio ou recusado: mensagem, sem rodar o Git', async () => {
    expect((await run({ text: '' })).done).toMatchObject({ ok: false });
    expect((await run({ text: 'x', include: '../fora' })).done).toMatchObject({ ok: false });
  });
  it('o texto nunca vira opção do Git', async () => {
    const r = await run({ text: '--output=/tmp/gn-injecao' });
    expect(r.done.ok).toBe(true);
    expect(r.ids).toEqual([]);
  });
  it('repositório sem commits: lista vazia dita em texto, não é erro', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'gitnexus-hsearch-empty-'));
    try {
      await runGit(empty, ['init', '-q', '-b', 'main']);
      const r = await searchHistoryStream(empty, { text: 'x' });
      expect(r.done).toMatchObject({ ok: true, count: 0, reason: 'noCommits' });
      const all = await searchHistoryStream(empty, { text: 'x', scope: 'all' });
      expect(all.done.ok).toBe(true);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
