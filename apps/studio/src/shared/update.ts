// Lógica PURA da verificação de atualização (sem rede, sem Electron): comparar versões e escolher o pacote certo.

export const UPDATE_REPO = 'imozart/git-nexus';

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Compara "1.2.3" e "v1.10.0": negativo se a < b, 0 se iguais, positivo se a > b. `null` se algum não for X.Y.Z. */
export function compareVersions(a: string, b: string): number | null {
  const ma = SEMVER.exec(a.trim());
  const mb = SEMVER.exec(b.trim());
  if (!ma || !mb) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i]);
    if (d !== 0) return d;
  }
  return 0;
}

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface PickContext {
  platform: NodeJS.Platform | string;
  arch: string;
  /** Roda em modo portátil (dados ao lado do executável): sugere o pacote portátil em vez do instalador. */
  portable: boolean;
}

const ARCH_ALIAS: Record<string, string[]> = { x64: ['x64', 'amd64', 'x86_64'], arm64: ['arm64', 'aarch64'] };

/**
 * Escolhe o arquivo mais adequado da release para este sistema:
 *  Windows: instalador (ou ZIP se for portátil) · macOS: DMG · Linux: AppImage (portátil) ou .deb/.rpm não são sugeridos
 *  automaticamente (a distribuição pode variar) — AppImage é o único independente de distro.
 */
export function pickAsset(assets: ReleaseAsset[], ctx: PickContext): ReleaseAsset | null {
  const archs = ARCH_ALIAS[ctx.arch] ?? [ctx.arch];
  const has = (n: string, ...parts: string[]) => parts.every((p) => n.toLowerCase().includes(p));
  const forArch = (n: string) => archs.some((a) => n.toLowerCase().includes(`-${a}`));
  const candidates = (os: string, rank: Array<(n: string) => boolean>) => {
    const mine = assets.filter((a) => has(a.name, `-${os}-`) && forArch(a.name));
    for (const test of rank) {
      const hit = mine.find((a) => test(a.name));
      if (hit) return hit;
    }
    return null;
  };
  if (ctx.platform === 'win32') {
    const setup = (n: string) => n.endsWith('-setup.exe');
    const zip = (n: string) => n.endsWith('.zip');
    return candidates('win', ctx.portable ? [zip, setup] : [setup, zip]);
  }
  if (ctx.platform === 'darwin') return candidates('mac', [(n) => n.endsWith('.dmg'), (n) => n.endsWith('.zip')]);
  if (ctx.platform === 'linux') return candidates('linux', [(n) => n.endsWith('.AppImage'), (n) => n.endsWith('.tar.gz')]);
  return null;
}

/** Só abre páginas do próprio GitHub do projeto (a interface não pode mandar abrir qualquer endereço). */
export function isAllowedUpdateUrl(url: string, repo = UPDATE_REPO): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'github.com' && u.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/`);
  } catch {
    return false;
  }
}

// --- Instalação da atualização (decisão pura; quem baixa e executa é entrypoints/installer.ts) ---------------------

/**
 * O que o botão "Instalar e reiniciar" faz neste sistema:
 *  - `installer`: Windows instalado (NSIS) → baixa o instalador, confere o SHA-256 e o executa em modo silencioso;
 *  - `appimage`: Linux em AppImage → baixa o novo AppImage, confere o SHA-256 e substitui o arquivo atual;
 *  - `portable`: Windows em ZIP portátil → baixa o ZIP, confere o SHA-256, extrai numa pasta de preparo e, ao reiniciar,
 *    troca os arquivos do app (a pasta GitNexusData/ é preservada) e reabre; exige que a pasta do app seja gravável;
 *  - `manual`: o resto (macOS não assinado, .deb/.rpm, pasta sem permissão de escrita) → só abre o download no navegador.
 */
export type InstallKind = 'installer' | 'appimage' | 'portable' | 'manual';

export interface InstallContext {
  platform: NodeJS.Platform | string;
  portable: boolean;
  /** Linux: o app foi iniciado a partir de um AppImage (variável APPIMAGE definida). */
  appImage: boolean;
  /** A pasta onde o app está tem permissão de escrita (necessário para trocar os arquivos do ZIP portátil). */
  writable?: boolean;
}

export function installPlan(assetName: string | undefined, ctx: InstallContext): InstallKind {
  if (!assetName) return 'manual';
  if (ctx.platform === 'win32' && !ctx.portable && assetName.endsWith('-setup.exe')) return 'installer';
  if (ctx.platform === 'win32' && ctx.portable && ctx.writable === true && assetName.endsWith('.zip')) return 'portable';
  if (ctx.platform === 'linux' && ctx.appImage && assetName.endsWith('.AppImage')) return 'appimage';
  return 'manual';
}

/** Nome do arquivo de hashes que o pipeline publica em toda release (`sha256sum *`). */
export const SUMS_ASSET = 'SHA256SUMS.txt';

/** Lê o conteúdo do `sha256sum` ("<hash>  <arquivo>" ou "<hash> *<arquivo>") e devolve o hash do arquivo pedido. */
export function findSha256(sumsText: string, fileName: string): string | null {
  for (const line of sumsText.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m?.[1] && m[2] === fileName) return m[1].toLowerCase();
  }
  return null;
}

/** Nome de arquivo seguro para gravar no disco: sem pastas, sem caracteres estranhos. */
export function isSafeAssetName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(name) && !name.includes('..');
}
