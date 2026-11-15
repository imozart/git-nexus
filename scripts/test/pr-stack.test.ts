import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { MARKER, STACK_LABEL, commentBody, mergeOrders, safeTitle, sameBody } from '../lib/pr-stack.mjs';

// Pilha: #1 (c1) <- #2 (c1,c2) <- #3 (c1,c2,c3); #9 é independente.
const prs = [
  { number: 1, title: 'feat: base', headSha: 'c1' },
  { number: 2, title: 'feat: meio', headSha: 'c2' },
  { number: 3, title: 'feat: topo', headSha: 'c3' },
  { number: 9, title: 'fix: solto', headSha: 'x1' },
];
const commits = new Map<number, Set<string>>([
  [1, new Set(['c1'])],
  [2, new Set(['c1', 'c2'])],
  [3, new Set(['c1', 'c2', 'c3'])],
  [9, new Set(['x1'])],
]);

describe('mergeOrders', () => {
  it('ordena cada PR da pilha: dependências da menor para a maior, o próprio PR por último', () => {
    const o = mergeOrders(prs, commits);
    expect(o.get(2)).toEqual([1, 2]);
    expect(o.get(3)).toEqual([1, 2, 3]);
  });

  it('o PR de baixo e o independente não aparecem (não dependem de ninguém)', () => {
    const o = mergeOrders(prs, commits);
    expect(o.has(1)).toBe(false);
    expect(o.has(9)).toBe(false);
  });

  it('quando o PR de baixo é mergeado (sai da lista de abertos), os de cima ficam livres', () => {
    const o = mergeOrders(prs.filter((p) => p.number !== 1), commits);
    expect(o.get(2)).toBeUndefined();
    expect(o.get(3)).toEqual([2, 3]);
  });

  it('PRs com a mesma ponta (branches idênticas) não se bloqueiam', () => {
    const same = [
      { number: 5, title: 'a', headSha: 's' },
      { number: 6, title: 'b', headSha: 's' },
    ];
    expect(mergeOrders(same, new Map([[5, new Set(['s'])], [6, new Set(['s'])]])).size).toBe(0);
  });

  it('PR sem comparação (não está no mapa de commits) é ignorado', () => {
    expect(mergeOrders(prs, new Map([[1, new Set(['c1'])]])).size).toBe(0);
  });

  it('desempata dependências com o mesmo tamanho pelo número do PR', () => {
    const ps = [
      { number: 7, title: 'a', headSha: 'a' },
      { number: 4, title: 'b', headSha: 'b' },
      { number: 8, title: 'c', headSha: 'c' },
    ];
    const cm = new Map<number, Set<string>>([[7, new Set(['a'])], [4, new Set(['b'])], [8, new Set(['a', 'b', 'c'])]]);
    expect(mergeOrders(ps, cm).get(8)).toEqual([4, 7, 8]);
  });
});

describe('commentBody', () => {
  const titles = new Map([[1, 'feat: base'], [2, 'feat: meio']]);

  it('começa com a marca, lista a ordem e destaca o PR atual', () => {
    const b = commentBody(2, [1, 2], titles);
    expect(b.startsWith(MARKER)).toBe(true);
    expect(b).toContain('1. #1 — feat: base');
    expect(b).toContain('2. **#2 (este PR)** — feat: meio');
    expect(b).toContain(STACK_LABEL);
  });

  it('título do PR não vira menção nem quebra a lista', () => {
    expect(safeTitle('fix: avisa @fulano\n- injeção')).toBe('fix: avisa @​fulano - injeção');
    const b = commentBody(2, [1, 2], new Map([[1, 'a @equipe\nb'], [2, 'x']]));
    expect(b).not.toMatch(/@equipe/);
    expect(b.split('\n').filter((l) => /^\d+\. /.test(l))).toHaveLength(2);
  });
});

describe('sameBody', () => {
  it('ignora fim de linha e espaços nas pontas', () => {
    expect(sameBody('a\r\nb\n', 'a\nb')).toBe(true);
    expect(sameBody('a', 'b')).toBe(false);
    expect(sameBody(undefined, '')).toBe(true);
  });
});

describe('catálogo', () => {
  it('a label "bloqueado" existe', () => {
    const catalog = JSON.parse(readFileSync(join(__dirname, '..', '..', '.github', 'labels.json'), 'utf8')) as Array<{ name: string }>;
    expect(catalog.map((l) => l.name)).toContain(STACK_LABEL);
  });
});
