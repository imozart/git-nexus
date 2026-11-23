import { describe, expect, it } from 'vitest';
import {
  GrepParser,
  buildGrepArgs,
  byteColToIndex,
  candidateLiteral,
  clipAround,
  compileJsRegex,
  fixedRanges,
  isSafeRevision,
  normalizeQuery,
  parseMasks,
  regexRanges,
  type NormalizedQuery,
  type RawHit,
} from '../src/pure.js';

const norm = (q: Parameters<typeof normalizeQuery>[0]): NormalizedQuery => {
  const r = normalizeQuery(q);
  if ('error' in r) throw new Error(JSON.stringify(r.error));
  return r.query;
};

describe('máscaras', () => {
  it('vírgula ou espaço, "!" exclui, sem barra vale em qualquer pasta e "pasta/" vale pela pasta inteira', () => {
    expect(parseMasks('*.ts, *.vue !*.test.ts, !dist/ src/**/*.js')).toEqual({
      masks: { include: ['**/*.ts', '**/*.vue', 'src/**/*.js'], exclude: ['**/*.test.ts', '**/dist/**'] },
    });
    expect(parseMasks('!packages/app/')).toEqual({ masks: { include: [], exclude: ['packages/app/**'] } });
    expect(parseMasks('')).toEqual({ masks: { include: [], exclude: [] } });
  });

  it('recusa o que não é máscara de arquivo: "..", magia de pathspec, barra no começo, opção e controle', () => {
    for (const bad of ['../x', 'a/../b', ':(top)x', ':!x', '/etc/passwd', '--help', '!:(exclude)x', 'a\u0001b']) expect(parseMasks(bad), bad).toHaveProperty('error');
  });
});

describe('pedido normalizado', () => {
  it('aplica os padrões e limites', () => {
    const q = norm({ pattern: 'x', contextBefore: 99, contextAfter: -3, limit: 999_999, offset: 7.9 });
    expect(q).toMatchObject({ scope: 'worktree', includeUntracked: true, includeIgnored: false, contextBefore: 5, contextAfter: 0, limit: 5000, offset: 7, regex: false, multiline: false });
  });

  it('vazio, grande demais, máscara e revisão inválidas viram erro (nada vira opção do git)', () => {
    expect(normalizeQuery({ pattern: '  ' })).toEqual({ error: { code: 'empty' } });
    expect(normalizeQuery({ pattern: 'x'.repeat(4001) })).toEqual({ error: { code: 'tooLong', max: 4000 } });
    expect(normalizeQuery({ pattern: 'x', include: '../x' })).toEqual({ error: { code: 'badMask', mask: '../x' } });
    for (const rev of ['', '-x', '--output=/tmp/x', 'a..b', 'a b', ':/x', 'main/', 'x.lock']) {
      expect(normalizeQuery({ pattern: 'x', scope: 'revision', revision: rev }), rev).toHaveProperty('error.code', 'badRevision');
    }
    for (const rev of ['main', 'origin/feat/x', 'v1.2.3', 'HEAD~2', 'a1b2c3d', '@{u}']) expect(isSafeRevision(rev), rev).toBe(true);
  });

  it('a busca de várias linhas liga sozinha com quebra de linha (e com \\n na regex)', () => {
    expect(norm({ pattern: 'a\nb' }).multiline).toBe(true);
    expect(norm({ pattern: 'a\\nb', regex: true }).multiline).toBe(true);
    expect(norm({ pattern: 'a\\nb' }).multiline).toBe(false);
    expect(norm({ pattern: 'a' }).multiline).toBe(false);
  });
});

