import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { MARKER, MAX_PRS, buildModel, compareUrl, formatDate, isBetaTag, mergeState, parseState, previousStable, renderIssueComment, renderPrComment, tagUrl } from '../lib/release-announce.mjs';

const REPO = 'dono/repo';
type Pr = { number: number; title: string; state: 'merged' | 'open' | 'closed'; commits: string[]; issues: number[] };

// o caso real do marco "Refinamento visual": o PR de release #240 reúne os commits dos PRs #234 a #239
const ORIGINS: Pr[] = [
  { number: 234, title: 'feat(ui): anel de foco nos campos de texto, com o token --gn-ring', state: 'merged', commits: ['a1'], issues: [154] },
  { number: 235, title: 'feat(ui): diálogos usam o GnDialog', state: 'merged', commits: ['b1', 'b2'], issues: [156, 163] },
  { number: 236, title: 'feat(ui): menus e popovers usam tokens', state: 'merged', commits: ['c1'], issues: [157] },
];
const RELEASE_PR: Pr = { number: 240, title: 'feat(ui): refinamento visual', state: 'merged', commits: ['a1', 'b1', 'b2', 'c1', 'm1', 'm2'], issues: [154, 156, 157, 163] };
const model = (over: Partial<Parameters<typeof buildModel>[0]> = {}) =>
  buildModel({ repo: REPO, tag: 'v1.21.0', previous: 'v1.20.0', prerelease: false, date: '2026-11-19', prs: [...ORIGINS, RELEASE_PR], ...over });

describe('tags e datas', () => {
  it('beta, url da release e do comparativo, data em dd/mm/aaaa', () => {
    expect(isBetaTag('v1.21.0-beta.2')).toBe(true);
    expect(isBetaTag('v1.21.0')).toBe(false);
    expect(tagUrl(REPO, 'v1.21.0')).toBe('https://github.com/dono/repo/releases/tag/v1.21.0');
    expect(compareUrl(REPO, 'v1.20.0', 'v1.21.0')).toBe('https://github.com/dono/repo/compare/v1.20.0...v1.21.0');
    expect(formatDate('2026-11-19')).toBe('19/11/2026');
    expect(formatDate('2026-11-19T10:00:00Z')).toBe('19/11/2026');
    expect(formatDate('x')).toBe('x');
  });
  it('previousStable: a maior estável abaixo da base da tag (serve à beta e não muda ao reexecutar uma release antiga)', () => {
    const tags = ['v1.18.0', 'v1.19.0', 'v1.19.0-beta.1', 'v1.20.0', 'v1.21.0-beta.1', 'v1.21.0'];
    expect(previousStable(tags, 'v1.21.0')).toBe('v1.20.0');
    expect(previousStable(tags, 'v1.21.0-beta.2')).toBe('v1.20.0');
    expect(previousStable(tags, 'v1.19.0')).toBe('v1.18.0'); // reexecução de uma release antiga
    expect(previousStable(['v1.0.0'], 'v1.0.0')).toBeNull();
    expect(previousStable(tags, 'lixo')).toBeNull();
  });
});

describe('estado do comentário', () => {
  it('beta soma à lista sem repetir; estável fixa a versão; beta depois da estável não desfaz', () => {
    let s = mergeState(null, { tag: 'v1.21.0-beta.1', prerelease: true, date: '2026-11-18' });
    s = mergeState(s, { tag: 'v1.21.0-beta.2', prerelease: true, date: '2026-11-18' });
    s = mergeState(s, { tag: 'v1.21.0-beta.2', prerelease: true, date: '2026-11-18' });
    expect(s).toEqual({ stable: null, betas: ['v1.21.0-beta.1', 'v1.21.0-beta.2'] });
    s = mergeState(s, { tag: 'v1.21.0', prerelease: false, date: '2026-11-19' });
    expect(s.stable).toEqual({ tag: 'v1.21.0', date: '2026-11-19' });
    expect(mergeState(s, { tag: 'v1.22.0-beta.1', prerelease: true, date: '2026-11-20' })).toEqual(s);
  });
  it('parseState valida o que veio do comentário (pode ter sido editado à mão)', () => {
    const ok = `${MARKER}\n<!-- git-nexus:release-state {"stable":{"tag":"v1.21.0","date":"2026-11-19"},"betas":["v1.21.0-beta.1"]} -->`;
    expect(parseState(ok)).toEqual({ stable: { tag: 'v1.21.0', date: '2026-11-19' }, betas: ['v1.21.0-beta.1'] });
    expect(parseState('sem estado')).toBeNull();
    expect(parseState('<!-- git-nexus:release-state {quebrado} -->')).toBeNull();
    const evil = '<!-- git-nexus:release-state {"stable":{"tag":"<script>"},"betas":["x","v1.0.0","v1.0.0-beta.1"]} -->';
    expect(parseState(evil)).toEqual({ stable: null, betas: ['v1.0.0-beta.1'] });
  });
});

