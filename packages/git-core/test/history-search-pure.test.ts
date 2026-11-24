import { describe, expect, it } from 'vitest';
import {
  HistoryStream,
  RS,
  FS,
  buildHistoryArgs,
  buildScopeArgs,
  ciEre,
  escapeEre,
  kindOf,
  makeRanger,
  normalizeHistoryQuery,
  parseHistoryRecord,
  parsePatch,
  summarizeHistory,
  type HistoryHit,
  type NormalizedHistory,
} from '../src/pure.js';

const norm = (q: Parameters<typeof normalizeHistoryQuery>[0]): NormalizedHistory => {
  const r = normalizeHistoryQuery(q);
  if ('error' in r) throw new Error('erro: ' + r.error.code);
  return r.query;
};

describe('normalizeHistoryQuery', () => {
  it('padrões: quando entrou ou saiu, branch atual, página de 200', () => {
    const n = norm({ text: 'foo' });
    expect(n).toMatchObject({ mode: 'pickaxe', scope: 'current', limit: 200, skip: 0, caseSensitive: false, wholeWord: false, regex: false });
  });
  it('recusa o que não é busca', () => {
    expect(normalizeHistoryQuery({ text: '' })).toEqual({ error: { code: 'emptyQuery' } });
    expect(normalizeHistoryQuery({ text: 'x'.repeat(5000) })).toMatchObject({ error: { code: 'tooLong' } });
    expect(normalizeHistoryQuery({ text: 'a\nb', mode: 'lines' })).toEqual({ error: { code: 'multiline' } });
    expect(normalizeHistoryQuery({ text: 'a\nb', mode: 'message' })).toEqual({ error: { code: 'multiline' } });
    expect(normalizeHistoryQuery({ text: 'a\nb' })).toHaveProperty('query'); // -S aceita várias linhas
  });
  it('um filtro basta sem texto (autor, período, arquivo)', () => {
    expect(normalizeHistoryQuery({ text: '', author: 'Ana' })).toHaveProperty('query');
    expect(normalizeHistoryQuery({ text: '', since: '2 weeks ago' })).toHaveProperty('query');
    expect(normalizeHistoryQuery({ text: '', include: 'src/a.ts' })).toHaveProperty('query');
  });
  it('revisão: nome seguro, ou A..B com as duas pontas seguras; nunca vira opção do Git', () => {
    expect(normalizeHistoryQuery({ text: 'x', scope: 'branch', revision: 'v1.0' })).toHaveProperty('query');
    expect(normalizeHistoryQuery({ text: 'x', scope: 'branch', revision: '--output=/tmp/x' })).toMatchObject({ error: { code: 'badRevision' } });
    expect(normalizeHistoryQuery({ text: 'x', scope: 'branch', revision: 'a b' })).toMatchObject({ error: { code: 'badRevision' } });
    expect(normalizeHistoryQuery({ text: 'x', scope: 'range', revision: 'v1..main' })).toHaveProperty('query');
    expect(normalizeHistoryQuery({ text: 'x', scope: 'range', revision: 'v1' })).toMatchObject({ error: { code: 'badRevision' } });
    expect(normalizeHistoryQuery({ text: 'x', scope: 'range', revision: 'a..b..c' })).toMatchObject({ error: { code: 'badRevision' } });
  });
  it('máscaras e pasta: as mesmas regras da pesquisa; datas sem caractere de controle', () => {
    expect(normalizeHistoryQuery({ text: 'x', include: '../fora' })).toMatchObject({ error: { code: 'badMask' } });
    expect(normalizeHistoryQuery({ text: 'x', folder: '..' })).toMatchObject({ error: { code: 'badMask' } });
    expect(normalizeHistoryQuery({ text: 'x', since: 'ontem\u0000' })).toMatchObject({ error: { code: 'badDate' } });
  });
  it('seguir renomeação só com um arquivo', () => {
    expect(norm({ text: 'x', follow: true, include: 'src/a.ts' }).follow).toBe('src/a.ts');
    for (const include of ['*.ts', 'src/', 'a.ts, b.ts', '', '!a.ts']) expect(normalizeHistoryQuery({ text: 'x', follow: true, include })).toEqual({ error: { code: 'badFollow' } });
    expect(normalizeHistoryQuery({ text: 'x', follow: true, include: 'a.ts', folder: 'src' })).toEqual({ error: { code: 'badFollow' } });
  });
  it('trecho (-L): arquivo e linhas válidos', () => {
    expect(norm({ text: '', mode: 'range', lines: { file: 'src/a.ts', start: 3, end: 9 } }).lines).toEqual({ file: 'src/a.ts', start: 3, end: 9 });
    for (const lines of [{ file: '', start: 1, end: 2 }, { file: 'a.ts', start: 0, end: 2 }, { file: 'a.ts', start: 5, end: 2 }, { file: '../x', start: 1, end: 2 }, { file: 'a:b', start: 1, end: 2 }]) {
      expect(normalizeHistoryQuery({ text: '', mode: 'range', lines })).toEqual({ error: { code: 'badLines' } });
    }
    expect(normalizeHistoryQuery({ text: '', mode: 'range' })).toEqual({ error: { code: 'badLines' } });
  });
  it('limites: página entre 1 e 1000, skip não negativo', () => {
    expect(norm({ text: 'x', limit: 99999 }).limit).toBe(1000);
    expect(norm({ text: 'x', limit: 0 }).limit).toBe(1);
    expect(norm({ text: 'x', skip: -5 }).skip).toBe(0);
  });
});

