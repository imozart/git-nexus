import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getSubmodules, initSubmodules, isReadOnlyGit, parseGitmodules, parseSubmoduleStatus, runGit, updateSubmodules } from '../src/index.js';

// cada teste monta vários repositórios (com submódulos): em máquina carregada passa dos 30 s padrão
vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });

let root: string;
let n = 0;
// `file` liberado (o git bloqueia submódulo local por padrão) e sem fsmonitor (um daemon por repositório deixava a suíte lenta e segurava as pastas)
const GIT_ENV = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always', GIT_CONFIG_KEY_1: 'core.fsmonitor', GIT_CONFIG_VALUE_1: 'false' };
const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim();
const cfg = (d: string) => {
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) sh(d, 'config', k!, v!);
};
function commitFile(dir: string, file: string, text: string, msg: string): string {
  writeFileSync(join(dir, file), text);
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-qm', msg);
  return sh(dir, 'rev-parse', 'HEAD');
}

// o protocolo `file` precisa estar liberado para o git clonar submódulos locais (o git bloqueia por padrão desde 2022)
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-sub-'));
  Object.assign(process.env, GIT_ENV);
});
afterAll(() => {
  for (const k of Object.keys(GIT_ENV)) delete process.env[k];
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** Um repositório com 2 submódulos ("lib" e "ferramentas/util") e um clone dele (o que o app abre), sem os submódulos inicializados. */
async function setup() {
  const id = ++n;
  const libSrc = join(root, `lib${id}`);
  const utilSrc = join(root, `util${id}`);
  for (const d of [libSrc, utilSrc]) {
    sh(root, 'init', '-q', '-b', 'main', d);
    cfg(d);
  }
  const lib1 = commitFile(libSrc, 'lib.txt', '1\n', 'feat: lib 1');
  commitFile(utilSrc, 'util.txt', '1\n', 'feat: util 1');
  const parent = join(root, `pai${id}`);
  sh(root, 'init', '-q', '-b', 'main', parent);
  cfg(parent);
  sh(parent, 'submodule', 'add', '-q', libSrc, 'lib');
  sh(parent, 'submodule', 'add', '-q', utilSrc, 'ferramentas/util');
  sh(parent, 'commit', '-qm', 'feat: submódulos');
  const bare = join(root, `pai${id}.git`);
  sh(root, 'clone', '-q', '--bare', parent, bare);
  const app = join(root, `app${id}`);
  sh(root, 'clone', '-q', bare, app); // clone simples: submódulos NÃO inicializados
  cfg(app);
  return { libSrc, utilSrc, parent, bare, app, lib1 };
}

describe('leitura da saída do git', () => {
  it('git submodule status: estados, caminho com espaço e descrição', () => {
    const sha = 'a'.repeat(40);
    const out = ` ${sha} lib (heads/main)\n-${sha} ferramentas/util\n+${sha} com espaço/x (v1.0-2-gabc)\nU${sha} conflito\nlixo\n`;
    expect(parseSubmoduleStatus(out)).toEqual([
      { state: 'ok', sha, path: 'lib', describe: 'heads/main' },
      { state: 'uninitialized', sha, path: 'ferramentas/util' },
      { state: 'outdated', sha, path: 'com espaço/x', describe: 'v1.0-2-gabc' },
      { state: 'conflict', sha, path: 'conflito' },
    ]);
  });

  it('linha enorme e repetitiva é lida em tempo curto (sem regex quadrática)', () => {
    const t0 = Date.now();
    parseSubmoduleStatus(' ' + 'a'.repeat(40) + ' ' + ' ('.repeat(50_000));
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('.gitmodules: nome com ponto e os três campos', () => {
    const out = 'submodule.a.b.path\nlib/ab\0submodule.a.b.url\nhttps://x/ab.git\0submodule.c.path\nc\0submodule.c.branch\ndev\0';
    const m = parseGitmodules(out);
    expect(m.get('a.b')).toEqual({ path: 'lib/ab', url: 'https://x/ab.git' });
    expect(m.get('c')).toEqual({ path: 'c', branch: 'dev' });
  });

  it('o log do app trata `submodule status` como consulta e `update` como alteração', () => {
    expect(isReadOnlyGit(['submodule', 'status'])).toBe(true);
    expect(isReadOnlyGit(['submodule'])).toBe(true);
    expect(isReadOnlyGit(['submodule', 'update', '--init'])).toBe(false);
  });
});

describe('getSubmodules', () => {
  it('repositório sem submódulos: lista vazia', async () => {
    const d = join(root, `plain${++n}`);
    sh(root, 'init', '-q', '-b', 'main', d);
    expect(await getSubmodules(d)).toEqual([]);
  });

  it('clone sem inicializar: os dois aparecem como não inicializados, com nome, caminho e endereço', async () => {
    const { app, libSrc, utilSrc } = await setup();
    const subs = await getSubmodules(app);
    expect(subs.map((s) => [s.name, s.path, s.state, s.dirty])).toEqual([
      ['ferramentas/util', 'ferramentas/util', 'uninitialized', false],
      ['lib', 'lib', 'uninitialized', false],
    ]);
    expect(subs.find((s) => s.path === 'lib')!.url).toBe(libSrc);
    expect(subs.find((s) => s.path === 'ferramentas/util')!.url).toBe(utilSrc);
  });
});

describe('initSubmodules', () => {
  it('inicializa todos (baixa os arquivos) e depois diz que já estão inicializados', async () => {
    const { app } = await setup();
    const r = await initSubmodules(app);
    expect(r.ok, r.message).toBe(true);
    expect(existsSync(join(app, 'lib', 'lib.txt'))).toBe(true);
    expect(existsSync(join(app, 'ferramentas', 'util', 'util.txt'))).toBe(true);
    expect((await getSubmodules(app)).every((s) => s.state === 'ok')).toBe(true);
    expect((await initSubmodules(app)).message).toMatch(/já estão inicializados|already initialized/i);
  });

  it('inicializa só o que foi pedido', async () => {
    const { app } = await setup();
    expect((await initSubmodules(app, ['lib'])).ok).toBe(true);
    const subs = await getSubmodules(app);
    expect(subs.find((s) => s.path === 'lib')!.state).toBe('ok');
    expect(subs.find((s) => s.path === 'ferramentas/util')!.state).toBe('uninitialized');
  });

  it('caminho que não é submódulo (ou parece opção) é ignorado: nada é executado com ele', async () => {
    const { app } = await setup();
    const r = await initSubmodules(app, ['--recursive', '../fora', 'nao-existe']);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/não tem submódulos|no submodules/i);
  });

  it('repositório sem submódulos: mensagem clara', async () => {
    const d = join(root, `plain${++n}`);
    sh(root, 'init', '-q', '-b', 'main', d);
    expect((await initSubmodules(d)).ok).toBe(false);
  });
});

describe('updateSubmodules', () => {
  it('depois de um pull que muda o registro, o submódulo aparece como desatualizado e a atualização o leva ao commit certo', async () => {
    const { app, libSrc, parent, bare } = await setup();
    await initSubmodules(app);
    // o "colega" avança a lib e registra o novo commit no repositório pai
    const lib2 = commitFile(libSrc, 'lib.txt', '2\n', 'feat: lib 2');
    sh(join(parent, 'lib'), 'pull', '-q', 'origin', 'main');
    sh(parent, 'add', 'lib');
    sh(parent, 'commit', '-qm', 'feat: atualiza lib');
    sh(parent, 'push', '-q', bare, 'main');
    sh(app, 'pull', '-q');
    const before = (await getSubmodules(app)).find((s) => s.path === 'lib')!;
    expect(before.state).toBe('outdated');
    const r = await updateSubmodules(app, ['lib']);
    expect(r.ok, r.message).toBe(true);
    expect(sh(join(app, 'lib'), 'rev-parse', 'HEAD')).toBe(lib2);
    expect((await getSubmodules(app)).find((s) => s.path === 'lib')!.state).toBe('ok');
  });

  it('submódulo com alterações locais é pulado (e a mensagem diz por quê); nada é perdido', async () => {
    const { app, libSrc, parent, bare } = await setup();
    await initSubmodules(app);
    commitFile(libSrc, 'lib.txt', '2\n', 'feat: lib 2');
    sh(join(parent, 'lib'), 'pull', '-q', 'origin', 'main');
    sh(parent, 'add', 'lib');
    sh(parent, 'commit', '-qm', 'feat: atualiza lib');
    sh(parent, 'push', '-q', bare, 'main');
    sh(app, 'pull', '-q');
    writeFileSync(join(app, 'lib', 'lib.txt'), 'meu trabalho não commitado\n');
    const subs = await getSubmodules(app);
    expect(subs.find((s) => s.path === 'lib')!.dirty).toBe(true);
    const r = await updateSubmodules(app, ['lib']);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/alterações locais|local changes/i);
    expect(sh(join(app, 'lib'), 'show', ':lib.txt')).toBe('1');
    expect(execFileSync('git', ['show', 'HEAD:lib.txt'], { cwd: join(app, 'lib'), encoding: 'utf8' }).trim()).toBe('1');
    expect(execFileSync('node', ['-e', "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8').trim())", join(app, 'lib', 'lib.txt')], { encoding: 'utf8' })).toBe('meu trabalho não commitado');
  });

  it('submódulo com commit próprio (que o repositório não registrou) é pulado: o commit não é largado para trás', async () => {
    const { app } = await setup();
    await initSubmodules(app);
    const mine = commitFile(join(app, 'lib'), 'meu.txt', 'meu\n', 'feat: meu commit no submódulo');
    // o registro do pai continua no commit antigo: o submódulo está "à frente" dele
    const subs = await getSubmodules(app);
    expect(subs.find((s) => s.path === 'lib')!.state).toBe('outdated');
    const r = await updateSubmodules(app, ['lib']);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/commits que o repositório não registrou|not recorded/i);
    expect(sh(join(app, 'lib'), 'rev-parse', 'HEAD')).toBe(mine);
  });

  it('já no commit registrado: nada a fazer; não inicializado: não é tocado por "atualizar"', async () => {
    const { app } = await setup();
    expect((await updateSubmodules(app)).message).toMatch(/Nada foi atualizado|already at|já estão/i);
    expect(existsSync(join(app, 'lib', 'lib.txt'))).toBe(false);
    await initSubmodules(app);
    const r = await updateSubmodules(app);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/já estão no commit registrado|already at the recorded/i);
  });
});

describe('integração com o runGit', () => {
  it('o git do teste enxerga os submódulos (sanidade do ambiente)', async () => {
    const { app } = await setup();
    expect((await runGit(app, ['submodule', 'status'])).stdout).toContain('lib');
  });
});
