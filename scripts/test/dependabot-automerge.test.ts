import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// O merge automático do Dependabot mexe em quem pode entrar na main sem revisão humana: as travas abaixo não podem sumir em silêncio.
const root = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8').replace(/\r\n/g, '\n');
const wf = read('.github', 'workflows', 'dependabot-automerge.yml');

describe('dependabot-automerge.yml', () => {
  it('só age em PR aberto pelo Dependabot, com o ator do Dependabot', () => {
    expect(wf).toContain("github.event.pull_request.user.login == 'dependabot[bot]'");
    expect(wf).toContain("github.actor == 'dependabot[bot]'");
  });

  it('usa pull_request (nunca pull_request_target, que daria secrets a código de PR)', () => {
    expect(wf).toMatch(/^on: pull_request$/m);
    expect(wf).not.toContain('pull_request_target');
  });

  it('liga o auto-merge com merge commit e não junta na hora (espera os checks do ruleset)', () => {
    expect(wf).toContain('gh pr merge --auto --merge "$PR_URL"');
    expect(wf).not.toMatch(/--squash|--rebase|--admin/);
  });

  it('major e Electron ficam para revisão manual', () => {
    const ativar = wf.slice(wf.indexOf('- name: Ativar o auto-merge'), wf.indexOf('- name: Aviso'));
    expect(ativar).toContain("steps.meta.outputs.update-type != 'version-update:semver-major'");
    expect(ativar).toContain("!contains(steps.meta.outputs.dependency-names, 'electron')");
  });

  it('permissões mínimas: leitura no topo e escrita só no job; a action vem fixada por SHA', () => {
    expect(wf).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(wf).toMatch(/ {4}permissions:\n {6}contents: write\n {6}pull-requests: write\n/);
    for (const m of wf.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) expect(m[1], m[1]).toMatch(/@[0-9a-f]{40}$/);
  });

  it('o repositório aceita merge commit, e o título do PR (chore(deps-dev), ci(deps)) segue sem publicar release', () => {
    const dependabot = read('.github', 'dependabot.yml');
    expect(dependabot).toContain('prefix-development: "chore(deps-dev)"');
    expect(dependabot).toContain('prefix: "ci(deps)"');
    const release = read('.github', 'workflows', 'release.yml');
    expect(release).toContain("contains(github.event.head_commit.message, 'chore(deps-dev)')");
    expect(release).toContain("contains(github.event.head_commit.message, 'ci(deps)')");
  });

  it('a documentação cita o workflow e a lista de checks obrigatórios', () => {
    expect(read('docs', 'AUTOMATION.md')).toContain('dependabot-automerge.yml');
    expect(read('docs', 'REPOSITORIO.md')).toContain('Checks obrigatórios');
  });
});
