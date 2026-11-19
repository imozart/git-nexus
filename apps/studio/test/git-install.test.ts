import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GitInstallProgress } from '@git-nexus/git-core/pure';
import { MAIN_METHODS, WORKER_METHODS } from '../src/shared/channels';
import {
  GIT_FREE_WORKER_METHODS,
  GIT_WINDOWS_ARGS,
  MIN_GIT_VERSION,
  compareGitVersions,
  depsInstallCommand,
  detectPackageManager,
  effectiveMinGitVersion,
  gitCandidates,
  installMethod,
  isAcceptableSignature,
  isAllowedGitWindowsUrl,
  isAllowedKernelUrl,
  isOutdated,
  makeArgs,
  missingBuildTools,
  parseGitVersion,
  pickGitWindowsAsset,
  pickLatestTarball,
  tarballSha256,
  windowsAssetSha256,
} from '../src/shared/git-install';
import { detectGit, gitEnvFor, makeHas, type Exec } from '../src/entrypoints/git-detect';
import { GitInstallError, downloadChecked, installGit, type InstallDeps, type RunStream } from '../src/entrypoints/git-install';
import { GitManager } from '../src/entrypoints/git-manager';
import { createHash } from 'node:crypto';

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const fwd = (p: string) => p.replace(/\\/g, '/');

describe('versão do Git', () => {
  it('lê a versão da saída de `git --version` em cada sistema', () => {
    expect(parseGitVersion('git version 2.47.1.windows.2')).toBe('2.47.1');
    expect(parseGitVersion('git version 2.39.5 (Apple Git-154)')).toBe('2.39.5');
    expect(parseGitVersion('git version 2.56.1\n')).toBe('2.56.1');
    expect(parseGitVersion('bash: git: command not found')).toBeNull();
  });

  it('compara numericamente (2.9 < 2.10) e trata segmento que falta como 0', () => {
    expect(compareGitVersions('2.9.0', '2.10.1')).toBeLessThan(0);
    expect(compareGitVersions('2.56.1', '2.56.1.0')).toBe(0);
    expect(compareGitVersions('3.0.0', '2.99.9')).toBeGreaterThan(0);
  });

  it('GITNEXUS_MIN_GIT_VERSION troca o mínimo (testes de ponta a ponta); valor inválido é ignorado', () => {
    expect(effectiveMinGitVersion({})).toBe('2.56.1');
    expect(effectiveMinGitVersion({ GITNEXUS_MIN_GIT_VERSION: '0' })).toBe('0');
    expect(isOutdated('1.0.0', effectiveMinGitVersion({ GITNEXUS_MIN_GIT_VERSION: '0' }))).toBe(false);
    expect(effectiveMinGitVersion({ GITNEXUS_MIN_GIT_VERSION: 'abc' })).toBe('2.56.1');
  });

  it('a versão mínima do app é a 2.56.1: abaixo é "antigo", igual ou acima é aceita', () => {
    expect(MIN_GIT_VERSION).toBe('2.56.1');
    expect(isOutdated('2.47.1')).toBe(true);
    expect(isOutdated('2.56.0')).toBe(true);
    expect(isOutdated('2.56.1')).toBe(false);
    expect(isOutdated('2.57.0')).toBe(false);
    expect(isOutdated('1.0.0', null)).toBe(false); // sem mínimo, nunca
  });
});