describe('buildHistoryArgs', () => {
  it('quando entrou ou saiu: -S colado, sem diferenciar maiúsculas com a opção do Git', () => {
    const a = buildHistoryArgs(norm({ text: 'foo()' }));
    expect(a).toContain('-Sfoo()');
    expect(a).toContain('--regexp-ignore-case');
    expect(a).toContain('-p');
    expect(a.at(-1)).toBe('HEAD');
    expect(a).not.toContain('--topo-order'); // ele obriga o Git a varrer a história toda antes do primeiro resultado
    expect(buildHistoryArgs(norm({ text: 'foo', caseSensitive: true }))).not.toContain('--regexp-ignore-case');
  });
  it('regex no -S usa --pickaxe-regex; linhas alteradas usam -G com o texto escapado', () => {
    expect(buildHistoryArgs(norm({ text: 'a.*b', regex: true }))).toEqual(expect.arrayContaining(['-Sa.*b', '--pickaxe-regex']));
    expect(buildHistoryArgs(norm({ text: 'a.b', mode: 'lines' }))).toContain('-Ga\\.b');
    expect(buildHistoryArgs(norm({ text: 'a.*b', mode: 'lines', regex: true }))).toContain('-Ga.*b');
  });
  it('palavra inteira troca o -S pelo -G (o núcleo confere o resto no diff)', () => {
    const a = buildHistoryArgs(norm({ text: 'id', wholeWord: true }));
    expect(a).toContain('-Gid');
    expect(a.some((x) => x.startsWith('-S'))).toBe(false);
  });
  it('mensagem: --grep em ERE, sem diff; palavra inteira vira bordas na expressão', () => {
    const a = buildHistoryArgs(norm({ text: 'a.b', mode: 'message' }));
    expect(a).toEqual(expect.arrayContaining(['--extended-regexp', '--grep=a\\.b']));
    expect(a).not.toContain('-p');
    expect(buildHistoryArgs(norm({ text: 'fix', mode: 'message', wholeWord: true }))).toContain('--grep=(^|[^[:alnum:]_])(fix)($|[^[:alnum:]_])');
  });
  it('escopos', () => {
    expect(buildHistoryArgs(norm({ text: 'x', scope: 'all' }))).toEqual(expect.arrayContaining(['--branches', '--tags', '--remotes', 'HEAD']));
    expect(buildHistoryArgs(norm({ text: 'x', scope: 'all' }), false)).not.toContain('HEAD');
    expect(buildHistoryArgs(norm({ text: 'x', scope: 'tags' }))).toContain('--tags');
    expect(buildHistoryArgs(norm({ text: 'x', scope: 'branch', revision: 'feat/a' })).at(-1)).toBe('feat/a');
    expect(buildHistoryArgs(norm({ text: 'x', scope: 'range', revision: 'v1..main' })).at(-1)).toBe('v1..main');
  });
  it('autor sem diferenciar maiúsculas e sem metacaractere; período; pular', () => {
    const a = buildHistoryArgs(norm({ text: 'x', author: 'a.b', since: '2026-01-01', until: 'yesterday', skip: 200 }));
    expect(a).toEqual(expect.arrayContaining(['--author=[aA]\\.[bB]', '--since=2026-01-01', '--until=yesterday']));
    expect(a.some((x) => x.startsWith('--skip') || x.startsWith('-n'))).toBe(false); // o Git conta candidatos antes do -S: o núcleo pula os achados
  });
  it('arquivo, máscara e seguir renomeação vão depois do --', () => {
    const a = buildHistoryArgs(norm({ text: 'x', include: '*.ts' }));
    expect(a.slice(a.indexOf('--') + 1)).toEqual([':(glob)**/*.ts']);
    const f = buildHistoryArgs(norm({ text: 'x', follow: true, include: 'src/a.ts' }));
    expect(f).toContain('--follow');
    expect(f.slice(f.indexOf('--') + 1)).toEqual(['src/a.ts']);
  });
  it('trecho: -L e nada de pathspec nem pickaxe', () => {
    const a = buildHistoryArgs(norm({ text: 'ignorado', mode: 'range', lines: { file: 'src/a.ts', start: 3, end: 9 } }));
    expect(a).toContain('-L3,9:src/a.ts');
    expect(a).not.toContain('--');
    expect(a.some((x) => x.startsWith('-S') || x.startsWith('-G'))).toBe(false);
  });
  it('sem texto não pede o diff', () => {
    expect(buildHistoryArgs(norm({ text: '', author: 'Ana' }))).not.toContain('-p');
  });
  it('a contagem do escopo usa os mesmos filtros, sem o texto', () => {
    const a = buildScopeArgs(norm({ text: 'x', author: 'Ana', include: '*.ts', scope: 'tags' }));
    expect(a[0]).toBe('rev-list');
    expect(a).toEqual(expect.arrayContaining(['--tags', ':(glob)**/*.ts']));
    expect(a.some((x) => x.startsWith('-S'))).toBe(false);
  });
});

