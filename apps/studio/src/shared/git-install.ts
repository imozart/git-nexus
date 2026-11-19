// Lógica PURA da detecção e da instalação automática do Git (sem rede, sem Electron, sem disco): versões, escolha do arquivo e do caminho de
// instalação por sistema, e os argumentos de cada comando. Quem baixa, executa e acompanha é entrypoints/git-detect.ts e git-install.ts.
import type { GitInstallMethod } from '@git-nexus/git-core/pure';
import { findSha256 } from './update';

/**
 * Versão mínima do Git aceita pelo app (decisão do dono do projeto, issue #216: 2.56.1). Abaixo disso o estado é `outdated` e o app fica
 * bloqueado até a instalação da versão mais recente. `null` desligaria a verificação de versão. É o ÚNICO lugar a mudar quando a regra mudar.
 */
export const MIN_GIT_VERSION: string | null = '2.56.1';

/** Página oficial de download (o "Instalar manualmente" abre esta). */
export const GIT_DOWNLOAD_URL = 'https://git-scm.com/downloads';

/** Chamadas que funcionam sem o Git (catálogo, idioma, credenciais, varredura de pastas): o resto é recusado enquanto ele faltar. */
export const GIT_FREE_WORKER_METHODS: ReadonlySet<string> = new Set([
  'setLocale',
  'askpassAnswer',
  'getKnownRepositories',
  'touchRepository',
  'removeRepository',
  'scanDirectories',
]);

// --- Versões -----------------------------------------------------------------------------------------------------

/** "git version 2.47.1.windows.2" → "2.47.1" · "git version 2.39.5 (Apple Git-154)" → "2.39.5" · outra coisa → null. */
export function parseGitVersion(output: string): string | null {
  const m = /git version (\d+(?:\.\d+){1,3})/.exec(output);
  return m?.[1] ?? null;
}

/** Compara versões numéricas ("2.9.0" < "2.10.1"): negativo se a < b, 0 se iguais, positivo se a > b. Segmentos que faltam valem 0. */
export function compareGitVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Mínimo em vigor: `MIN_GIT_VERSION`, ou o valor de `GITNEXUS_MIN_GIT_VERSION` (só para testes de ponta a ponta: os computadores de CI têm um Git mais
 * antigo que o mínimo do app e o aviso bloquearia o teste; `0` desliga a verificação de versão). Valor que não é número de versão é ignorado.
 */
export function effectiveMinGitVersion(env: Record<string, string | undefined>): string | null {
  const v = env.GITNEXUS_MIN_GIT_VERSION?.trim();
  return v && /^\d+(\.\d+){0,3}$/.test(v) ? v : MIN_GIT_VERSION;
}

/** Abaixo do mínimo? Sem mínimo definido, nunca. */
export const isOutdated = (version: string, min: string | null = MIN_GIT_VERSION): boolean => min !== null && compareGitVersions(version, min) < 0;

// --- Onde procurar -----------------------------------------------------------------------------------------------

export interface DetectEnv {
  platform: string;
  env: Record<string, string | undefined>;
  /** Pasta de dados do app (a instalação feita pelo app no Linux fica em `<dados>/git`). */
  dataDir: string;
}

/** Junta com barra invertida; null se a variável de ambiente de `base` não existe (nunca um caminho relativo por engano). */
const under = (base: string | undefined, ...rest: string[]): string | null => (base ? [base, ...rest].join('\\') : null);

/**
 * Executáveis a tentar, em ordem. `git` é o do PATH. No macOS o `git` do PATH só entra quando as Command Line Tools existem (sem elas,
 * `/usr/bin/git` é um atalho que abre o pedido de instalação do sistema, e rodá-lo só para "perguntar" dispararia esse diálogo).
 */
