import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { BEHIND_LABEL, behindAction, behindCount } from '../lib/pr-behind.mjs';

const commit = (subject: string, parents = 1) => ({ parents, subject });

describe('behindCount', () => {
  it('conta commits com conteúdo novo', () => {
    expect(behindCount([commit('fix: a'), commit('feat: b')])).toBe(2);
  });

  it('não conta merge commit (o que ele junta já aparece nos commits dele)', () => {
    expect(behindCount([commit('Merge pull request #5 from o/b', 2)])).toBe(0);
    expect(behindCount([commit('fix: a'), commit('Merge pull request #5 from o/b', 2)])).toBe(1);
  });

  it('não conta o commit chore(release) do pipeline', () => {
    expect(behindCount([commit('chore(release): v1.5.0 [skip release]')])).toBe(0);
    expect(behindCount([commit('chore(release): v1.5.0 [skip release]'), commit('docs: x')])).toBe(1);
  });

  it('chore comum e outros tipos contam (só o de release é especial)', () => {
    expect(behindCount([commit('chore: limpa'), commit('chore(deps-dev): bump vitest')])).toBe(2);
  });

  it('sem commits, zero', () => {
    expect(behindCount([])).toBe(0);
  });
});

describe('behindAction', () => {
  it('atrasado sem a label -> adiciona; com a label -> nada', () => {
    expect(behindAction(3, ['bug'])).toBe('add');
    expect(behindAction(3, ['bug', BEHIND_LABEL])).toBe('none');
  });

  it('em dia com a label -> remove; sem a label -> nada', () => {
    expect(behindAction(0, [BEHIND_LABEL])).toBe('remove');
    expect(behindAction(0, [])).toBe('none');
  });
});

describe('integração com o repositório', () => {
  const root = join(__dirname, '..', '..');

  it('a label existe no catálogo', () => {
    const catalog = JSON.parse(readFileSync(join(root, '.github', 'labels.json'), 'utf8')) as Array<{ name: string }>;
    expect(catalog.map((l) => l.name)).toContain(BEHIND_LABEL);
  });

  it('o workflow roda no push da main e nos eventos do PR, sem fazer checkout do código do PR', () => {
    const t = readFileSync(join(root, '.github', 'workflows', 'pr-behind.yml'), 'utf8').replace(/\r\n/g, '\n');
    expect(t).toMatch(/^ {2}push:\n {4}branches: \[main\]/m);
    expect(t).toMatch(/pull_request_target:\n {4}types: \[opened, synchronize, reopened\]/);
    expect(t).not.toMatch(/ref: \$\{\{ github\.(head_ref|event\.pull_request)/);
  });
});