describe('escapes', () => {
  it('escapeEre e ciEre', () => {
    expect(escapeEre('a.b(c)[d]{e}|f*g+h?^$\\')).toBe('a\\.b\\(c\\)\\[d\\]\\{e\\}\\|f\\*g\\+h\\?\\^\\$\\\\');
    expect(ciEre('Ab.1')).toBe('[aA][bB]\\.1');
  });
});

describe('contagem e destaque', () => {
  it('texto fixo: Aa e palavra inteira', () => {
    expect(makeRanger({ text: 'foo', caseSensitive: false })!.ranges('Foo foo FOO')).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(makeRanger({ text: 'foo', caseSensitive: true })!.ranges('Foo foo FOO')).toEqual([[4, 7]]);
    expect(makeRanger({ text: 'id', wholeWord: true })!.ranges('id uid id_x id')).toEqual([[0, 2], [12, 14]]);
  });
  it('regex; expressão que o JavaScript não entende dá null (o Git decide sozinho)', () => {
    expect(makeRanger({ text: 'a+', regex: true, caseSensitive: true })!.ranges('baaac a')).toEqual([[1, 4], [6, 7]]);
    expect(makeRanger({ text: '(', regex: true })).toBeNull();
    expect(makeRanger({ text: '' })).toBeNull();
  });
});

const patchOf = (...files: string[]) => files.join('\n') + '\n';
const PATCH_A = patchOf(
  'diff --git a/src/a.ts b/src/a.ts',
  'index 111..222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  '-const needle = 1;',
  '+const other = 1;',
  '+needle needle',
);