describe('argumentos do git grep', () => {
  const grep = (q: Parameters<typeof normalizeQuery>[0], o: Partial<Parameters<typeof buildGrepArgs>[1]> = {}) => buildGrepArgs(norm(q), { pcre: true, threads: 4, ...o });

  it('texto fixo depois de -e, máscaras depois de --, colunas e contexto', () => {
    const a = grep({ pattern: '-rf', include: '*.ts, !dist/', contextBefore: 2, contextAfter: 1 });
    expect(a.slice(0, 3)).toEqual(['grep', '-z', '--no-color']);
    expect(a).toEqual(expect.arrayContaining(['-n', '--column', '-B', '2', '-A', '1', '--fixed-strings', '--ignore-case', '--untracked', '--threads=4']));
    expect(a.slice(a.indexOf('-e'))).toEqual(['-e', '-rf', '--', ':(glob)**/*.ts', ':(exclude,glob)**/dist/**']);
  });

  it('dialeto: -P quando o git suporta, a estendida quando não, e o fixo sem regex', () => {
    expect(grep({ pattern: 'a.b', regex: true })).toContain('--perl-regexp');
    expect(grep({ pattern: 'a.b', regex: true }, { pcre: false })).toContain('--extended-regexp');
    expect(grep({ pattern: 'a.b', regex: true })).not.toContain('--fixed-strings');
  });

  it('escopos: versionados, stage, revisão, ignorados e submódulos', () => {
    expect(grep({ pattern: 'x', scope: 'tracked', includeUntracked: false })).not.toContain('--untracked');
    expect(grep({ pattern: 'x', scope: 'staged' })).toContain('--cached');
    const rev = grep({ pattern: 'x', scope: 'revision', revision: 'v1.0' });
    expect(rev.slice(rev.indexOf('-e'))).toEqual(['-e', 'x', 'v1.0', '--']);
    expect(rev).not.toContain('--untracked');
    expect(grep({ pattern: 'x', includeIgnored: true })).toEqual(expect.arrayContaining(['--untracked', '--no-exclude-standard']));
    const sub = grep({ pattern: 'x', includeSubmodules: true });
    expect(sub).toContain('--recurse-submodules');
    expect(sub).not.toContain('--untracked');
  });

  it('candidatos (-l) e oráculo (-o) usam o texto fixo pedido', () => {
    const l = grep({ pattern: 'a\nb' }, { listFiles: true, pattern: 'a', fixed: true });
    expect(l).toContain('-l');
    expect(l).not.toContain('--column');
    expect(grep({ pattern: 'x', regex: true }, { onlyMatching: true })).toContain('-o');
  });
});

describe('literal de pré-filtro da busca de várias linhas', () => {
  it('texto fixo: a linha mais longa; regex: só o trecho sem metacaracteres', () => {
    expect(candidateLiteral('foo\nbarbaz\nx', false)).toBe('barbaz');
    expect(candidateLiteral('function \\w+\\(\\)\\n  return', true)).toBe('  return');
    expect(candidateLiteral('^a.*\\nb+$', true)).toBeNull();
    expect(candidateLiteral('ab\\.cd\\nxy', true)).toBe('ab.cd');
  });
});

