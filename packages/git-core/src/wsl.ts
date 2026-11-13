export interface WslLocation {
  distro: string;
  /** Caminho POSIX dentro da distro, ex.: /home/user/projeto */
  linuxPath: string;
}

const WSL_UNC = /^[\\/]{2}(?:wsl\$|wsl\.localhost)[\\/]([^\\/]+)(?:[\\/](.*))?$/i;

/** Reconhece `\\wsl$\Distro\...` e `\\wsl.localhost\Distro\...`. */
export function parseWslPath(path: string): WslLocation | null {
  const m = WSL_UNC.exec(path);
  if (!m) return null;
  const distro = m[1]!;
  const rest = (m[2] ?? '').replace(/\\/g, '/');
  return { distro, linuxPath: '/' + rest };
}

export function isWslPath(path: string): boolean {
  return WSL_UNC.test(path);
}