describe('buildModel: agregador e issues', () => {
  it('o PR de release é o pai dos PRs cujos commits estão todos nele; cada origem aponta para ele', () => {
    const m = model();
    const by = Object.fromEntries(m.prs.map((p: { number: number }) => [p.number, p]));
    expect(by[240].children).toEqual([234, 235, 236]);
    expect(by[240].parent).toBeNull();
    for (const n of [234, 235, 236]) expect(by[n].parent).toBe(240);
  });
  it('cada issue aponta para quem a implementou (a origem) e por qual PR entrou', () => {
    const m = model();
    expect(m.issues).toEqual([
      { number: 154, implementers: [234], via: [240] },
      { number: 156, implementers: [235], via: [240] },
      { number: 157, implementers: [236], via: [240] },
      { number: 163, implementers: [235], via: [240] },
    ]);
  });
  it('sem agregador, o PR é o próprio implementador e não há "por quem entrou"', () => {
    const m = model({ prs: [ORIGINS[0]] });
    expect(m.prs[0].parent).toBeNull();
    expect(m.issues).toEqual([{ number: 154, implementers: [234], via: [] }]);
  });
  it('issue citada só pelo agregador: ele é o implementador', () => {
    const m = model({ prs: [{ ...ORIGINS[0], issues: [] }, { ...RELEASE_PR, commits: ['a1', 'x'], issues: [999] }] });
    expect(m.issues).toEqual([{ number: 999, implementers: [240], via: [] }]);
  });
  it('PR fechado sem merge fica de fora; aberto entra (beta de homologação)', () => {
    const m = model({ prs: [ORIGINS[0], { ...ORIGINS[1], state: 'closed' }, { ...ORIGINS[2], state: 'open' }] });
    expect(m.prs.map((p: { number: number }) => p.number)).toEqual([234, 236]);
  });
  it('o teto de PRs mantém os mais recentes e conta os omitidos', () => {
    const many: Pr[] = Array.from({ length: MAX_PRS + 5 }, (_, i) => ({ number: i + 1, title: 't', state: 'merged', commits: [`c${i}`], issues: [] }));
    const m = model({ prs: many });
    expect(m.prs).toHaveLength(MAX_PRS);
    expect(m.omitted).toBe(5);
    expect(m.prs[0].number).toBe(6);
  });
});

describe('comentário do PR agregador', () => {
  const m = model();
  const agg = m.prs.find((p: { number: number }) => p.number === 240);
  it('estável: título com a versão, data, tabela dos agregados, issues entregues e comparativo', () => {
    const { body } = renderPrComment(m, agg);
    expect(body.startsWith(`${MARKER}\n<!-- git-nexus:release-state `)).toBe(true);
    expect(body).toContain('### 🚀 Publicado na [v1.21.0](https://github.com/dono/repo/releases/tag/v1.21.0)');
    expect(body).toContain('`19/11/2026` · versão estável');
    expect(body).toContain('**📦 PRs agregados (3)**');
    expect(body).toContain('| #234 | anel de foco nos campos de texto, com o token --gn-ring | #154 |');
    expect(body).toContain('| #235 | diálogos usam o GnDialog | #156, #163 |');
    expect(body).toContain('- 🎯 Issues entregues (4): #154, #156, #157, #163');
    expect(body).toContain('[O que mudou desde a v1.20.0](https://github.com/dono/repo/compare/v1.20.0...v1.21.0)');
    expect(body).not.toContain('⏳');
  });
  it('beta: "Em homologação", sem a estável ainda', () => {
    const { body } = renderPrComment(model({ tag: 'v1.21.0-beta.1', prerelease: true }), agg);
    expect(body).toContain('### 🧪 Em homologação na [v1.21.0-beta.1]');
    expect(body).toContain('pré-lançamento');
    expect(body).toContain('- 🎯 Issues que serão entregues (4)');
    expect(body).toContain('- ⏳ _A versão estável aparece aqui quando for publicada._');
  });
});