describe('onde procurar o Git', () => {
  const dataDir = '/dados';

  it('Windows: o do PATH e as pastas por usuário e do sistema; variável ausente nunca vira caminho relativo', () => {
    const c = gitCandidates({ platform: 'win32', dataDir: 'C:\\dados', env: { LOCALAPPDATA: 'C:\\U\\AppData\\Local', ProgramFiles: 'C:\\Program Files' } });
    expect(c[0]).toBe('git');
    expect(c).toContain('C:\\U\\AppData\\Local\\Programs\\Git\\cmd\\git.exe');
    expect(c).toContain('C:\\Program Files\\Git\\cmd\\git.exe');
    expect(c.every((p) => p === 'git' || /^[A-Z]:\\/.test(p))).toBe(true);
  });

  it('macOS: sem Command Line Tools nunca roda o `git` do PATH (o atalho do sistema abriria o pedido de instalação)', () => {
    const without = gitCandidates({ platform: 'darwin', dataDir, env: {} }, { cltInstalled: false });
    expect(without).not.toContain('git');
    expect(without).not.toContain('/usr/bin/git');
    expect(gitCandidates({ platform: 'darwin', dataDir, env: {} }, { cltInstalled: true })).toContain('/usr/bin/git');
  });

  it('Linux: o PATH e a instalação feita pelo app em <dados>/git', () => {
    expect(gitCandidates({ platform: 'linux', dataDir, env: {} })).toEqual(['git', '/dados/git/bin/git', '/usr/local/bin/git', '/usr/bin/git']);
  });

  it('método de instalação por sistema', () => {
    expect(installMethod('win32', 'x64')).toBe('windows-installer');
    expect(installMethod('win32', 'arm64')).toBe('windows-installer');
    expect(installMethod('win32', 'ia32')).toBe('manual');
    expect(installMethod('darwin', 'arm64', { brew: '/opt/homebrew/bin/brew' })).toBe('homebrew');
    expect(installMethod('darwin', 'arm64', { brew: null })).toBe('command-line-tools');
    expect(installMethod('linux', 'x64')).toBe('source-build');
    expect(installMethod('linux', 'x64', { flatpak: true })).toBe('manual');
  });
});

describe('Windows: escolha e verificação do instalador', () => {
  const assets = [
    { name: 'MinGit-2.56.1-64-bit.zip', browser_download_url: 'https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/MinGit-2.56.1-64-bit.zip' },
    { name: 'PortableGit-2.56.1-64-bit.7z.exe', browser_download_url: 'https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/PortableGit-2.56.1-64-bit.7z.exe' },
    { name: 'Git-2.56.1-arm64.exe', browser_download_url: 'https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/Git-2.56.1-arm64.exe' },
    { name: 'Git-2.56.1-64-bit.exe', browser_download_url: 'https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/Git-2.56.1-64-bit.exe', digest: `sha256:${'a'.repeat(64)}` },
  ];

  it('x64 pega o `-64-bit.exe` e ARM64 o `-arm64.exe`; nunca MinGit nem portátil; arquitetura desconhecida, nada', () => {
    expect(pickGitWindowsAsset(assets, 'x64')?.name).toBe('Git-2.56.1-64-bit.exe');
    expect(pickGitWindowsAsset(assets, 'arm64')?.name).toBe('Git-2.56.1-arm64.exe');
    expect(pickGitWindowsAsset(assets, 'ia32')).toBeNull();
  });

  it('só aceita arquivo de release do Git for Windows, por HTTPS', () => {
    expect(isAllowedGitWindowsUrl(assets[3]!.browser_download_url)).toBe(true);
    expect(isAllowedGitWindowsUrl('http://github.com/git-for-windows/git/releases/download/v1/x.exe')).toBe(false);
    expect(isAllowedGitWindowsUrl('https://github.com/outro/repo/releases/download/v1/x.exe')).toBe(false);
    expect(isAllowedGitWindowsUrl('https://evil.example/git-for-windows/git/releases/download/v1/x.exe')).toBe(false);
    expect(isAllowedGitWindowsUrl('não é url')).toBe(false);
  });

  it('o SHA-256 vem do digest da API ou, na falta, da tabela das notas da release', () => {
    expect(windowsAssetSha256(assets[3]!)).toBe('a'.repeat(64));
    const body = `| Filename | SHA-256 |\n| Git-2.56.1-64-bit.exe | ${'B'.repeat(64)} |\n`;
    expect(windowsAssetSha256({ ...assets[3]!, digest: null }, body)).toBe('b'.repeat(64));
    expect(windowsAssetSha256({ ...assets[3]!, digest: null }, 'sem tabela')).toBeNull();
  });

  it('assinatura: só Valid ou NotSigned seguem', () => {
    expect(isAcceptableSignature('Valid')).toBe(true);
    expect(isAcceptableSignature('NotSigned\r\n')).toBe(true);
    expect(isAcceptableSignature('HashMismatch')).toBe(false);
    expect(isAcceptableSignature('NotTrusted')).toBe(false);
    expect(isAcceptableSignature('')).toBe(false);
  });

  it('os argumentos do instalador são por usuário, sem assistente e sem reiniciar', () => {
    expect(GIT_WINDOWS_ARGS).toContain('/VERYSILENT');
    expect(GIT_WINDOWS_ARGS).toContain('/CURRENTUSER');
    expect(GIT_WINDOWS_ARGS).toContain('/NORESTART');
  });
});

