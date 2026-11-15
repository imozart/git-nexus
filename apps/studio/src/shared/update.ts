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
