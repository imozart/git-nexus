import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bulkChoices, buildMerge, decodeText, emptyChoices, encodeText, eolDiffers, hasConflictMarkers, hasMixedEol, presetPicks, resolveMerge, sideLines, summarizePicks } from '../src/index.js';
import type { MergeChoices, MergeModel } from '../src/index.js';

const dir = mkdtempSync(join(tmpdir(), 'gitnexus-merge3-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const lines = (...l: string[]) => l.join('\n') + '\n';

/** Oráculo: `git merge-file -p` (mine = arquivo atual, theirs = o outro). `conflicts` = número de conflitos que o Git contou. */
function gitMerge(base: string, mine: string, theirs: string, flag?: '--ours' | '--theirs'): { out: string; conflicts: number } {
  writeFileSync(join(dir, 'base'), base);
  writeFileSync(join(dir, 'mine'), mine);
  writeFileSync(join(dir, 'theirs'), theirs);
  const r = spawnSync('git', ['merge-file', '-p', ...(flag ? [flag] : []), join(dir, 'mine'), join(dir, 'base'), join(dir, 'theirs')], { encoding: 'utf8' });
  if (r.error || (r.status ?? 255) > 127) throw new Error(`git merge-file falhou: ${r.error?.message ?? r.stderr}`);
  return { out: r.stdout, conflicts: r.status ?? 0 };
}

const merge = (base: string, mine: string, theirs: string) => buildMerge({ base, mine, theirs });
const resolved = (m: MergeModel, c: Parameters<typeof bulkChoices>[1]) => resolveMerge(m, bulkChoices(m, c)).text;
const allMine = (m: MergeModel) => resolved(m, { conflicts: 'mine', changes: 'mine' });
const allTheirs = (m: MergeModel) => resolved(m, { conflicts: 'theirs', changes: 'theirs' });
const kinds = (m: MergeModel) => m.segments.map((s) => s.kind);

describe('segmentos', () => {
  it('sem mudança nenhuma: um segmento estável', () => {
    const t = lines('a', 'b', 'c');
    const m = merge(t, t, t);
    expect(kinds(m)).toEqual(['stable']);
    expect(resolveMerge(m, emptyChoices()).text).toBe(t);
  });

  it('classifica: só minha, só da origin, igual nos dois e conflito', () => {
    const base = lines('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i');
    const mine = lines('a', 'B', 'c', 'd', 'E', 'f', 'g', 'h', 'MI');
    const theirs = lines('a', 'b', 'c', 'd', 'E', 'f', 'TH', 'h', 'TI');
    const m = merge(base, mine, theirs);
    expect(kinds(m)).toEqual(['stable', 'mine', 'stable', 'same', 'stable', 'theirs', 'stable', 'conflict']);
    expect(m.conflicts).toEqual([7]);
    expect(m.changes).toEqual([1, 3, 5]);
    expect(resolveMerge(m, emptyChoices()).text).toBeNull();
    expect(resolveMerge(m, emptyChoices()).pending).toEqual([7]);
    expect(resolved(m, { conflicts: 'mine', changes: 'all' })).toBe(lines('a', 'B', 'c', 'd', 'E', 'f', 'TH', 'h', 'MI'));
  });

  it('dois trechos que ENCOSTAM formam conflito (como o Git), e distantes por uma linha não', () => {
    const base = lines('a', 'b', 'c', 'd');
    const touching = merge(base, lines('a', 'B', 'c', 'd'), lines('a', 'b', 'C', 'd'));
    expect(touching.conflicts).toHaveLength(1);
    expect(gitMerge(base, lines('a', 'B', 'c', 'd'), lines('a', 'b', 'C', 'd')).conflicts).toBe(1);
    const apart = merge(lines('a', 'b', 'c', 'd', 'e'), lines('a', 'B', 'c', 'd', 'e'), lines('a', 'b', 'c', 'D', 'e'));
    expect(apart.conflicts).toHaveLength(0);
  });

  it('inserção no mesmo ponto com conteúdos diferentes é conflito; iguais, não', () => {
    const base = lines('a', 'b');
    expect(merge(base, lines('a', 'x', 'b'), lines('a', 'y', 'b')).conflicts).toHaveLength(1);
    const same = merge(base, lines('a', 'x', 'b'), lines('a', 'x', 'b'));
    expect(kinds(same)).toEqual(['stable', 'same', 'stable']);
  });

  it('apara o começo e o fim iguais dos dois lados do conflito', () => {
    const base = lines('a', 'b', 'z');
    const m = merge(base, lines('a', 'p', 'q', 's', 'z'), lines('a', 'p', 'r', 's', 'z'));
    expect(kinds(m)).toEqual(['stable', 'same', 'conflict', 'same', 'stable']);
    const c = m.segments[m.conflicts[0]!]!;
    expect(sideLines(m, c, 'mine')).toEqual(['q']);
    expect(sideLines(m, c, 'theirs')).toEqual(['r']);
    expect(sideLines(m, c, 'base')).toEqual(['b']);
    expect(m.changes).toEqual([]); // as partes aparadas não são "mudanças desfazíveis"
  });

  it('um lado apagou e o outro alterou: conflito com um lado vazio', () => {
    const m = merge(lines('a', 'b', 'c'), lines('a', 'c'), lines('a', 'B', 'c'));
    expect(m.conflicts).toHaveLength(1);
    expect(sideLines(m, m.segments[m.conflicts[0]!]!, 'mine')).toEqual([]);
    expect(allMine(m)).toBe(lines('a', 'c'));
    expect(allTheirs(m)).toBe(lines('a', 'B', 'c'));
  });

  it('cobre as três versões por inteiro, sem buracos nem sobras', () => {
    const base = lines('1', '2', '3', '4', '5', '6');
    const m = merge(base, lines('1', 'x', '3', '4', '5', '6', 'fim'), lines('0', '1', '2', '3', 'y', '5', '6'));
    for (const side of ['base', 'mine', 'theirs'] as const) {
      let at = 0;
      for (const s of m.segments) {
        expect(s[side].start).toBe(at);
        at = s[side].end;
      }
      expect(at).toBe(m[side].lines.length);
    }
  });
});

describe('fim de arquivo sem quebra de linha', () => {
  it('a última linha sem quebra difere da mesma com quebra (como no Git)', () => {
    const base = 'a\nb\n';
    const mine = 'a\nb'; // tirou a quebra final
    const theirs = 'a\nB\n';
    const m = merge(base, mine, theirs);
    expect(m.conflicts).toHaveLength(1);
    expect(gitMerge(base, mine, theirs).conflicts).toBe(1);
    expect(allMine(m)).toBe(mine);
    expect(allTheirs(m)).toBe(theirs);
  });

  it('mudança só da origin preserva a falta de quebra final', () => {
    const base = 'a\nb';
    const m = merge(base, base, 'A\nb');
    expect(resolved(m, { conflicts: 'pending', changes: 'all' })).toBe('A\nb');
    expect(gitMerge(base, base, 'A\nb').out).toBe('A\nb');
  });

  it('linha sem terminador no meio do resultado ganha o fim de linha dominante', () => {
    const m = merge('x\n', 'x\nm', 'x\nt\n');
    expect(resolved(m, { conflicts: 'both', changes: 'all' })).toBe('x\nm\nt\n');
    expect(resolved(m, { conflicts: 'both-reversed', changes: 'all' })).toBe('x\nt\nm');
  });
});

describe('fim de linha (CRLF e LF)', () => {
  it('compara sem o terminador, mas regrava cada linha como nasceu', () => {
    const base = 'a\r\nb\r\nc\r\nd\r\n';
    const mine = 'a\r\nB\r\nc\r\nd\r\n';
    const theirs = 'a\r\nb\r\nc\r\nD\r\n';
    const m = merge(base, mine, theirs);
    expect(resolved(m, { conflicts: 'pending', changes: 'all' })).toBe('a\r\nB\r\nc\r\nD\r\n');
  });

  it('um lado só reconverteu o arquivo para CRLF: não vira conflito e "tudo meu"/"tudo da origin" são exatos', () => {
    const base = lines('a', 'b', 'c');
    const mine = 'a\r\nb\r\nc\r\n';
    const theirs = lines('a', 'B', 'c');
    const m = merge(base, mine, theirs);
    expect(m.conflicts).toHaveLength(0);
    expect(eolDiffers(m)).toBe(true);
    expect(allMine(m)).toBe(mine);
    expect(allTheirs(m)).toBe(theirs);
  });

  it('impõe o fim de linha escolhido a todas as linhas e detecta resultado misto', () => {
    const m = merge('a\nb\n', 'a\r\nb\n', 'a\nb\n');
    const mixed = resolveMerge(m, emptyChoices());
    expect(hasMixedEol(mixed.lines)).toBe(true);
    for (const [eol, want] of [['lf', 'a\nb\n'], ['crlf', 'a\r\nb\r\n']] as const) {
      const r = resolveMerge(m, { ...emptyChoices(), eol });
      expect(r.text).toBe(want);
      expect(hasMixedEol(r.lines)).toBe(false);
    }
  });
});

describe('escolhas linha a linha', () => {
  const base = lines('inicio', 'x', 'fim');
  const mine = lines('inicio', 'm1', 'm2', 'm3', 'fim');
  const theirs = lines('inicio', 't1', 't2', 'fim');
  const m = merge(base, mine, theirs);
  const idx = m.conflicts[0]!;
  const seg = m.segments[idx]!;
  const choose = (picks: MergeChoices['picks'][number]): MergeChoices => ({ ...emptyChoices(), picks: { [idx]: picks } });

  it('atalhos do cartão: minha, da origin, as duas (e a ordem trocada), base e nenhuma', () => {
    const text = (preset: Parameters<typeof presetPicks>[2]) => resolveMerge(m, choose(presetPicks(m, idx, preset))).text;
    expect(text('mine')).toBe(mine);
    expect(text('theirs')).toBe(theirs);
    expect(text('both')).toBe(lines('inicio', 'm1', 'm2', 'm3', 't1', 't2', 'fim'));
    expect(text('both-reversed')).toBe(lines('inicio', 't1', 't2', 'm1', 'm2', 'm3', 'fim'));
    expect(text('base')).toBe(base);
    expect(text('none')).toBe(lines('inicio', 'fim'));
  });

  it('escolhe 2 de 3 de um lado, 1 do outro e uma linha digitada, na ordem pedida', () => {
    const r = resolveMerge(
      m,
      choose([
        { from: 'theirs', line: seg.theirs.start + 1 },
        { from: 'mine', line: seg.mine.start },
        { from: 'typed', text: 'à mão' },
        { from: 'mine', line: seg.mine.start + 2 },
      ]),
    );
    expect(r.text).toBe(lines('inicio', 't2', 'm1', 'à mão', 'm3', 'fim'));
    expect(r.lines.filter((l) => l.segment === idx).map((l) => l.origin)).toEqual(['theirs', 'mine', 'typed', 'mine']);
  });

  it('resume a decisão', () => {
    expect(summarizePicks([{ from: 'mine', line: 1 }, { from: 'mine', line: 2 }, { from: 'theirs', line: 0 }, { from: 'typed', text: '' }])).toEqual({ mine: 2, theirs: 1, base: 0, typed: 1 });
  });

  it('conflito pendente: sem texto final (nunca "adivinha" um lado) e prévia com a versão do usuário, sem marcador', () => {
    const r = resolveMerge(m, emptyChoices());
    expect(r.text).toBeNull();
    expect(r.pending).toEqual([idx]);
    expect(r.preview).toBe(mine);
    expect(r.lines.filter((l) => l.origin === 'pending')).toHaveLength(3);
    expect(hasConflictMarkers(r.preview)).toBe(false);
  });

  it('desfazer só uma mudança sem conflito', () => {
    const b = lines('a', 'b', 'c', 'd', 'e');
    const mm = merge(b, lines('A', 'b', 'c', 'd', 'e'), lines('a', 'b', 'c', 'd', 'E'));
    expect(kinds(mm)).toEqual(['mine', 'stable', 'theirs']);
    expect(resolveMerge(mm, emptyChoices()).text).toBe(lines('A', 'b', 'c', 'd', 'E'));
    expect(resolveMerge(mm, { ...emptyChoices(), reverted: [0] }).text).toBe(lines('a', 'b', 'c', 'd', 'E'));
    expect(resolveMerge(mm, { ...emptyChoices(), reverted: [2] }).text).toBe(lines('A', 'b', 'c', 'd', 'e'));
    expect(resolved(mm, { conflicts: 'pending', changes: 'none' })).toBe(b);
    expect(resolved(mm, { conflicts: 'pending', changes: 'mine' })).toBe(lines('A', 'b', 'c', 'd', 'e'));
    expect(resolved(mm, { conflicts: 'pending', changes: 'theirs' })).toBe(lines('a', 'b', 'c', 'd', 'E'));
  });
});

// ---------------------------------------------------------------- aleatório com o Git como oráculo

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linhas únicas (o alinhamento do diff é então o mesmo no Git e aqui). `density`: chance de cada ponto ser editado. */
function scenario(seed: number, size: number, density: number): { base: string; mine: string; theirs: string } {
  const r = rng(seed);
  const baseLines = Array.from({ length: size }, (_, i) => `linha-${i}`);
  const edit = (tag: string, shared: () => number) => {
    const out: string[] = [];
    baseLines.forEach((l, i) => {
      const x = r();
      const sh = shared() < 0.25; // as duas versões fazem a mesma edição neste ponto
      const who = sh ? 's' : tag;
      if (x < density / 3) out.push(`${who}-ins-${i}`, l);
      else if (x < (2 * density) / 3) out.push(`${who}-troca-${i}`);
      else if (x < density) return;
      else out.push(l);
    });
    if (r() < 0.1) out.push(`${tag}-fim`);
    return out;
  };
  const s1 = rng(seed + 1);
  const s2 = rng(seed + 1);
  const eol = r() < 0.2 ? '' : '\n';
  const join = (l: string[]) => l.join('\n') + (l.length ? eol : '');
  return { base: join(baseLines), mine: join(edit('m', s1)), theirs: join(edit('t', s2)) };
}

describe('contra o git merge-file (aleatório)', () => {
  const runs = Array.from({ length: 25 }, (_, i) => i + 1);
  it.each([[0.08], [0.25], [0.6]])('densidade %s: sem conflito é idêntico; com conflito, "ours"/"theirs" são idênticos', (density) => {
    let withConflict = 0;
    let without = 0;
    for (const seed of runs) {
      const { base, mine, theirs } = scenario(seed * 7 + Math.round(density * 100), 14 + (seed % 20), density);
      const m = merge(base, mine, theirs);
      const git = gitMerge(base, mine, theirs);
      const ctx = JSON.stringify({ seed, density });
      expect(m.conflicts.length > 0, ctx).toBe(git.conflicts > 0);
      if (git.conflicts === 0) {
        without++;
        expect(resolveMerge(m, emptyChoices()).text, ctx).toBe(git.out);
      } else {
        withConflict++;
        expect(resolved(m, { conflicts: 'mine', changes: 'all' }), ctx).toBe(gitMerge(base, mine, theirs, '--ours').out);
        expect(resolved(m, { conflicts: 'theirs', changes: 'all' }), ctx).toBe(gitMerge(base, mine, theirs, '--theirs').out);
      }
      // "tudo meu" é a versão do usuário e "tudo da origin" é a que chega, com ou sem conflito
      expect(allMine(m), ctx).toBe(mine);
      expect(allTheirs(m), ctx).toBe(theirs);
      expect(hasConflictMarkers(resolveMerge(m, emptyChoices()).preview) && !hasConflictMarkers(base + mine + theirs), ctx).toBe(false);
    }
    expect(withConflict + without).toBe(runs.length);
  });
});

// ---------------------------------------------------------------- corpus de conflitos

interface Case {
  nome: string;
  base: string;
  mine: string;
  theirs: string;
  /** Conflitos esperados (os do Git, sem a junção de conflitos próximos do nível "zealous"). */
  conflitos: number;
}

const CORPUS: Case[] = [
  { nome: 'mudança de uma linha dos dois lados', base: lines('a', 'b', 'c'), mine: lines('a', 'B1', 'c'), theirs: lines('a', 'B2', 'c'), conflitos: 1 },
  { nome: 'mesma mudança dos dois lados', base: lines('a', 'b', 'c'), mine: lines('a', 'X', 'c'), theirs: lines('a', 'X', 'c'), conflitos: 0 },
  { nome: 'inserções diferentes no mesmo ponto', base: lines('a', 'c'), mine: lines('a', 'b1', 'c'), theirs: lines('a', 'b2', 'c'), conflitos: 1 },
  { nome: 'inserções iguais no mesmo ponto', base: lines('a', 'c'), mine: lines('a', 'b', 'c'), theirs: lines('a', 'b', 'c'), conflitos: 0 },
  { nome: 'remoção dos dois lados', base: lines('a', 'b', 'c'), mine: lines('a', 'c'), theirs: lines('a', 'c'), conflitos: 0 },
  { nome: 'remoção contra alteração', base: lines('a', 'b', 'c'), mine: lines('a', 'c'), theirs: lines('a', 'B', 'c'), conflitos: 1 },
  { nome: 'alteração contra remoção', base: lines('a', 'b', 'c'), mine: lines('a', 'B', 'c'), theirs: lines('a', 'c'), conflitos: 1 },
  { nome: 'remoção de bloco contra alteração dentro dele', base: lines('a', 'b', 'c', 'd', 'e'), mine: lines('a', 'e'), theirs: lines('a', 'b', 'C', 'd', 'e'), conflitos: 1 },
  { nome: 'arquivo criado nos dois lados com conteúdos diferentes (base vazia)', base: '', mine: lines('meu'), theirs: lines('dele'), conflitos: 1 },
  { nome: 'arquivo criado nos dois lados com o mesmo conteúdo', base: '', mine: lines('igual'), theirs: lines('igual'), conflitos: 0 },
  { nome: 'um lado esvaziou o arquivo e o outro alterou', base: lines('a', 'b'), mine: '', theirs: lines('a', 'B'), conflitos: 1 },
  { nome: 'um lado esvaziou o arquivo e o outro não mexeu', base: lines('a', 'b'), mine: '', theirs: lines('a', 'b'), conflitos: 0 },
  { nome: 'linhas vizinhas editadas em cada lado', base: lines('a', 'b', 'c', 'd'), mine: lines('a', 'B', 'c', 'd'), theirs: lines('a', 'b', 'C', 'd'), conflitos: 1 },
  { nome: 'conflito na primeira linha', base: lines('a', 'b'), mine: lines('A1', 'b'), theirs: lines('A2', 'b'), conflitos: 1 },
  { nome: 'conflito na última linha', base: lines('a', 'b'), mine: lines('a', 'B1'), theirs: lines('a', 'B2'), conflitos: 1 },
  { nome: 'dois conflitos separados por trecho estável longo', base: lines('1', '2', '3', '4', '5', '6', '7', '8'), mine: lines('M1', '2', '3', '4', '5', '6', '7', 'M8'), theirs: lines('T1', '2', '3', '4', '5', '6', '7', 'T8'), conflitos: 2 },
  { nome: 'adição no fim contra adição no fim', base: lines('a'), mine: lines('a', 'm'), theirs: lines('a', 't'), conflitos: 1 },
  { nome: 'fim sem quebra de linha nos dois lados com alterações diferentes', base: 'a\nb', mine: 'a\nB1', theirs: 'a\nB2', conflitos: 1 },
  { nome: 'fim sem quebra de linha só de um lado', base: 'a\nb\n', mine: 'a\nb', theirs: 'a\nb\nc\n', conflitos: 1 },
  { nome: 'linhas em branco', base: '\n\na\n\n', mine: '\n\nA1\n\n', theirs: '\n\nA2\n\n', conflitos: 1 },
  { nome: 'CRLF nos três', base: 'a\r\nb\r\nc\r\n', mine: 'a\r\nB1\r\nc\r\n', theirs: 'a\r\nB2\r\nc\r\n', conflitos: 1 },
  { nome: 'UTF-8 com acentos', base: lines('ação', 'coração', 'fim'), mine: lines('ação', 'coração 😀', 'fim'), theirs: lines('ação', 'coração ✓', 'fim'), conflitos: 1 },
  { nome: 'texto em chinês e emoji sem conflito', base: lines('你好', '中', '世界'), mine: lines('你好！', '中', '世界'), theirs: lines('你好', '中', '世界 🌏'), conflitos: 0 },
  { nome: 'linhas repetidas sem conflito', base: lines('x', 'x', 'x', 'y'), mine: lines('x', 'x', 'x', 'y', 'm'), theirs: lines('t', 'x', 'x', 'x', 'y'), conflitos: 0 },
  { nome: 'código: import adicionado nos dois lados', base: lines('import a', '', 'fn()'), mine: lines('import a', 'import m', '', 'fn()'), theirs: lines('import a', 'import t', '', 'fn()'), conflitos: 1 },
  { nome: 'JSON: valor alterado dos dois lados', base: lines('{', '  "v": 1,', '  "k": 2', '}'), mine: lines('{', '  "v": 10,', '  "k": 2', '}'), theirs: lines('{', '  "v": 11,', '  "k": 2', '}'), conflitos: 1 },
  { nome: 'só um lado mexeu', base: lines('a', 'b', 'c'), mine: lines('a', 'b', 'c'), theirs: lines('A', 'b', 'C'), conflitos: 0 },
  { nome: 'nenhum lado mexeu', base: lines('a'), mine: lines('a'), theirs: lines('a'), conflitos: 0 },
  { nome: 'três conflitos seguidos com trecho estável entre eles', base: lines('a', 'x', 'b', 'x', 'c', 'x', 'd', 'x', 'e'), mine: lines('a', 'M', 'b', 'x', 'c', 'x', 'd', 'M', 'e'), theirs: lines('a', 'T', 'b', 'x', 'c', 'x', 'd', 'T', 'e'), conflitos: 2 },
  { nome: 'bloco movido de um lado e linha alterada no outro', base: lines('a', 'b', 'c', 'd', 'e'), mine: lines('c', 'd', 'e', 'a', 'b'), theirs: lines('a', 'b', 'C', 'd', 'e'), conflitos: 1 },
  { nome: 'reindentação de um lado e edição do outro na mesma linha', base: lines('if (x) {', '  f()', '}'), mine: lines('if (x) {', '    f()', '}'), theirs: lines('if (x) {', '  g()', '}'), conflitos: 1 },
];

describe('corpus de conflitos', () => {
  it('tem pelo menos 30 casos', () => expect(CORPUS.length).toBeGreaterThanOrEqual(30));

  it.each(CORPUS.map((c) => [c.nome, c] as const))('%s', (_nome, c) => {
    const m = merge(c.base, c.mine, c.theirs);
    const git = gitMerge(c.base, c.mine, c.theirs);
    // o Git (zealous) pode juntar conflitos próximos; aqui só se exige que "há conflito" coincida e que o número não passe do dele quando é 0
    expect(m.conflicts.length > 0).toBe(c.conflitos > 0);
    expect(git.conflicts > 0).toBe(c.conflitos > 0);
    expect(m.conflicts.length).toBe(c.conflitos);
    // "tudo meu" é a minha versão e "tudo da origin" a que chega, byte a byte
    expect(allMine(m)).toBe(c.mine);
    expect(allTheirs(m)).toBe(c.theirs);
    // sem conflito = o que o Git faz; com conflito, "ours" e "theirs" do Git
    if (git.conflicts === 0) expect(resolveMerge(m, emptyChoices()).text).toBe(git.out);
    else {
      expect(resolved(m, { conflicts: 'mine', changes: 'all' })).toBe(gitMerge(c.base, c.mine, c.theirs, '--ours').out);
      expect(resolved(m, { conflicts: 'theirs', changes: 'all' })).toBe(gitMerge(c.base, c.mine, c.theirs, '--theirs').out);
    }
    // nunca sai marcador (quando as entradas não os têm)
    for (const choice of ['mine', 'theirs', 'both', 'both-reversed', 'base', 'none'] as const) {
      const text = resolved(m, { conflicts: choice, changes: 'all' });
      expect(text).not.toBeNull();
      expect(hasConflictMarkers(text!)).toBe(false);
    }
  });
});

describe('codificação: ida e volta exata (UTF-8 e Windows-1252)', () => {
  const doc = (l: string[]) => l.join('\r\n') + '\r\n';
  const versions = {
    base: doc(['ação', 'coração', 'fim']),
    mine: doc(['ação', 'coração ç', 'fim']),
    theirs: doc(['ação', 'coração é', 'fim']),
  };

  it.each([['utf-8'], ['windows-1252']] as const)('%s: decodifica, funde e regrava os mesmos bytes', (enc) => {
    const bytes = (s: string) => encodeText(s, enc);
    const dec = (s: string) => decodeText(bytes(s), enc).text;
    const m = merge(dec(versions.base), dec(versions.mine), dec(versions.theirs));
    expect(m.conflicts).toHaveLength(1);
    // as escolhas voltam como bytes iguais aos da versão escolhida
    expect(encodeText(allMine(m)!, enc).equals(bytes(versions.mine))).toBe(true);
    expect(encodeText(allTheirs(m)!, enc).equals(bytes(versions.theirs))).toBe(true);
    const both = resolved(m, { conflicts: 'both', changes: 'all' })!;
    expect(both).toBe(doc(['ação', 'coração ç', 'coração é', 'fim']));
    expect(decodeText(encodeText(both, enc), enc).text).toBe(both);
  });

  it('Windows-1252 recusa, ao gravar, um caractere digitado que a codificação não tem', () => {
    const m = merge(versions.base, versions.mine, versions.theirs);
    const r = resolveMerge(m, { ...emptyChoices(), picks: { [m.conflicts[0]!]: [{ from: 'typed', text: 'emoji 😀' }] } });
    expect(() => encodeText(r.text!, 'windows-1252')).toThrow();
    expect(() => encodeText(r.text!, 'utf-8')).not.toThrow();
  });
});

describe('desempenho', () => {
  /** 20 mil linhas com 200 conflitos (meta da issue: abrir e aceitar a primeira decisão em até 1 s; cada escolha em até 100 ms). */
  const N = 20_000;
  const base = Array.from({ length: N }, (_, i) => `linha ${i}`);
  const mine = [...base];
  const theirs = [...base];
  for (let k = 0; k < 200; k++) {
    const i = 50 + k * 95;
    mine[i] = `meu ${i}`;
    theirs[i] = `dele ${i}`;
  }
  // mais mudanças sem conflito espalhadas
  for (let i = 20; i < N; i += 95 * 3) mine[i] = `só meu ${i}`;
  for (let i = 80; i < N; i += 95 * 4) theirs[i] = `só dele ${i}`;
  const text = (l: string[]) => l.join('\n') + '\n';

  it('abre em até 1 s e cada escolha atualiza o resultado em até 100 ms', () => {
    const t0 = performance.now();
    const m = merge(text(base), text(mine), text(theirs));
    const r0 = resolveMerge(m, emptyChoices());
    const open = performance.now() - t0;
    expect(m.conflicts).toHaveLength(200);
    expect(r0.pending).toHaveLength(200);
    expect(open).toBeLessThan(1000);

    const choices = emptyChoices();
    const idx = m.conflicts[100]!;
    choices.picks[idx] = presetPicks(m, idx, 'both');
    const t1 = performance.now();
    const r1 = resolveMerge(m, choices);
    const choose = performance.now() - t1;
    expect(r1.pending).toHaveLength(199);
    expect(choose).toBeLessThan(100);
  });

  it('arquivo grande: só uma versão mexeu', () => {
    const m = merge(text(base), text(mine), text(base));
    expect(m.conflicts).toHaveLength(0);
    expect(resolveMerge(m, emptyChoices()).text).toBe(text(mine));
  });
});
