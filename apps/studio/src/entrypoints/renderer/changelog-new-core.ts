// "Novidades" (#288): quais versões do histórico são novas para quem abre (as que vieram depois da última cujas notas foram vistas). Sem Vue nem `window`.

export const CHANGELOG_SEEN_KEY = 'gitnexus.changelogSeen';

interface Semver {
  core: [number, number, number];
  /** Pré-lançamento (`beta.2`), ou '' numa versão estável. */
  pre: string;
}

/** `1.27.0`, `v1.27.0`, `1.27.0-beta.2`; qualquer outra coisa é `null`. */
export function parseSemver(v: string | null | undefined): Semver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec((v ?? '').trim());
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? '' } : null;
}

/** Negativo, zero ou positivo, como `Array.sort`. Pré-lançamento vem ANTES da estável do mesmo número; versão ilegível fica antes de todas. */
export function compareVersions(a: string, b: string): number {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! - y.core[i]!;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  // pré-lançamentos: compara parte a parte (números como números: beta.10 depois de beta.2)
  const px = x.pre.split('.');
  const py = y.pre.split('.');
  for (let i = 0; i < Math.max(px.length, py.length); i++) {
    const a1 = px[i];
    const b1 = py[i];
    if (a1 === undefined) return -1;
    if (b1 === undefined) return 1;
    const na = /^\d+$/.test(a1) ? Number(a1) : NaN;
    const nb = /^\d+$/.test(b1) ? Number(b1) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else if (a1 !== b1) return a1 < b1 ? -1 : 1;
  }
  return 0;
}

/**
 * As versões do histórico que são novas: as ESTÁVEIS e de pré-lançamento mais recentes que a última vista, até a que está em uso. Sem "última vista" (primeira vez
 * que se abre) nada é novo: a primeira abertura só marca o ponto de partida.
 */
export function newVersions(listed: readonly string[], seen: string | null | undefined, current: string): Set<string> {
  if (!parseSemver(seen)) return new Set();
  return new Set(listed.filter((v) => compareVersions(v, seen!) > 0 && compareVersions(v, current) <= 0));
}
