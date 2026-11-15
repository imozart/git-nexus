import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { RELEASE_TYPES, parseCommit, shouldRelease } from '../lib/release-core.mjs';

const c = (subject: string, body = '') => parseCommit({ hash: 'a'.repeat(40), author: 'Ana', subject, body });

describe('shouldRelease', () => {
  it('só publica quando algum commit muda o app', () => {
    for (const s of ['feat: x', 'fix: x', 'perf: x', 'refactor: x', 'build(deps): bump vue', 'Mensagem fora do padrão']) {
      expect(shouldRelease([c(s)]), s).toBe(true);
    }
  });

  it('documentação, testes, CI, estilo e manutenção não publicam', () => {
    for (const s of ['docs: x', 'test: x', 'ci: x', 'ci(deps): bump actions/checkout', 'style: x', 'chore: x', 'chore(deps-dev): bump vitest']) {
      expect(shouldRelease([c(s)]), s).toBe(false);
    }
  });

  it('breaking publica mesmo em tipo que normalmente não publica', () => {
    expect(shouldRelease([c('ci!: muda o contrato do pipeline')])).toBe(true);
    expect(shouldRelease([c('docs: x', 'BREAKING CHANGE: muda a API')])).toBe(true);
  });

  it('um commit que muda o app entre vários internos basta', () => {
    expect(shouldRelease([c('ci: a'), c('docs: b'), c('fix: c'), c('chore: d')])).toBe(true);
  });

  it('sem commits não publica', () => {
    expect(shouldRelease([])).toBe(false);
  });

  it('a lista de tipos não inclui os internos', () => {
    for (const t of ['docs', 'test', 'ci', 'style', 'chore']) expect(RELEASE_TYPES).not.toContain(t);
  });
});

// Ponta a ponta do `release-info.mjs next` em um repositório git de verdade, em pasta temporária.
const script = join(__dirname, '..', 'release-info.mjs');
let dir: string;
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
const commit = (msg: string) => git('commit', '--allow-empty', '-q', '-m', msg);
const next = (...args: string[]) => {
  const out = execFileSync('node', [script, 'next', ...args], { cwd: dir, encoding: 'utf8' });
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as { release: boolean; version: string; reason?: string };
};

describe('release-info.mjs next (repositório de verdade)', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'release-gate-'));
    execFileSync('node', ['-e', "require('fs').writeFileSync('package.json', JSON.stringify({version:'1.0.0'}))"], { cwd: dir });
    git('init', '-q', '-b', 'main');
    git('add', '.');
    commit('feat: primeira versão');
    git('tag', 'v1.0.0');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('sem commits novos, não publica', () => {
    const r = next();
    expect(r.release).toBe(false);
    expect(r.reason).toMatch(/sem release/);
  });

  it('só docs, CI e manutenção: não publica e explica o motivo', () => {
    commit('docs: ajusta o README');
    commit('ci: muda um workflow');
    commit('chore(deps-dev): bump vitest');
    const r = next();
    expect(r.release).toBe(false);
    expect(r.reason).toContain('v1.0.0');
  });

  it('--force (execução manual) publica mesmo assim', () => {
    expect(next('--force').release).toBe(true);
  });

  it('um fix junto com os internos publica, e a versão sobe como antes (patch)', () => {
    commit('fix(app): corrige o crash');
    const r = next();
    expect(r.release).toBe(true);
    expect(r.version).toBe('1.0.1');
    expect(r.reason).toBeUndefined();
  });
});

describe('release.yml encadeia o resultado', () => {
  const text = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n');

  it('o job de versão expõe `release` e a execução manual força', () => {
    expect(text).toMatch(/^ {6}release: \$\{\{ steps\.next\.outputs\.release \}\}/m);
    expect(text).toContain("FORCE: ${{ github.event_name == 'workflow_dispatch' }}");
    expect(text).toContain('args+=(--force)');
  });

  it('os testes da release esperam a versão e só rodam quando há o que publicar', () => {
    const quality = text.slice(text.indexOf('\n  quality:'), text.indexOf('\n  build:'));
    expect(quality).toContain('needs: version');
    expect(quality).toContain("needs.version.outputs.release == 'true'");
  });

  it('build e publicação dependem de quality/version: pular um pula o resto', () => {
    expect(text).toMatch(/^ {4}needs: \[version, quality\]$/m);
    expect(text).toMatch(/^ {4}needs: \[version, build\]$/m);
  });
});
