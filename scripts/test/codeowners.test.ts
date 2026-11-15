import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const rules = readFileSync(join(root, '.github', 'CODEOWNERS'), 'utf8')
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [pattern, ...owners] = l.split(/\s+/);
    return { pattern: pattern!, owners };
  });

describe('.github/CODEOWNERS', () => {
  it('toda regra tem ao menos um dono no formato @usuario ou @org/time', () => {
    expect(rules.length).toBeGreaterThan(3);
    for (const r of rules) {
      expect(r.owners.length, r.pattern).toBeGreaterThan(0);
      for (const o of r.owners) expect(o, `${r.pattern}: ${o}`).toMatch(/^@[A-Za-z0-9][A-Za-z0-9-]*(\/[A-Za-z0-9._-]+)?$/);
    }
  });

  it('a regra geral vem primeiro (vale a última que casa, então as específicas ficam depois)', () => {
    expect(rules[0]?.pattern).toBe('*');
  });

  it('todo caminho citado existe (renomear uma pasta sem atualizar o arquivo deixaria a regra morta)', () => {
    for (const r of rules) {
      if (r.pattern === '*') continue;
      const path = r.pattern.replace(/^\//, '').replace(/\/$/, '');
      expect(existsSync(join(root, path)), r.pattern).toBe(true);
    }
  });

  it('cobre as pastas de código, os workflows e os scripts', () => {
    const patterns = rules.map((r) => r.pattern);
    for (const p of ['/apps/studio/', '/apps/ui-kit/', '/packages/git-core/', '/packages/governance-policy/', '/.github/', '/scripts/']) expect(patterns, p).toContain(p);
  });
});
