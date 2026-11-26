// O que as Ferramentas decidem mostrar ou recolher (#285): LFS (raiz ou subpasta), submódulos (e quantos pendentes) e o contador do stash. Git de verdade.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getToolsUsage } from '../src/index.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

let root: string;
let n = 0;
const GIT_ENV = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always', GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim();
function repo(): string {
  const d = join(root, `r${++n}`);
  mkdirSync(d);
  sh(d, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) sh(d, 'config', k!, v!);
  writeFileSync(join(d, 'a.txt'), 'um\n');
  sh(d, 'add', '.');
  sh(d, 'commit', '-qm', 'init');
  return d;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-tu-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

describe('getToolsUsage', () => {
  it('repositório comum: não usa LFS nem submódulos, sem stash', async () => {
    expect(await getToolsUsage(repo())).toEqual({ lfs: false, submodules: false, submodulesPending: 0, stash: 0 });
  });

  it('LFS: o .gitattributes da raiz com filter=lfs conta; uma linha sem o filtro não', async () => {
    const d = repo();
    writeFileSync(join(d, '.gitattributes'), '*.txt text eol=lf\n');
    expect((await getToolsUsage(d)).lfs).toBe(false);
    writeFileSync(join(d, '.gitattributes'), '*.psd filter=lfs diff=lfs merge=lfs -text\n');
    expect((await getToolsUsage(d)).lfs).toBe(true);
  });

  it('LFS: um .gitattributes só de uma subpasta também conta (mesmo sem estar no commit)', async () => {
    const d = repo();
    mkdirSync(join(d, 'midia'));
    writeFileSync(join(d, 'midia', '.gitattributes'), '*.bin filter=lfs -text\n');
    expect((await getToolsUsage(d)).lfs).toBe(true);
  });

  it('stash: conta os guardados', async () => {
    const d = repo();
    for (const t of ['x', 'y', 'z']) {
      writeFileSync(join(d, 'a.txt'), `${t}\n`);
      sh(d, 'stash', 'push', '-q', '-m', t);
    }
    expect((await getToolsUsage(d)).stash).toBe(3);
  });

  it('submódulos: .gitmodules marca o uso; num clone sem inicializar, todos estão pendentes, e depois de inicializar, nenhum', async () => {
    const id = ++n;
    const sub = repo();
    const parent = join(root, `pai${id}`);
    mkdirSync(parent);
    sh(parent, 'init', '-q', '-b', 'main');
    for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false']]) sh(parent, 'config', k!, v!);
    sh(parent, 'submodule', 'add', '-q', sub, 'lib');
    sh(parent, 'commit', '-qm', 'feat: submódulo');
    const app = join(root, `app${id}`);
    sh(root, 'clone', '-q', parent, app);
    expect(await getToolsUsage(app)).toMatchObject({ submodules: true, submodulesPending: 1 });
    sh(app, 'submodule', 'update', '--init', '-q');
    expect(await getToolsUsage(app)).toMatchObject({ submodules: true, submodulesPending: 0 });
  });
});