describe('Linux: código-fonte oficial', () => {
  const index = '<a href="git-2.9.0.tar.gz">x</a> <a href="git-2.56.1.tar.gz">y</a> <a href="git-2.56.1.tar.xz">z</a> <a href="git-2.57.0-rc0.tar.gz">rc</a> <a href="git-2.10.1.tar.gz">w</a>';

  it('pega o tarball mais recente (comparação numérica) e ignora candidatas -rc', () => {
    expect(pickLatestTarball(index)).toEqual({ name: 'git-2.56.1.tar.gz', version: '2.56.1' });
    expect(pickLatestTarball('nada')).toBeNull();
  });

  it('o hash sai do sha256sums.asc, mesmo dentro do bloco assinado', () => {
    const asc = `-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\n${'c'.repeat(64)}  git-2.56.1.tar.gz\n${'d'.repeat(64)}  git-2.56.1.tar.xz\n-----BEGIN PGP SIGNATURE-----\n`;
    expect(tarballSha256(asc, 'git-2.56.1.tar.gz')).toBe('c'.repeat(64));
    expect(tarballSha256(asc, 'git-9.tar.gz')).toBeNull();
  });

  it('só kernel.org (e subdomínios), por HTTPS', () => {
    expect(isAllowedKernelUrl('https://www.kernel.org/pub/software/scm/git/')).toBe(true);
    expect(isAllowedKernelUrl('https://cdn.kernel.org/pub/software/scm/git/x.tar.gz')).toBe(true);
    expect(isAllowedKernelUrl('https://evilkernel.org/x')).toBe(false);
    expect(isAllowedKernelUrl('http://www.kernel.org/x')).toBe(false);
  });

  it('dependências: gerenciador detectado, comando de instalação e o que falta para compilar', () => {
    expect(detectPackageManager((b) => b === 'dnf')).toBe('dnf');
    expect(detectPackageManager(() => false)).toBeNull();
    expect(depsInstallCommand('apt')).toEqual({ file: 'apt-get', args: ['install', '-y', 'build-essential', 'libcurl4-openssl-dev', 'zlib1g-dev'] });
    expect(depsInstallCommand('pacman').args).toContain('--noconfirm');
    expect(missingBuildTools(() => true, true)).toEqual([]);
    expect(missingBuildTools((b) => b === 'make', false)).toEqual(['cc', 'curl-config', 'zlib.h']);
  });

  it('o make não depende de gettext, Tcl/Tk, Perl, Python nem expat, e instala no prefixo do usuário', () => {
    const a = makeArgs('/dados/git', 'install', 4);
    expect(a).toEqual(['-j4', 'prefix=/dados/git', 'NO_GETTEXT=1', 'NO_TCLTK=1', 'NO_PERL=1', 'NO_PYTHON=1', 'NO_EXPAT=1', 'install']);
    expect(makeArgs('/x', 'all', 999)[0]).toBe('-j16');
    expect(makeArgs('/x', 'all', 0)[0]).toBe('-j1');
  });
});

describe('chamadas bloqueadas sem Git', () => {
  it('toda chamada liberada existe de verdade, e as novas chamadas do Git estão no canal do processo principal', () => {
    for (const m of GIT_FREE_WORKER_METHODS) expect(WORKER_METHODS as readonly string[], m).toContain(m);
    for (const m of ['getGitAvailability', 'recheckGit', 'installGit', 'cancelGitInstall', 'openGitDownloadPage']) expect(MAIN_METHODS as readonly string[], m).toContain(m);
  });

  it('operações de repositório não estão na lista liberada', () => {
    for (const m of ['getGitStatus', 'executeCommit', 'cloneRepository', 'checkoutBranch', 'addRepositoryPath', 'pullRepo']) expect(GIT_FREE_WORKER_METHODS.has(m), m).toBe(false);
  });
});

