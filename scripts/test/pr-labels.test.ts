import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { BREAKING_LABEL, MANAGED, TYPE_LABEL, desiredTypeLabels, diffLabels, parseTitle, typeFromBranch } from '../lib/pr-labels.mjs';
// @ts-expect-error módulo .mjs sem tipos
import { PR_TYPES } from '../lib/pr-title.mjs';

const catalog = JSON.parse(readFileSync(join(__dirname, '..', '..', '.github', 'labels.json'), 'utf8')) as Array<{ name: string }>;

describe('mapa tipo -> label', () => {
  it('cobre todos os tipos aceitos no título do PR', () => {
    expect(Object.keys(TYPE_LABEL).sort()).toEqual([...PR_TYPES].sort());
  });

  it('só usa labels que existem no catálogo', () => {
    const names = new Set(catalog.map((l) => l.name));
    for (const l of MANAGED) expect(names.has(l), l).toBe(true);
  });
});

describe('parseTitle', () => {
  it('lê tipo e breaking, com ou sem escopo', () => {
    expect(parseTitle('feat: algo')).toEqual({ type: 'feat', breaking: false });
    expect(parseTitle('fix(git-core): algo')).toEqual({ type: 'fix', breaking: false });
    expect(parseTitle('feat(api)!: remove')).toEqual({ type: 'feat', breaking: true });
  });

  it('devolve null para formato ou tipo inválido', () => {
    expect(parseTitle('Atualiza coisas')).toBeNull();
    expect(parseTitle('feature: algo')).toBeNull();
    expect(parseTitle('')).toBeNull();
    expect(parseTitle(undefined)).toBeNull();
  });
});

describe('typeFromBranch', () => {
  it('usa o prefixo da branch; hotfix conta como correção', () => {
    expect(typeFromBranch('feat/combobox')).toBe('feat');
    expect(typeFromBranch('hotfix/crash')).toBe('fix');
    expect(typeFromBranch('ci/labels')).toBe('ci');
  });

  it('ignora o que não é prefixo conhecido', () => {
    expect(typeFromBranch('main')).toBeNull();
    expect(typeFromBranch('dependabot/npm_and_yarn/vue-3')).toBeNull();
    expect(typeFromBranch('algo/novo')).toBeNull();
    expect(typeFromBranch(undefined)).toBeNull();
  });
});

describe('desiredTypeLabels', () => {
  it('o título manda sobre a branch', () => {
    expect(desiredTypeLabels({ title: 'fix: corrige', branch: 'feat/x' })).toEqual(['bug']);
  });

  it('sem tipo válido no título, vale a branch', () => {
    expect(desiredTypeLabels({ title: 'Corrige o painel', branch: 'fix/painel' })).toEqual(['bug']);
    expect(desiredTypeLabels({ title: 'Corrige o painel', branch: 'qualquer' })).toEqual([]);
  });

  it('"!" no título ou BREAKING CHANGE no corpo acrescenta breaking change', () => {
    expect(desiredTypeLabels({ title: 'feat(api)!: remove', branch: 'feat/x' })).toEqual(['enhancement', BREAKING_LABEL]);
    expect(desiredTypeLabels({ title: 'feat: algo', branch: 'feat/x', body: 'Texto\n\nBREAKING CHANGE: a rota some' })).toEqual(['enhancement', BREAKING_LABEL]);
    expect(desiredTypeLabels({ title: 'feat: algo', branch: 'feat/x', body: 'cita BREAKING CHANGE: no meio da frase' })).toEqual(['enhancement']);
  });
});

describe('diffLabels', () => {
  it('troca a label de tipo e não mexe nas de outros grupos', () => {
    const d = diffLabels(['bug', 'área: app', 'tamanho: S'], ['enhancement']);
    expect(d).toEqual({ add: ['enhancement'], remove: ['bug'] });
  });

  it('não repete o que já está certo e remove breaking que deixou de valer', () => {
    expect(diffLabels(['enhancement'], ['enhancement'])).toEqual({ add: [], remove: [] });
    expect(diffLabels(['enhancement', BREAKING_LABEL], ['enhancement'])).toEqual({ add: [], remove: [BREAKING_LABEL] });
  });

  it('se o título perde o tipo, tira a label de tipo antiga', () => {
    expect(diffLabels(['bug'], [])).toEqual({ add: [], remove: ['bug'] });
  });
});
