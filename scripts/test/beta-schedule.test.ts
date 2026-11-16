import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { latestBetaTag } from '../lib/release-core.mjs';

describe('latestBetaTag', () => {
  const tags = ['v1.2.0', 'v1.3.0-beta.1', 'v1.3.0-beta.2', 'v1.3.0-beta.10', 'v1.4.0-beta.1', 'v1.3.0', 'nao-e-tag'];

  it('acha o maior N da base pedida (numericamente: beta.10 vence beta.2)', () => {
    expect(latestBetaTag(tags, '1.3.0')).toBe('v1.3.0-beta.10');
    expect(latestBetaTag(tags, '1.4.0')).toBe('v1.4.0-beta.1');
  });

  it('sem beta dessa base, devolve null', () => {
    expect(latestBetaTag(tags, '1.2.0')).toBeNull();
    expect(latestBetaTag([], '1.0.0')).toBeNull();
  });
});

// A agenda semanal passa --if-new: só publica um beta se houver commit que muda o app depois do último beta da mesma versão.
const script = join(__dirname, '..', 'release-info.mjs');
let dir: string;
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
const commit = (msg: string) => git('commit', '--allow-empty', '-q', '-m', msg);
const next = (...args: string[]) => {
  const out = execFileSync('node', [script, 'next', '--channel', 'beta', ...args], { cwd: dir, encoding: 'utf8' });
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)) as { release: boolean; version: string; reason?: string };
};

describe('release-info.mjs next --channel beta --if-new (repositório de verdade)', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'beta-schedule-'));
    execFileSync('node', ['-e', "require('fs').writeFileSync('package.json', JSON.stringify({version:'1.0.0'}))"], { cwd: dir });
    git('init', '-q', '-b', 'main');
    git('add', '.');
    commit('feat: primeira versão');
    git('tag', 'v1.0.0');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('sem nada novo desde a estável, a agenda não publica', () => {
    const r = next('--if-new');
    expect(r.release).toBe(false);
    expect(r.reason).toMatch(/v1\.0\.0/);
  });

  it('com um fix depois da estável, publica o primeiro beta da próxima versão', () => {
    commit('fix: corrige algo');
    const r = next('--if-new');
    expect(r.release).toBe(true);
    expect(r.version).toBe('1.0.1-beta.1');
    git('tag', 'v1.0.1-beta.1');
  });

  it('semana seguinte sem novidade: não repete o beta', () => {
    const r = next('--if-new');
    expect(r.release).toBe(false);
    expect(r.reason).toContain('v1.0.1-beta.1');
  });

  it('só docs/CI depois do beta: continua sem beta novo', () => {
    commit('docs: ajusta o README');
    commit('ci: muda um workflow');
    expect(next('--if-new').release).toBe(false);
  });

  it('um novo fix depois do beta gera o beta.2 da mesma base', () => {
    commit('fix: corrige outra coisa');
    const r = next('--if-new');
    expect(r.release).toBe(true);
    expect(r.version).toBe('1.0.1-beta.2');
  });

  it('o beta manual (sem --if-new) não depende de novidade: com --force publica sempre', () => {
    expect(next('--force').release).toBe(true);
  });
});

describe('release.yml agenda o beta', () => {
  const text = readFileSync(join(__dirname, '..', '..', '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n');

  it('tem um gatilho semanal (cron de uma vez por semana)', () => {
    expect(text).toMatch(/^ {2}schedule:\n {4}- cron: '\d+ \d+ \* \* [0-6]'$/m);
  });

  it('na agenda o canal é beta e o script recebe --if-new; no push continua stable', () => {
    expect(text).toContain("CHANNEL: ${{ inputs.channel || (github.event_name == 'schedule' && 'beta') || 'stable' }}");
    expect(text).toContain('args+=(--if-new)');
    expect(text).toContain("SCHEDULED: ${{ github.event_name == 'schedule' }}");
  });
});