describe('detecção', () => {
  const fakeExec =
    (table: Record<string, string | number>): Exec =>
    async (file) => {
      const v = table[file];
      if (v === undefined) return { output: 'não existe', code: -1 };
      return typeof v === 'number' ? { output: '', code: v } : { output: v, code: 0 };
    };
  const base = { platform: 'linux', dataDir: '/dados', env: {} as Record<string, string | undefined>, exists: () => true };

  it('com Git aceito: ok, com caminho e versão', async () => {
    const r = await detectGit({ ...base, exec: fakeExec({ git: 'git version 2.56.1' }) });
    expect(r).toEqual({ status: 'ok', path: 'git', version: '2.56.1' });
  });

  it('sem nenhum: missing', async () => {
    expect((await detectGit({ ...base, exec: fakeExec({}) })).status).toBe('missing');
  });

  it('só um Git antigo (abaixo da 2.56.1): outdated, com o caminho e a versão que achou', async () => {
    const r = await detectGit({ ...base, exec: fakeExec({ git: 'git version 2.47.1' }) });
    expect(r).toEqual({ status: 'outdated', path: 'git', version: '2.47.1' });
  });

  it('um antigo no PATH e um novo em outro lugar: vale o novo', async () => {
    const r = await detectGit({ ...base, exec: fakeExec({ git: 'git version 2.39.5', '/dados/git/bin/git': 'git version 2.56.1' }) });
    expect(r).toEqual({ status: 'ok', path: '/dados/git/bin/git', version: '2.56.1' });
  });

  it('o caminho guardado pelo app (GITNEXUS_GIT_PATH) é o primeiro a ser tentado', async () => {
    const r = await detectGit({ ...base, env: { GITNEXUS_GIT_PATH: '/meu/git' }, exec: fakeExec({ '/meu/git': 'git version 2.56.2', git: 'git version 2.56.1' }) });
    expect(r.path).toBe('/meu/git');
  });

  it('caminho absoluto que não existe é pulado sem executar nada', async () => {
    const ran: string[] = [];
    const exec: Exec = async (f) => (ran.push(f), { output: 'git version 2.56.1', code: 0 });
    await detectGit({ ...base, exists: () => false, exec });
    expect(ran).toEqual(['git']); // só o do PATH; os absolutos não existem
  });

  it('GITNEXUS_FORCE_GIT_MISSING=1 força "sem Git" (testes de interface)', async () => {
    const r = await detectGit({ ...base, env: { GITNEXUS_FORCE_GIT_MISSING: '1' }, exec: fakeExec({ git: 'git version 2.56.1' }) });
    expect(r.status).toBe('missing');
  });

  it('macOS sem Command Line Tools: o `git` do PATH e o /usr/bin/git NUNCA são executados', async () => {
    const ran: string[] = [];
    const exec: Exec = async (f) => (ran.push(f), f === 'xcode-select' ? { output: '', code: 2 } : { output: '', code: -1 });
    const r = await detectGit({ platform: 'darwin', dataDir: '/d', env: {}, exists: () => true, exec });
    expect(r.status).toBe('missing');
    expect(ran).not.toContain('git');
    expect(ran).not.toContain('/usr/bin/git');
  });

  it('o ambiente do worker usa o caminho absoluto e a pasta dele no começo do PATH, sem duplicar', () => {
    const env = gitEnvFor('/dados/git/bin/git', { PATH: ['/usr/bin', '/dados/git/bin', '/bin'].join(delimiter) });
    expect(env.GITNEXUS_GIT_PATH).toBe('/dados/git/bin/git');
    expect(env.PATH?.startsWith('/dados/git/bin')).toBe(true);
    expect(env.PATH?.split(delimiter).filter((p) => p === '/dados/git/bin')).toHaveLength(1);
    expect(gitEnvFor('git', { PATH: '/bin' })).toEqual({});
    expect(gitEnvFor(undefined, {})).toEqual({});
  });

  it('makeHas procura no PATH (e `.exe` no Windows)', () => {
    const has = makeHas({ PATH: ['/a', '/b'].join(delimiter) }, (p) => fwd(p) === '/b/make', 'linux');
    expect(has('make')).toBe(true);
    expect(has('gcc')).toBe(false);
    expect(makeHas({ PATH: 'C:/a' }, (p) => fwd(p) === 'C:/a/git.exe', 'win32')('git')).toBe(true);
  });
});