describe('parsePatch', () => {
  it('conta as ocorrências que entraram e saíram, por arquivo', () => {
    const f = parsePatch(PATCH_A, { mode: 'pickaxe', ranger: makeRanger({ text: 'needle' }) });
    expect(f).toEqual([{ path: 'src/a.ts', status: 'M', added: 2, removed: 1 }]);
  });
  it('arquivo novo, apagado, renomeado e binário', () => {
    const p = patchOf(
      'diff --git a/n.txt b/n.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/n.txt',
      '@@ -0,0 +1 @@',
      '+needle',
      'diff --git a/d.txt b/d.txt',
      'deleted file mode 100644',
      '--- a/d.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-needle',
      'diff --git a/old name.txt b/new name.txt',
      'similarity index 80%',
      'rename from old name.txt',
      'rename to new name.txt',
      '--- a/old name.txt',
      '+++ b/new name.txt',
      '@@ -1 +1 @@',
      '-x',
      '+needle',
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
    );
    expect(parsePatch(p, { mode: 'pickaxe', ranger: makeRanger({ text: 'needle' }) })).toEqual([
      { path: 'n.txt', status: 'A', added: 1, removed: 0 },
      { path: 'd.txt', status: 'D', added: 0, removed: 1 },
      { path: 'new name.txt', oldPath: 'old name.txt', status: 'R', added: 1, removed: 0 },
      { path: 'img.png', status: 'M', added: 0, removed: 0, binary: true },
    ]);
  });
  it('um "+++" ou "---" dentro do conteúdo não é cabeçalho', () => {
    const p = patchOf('diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1 +1 @@', '---needle', '+++needle');
    expect(parsePatch(p, { mode: 'pickaxe', ranger: makeRanger({ text: 'needle' }) })[0]).toMatchObject({ added: 1, removed: 1 });
  });
  it('texto de várias linhas: conta no texto junto', () => {
    const p = patchOf('diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -0,0 +1,2 @@', '+um', '+dois');
    const f = parsePatch(p, { mode: 'pickaxe', ranger: makeRanger({ text: 'um\ndois' }), joined: true });
    expect(f[0]).toMatchObject({ added: 1, removed: 0 });
  });
  it('texto de várias linhas que cruza o contexto: o antes e o depois do trecho decidem', () => {
    // só a segunda linha do texto mudou; a primeira vem como contexto (-U2): o texto inteiro saiu
    const p = patchOf('diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1,2 +1,2 @@', ' um', '-dois', '+DOIS');
    const f = parsePatch(p, { mode: 'pickaxe', ranger: makeRanger({ text: 'um\ndois', caseSensitive: true }), joined: true });
    expect(f[0]).toMatchObject({ added: 0, removed: 1 });
    // dois trechos no mesmo arquivo somam
    const two = patchOf('diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1,2 +1,2 @@', ' um', '-dois', '+x', '@@ -9,2 +9,3 @@', ' um', '+dois', ' fim');
    expect(parsePatch(two, { mode: 'pickaxe', ranger: makeRanger({ text: 'um\ndois', caseSensitive: true }), joined: true })[0]).toMatchObject({ added: 0, removed: 0 });
  });
  it('trecho: conta as linhas + e -', () => {
    expect(parsePatch(PATCH_A, { mode: 'range', ranger: null })[0]).toMatchObject({ added: 2, removed: 1 });
  });
});

describe('kindOf', () => {
  it('entrou, saiu, mudou, desconhecido', () => {
    expect(kindOf(2, 0)).toBe('added');
    expect(kindOf(0, 1)).toBe('removed');
    expect(kindOf(2, 1)).toBe('changed');
    expect(kindOf(0, 0)).toBe('unknown');
  });
});

