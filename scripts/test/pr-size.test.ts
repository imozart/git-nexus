import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { SIZES, SIZE_LABELS, SIZE_XL, countLines, isIgnored, sizeLabel } from '../lib/pr-size.mjs';

const catalog = JSON.parse(readFileSync(join(__dirname, '..', '..', '.github', 'labels.json'), 'utf8')) as Array<{ name: string; description: string }>;

describe('sizeLabel', () => {
  it('cai na faixa certa, com o limite superior inclusivo', () => {
    expect(sizeLabel(0)).toBe('tamanho: XS');
    expect(sizeLabel(10)).toBe('tamanho: XS');
    expect(sizeLabel(11)).toBe('tamanho: S');
    expect(sizeLabel(50)).toBe('tamanho: S');
    expect(sizeLabel(51)).toBe('tamanho: M');
    expect(sizeLabel(200)).toBe('tamanho: M');
    expect(sizeLabel(201)).toBe('tamanho: L');
    expect(sizeLabel(500)).toBe('tamanho: L');
    expect(sizeLabel(501)).toBe(SIZE_XL);
    expect(sizeLabel(100000)).toBe(SIZE_XL);
  });

  it('as faixas combinam com as descrições do catálogo de labels', () => {
    const byName = new Map(catalog.map((l) => [l.name, l.description]));
    for (const l of SIZE_LABELS) expect(byName.has(l), l).toBe(true);
    for (const s of SIZES) expect(byName.get(s.label), s.label).toContain(String(s.max));
    expect(byName.get(SIZE_XL)).toContain(String(SIZES.at(-1).max));
  });
});

describe('countLines', () => {
  it('soma adições e remoções e ignora lockfile e snapshots', () => {
    const files = [
      { filename: 'apps/studio/src/a.ts', additions: 10, deletions: 4 },
      { filename: 'pnpm-lock.yaml', additions: 900, deletions: 300 },
      { filename: 'apps/x/__snapshots__/a.snap', additions: 50, deletions: 0 },
      { filename: 'docs/b.md', additions: 6, deletions: 0 },
    ];
    expect(countLines(files)).toBe(20);
  });

  it('lista vazia (ou só arquivos ignorados) dá zero', () => {
    expect(countLines([])).toBe(0);
    expect(countLines([{ filename: 'sub/pnpm-lock.yaml', additions: 5, deletions: 5 }])).toBe(0);
  });

  it('isIgnored só pega os padrões gerados', () => {
    expect(isIgnored('pnpm-lock.yaml')).toBe(true);
    expect(isIgnored('apps/ui/dist/app.min.js')).toBe(true);
    expect(isIgnored('apps/studio/package.json')).toBe(false);
    expect(isIgnored('docs/pnpm-lock-notes.md')).toBe(false);
  });
});