describe('GitManager', () => {
  const mk = (over: Partial<ConstructorParameters<typeof GitManager>[0]> = {}) => {
    const calls = { found: [] as string[], installs: 0 };
    let detected: { status: 'ok' | 'missing' | 'outdated'; path?: string; version?: string } = { status: 'missing' };
    const m = new GitManager({
      detect: async () => detected,
      install: async () => {
        calls.installs++;
        detected = { status: 'ok', path: '/g', version: '2.56.1' };
        return detected;
      },
      method: () => 'windows-installer',
      min: '2.56.1',
      onFound: (f) => void calls.found.push(f.path ?? ''),
      log: () => undefined,
      ...over,
    });
    return { m, calls, set: (d: typeof detected) => (detected = d) };
  };

  it('sem Git está bloqueado e informa o método e a versão mínima; com Git libera e avisa onde ele está', async () => {
    const { m, calls, set } = mk();
    await m.ready;
    expect(m.isBlocked()).toBe(true);
    expect(m.availability()).toMatchObject({ status: 'missing', method: 'windows-installer', canInstall: true, minVersion: '2.56.1' });
    set({ status: 'ok', path: '/g', version: '2.56.1' });
    await m.refresh();
    expect(m.isBlocked()).toBe(false);
    expect(calls.found).toEqual(['/g']);
  });

  it('Git antigo também bloqueia', async () => {
    const { m } = mk({ detect: async () => ({ status: 'outdated', path: 'git', version: '2.47.1' }) });
    await m.ready;
    expect(m.isBlocked()).toBe(true);
  });

  it('instalar duas vezes ao mesmo tempo faz UMA instalação só', async () => {
    const { m, calls } = mk();
    await m.ready;
    const [a, b] = await Promise.all([m.install(() => undefined), m.install(() => undefined)]);
    expect(calls.installs).toBe(1);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    expect(m.isBlocked()).toBe(false);
  });

  it('com o Git já ok, instalar não faz nada', async () => {
    const { m, calls } = mk({ detect: async () => ({ status: 'ok', path: 'git', version: '2.56.1' }) });
    await m.ready;
    await m.install(() => undefined);
    expect(calls.installs).toBe(0);
  });

  it('a falha propaga, o app continua bloqueado e dá para tentar de novo', async () => {
    let n = 0;
    const { m } = mk({
      install: async () => {
        if (n++ === 0) throw new GitInstallError('sem rede');
        return { status: 'ok', path: '/g', version: '2.56.1' };
      },
    });
    await m.ready;
    await expect(m.install(() => undefined)).rejects.toThrow('sem rede');
    expect(m.isBlocked()).toBe(true);
    expect(m.installing).toBe(false);
    await expect(m.install(() => undefined)).resolves.toMatchObject({ status: 'ok' });
  });

  it('cancelar aborta o sinal entregue à instalação', async () => {
    let seen: AbortSignal | undefined;
    const { m } = mk({
      install: (_e, signal) =>
        new Promise((_r, reject) => {
          seen = signal;
          signal.addEventListener('abort', () => reject(new GitInstallError('cancelada')));
        }),
    });
    await m.ready;
    const p = m.install(() => undefined);
    m.cancel();
    await expect(p).rejects.toThrow('cancelada');
    expect(seen?.aborted).toBe(true);
  });

  it('método manual: não dá para instalar pelo app', async () => {
    const { m } = mk({ method: () => 'manual' });
    await m.ready;
    expect(m.availability().canInstall).toBe(false);
  });
});

// --- instalação (rede, processos e disco falsos) -------------------------------------------------------------------------

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'gn-git-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const bytes = (s: string) => new TextEncoder().encode(s);
const ok = (body: Uint8Array | string) => new Response(typeof body === 'string' ? bytes(body) : body, { status: 200 });

/** `fetch` que responde por endereço; o que não está na tabela é 404. */
const router =
  (table: Record<string, () => Response>, seen: string[] = []): typeof fetch =>
  async (input) => {
    const url = String(input);
    seen.push(url);
    return table[url]?.() ?? new Response('nada', { status: 404 });
  };