export function gitCandidates(d: DetectEnv, opts: { cltInstalled?: boolean } = {}): string[] {
  if (d.platform === 'win32') {
    const e = d.env;
    return [
      'git',
      under(e.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe'),
      under(e.ProgramFiles, 'Git', 'cmd', 'git.exe'),
      under(e['ProgramFiles(x86)'], 'Git', 'cmd', 'git.exe'),
      under(d.dataDir, 'git', 'cmd', 'git.exe'),
    ].filter((p): p is string => p !== null);
  }
  if (d.platform === 'darwin') {
    return ['/opt/homebrew/bin/git', '/usr/local/bin/git', ...(opts.cltInstalled ? ['git', '/usr/bin/git'] : [])];
  }
  return ['git', `${d.dataDir}/git/bin/git`, '/usr/local/bin/git', '/usr/bin/git'];
}

// --- Como instalar, por sistema ------------------------------------------------------------------------------------

export const BREW_PATHS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'] as const;

/** Método da instalação automática neste sistema (`brew` = caminho do Homebrew, se existir). */
export function installMethod(platform: string, arch: string, opts: { brew?: string | null; flatpak?: boolean } = {}): GitInstallMethod {
  if (platform === 'win32') return arch === 'x64' || arch === 'arm64' ? 'windows-installer' : 'manual';
  if (platform === 'darwin') return opts.brew ? 'homebrew' : 'command-line-tools';
  if (platform === 'linux') return opts.flatpak ? 'manual' : arch === 'x64' || arch === 'arm64' ? 'source-build' : 'manual';
  return 'manual';
}

// ---- Windows: Git for Windows ----

/** Repositório do Git for Windows: é para onde o download de git-scm.com aponta. */
export const GIT_FOR_WINDOWS_REPO = 'git-for-windows/git';
export const GIT_FOR_WINDOWS_LATEST = `https://api.github.com/repos/${GIT_FOR_WINDOWS_REPO}/releases/latest`;

/** Instalador Inno Setup: sem assistente, sem reiniciar, sem caixas de mensagem, sem cancelar e POR USUÁRIO (sem administrador, sem UAC). */
export const GIT_WINDOWS_ARGS = ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES', '/NOCANCEL', '/SP-', '/CURRENTUSER'] as const;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  /** `sha256:<hex>` (a API do GitHub informa o hash de cada arquivo da release). */
  digest?: string | null;
  size?: number;
}

/** `Git-2.47.1-64-bit.exe` (x64) ou `Git-2.47.1-arm64.exe` (ARM64); nunca MinGit, busybox, portátil ou `.tar.bz2`. */
export function pickGitWindowsAsset(assets: ReleaseAsset[], arch: string): ReleaseAsset | null {
  const suffix = arch === 'arm64' ? 'arm64' : arch === 'x64' ? '64-bit' : null;
  if (!suffix) return null;
  const re = new RegExp(`^Git-\\d+(?:\\.\\d+)+-${suffix}\\.exe$`);
  return assets.find((a) => re.test(a.name)) ?? null;
}

/** Só o GitHub do Git for Windows, por HTTPS, e só arquivos de release. */
export function isAllowedGitWindowsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'github.com' && u.pathname.startsWith(`/${GIT_FOR_WINDOWS_REPO}/releases/download/`);
  } catch {
    return false;
  }
}

/** SHA-256 esperado: o `digest` do arquivo na API ou, na falta, a linha do arquivo na tabela de hashes das notas da release. */
export function windowsAssetSha256(asset: ReleaseAsset, releaseBody = ''): string | null {
  const d = /^sha256:([0-9a-fA-F]{64})$/.exec(asset.digest ?? '');
  if (d?.[1]) return d[1].toLowerCase();
  for (const line of releaseBody.split(/\r?\n/)) {
    if (!line.includes(asset.name)) continue;
    const m = /\b([0-9a-fA-F]{64})\b/.exec(line);
    if (m?.[1]) return m[1].toLowerCase();
  }
  return null;
}

/** Resultado do `Get-AuthenticodeSignature`: só `Valid` (assinado e íntegro) ou `NotSigned` (a release não é assinada) seguem; o resto é recusado. */
export const isAcceptableSignature = (status: string): boolean => /^(Valid|NotSigned)$/.test(status.trim());

// ---- macOS ----

/** Command Line Tools: `xcode-select --install` abre o diálogo do sistema; depois sondamos `xcode-select -p` e o `git --version`. */
export const CLT_POLL_MS = 5000;
export const CLT_TIMEOUT_MS = 30 * 60_000;

