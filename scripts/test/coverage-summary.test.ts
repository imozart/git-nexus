import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { renderCoverage } from '../lib/coverage-summary.mjs';

const m = (covered: number, total: number) => ({ total, covered, skipped: 0, pct: total ? Math.round((covered / total) * 10000) / 100 : 100 });
const file = (c: number, t: number) => ({ lines: m(c, t), statements: m(c, t), functions: m(c, t), branches: m(c, t) });

describe('renderCoverage', () => {
  const summary = {
    total: file(90, 100),
    'C:\\repo\\packages\\a\\src\\bom.ts': file(10, 10),
    'C:\\repo\\packages\\a\\src\\ruim.ts': file(1, 10),
    'C:\\repo\\packages\\a\\src\\medio.ts': file(5, 10),
    'C:\\repo\\packages\\a\\src\\vazio.ts': file(0, 0),
  };

  it('mostra a tabela de totais', () => {
    const md = renderCoverage(summary, 'C:\\repo');
    expect(md).toContain('## Cobertura de testes');
    expect(md).toContain('| Linhas | 90.00% | 90 / 100 |');
    expect(md).toContain('| Ramos | 90.00% | 90 / 100 |');
  });

  it('lista os arquivos de menor cobertura, com caminho curto, e ignora arquivo sem linhas', () => {
    const md = renderCoverage(summary, 'C:\\repo', 2);
    expect(md).toContain('2 arquivos com menor cobertura');
    expect(md.indexOf('packages/a/src/ruim.ts')).toBeLessThan(md.indexOf('packages/a/src/medio.ts'));
    expect(md).not.toContain('bom.ts');
    expect(md).not.toContain('vazio.ts');
    expect(md).not.toContain('C:/repo');
  });

  it('aguenta resumo sem arquivos', () => {
    expect(renderCoverage({ total: file(0, 0) })).not.toContain('menor cobertura');
  });
});