function deps(over: Partial<InstallDeps> & { events?: GitInstallProgress[] } = {}): InstallDeps & { events: GitInstallProgress[]; execs: Array<[string, string[]]>; runs: Array<[string, string[]]> } {
  const events: GitInstallProgress[] = over.events ?? [];
  const execs: Array<[string, string[]]> = [];
  const runs: Array<[string, string[]]> = [];
  const exec: Exec = async (f, a) => (execs.push([f, a]), { output: '', code: 0 });
  const run: RunStream = async (f, a) => (runs.push([f, a]), 0);
  const d: InstallDeps = {
    platform: 'linux',
    arch: 'x64',
    env: { PATH: '/bin' },
    dataDir: tmp(),
    fetchImpl: router({}),
    exec,
    run,
    exists: () => true,
    detect: async () => ({ status: 'ok', path: 'git', version: '2.56.1' }),
    emit: (p) => void events.push(p),
    log: () => undefined,
    signal: new AbortController().signal,
    sleep: async () => undefined,
    ...over,
  };
  return Object.assign(d, { events, execs, runs });
}

describe('download verificado', () => {
  const dest = () => join(tmp(), 'x.bin');
  const o = (fetchImpl: typeof fetch, file: string, sum: string) => ({ fetchImpl, url: 'https://github.com/x', dest: file, sha256: sum, allowFinal: () => true, signal: new AbortController().signal, onProgress: () => undefined });

  it('hash certo: o arquivo fica no destino', async () => {
    const file = dest();
    await downloadChecked(o(router({ 'https://github.com/x': () => ok('conteúdo') }), file, sha('conteúdo')));
    expect(existsSync(file)).toBe(true);
  });

  it('hash errado: apaga tudo e falha, sem deixar arquivo para executar', async () => {
    const file = dest();
    await expect(downloadChecked(o(router({ 'https://github.com/x': () => ok('adulterado') }), file, sha('conteúdo')))).rejects.toThrow(/integridade|integrity/i);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(`${file}.part`)).toBe(false);
  });

  it('redirecionamento para endereço não permitido é recusado', async () => {
    const f: typeof fetch = async () => Object.defineProperty(ok('x'), 'url', { value: 'https://evil.example/x' });
    const file = dest();
    await expect(downloadChecked({ ...o(f, file, sha('x')), allowFinal: (u) => u.startsWith('https://github.com/') })).rejects.toThrow(/não permitido|disallowed/i);
    expect(existsSync(file)).toBe(false);
  });

  it('resposta de erro do servidor falha com a mensagem', async () => {
    await expect(downloadChecked(o(router({}), dest(), 'a'.repeat(64)))).rejects.toThrow(/404/);
  });
});

