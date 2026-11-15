import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { checkBranchName } from '../lib/branch-name.mjs';
// @ts-expect-error módulo .mjs sem tipos
import { parseCommit } from '../lib/release-core.mjs';
// @ts-expect-error módulo .mjs sem tipos
import { checkPrTitle } from '../lib/pr-title.mjs';

const root = join(__dirname, '..', '..');
const text = readFileSync(join(root, '.github', 'dependabot.yml'), 'utf8').replace(/\r\n/g, '\n');
const catalog = new Set((JSON.parse(readFileSync(join(root, '.github', 'labels.json'), 'utf8')) as Array<{ name: string }>).map((l) => l.name));

/** Blocos `- package-ecosystem: …` do arquivo. */
const updates = text.split(/^ {2}- package-ecosystem: /m).slice(1);
const prefixes = [...text.matchAll(/^ {6}prefix(?:-development)?: "([^"]+)"$/gm)].map((m) => m[1]!);

/** Nomes de dependências declaradas em qualquer package.json do monorepo. */
function declared(): Set<string> {
  const names = new Set<string>();
  for (const dir of ['', 'apps/studio', 'apps/ui-kit', 'packages/git-core', 'packages/governance-policy']) {
    const pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    for (const k of ['dependencies', 'devDependencies']) for (const n of Object.keys(pkg[k] ?? {})) names.add(n);
  }
  return names;
}

describe('.github/dependabot.yml', () => {
  it('cobre npm (pnpm) e as actions dos workflows, uma vez por semana', () => {
    expect(updates.map((u) => u.split('\n')[0])).toEqual(['npm', 'github-actions']);
    for (const u of updates) {
      expect(u).toMatch(/^ {6}interval: weekly$/m);
      expect(u).toMatch(/^ {4}directory: \/$/m);
    }
  });

  it('as labels existem no catálogo', () => {
    const labels = [...text.matchAll(/^ {6}- (.+)$/gm)].map((m) => m[1]!.trim());
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(catalog.has(l), l).toBe(true);
  });

  it('os prefixos produzem títulos aceitos pelo check "Título do PR"', () => {
    expect(prefixes.sort()).toEqual(['build(deps)', 'chore(deps-dev)', 'ci(deps)']);
    for (const p of prefixes) expect(checkPrTitle(`${p}: bump vue from 3.5.1 to 3.5.2`).errors, p).toEqual([]);
  });

  it('o pipeline lê os prefixos como build / chore / ci (o release.yml pula ci(deps) e chore(deps-dev))', () => {
    const type = (p: string) => parseCommit({ hash: 'a'.repeat(40), author: 'bot', subject: `${p}: bump x from 1 to 2`, body: '' }).type;
    expect(type('build(deps)')).toBe('build');
    expect(type('chore(deps-dev)')).toBe('chore');
    expect(type('ci(deps)')).toBe('ci');
    const release = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(release).toContain("'ci(deps)'");
    expect(release).toContain("'chore(deps-dev)'");
  });

  it('as branches do Dependabot passam na regra de nome de branch', () => {
    expect(checkBranchName('dependabot/npm_and_yarn/vue-3.5.2', 'build(deps): bump vue').ok).toBe(true);
    expect(checkBranchName('dependabot/github_actions/actions/checkout-8', 'ci(deps): bump actions/checkout').ok).toBe(true);
  });

  it('todo grupo cita dependências que existem (nome sem curinga) e a espera de 7 dias está ligada', () => {
    const have = declared();
    for (const m of text.matchAll(/patterns: \[([^\]]+)\]/g)) {
      for (const p of [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!)) {
        if (p.includes('*')) continue; // padrão com curinga: não dá para conferir um nome só
        expect(have.has(p), `grupo cita "${p}", que não está em nenhum package.json`).toBe(true);
      }
    }
    expect(text.match(/^ {6}default-days: 7$/gm)?.length).toBe(2);
  });

  it('os padrões com curinga casam pelo menos uma dependência', () => {
    const have = [...declared()];
    expect(have.some((n) => n.startsWith('@codemirror/'))).toBe(true);
    expect(have.some((n) => n.startsWith('@types/'))).toBe(true);
  });
});
