import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Teste de ponta a ponta do scripts/changelog.mjs: um repositório git de verdade, em uma pasta temporária, com tags e commits.
const script = join(__dirname, '..', 'changelog.mjs');
let dir: string;

const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Teste', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
const commit = (msg: string) => git('commit', '--allow-empty', '-q', '-m', msg);
const run = (...args: string[]) => {
  try {
    return { code: 0, out: execFileSync('node', [script, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
};
const changelog = () => readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'changelog-'));
  git('init', '-q', '-b', 'main');
  commit('feat(app): primeira versão');
  git('tag', 'v1.0.0');
  commit('fix(app): corrige o salvamento');
  commit('ci: ajusta o cache');
  commit('feat(ui): tela nova');
  commit('chore(release): v1.1.0 [skip release]'); // o commit do pipeline nunca entra
  git('tag', 'v1.1.0');
  commit('feat: coisa em teste');
  git('tag', 'v1.2.0-beta.1');
  commit('perf: mais rápido');
  git('tag', 'v1.2.0');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('scripts/changelog.mjs', () => {
  it('--version em arquivo vazio cria o CHANGELOG com a versão e completa as anteriores que faltavam', () => {
    const r = run('--version', '1.1.0', '--repo', 'dono/repo');
    expect(r.code).toBe(0);
    const t = changelog();
    expect(t.indexOf('## [1.1.0]')).toBeLessThan(t.indexOf('## [1.0.0]'));
    expect(t).toContain('tela nova');
    expect(t).toContain('corrige o salvamento');
    expect(t).toContain('primeira versão');
    expect(r.out).toMatch(/v1\.0\.0: .*versão que faltava/);
  });

  it('entra tudo (inclusive CI e manutenção); só o commit chore(release) do pipeline fica de fora', () => {
    const t = changelog();
    expect(t).toContain('ajusta o cache');
    // o preâmbulo cita o tipo `chore(release)`; o que não pode aparecer é a mensagem do commit do pipeline
    expect(t).not.toContain('chore(release): v1.1.0');
    expect(t).not.toContain('[skip release]');
  });

  it('cada versão só tem os commits entre a anterior e ela', () => {
    const v11 = changelog().split('## [1.1.0]')[1]!.split('## [1.0.0]')[0]!;
    expect(v11).toContain('tela nova');
    expect(v11).not.toContain('primeira versão');
  });

  it('repetir o comando não muda nada (nem gera commit à toa no pipeline)', () => {
    const before = changelog();
    const r = run('--version', '1.1.0', '--repo', 'dono/repo');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/já está em dia/);
    expect(changelog()).toBe(before);
  });

  it('a próxima versão entra no topo; o beta entre as duas não vira commit da 1.2.0 por engano, mas os commits dele contam', () => {
    expect(run('--version', '1.2.0', '--repo', 'dono/repo').code).toBe(0);
    const t = changelog();
    expect(t.indexOf('## [1.2.0]')).toBeLessThan(t.indexOf('## [1.1.0]'));
    const v12 = t.split('## [1.2.0]')[1]!.split('## [1.1.0]')[0]!;
    expect(v12).toContain('coisa em teste'); // veio de antes da tag beta, mas é desta versão estável
    expect(v12).toContain('mais rápido');
    expect(t).not.toContain('beta');
    expect(t).toContain('[1.2.0]: https://github.com/dono/repo/compare/v1.1.0...v1.2.0');
  });

  it('recusa beta e tag que não existe', () => {
    expect(run('--version', '1.2.0-beta.1').code).toBe(1);
    const missing = run('--version', '9.9.9');
    expect(missing.code).toBe(1);
    expect(missing.out).toMatch(/não existe/);
  });

  it('--dry mostra a mudança sem gravar', () => {
    rmSync(join(dir, 'CHANGELOG.md'));
    const r = run('--version', '1.0.0', '--dry', '--repo', 'dono/repo');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/mudaria/);
    expect(existsSync(join(dir, 'CHANGELOG.md'))).toBe(false);
  });

  it('--backfill monta tudo e recusa sobrescrever sem --force', () => {
    expect(run('--backfill', '--repo', 'dono/repo').code).toBe(0);
    expect([...changelog().matchAll(/^## \[(.+?)\]/gm)].map((m) => m[1])).toEqual(['1.2.0', '1.1.0', '1.0.0']);
    writeFileSync(join(dir, 'CHANGELOG.md'), `${changelog()}\nEdição à mão\n`);
    const again = run('--backfill', '--repo', 'dono/repo');
    expect(again.code).toBe(1);
    expect(changelog()).toContain('Edição à mão');
    expect(run('--backfill', '--force', '--repo', 'dono/repo').code).toBe(0);
    expect(changelog()).not.toContain('Edição à mão');
  });
});