describe('instalação no Windows', () => {
  const installer = bytes('instalador-do-git');
  const url = 'https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/Git-2.56.1-64-bit.exe';
  const release = (digest: string | null) =>
    JSON.stringify({ tag_name: 'v2.56.1.windows.1', body: '', assets: [{ name: 'Git-2.56.1-64-bit.exe', browser_download_url: url, ...(digest ? { digest: `sha256:${digest}` } : {}), size: installer.length }] });
  const table = (digest: string | null) => ({ 'https://api.github.com/repos/git-for-windows/git/releases/latest': () => ok(release(digest)), [url]: () => ok(installer) });
  const win = (over: Partial<InstallDeps> = {}) => deps({ platform: 'win32', arch: 'x64', ...over });

  it('baixa, confere o hash e a assinatura e só então executa o instalador por usuário, silencioso', async () => {
    const d = win({ fetchImpl: router(table(sha(installer))) });
    d.exec = async (f, a) => (d.execs.push([f, a]), f === 'powershell.exe' ? { output: 'Valid\r\n', code: 0 } : { output: '', code: 0 });
    const found = await installGit(d);
    expect(found.status).toBe('ok');
    const steps = d.events.map((e) => e.step);
    expect(steps.indexOf('downloading')).toBeLessThan(steps.indexOf('verifying'));
    expect(steps.indexOf('verifying')).toBeLessThan(steps.indexOf('installing'));
    expect(steps.at(-1)).toBe('done');
    expect(d.events.find((e) => e.step === 'downloading' && e.version)?.version).toBe('2.56.1');
    const run = d.execs.find(([f]) => f.endsWith('Git-2.56.1-64-bit.exe'));
    expect(run?.[1]).toEqual([...GIT_WINDOWS_ARGS]);
    // a assinatura foi conferida ANTES de executar
    expect(d.execs.findIndex(([f]) => f === 'powershell.exe')).toBeLessThan(d.execs.indexOf(run!));
  });

  it('hash divergente: o instalador NUNCA é executado', async () => {
    const d = win({ fetchImpl: router(table('f'.repeat(64))) });
    await expect(installGit(d)).rejects.toThrow(/integridade|integrity/i);
    expect(d.execs.some(([f]) => f.endsWith('Git-2.56.1-64-bit.exe'))).toBe(false);
  });

  it('release sem SHA-256 publicado: nada é executado', async () => {
    const d = win({ fetchImpl: router(table(null)) });
    await expect(installGit(d)).rejects.toThrow(/SHA-256/);
    expect(d.execs).toHaveLength(0);
  });

  it('assinatura inválida: nada é executado', async () => {
    const d = win({ fetchImpl: router(table(sha(installer))) });
    d.exec = async (f, a) => (d.execs.push([f, a]), f === 'powershell.exe' ? { output: 'HashMismatch', code: 0 } : { output: '', code: 0 });
    await expect(installGit(d)).rejects.toThrow(/assinatura|signature/i);
    expect(d.execs.some(([f]) => f.endsWith('Git-2.56.1-64-bit.exe'))).toBe(false);
  });

  it('o instalador terminou com erro: a falha informa o código', async () => {
    const d = win({ fetchImpl: router(table(sha(installer))) });
    d.exec = async (f, a) => (d.execs.push([f, a]), f === 'powershell.exe' ? { output: 'NotSigned', code: 0 } : { output: '', code: 5 });
    await expect(installGit(d)).rejects.toThrow(/código 5|code 5/);
  });

  it('instalou mas a versão ficou abaixo da mínima: falha com explicação (e não libera o app)', async () => {
    const d = win({ fetchImpl: router(table(sha(installer))), detect: async () => ({ status: 'outdated', path: 'git', version: '2.40.0' }) });
    d.exec = async (f, a) => (d.execs.push([f, a]), f === 'powershell.exe' ? { output: 'Valid', code: 0 } : { output: '', code: 0 });
    await expect(installGit(d)).rejects.toThrow(/2\.40\.0/);
  });

  it('cancelar antes de executar: nada roda', async () => {
    const ac = new AbortController();
    const d = win({ fetchImpl: router(table(sha(installer))), signal: ac.signal });
    d.exec = async (f, a) => (d.execs.push([f, a]), { output: 'Valid', code: 0 });
    ac.abort();
    await expect(installGit(d)).rejects.toThrow(/cancel/i);
    expect(d.execs).toHaveLength(0);
  });
});

