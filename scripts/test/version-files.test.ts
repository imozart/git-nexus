import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { computeBeta, isReleaseCommit, parseCommit } from '../release-info.mjs';
// @ts-expect-error módulo .mjs sem tipos
import { SEMVER, setPackageVersion, versionManifests, writeVersion } from '../lib/version-files.mjs';

const pkg = (version: string, extra = '') => `{\n  "name": "x",\n  "version": "${version}",\n  "private": true${extra}\n}\n`;

describe('setPackageVersion', () => {
  it('troca só o campo version e mantém o resto do arquivo igual', () => {
    const r = setPackageVersion(pkg('1.0.0', ',\n  "dependencies": { "vue": "^3.5.0" }'), '1.4.2');
    expect(r).toMatchObject({ changed: true, previous: '1.0.0' });
    expect(r.text).toBe(pkg('1.4.2', ',\n  "dependencies": { "vue": "^3.5.0" }'));
  });

  it('aceita pré-release e não mexe quando já está na versão', () => {
    expect(setPackageVersion(pkg('1.0.0'), '1.3.0-beta.2').text).toContain('"version": "1.3.0-beta.2"');
    const same = setPackageVersion(pkg('1.3.0'), '1.3.0');
    expect(same.changed).toBe(false);
    expect(same.text).toBe(pkg('1.3.0'));
  });

  it('preserva CRLF', () => {
    const crlf = pkg('1.0.0').replace(/\n/g, '\r\n');
    const r = setPackageVersion(crlf, '2.0.0');
    expect(r.text).toBe(pkg('2.0.0').replace(/\n/g, '\r\n'));
  });

  it('ignora "version" aninhado e recusa versão inválida ou arquivo sem version', () => {
    const nested = '{\n  "name": "x",\n  "engines": {\n    "version": "9"\n  },\n  "version": "1.0.0"\n}\n';
    expect(JSON.parse(setPackageVersion(nested, '1.1.0').text)).toMatchObject({ version: '1.1.0', engines: { version: '9' } });
    expect(() => setPackageVersion(pkg('1.0.0'), 'v1.1.0')).toThrow(/inválida/);
    expect(() => setPackageVersion(pkg('1.0.0'), '1.1')).toThrow(/inválida/);
    expect(() => setPackageVersion('{ "name": "x" }', '1.1.0')).toThrow(/sem campo/);
  });

  it('SEMVER', () => {
    for (const ok of ['1.2.3', '10.0.0', '1.2.3-beta.1', '1.2.3-rc.1']) expect(SEMVER.test(ok), ok).toBe(true);
    for (const bad of ['1.2', 'v1.2.3', '1.2.3+build', '1.2.3-', 'a.b.c', '']) expect(SEMVER.test(bad), bad).toBe(false);
  });
});

describe('writeVersion (monorepo)', () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const monorepo = () => {
    const root = mkdtempSync(join(tmpdir(), 'gn-ver-'));
    dirs.push(root);
    for (const p of ['apps/studio', 'apps/ui-kit', 'packages/git-core', 'packages/semversao']) mkdirSync(join(root, p), { recursive: true });
    writeFileSync(join(root, 'package.json'), pkg('1.0.0'));
    writeFileSync(join(root, 'apps/studio/package.json'), pkg('1.0.0'));
    writeFileSync(join(root, 'apps/ui-kit/package.json'), pkg('1.0.0'));
    writeFileSync(join(root, 'packages/git-core/package.json'), pkg('1.1.0'));
    writeFileSync(join(root, 'packages/semversao/package.json'), '{ "name": "sem-versao" }\n'); // sem "version": fica de fora
    return root;
  };

  it('atualiza todos os package.json que têm version e pula os que não têm', () => {
    const root = monorepo();
    expect(versionManifests(root).sort()).toEqual(['apps/studio/package.json', 'apps/ui-kit/package.json', 'package.json', 'packages/git-core/package.json']);
    const changed = writeVersion(root, '1.2.0');
    expect(changed).toHaveLength(4);
    expect(changed.find((c: { file: string }) => c.file === 'packages/git-core/package.json')).toMatchObject({ from: '1.1.0', to: '1.2.0' });
    for (const f of versionManifests(root)) expect(JSON.parse(readFileSync(join(root, f), 'utf8')).version).toBe('1.2.0');
    expect(readFileSync(join(root, 'packages/semversao/package.json'), 'utf8')).toBe('{ "name": "sem-versao" }\n');
  });

  it('é idempotente e o modo dry não grava', () => {
    const root = monorepo();
    expect(writeVersion(root, '2.0.0', { dry: true })).toHaveLength(4);
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('1.0.0');
    writeVersion(root, '2.0.0');
    expect(writeVersion(root, '2.0.0')).toEqual([]);
  });
});

describe('computeBeta', () => {
  const c = (subject: string) => parseCommit({ hash: 'a'.repeat(40), author: 'Ana', subject, body: '' });

  it('estável prevista + -beta.N, contando os betas da mesma base', () => {
    const tags = ['v1.2.0', 'v1.3.0-beta.1', 'v1.3.0-beta.2', 'v1.4.0-beta.9'];
    const r = computeBeta({ tags, commits: [c('feat: nova tela')], initialVersion: '1.0.0' });
    expect(r).toMatchObject({ previous: 'v1.2.0', stable: '1.3.0', version: '1.3.0-beta.3', channel: 'beta', bump: 'minor' });
  });

  it('primeiro beta de uma base, e tags beta nunca viram "última tag"', () => {
    const r = computeBeta({ tags: ['v1.2.0', 'v1.2.1-beta.4'], commits: [c('fix: corrige')], initialVersion: '1.0.0' });
    expect(r).toMatchObject({ previous: 'v1.2.0', version: '1.2.1-beta.5' });
    expect(computeBeta({ tags: ['v1.2.0'], commits: [c('fix: x')], initialVersion: '1.0.0' }).version).toBe('1.2.1-beta.1');
  });

  it('sem nenhuma tag usa a versão inicial', () => {
    expect(computeBeta({ tags: [], commits: [], initialVersion: '1.0.0' }).version).toBe('1.0.0-beta.1');
  });
});

describe('isReleaseCommit', () => {
  const c = (subject: string) => parseCommit({ hash: 'a'.repeat(40), author: 'bot', subject, body: '' });
  it('reconhece só o commit de registro de versão', () => {
    expect(isReleaseCommit(c('chore(release): v1.2.0 [skip release]'))).toBe(true);
    expect(isReleaseCommit(c('chore(deps): atualiza vue'))).toBe(false);
    expect(isReleaseCommit(c('feat(release): painel de versão'))).toBe(false);
  });
});
