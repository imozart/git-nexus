// Tamanho de um PR (linhas adicionadas + removidas) -> label "tamanho: XS..XL". Núcleo PURO, sem dependências.

/** Limite superior (inclusive) de cada faixa; acima do último é XL. Mantenha igual à descrição das labels em .github/labels.json. */
export const SIZES = [
  { label: 'tamanho: XS', max: 10 },
  { label: 'tamanho: S', max: 50 },
  { label: 'tamanho: M', max: 200 },
  { label: 'tamanho: L', max: 500 },
];
export const SIZE_XL = 'tamanho: XL';
export const SIZE_LABELS = [...SIZES.map((s) => s.label), SIZE_XL];

/** Arquivos gerados que inflam o PR sem dar trabalho de revisão: não entram na conta. */
const IGNORED = [/(^|\/)pnpm-lock\.yaml$/, /(^|\/)package-lock\.json$/, /(^|\/)yarn\.lock$/, /(^|\/)__snapshots__\//, /\.snap$/, /\.min\.(js|css)$/];

export function isIgnored(path) {
  return IGNORED.some((re) => re.test(path));
}

/** Soma adições + remoções dos arquivos que contam. `files`: `[{ filename, additions, deletions }]`. */
export function countLines(files) {
  return files.filter((f) => !isIgnored(f.filename)).reduce((sum, f) => sum + (f.additions ?? 0) + (f.deletions ?? 0), 0);
}

/** Label da faixa em que `lines` cai. */
export function sizeLabel(lines) {
  return SIZES.find((s) => lines <= s.max)?.label ?? SIZE_XL;
}