describe('instalação no Linux (código-fonte oficial)', () => {
  const tarball = bytes('tarball-do-git');
  const base = 'https://www.kernel.org/pub/software/scm/git/';
  const table = (sum: string | null) => ({
    [base]: () => ok('<a href="git-2.55.0.tar.gz">a</a><a href="git-2.56.1.tar.gz">b</a>'),
    [`${base}sha256sums.asc`]: () => ok(sum ? `${sum}  git-2.56.1.tar.gz\n` : 'nada\n'),
    [`${base}git-2.56.1.tar.gz`]: () => ok(tarball),
  });
  const linux = (over: Partial<InstallDeps> = {}) => deps({ platform: 'linux', ...over });

  it('com as ferramentas presentes: confere o hash, compila e instala por usuário em <dados>/git, sem administrador', async () => {
    const d = linux({ fetchImpl: router(table(sha(tarball))), exists: () => true });
    const found = await installGit(d);
    expect(found.status).toBe('ok');
    const make = d.runs.filter(([f]) => f === 'make');
    expect(make).toHaveLength(2);
    expect(make[0]![1].at(-1)).toBe('all');
    expect(make[1]![1].at(-1)).toBe('install');
    expect(make[1]![1].some((a) => a === `prefix=${join(d.dataDir, 'git')}`)).toBe(true);
    expect(d.runs.some(([f]) => f === 'pkexec')).toBe(false); // nada de elevação quando não falta nada
    expect(d.execs.some(([f, a]) => f === 'tar' && a[0] === '-xzf')).toBe(true);
    expect(d.events.map((e) => e.step)).toEqual(expect.arrayContaining(['finding', 'downloading', 'verifying', 'building', 'installing', 'validating', 'done']));
  });

  it('hash divergente: nada é compilado', async () => {
    const d = linux({ fetchImpl: router(table('0'.repeat(64))) });
    await expect(installGit(d)).rejects.toThrow(/integridade|integrity/i);
    expect(d.runs).toHaveLength(0);
    expect(d.execs).toHaveLength(0);
  });

  it('o site não publica o hash: nada é baixado nem compilado', async () => {
    const seen: string[] = [];
    const d = linux({ fetchImpl: router(table(null), seen) });
    await expect(installGit(d)).rejects.toThrow(/SHA-256/);
    expect(seen.some((u) => u.endsWith('.tar.gz'))).toBe(false);
  });

  it('faltam ferramentas: pede elevação (pkexec) só para instalá-las pelo gerenciador e depois compila', async () => {
    const present = new Set(['/bin/pkexec', '/bin/apt-get']);
    const d = linux({ fetchImpl: router(table(sha(tarball))), exists: (p) => present.has(fwd(p)) });
    await installGit(d);
    const pk = d.runs.find(([f]) => f === 'pkexec');
    expect(pk?.[1].slice(0, 2)).toEqual(['apt-get', 'install']);
    expect(d.runs.findIndex(([f]) => f === 'pkexec')).toBeLessThan(d.runs.findIndex(([f]) => f === 'make'));
  });

  it('faltam ferramentas e não há pkexec: falha com instrução, sem compilar', async () => {
    const d = linux({ fetchImpl: router(table(sha(tarball))), exists: () => false });
    await expect(installGit(d)).rejects.toThrow(/Faltam ferramentas|missing/);
    expect(d.runs).toHaveLength(0);
  });

  it('permissão negada no pkexec: falha sem compilar', async () => {
    const present = new Set(['/bin/pkexec', '/bin/apt-get']);
    const d = linux({ fetchImpl: router(table(sha(tarball))), exists: (p) => present.has(fwd(p)) });
    d.run = async (f, a) => (d.runs.push([f, a]), f === 'pkexec' ? 126 : 0);
    await expect(installGit(d)).rejects.toThrow(/ferramentas de compilação|build tools/);
    expect(d.runs.some(([f]) => f === 'make')).toBe(false);
  });

  it('a compilação falhou: avisa, e nada é instalado', async () => {
    const d = linux({ fetchImpl: router(table(sha(tarball))) });
    d.run = async (f, a) => (d.runs.push([f, a]), 2);
    await expect(installGit(d)).rejects.toThrow(/compilação|Building/);
    expect(d.runs).toHaveLength(1);
  });
});

describe('instalação no macOS', () => {
  const mac = (over: Partial<InstallDeps> = {}) => deps({ platform: 'darwin', arch: 'arm64', ...over });

  it('com Homebrew: `brew install git`, sem instalar nada além disso', async () => {
    const d = mac({ exists: (p) => fwd(p) === '/opt/homebrew/bin/brew' });
    await installGit(d);
    expect(d.runs).toEqual([['/opt/homebrew/bin/brew', ['install', 'git']]]);
    expect(d.events.find((e) => e.step === 'installing')?.method).toBe('homebrew');
  });

  it('o Homebrew falhou: erro claro', async () => {
    const d = mac({ exists: (p) => fwd(p) === '/usr/local/bin/brew' });
    d.run = async () => 1;
    await expect(installGit(d)).rejects.toThrow(/Homebrew/);
  });

  it('sem Homebrew: Command Line Tools; acompanha até o git responder', async () => {
    let polls = 0;
    const d = mac({ exists: () => false, detect: async () => (++polls < 3 ? { status: 'missing' } : { status: 'ok', path: '/usr/bin/git', version: '2.56.1' }) });
    await installGit(d);
    expect(d.execs[0]).toEqual(['xcode-select', ['--install']]);
    expect(d.runs).toHaveLength(0); // nunca instala o Homebrew por conta própria
    expect(d.events.find((e) => e.step === 'installing')?.method).toBe('command-line-tools');
    expect(polls).toBeGreaterThanOrEqual(3);
  });

  it('cancelar enquanto espera a janela do macOS interrompe', async () => {
    const ac = new AbortController();
    const d = mac({ exists: () => false, detect: async () => ({ status: 'missing' }), signal: ac.signal, sleep: async () => ac.abort() });
    await expect(installGit(d)).rejects.toThrow(/cancel/i);
  });
});

describe('sistema sem instalação automática', () => {
  it('falha com mensagem e não faz nada', async () => {
    const d = deps({ platform: 'freebsd' });
    await expect(installGit(d)).rejects.toThrow(/automática|automatic/);
  });
});