describe('leitura da saída com colunas', () => {
  const parse = (chunks: Array<string | Buffer>, ctx = { before: 0, after: 0 }, prefix = '') => {
    const hits: RawHit[] = [];
    const p = new GrepParser((h) => hits.push(h), ctx, prefix);
    for (const c of chunks) p.push(typeof c === 'string' ? Buffer.from(c, 'utf8') : c);
    p.end();
    return { hits, binaries: p.binaries };
  };

  it('arquivo NUL linha NUL coluna NUL texto, sem o \\r do CRLF', () => {
    const { hits } = parse(['a.ts\x001\x005\x00let x = 1;\r\nb/c.ts\x0012\x001\x00y\n']);
    expect(hits.map((h) => [h.file, h.line, h.byteCol, h.text])).toEqual([
      ['a.ts', 1, 5, 'let x = 1;'],
      ['b/c.ts', 12, 1, 'y'],
    ]);
  });

  it('um caractere multibyte cortado entre dois pedaços não vira lixo', () => {
    const full = Buffer.from('a.ts\x001\x001\x00café naïve\n', 'utf8');
    const cut = full.indexOf(0xc3) + 1; // no meio do "é"
    const { hits } = parse([full.subarray(0, cut), full.subarray(cut)]);
    expect(hits[0]!.text).toBe('café naïve');
  });

  it('coluna em bytes vira índice do texto (acentos antes da ocorrência)', () => {
    const { hits } = parse(['a.ts\x001\x007\x00café xyz\n']); // "café " = 6 bytes (é tem 2)
    expect(byteColToIndex(hits[0]!.bytes, hits[0]!.byteCol)).toBe(5);
  });

  it('contexto antes e depois (um NUL a menos), separador -- ignorado e contexto não vira ocorrência', () => {
    const out = 'f.ts\x002\x00antes\nf.ts\x003\x001\x00ACHEI\nf.ts\x004\x00depois\n--\nf.ts\x0010\x002\x00outro\n';
    const { hits } = parse([out], { before: 1, after: 1 });
    expect(hits.map((h) => [h.line, h.before.map((c) => c.text), h.after.map((c) => c.text)])).toEqual([
      [3, ['antes'], ['depois']],
      [10, [], []],
    ]);
  });

  it('"Binary file x matches" vira arquivo ignorado e o prefixo da revisão sai do nome', () => {
    const { hits, binaries } = parse(['Binary file img.png matches\nmain:src/a.ts\x001\x001\x00x\n'], { before: 0, after: 0 }, 'main:');
    expect(binaries).toEqual(['img.png']);
    expect(hits[0]!.file).toBe('src/a.ts');
  });
});

describe('destaque', () => {
  it('texto fixo: todas as ocorrências, sem diferenciar caixa e com palavra inteira', () => {
    expect(fixedRanges('Foo foo FOO', 'foo', false, false)).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(fixedRanges('Foo foo', 'foo', true, false)).toEqual([[4, 7]]);
    expect(fixedRanges('foobar foo', 'foo', false, true)).toEqual([[7, 10]]);
  });

  it('regex: entende (?i) no começo (o PCRE aceita, o JavaScript não) e acha todas', () => {
    const c = compileJsRegex({ pattern: '(?i)ab\\d', regex: true, caseSensitive: true, wholeWord: false });
    expect('re' in c && regexRanges('AB1 ab2 x', c.re)).toEqual([[0, 3], [4, 7]]);
    expect(compileJsRegex({ pattern: '(', regex: true, caseSensitive: true, wholeWord: false })).toHaveProperty('error');
  });

  it('corte centrado: a ocorrência fica dentro do trecho, com o destaque deslocado, e os dois lados dizem que cortaram', () => {
    const text = 'x'.repeat(400) + 'ALVO' + 'y'.repeat(400);
    const c = clipAround(text, [[400, 404]]);
    expect(c.text.length).toBe(300);
    expect(c.clippedStart && c.clippedEnd).toBe(true);
    expect(c.text.slice(c.ranges[0]![0], c.ranges[0]![1])).toBe('ALVO');
  });

  it('ocorrência no começo ou no fim não corta do outro lado; linha curta não muda; par substituto não é partido', () => {
    const long = 'ALVO' + 'y'.repeat(500);
    expect(clipAround(long, [[0, 4]])).toMatchObject({ clippedStart: false, clippedEnd: true });
    expect(clipAround('curta', [[0, 2]])).toEqual({ text: 'curta', ranges: [[0, 2]], clippedStart: false, clippedEnd: false });
    const emoji = '\u{1F600}'.repeat(200); // cada um tem 2 unidades
    const c = clipAround(emoji, [[200, 202]]);
    expect(c.text).not.toMatch(/^[\udc00-\udfff]/);
    expect(c.text).not.toMatch(/[\ud800-\udbff]$/);
  });
});
