import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { MAX_DESCRIPTION, MAX_NAME, planLabels, validateCatalog } from '../lib/labels.mjs';

const catalog = JSON.parse(readFileSync(join(__dirname, '..', '..', '.github', 'labels.json'), 'utf8')) as Array<{ name: string; color: string; description: string }>;

describe('catálogo .github/labels.json', () => {
  it('é válido (nomes únicos, cores hexadecimais, limites do GitHub)', () => {
    expect(validateCatalog(catalog)).toEqual([]);
  });

  it('cobre os tipos de Conventional Commits do pr-title', () => {
    const names = new Set(catalog.map((l) => l.name));
    for (const n of ['enhancement', 'bug', 'documentation', 'performance', 'refatoração', 'testes', 'build', 'ci', 'estilo', 'chore', 'reversão', 'breaking change']) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it('inclui as labels de área usadas pelo .github/labeler.yml, quando ele existe', () => {
    const names = new Set(catalog.map((l) => l.name));
    for (const n of ['área: app', 'área: ui-kit', 'área: git-core', 'área: política', 'área: ci', 'área: docs', 'dependências']) expect(names.has(n), n).toBe(true);
  });
});

describe('validateCatalog', () => {
  it('aponta nome repetido (sem diferenciar maiúsculas), cor e descrição inválidas', () => {
    const p = validateCatalog([
      { name: 'Bug', color: 'ff0000', description: 'a' },
      { name: 'bug', color: 'ff0000', description: 'b' },
      { name: 'x', color: '#fff', description: 'c' },
      { name: 'y', color: '000000', description: '' },
      { name: 'z', color: '000000', description: 'd'.repeat(MAX_DESCRIPTION + 1) },
      { name: 'n'.repeat(MAX_NAME + 1), color: '000000', description: 'ok' },
      { color: '000000', description: 'sem nome' },
    ]);
    expect(p).toHaveLength(6);
    expect(p.join('\n')).toMatch(/repetido/);
    expect(p.join('\n')).toMatch(/6 dígitos/);
    expect(p.join('\n')).toMatch(/falta a descrição/);
  });

  it('recusa o que não é lista', () => {
    expect(validateCatalog({})).toHaveLength(1);
  });
});

describe('planLabels', () => {
  const want = [
    { name: 'bug', color: 'd73a4a', description: 'Correção' },
    { name: 'novo', color: '00ff00', description: 'Nova' },
    { name: 'igual', color: 'abcdef', description: 'Igual' },
  ];

  it('separa o que criar, atualizar e deixar como está (nome sem diferenciar maiúsculas; cor também)', () => {
    const plan = planLabels(
      [
        { name: 'Bug', color: 'D73A4A', description: 'Something isn\'t working' },
        { name: 'igual', color: 'ABCDEF', description: 'Igual' },
        { name: 'outra', color: '000000', description: '' },
      ],
      want,
    );
    expect(plan.create.map((l: { name: string }) => l.name)).toEqual(['novo']);
    expect(plan.update.map((l: { name: string; current: string }) => [l.name, l.current])).toEqual([['bug', 'Bug']]);
    expect(plan.same.map((l: { name: string }) => l.name)).toEqual(['igual']);
  });

  it('descrição vazia no GitHub (null) conta como diferente', () => {
    const plan = planLabels([{ name: 'bug', color: 'd73a4a', description: null }], [want[0]]);
    expect(plan.update).toHaveLength(1);
  });
});