describe('parseHistoryRecord', () => {
  const head = (h: string, subject = 'feat: x') => [h, 'p1 p2', 'Ana', '1700000000', 'HEAD -> main, tag: v1', subject].join(FS);
  const H = 'a'.repeat(40);
  const ctx = (q: Parameters<typeof normalizeHistoryQuery>[0]) => {
    const n = norm(q);
    return { n, ranger: n.mode === 'message' || n.mode === 'range' ? null : makeRanger(n) };
  };
  it('commit com diff: selo e arquivos', () => {
    const r = parseHistoryRecord(head(H) + '\n\n' + PATCH_A, ctx({ text: 'needle' }))!;
    expect(r).toMatchObject({ hash: H, shortHash: 'aaaaaaa', parents: ['p1', 'p2'], refs: ['HEAD -> main', 'tag: v1'], author: 'Ana', date: 1700000000, subject: 'feat: x', kind: 'changed', added: 2, removed: 1 });
    expect(r.files).toHaveLength(1);
  });
  it('mensagem: sem diff, selo "message"', () => {
    expect(parseHistoryRecord(head(H) + '\n', ctx({ text: 'x', mode: 'message' }))).toMatchObject({ kind: 'message', files: [] });
  });
  it('palavra inteira descarta o commit em que o texto só aparece dentro de outra palavra', () => {
    const p = patchOf('diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1 +1 @@', '-uid', '+uuid');
    expect(parseHistoryRecord(head(H) + '\n\n' + p, ctx({ text: 'id', wholeWord: true }))).toBeNull();
    expect(parseHistoryRecord(head(H) + '\n\n' + PATCH_A.replace(/needle/g, 'id'), ctx({ text: 'id', wholeWord: true }))).toMatchObject({ kind: 'changed' });
  });
  it('sem expressão que o JavaScript entenda: o Git decide e o selo fica "unknown"', () => {
    expect(parseHistoryRecord(head(H) + '\n\n' + PATCH_A, ctx({ text: '(', regex: true }))).toMatchObject({ kind: 'unknown', added: 0, removed: 0 });
  });
  it('trecho: guarda o diff e conta as linhas', () => {
    const r = parseHistoryRecord(head(H) + '\n\n' + PATCH_A, ctx({ text: '', mode: 'range', lines: { file: 'src/a.ts', start: 1, end: 2 } }))!;
    expect(r.patch).toContain('@@ -1,2 +1,3 @@');
    expect(r).toMatchObject({ kind: 'changed', added: 2, removed: 1 });
  });
  it('registro sem hash válido é ignorado', () => {
    expect(parseHistoryRecord('lixo', ctx({ text: 'x' }))).toBeNull();
  });
});

describe('HistoryStream', () => {
  it('junta os pedaços e só entrega o registro quando o próximo começa', () => {
    const got: string[] = [];
    const s = new HistoryStream((r) => got.push(r));
    const out = `${RS}aaa\n\ndiff 1\n${RS}bbb\n\ndiff 2\n${RS}ccc\n`;
    for (let i = 0; i < out.length; i += 5) s.push(out.slice(i, i + 5));
    expect(got).toEqual(['aaa\n\ndiff 1\n', 'bbb\n\ndiff 2\n']);
    s.end();
    expect(got).toEqual(['aaa\n\ndiff 1\n', 'bbb\n\ndiff 2\n', 'ccc\n']);
  });
  it('saída vazia não entrega nada', () => {
    const got: string[] = [];
    const s = new HistoryStream((r) => got.push(r));
    s.push('');
    s.end();
    expect(got).toEqual([]);
  });
});

describe('summarizeHistory', () => {
  const hit = (hash: string, date: number, added: number, removed: number): HistoryHit => ({
    hash, shortHash: hash, parents: [], refs: [], author: '', date, subject: '', kind: kindOf(added, removed), added, removed, files: [],
  });
  it('primeira vez que entrou e última vez que saiu', () => {
    const s = summarizeHistory([hit('c', 30, 0, 1), hit('b', 20, 2, 1), hit('a', 10, 1, 0)]);
    expect(s.firstAdded?.hash).toBe('a');
    expect(s.lastRemoved?.hash).toBe('c');
    expect(s).toMatchObject({ added: 1, removed: 1, changed: 1 });
  });
  it('só entrou: sem "saiu"', () => {
    const s = summarizeHistory([hit('a', 10, 1, 0)]);
    expect(s.lastRemoved).toBeUndefined();
  });
});