// ---- Linux: código-fonte oficial ----

export const KERNEL_GIT_INDEX = 'https://www.kernel.org/pub/software/scm/git/';
export const KERNEL_SUMS_FILE = 'sha256sums.asc';

/** Só o kernel.org (o endereço do índice redireciona para a CDN), por HTTPS. */
export function isAllowedKernelUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'kernel.org' || u.hostname.endsWith('.kernel.org'));
  } catch {
    return false;
  }
}

/** Do índice HTML do kernel.org, o `git-X.Y.Z.tar.gz` MAIS RECENTE (candidatas `-rc` e outros sufixos não casam com o padrão). */
export function pickLatestTarball(indexHtml: string): { name: string; version: string } | null {
  let best: { name: string; version: string } | null = null;
  for (const m of indexHtml.matchAll(/href="(git-(\d+\.\d+\.\d+)\.tar\.gz)"/g)) {
    const [, name, version] = m;
    if (!name || !version) continue;
    if (!best || compareGitVersions(version, best.version) > 0) best = { name, version };
  }
  return best;
}

/** Hash do tarball no `sha256sums.asc` (formato do `sha256sum`, dentro de um bloco assinado com PGP). */
export const tarballSha256 = (sumsText: string, name: string): string | null => findSha256(sumsText, name);

export type PackageManager = 'apt' | 'dnf' | 'zypper' | 'pacman' | 'apk';

/** Gerenciador da distribuição, só para instalar o que falta para COMPILAR (o Git em si vem do código-fonte oficial). */
export function detectPackageManager(has: (bin: string) => boolean): PackageManager | null {
  const bins: Array<[string, PackageManager]> = [
    ['apt-get', 'apt'],
    ['dnf', 'dnf'],
    ['zypper', 'zypper'],
    ['pacman', 'pacman'],
    ['apk', 'apk'],
  ];
  return bins.find(([b]) => has(b))?.[1] ?? null;
}

/** Comando (executável + argumentos) que instala as dependências de compilação: compilador, make, cabeçalhos do curl e do zlib. */
export function depsInstallCommand(pm: PackageManager): { file: string; args: string[] } {
  switch (pm) {
    case 'apt':
      return { file: 'apt-get', args: ['install', '-y', 'build-essential', 'libcurl4-openssl-dev', 'zlib1g-dev'] };
    case 'dnf':
      return { file: 'dnf', args: ['install', '-y', 'gcc', 'make', 'libcurl-devel', 'zlib-devel'] };
    case 'zypper':
      return { file: 'zypper', args: ['--non-interactive', 'install', 'gcc', 'make', 'libcurl-devel', 'zlib-devel'] };
    case 'pacman':
      return { file: 'pacman', args: ['-S', '--noconfirm', '--needed', 'base-devel', 'curl', 'zlib'] };
    case 'apk':
      return { file: 'apk', args: ['add', 'build-base', 'curl-dev', 'zlib-dev'] };
  }
}

/** O que a compilação exige: `make`, um compilador C, `curl-config` (cabeçalhos do libcurl, para https) e o cabeçalho do zlib. */
export function missingBuildTools(has: (bin: string) => boolean, zlibHeader: boolean): string[] {
  const missing: string[] = [];
  if (!has('make')) missing.push('make');
  if (!has('cc') && !has('gcc')) missing.push('cc');
  if (!has('curl-config')) missing.push('curl-config');
  if (!zlibHeader) missing.push('zlib.h');
  return missing;
}

/** Argumentos do `make`: sem gettext, Tcl/Tk, Perl, Python e expat (nada disso é preciso para o app e cada um é uma dependência a mais). */
export function makeArgs(prefix: string, target: 'all' | 'install', jobs: number): string[] {
  return [`-j${Math.max(1, Math.min(jobs, 16))}`, `prefix=${prefix}`, 'NO_GETTEXT=1', 'NO_TCLTK=1', 'NO_PERL=1', 'NO_PYTHON=1', 'NO_EXPAT=1', target];
}
