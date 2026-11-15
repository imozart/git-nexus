import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { MAX_TITLE, PR_TYPES, checkPrTitle } from '../lib/pr-title.mjs';

describe('checkPrTitle', () => {
  it('aceita Conventional Commits, com ou sem escopo e com breaking', () => {
    for (const t of [
      'feat: painel de log',
      'fix(git-core): corrige o mascaramento de tokens',
      'feat(api)!: remove a rota antiga',
      'chore(deps): bump vue from 3.5.1 to 3.5.2',
      'ci(deps-dev): atualiza actions',
      'revert: desfaz a mudança do seletor',
      'docs: guia de i18n (#12)',
    ]) {
      expect(checkPrTitle(t), t).toEqual({ ok: true, errors: [] });
    }
  });

  it('recusa título vazio, sem tipo ou fora do formato', () => {
    for (const t of ['', '   ', 'Atualiza o README', 'feat', 'feat(log) painel', ': sem tipo', 'Merge branch main into x']) {
      expect(checkPrTitle(t).ok, JSON.stringify(t)).toBe(false);
    }
  });

  it('recusa tipo desconhecido ou em maiúsculas, e diz quais valem', () => {
    const r = checkPrTitle('Feat: algo novo');
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('feat, fix');
    expect(checkPrTitle('feature: algo novo').ok).toBe(false);
    for (const type of PR_TYPES) expect(checkPrTitle(`${type}: ok sim`).ok, type).toBe(true);
  });

  it('confere escopo, espaço depois dos dois-pontos, descrição e tamanho', () => {
    expect(checkPrTitle('feat(): algo').ok).toBe(false);
    expect(checkPrTitle('feat(dois nomes): algo').ok).toBe(false);
    expect(checkPrTitle('feat:sem espaço').ok).toBe(false);
    expect(checkPrTitle('feat: ab').ok).toBe(false);
    expect(checkPrTitle(`feat: ${'x'.repeat(MAX_TITLE)}`).ok).toBe(false);
    expect(checkPrTitle(`feat: ${'x'.repeat(MAX_TITLE - 6)}`).ok).toBe(true);
  });
});

describe('check-pr-title.mjs (CLI)', () => {
  const run = (title: string) => {
    try {
      const out = execFileSync(process.execPath, ['scripts/check-pr-title.mjs'], { env: { ...process.env, PR_TITLE: title, GITHUB_ACTIONS: '' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stderr: string };
      return { code: err.status, out: err.stderr };
    }
  };

  it('sai com 0 para título válido e 1 (com explicação) para inválido', () => {
    expect(run('fix: corrige algo').code).toBe(0);
    const bad = run('corrige algo');
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('tipo(escopo): descrição');
  });

  it('título com aspas e cifrão não é interpretado como shell', () => {
    expect(run('feat: usa $(echo x) e "aspas"').code).toBe(0);
  });
});
