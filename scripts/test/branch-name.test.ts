import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { BRANCH_PREFIXES, MAX_BRANCH, checkBranchName } from '../lib/branch-name.mjs';
// @ts-expect-error módulo .mjs sem tipos
import { PR_TYPES } from '../lib/pr-title.mjs';

describe('checkBranchName', () => {
  it('aceita tipo/descricao, inclusive com subpastas, pontos e números', () => {
    for (const b of ['feat/painel-de-log', 'fix/issue-123', 'ci/labels-catalog', 'docs/v1.4.0-notes', 'feat/ui/combobox', 'hotfix/crash-no-merge', 'chore/public-repo']) {
      expect(checkBranchName(b).errors, b).toEqual([]);
    }
  });

  it('recusa formato errado: sem tipo, maiúsculas, espaços, fim com separador', () => {
    for (const b of ['main', 'minha-branch', 'Feat/Algo', 'feat/', 'feat/algo-', 'feat/a b', 'feature/algo', 'feat//x', 'feat/a..b', 'FIX/x']) {
      expect(checkBranchName(b).ok, b).toBe(false);
    }
  });

  it('branches de bots e de release ficam de fora', () => {
    for (const b of ['dependabot/npm_and_yarn/vue-3.5.1', 'renovate/vue-3.x', 'release/1.5']) expect(checkBranchName(b, 'qualquer coisa').ok, b).toBe(true);
  });

  it('limita o tamanho', () => {
    const ok = `feat/${'a'.repeat(MAX_BRANCH - 5)}`;
    expect(checkBranchName(ok).ok).toBe(true);
    expect(checkBranchName(`${ok}a`).ok).toBe(false);
  });

  it('exige o mesmo tipo na branch e no título; hotfix vale como fix', () => {
    expect(checkBranchName('feat/algo', 'feat(ui): algo').ok).toBe(true);
    expect(checkBranchName('hotfix/crash', 'fix: corrige o crash').ok).toBe(true);
    const r = checkBranchName('feat/algo', 'fix: corrige');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/"feat\/".*"fix"/);
  });

  it('título sem tipo válido não gera erro aqui (quem cobra é o pr-title)', () => {
    expect(checkBranchName('feat/algo', 'Algo sem formato').ok).toBe(true);
    expect(checkBranchName('feat/algo').ok).toBe(true);
  });

  it('vazio é inválido', () => {
    expect(checkBranchName('').ok).toBe(false);
    expect(checkBranchName(undefined).ok).toBe(false);
  });

  it('os prefixos aceitos cobrem todos os tipos do título do PR', () => {
    for (const t of PR_TYPES) expect(BRANCH_PREFIXES, t).toContain(t);
  });
});

describe('scripts/check-branch-name.mjs', () => {
  const run = (branch: string, title?: string) => {
    try {
      const out = execFileSync('node', ['scripts/check-branch-name.mjs'], { env: { ...process.env, BRANCH_NAME: branch, ...(title ? { PR_TITLE: title } : {}) }, cwd: join(__dirname, '..', '..'), encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stderr: string };
      return { code: err.status, out: err.stderr };
    }
  };

  it('sai com 0 quando válido e com 1 quando inválido, listando os motivos', () => {
    expect(run('fix/x', 'fix: x').code).toBe(0);
    const bad = run('Minha Branch');
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/inválido/);
  });
});