describe('comentário dos PRs de origem', () => {
  const m = model();
  const p235 = m.prs.find((p: { number: number }) => p.number === 235);
  it('estável: aponta para o PR de release e para as issues, com o estado das betas anteriores', () => {
    const prev = { stable: null, betas: ['v1.21.0-beta.1', 'v1.21.0-beta.2'] };
    const { body, state } = renderPrComment(m, p235, prev);
    expect(body).toContain('### 🚀 Publicado na [v1.21.0]');
    expect(body).toContain('- 🧩 Entrou na `main` pelo PR de release #240');
    expect(body).toContain('- 🎯 Entregou as issues #156, #163');
    expect(body).toContain('- 🧪 Passou pelas betas: [v1.21.0-beta.1](https://github.com/dono/repo/releases/tag/v1.21.0-beta.1), [v1.21.0-beta.2]');
    expect(state.stable).toEqual({ tag: 'v1.21.0', date: '2026-11-19' });
  });
  it('uma issue: "a issue" no singular; sem pai nem issue: linha neutra', () => {
    const p234 = m.prs.find((p: { number: number }) => p.number === 234);
    expect(renderPrComment(m, p234).body).toContain('- 🎯 Entregou a issue #154');
    const alone = model({ prs: [{ number: 7, title: 'fix: x', state: 'merged', commits: ['z'], issues: [] }] });
    expect(renderPrComment(alone, alone.prs[0]).body).toContain('- 🧩 Faz parte desta versão');
  });
  it('beta posterior a uma estável não reescreve o comentário', () => {
    const published = { stable: { tag: 'v1.21.0', date: '2026-11-19' }, betas: [] };
    expect(renderPrComment(model({ tag: 'v1.22.0-beta.1', prerelease: true }), p235, published)).toBeNull();
  });
  it('é idempotente: reexecutar com o mesmo estado dá o mesmo corpo', () => {
    const first = renderPrComment(m, p235);
    const again = renderPrComment(m, p235, parseState(first.body));
    expect(again.body).toBe(first.body);
  });
  it('só as betas mais recentes aparecem, com o resumo do que ficou de fora', () => {
    const betas = Array.from({ length: 9 }, (_, i) => `v1.21.0-beta.${i + 1}`);
    const { body } = renderPrComment(m, p235, { stable: null, betas });
    expect(body).toContain('… e 3 antes,');
    expect(body).toContain('beta.9');
    expect(body).not.toContain('beta.1]');
  });
});

describe('comentário da issue', () => {
  const m = model();
  it('estável: implementação, por qual PR entrou e a release', () => {
    const { body } = renderIssueComment(m, m.issues.find((i: { number: number }) => i.number === 156));
    expect(body).toContain('### ✅ Entregue na [v1.21.0]');
    expect(body).toContain('| 🔧 Implementação | #235 |');
    expect(body).toContain('| 📦 Entrou na `main` por | #240 |');
    expect(body).toContain('| 🏷️ Release | [v1.21.0]');
  });
  it('beta: "Em homologação" e "Agregado em"', () => {
    const mb = model({ tag: 'v1.21.0-beta.1', prerelease: true });
    const { body } = renderIssueComment(mb, mb.issues[0]);
    expect(body).toContain('### 🧪 Em homologação na [v1.21.0-beta.1]');
    expect(body).toContain('| 📦 Agregado em | #240 |');
    expect(body).toContain('⏳ _A versão estável aparece aqui');
  });
  it('a estável acumula as betas por que a issue passou', () => {
    const { body } = renderIssueComment(m, m.issues[0], { stable: null, betas: ['v1.21.0-beta.1'] });
    expect(body).toContain('| 🧪 Betas | [v1.21.0-beta.1]');
  });
});

describe('texto vindo de fora', () => {
  it('título de PR: sem @menções, sem quebrar a tabela (pipe) e sem o prefixo do tipo', () => {
    const m = model({ prs: [{ number: 1, title: 'fix(x): a | b @alguem', state: 'merged', commits: ['q'], issues: [] }, { number: 2, title: 'feat: pai', state: 'merged', commits: ['q', 'r'], issues: [] }] });
    const { body } = renderPrComment(m, m.prs.find((p: { number: number }) => p.number === 2));
    expect(body).toContain('a \\| b @​alguem');
    expect(body).not.toContain('fix(x):');
  });
});

describe('release.yml: o job announce', () => {
  const yml = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n');
  const job = (name: string) => {
    const start = yml.indexOf(`\n  ${name}:\n`);
    const rest = yml.slice(start + 1);
    const end = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
    return end === -1 ? rest : rest.slice(0, end + 1);
  };
  const announce = job('announce');

  it('roda depois do release, só com ele publicado, e não bloqueia nada', () => {
    expect(announce).toContain('needs: [version, release]');
    expect(announce).toContain("if: ${{ needs.release.result == 'success' }}");
    expect(announce).toContain('continue-on-error: true');
  });
  it('as permissões de escrita são só do job (o workflow segue com contents: read)', () => {
    expect(yml).toMatch(/^permissions:\n {2}contents: read/m);
    expect(announce).toContain('pull-requests: write');
    expect(announce).toContain('issues: write');
    expect(announce).not.toContain('contents: write');
  });
  it('não entra no notify-failure: uma falha nos comentários não vira "Falha na release"', () => {
    expect(job('notify-failure')).toContain('needs: [version, quality, build, release]');
    expect(job('notify-failure')).not.toContain('announce');
  });
  it('baixa o histórico e as tags, e passa tag, repositório, commit e canal por variável de ambiente (nada interpolado no script)', () => {
    expect(announce).toContain('fetch-depth: 0');
    expect(announce).toContain('fetch-tags: true');
    expect(announce).toContain('node scripts/release-announce.mjs --tag "$TAG" --repo "$GITHUB_REPOSITORY" --sha "$GITHUB_SHA" --prerelease "$PRERELEASE"');
    const run = announce.slice(announce.indexOf('run: node scripts/release-announce.mjs'));
    expect(run.split('\n')[0]).not.toContain('${{');
  });
});
