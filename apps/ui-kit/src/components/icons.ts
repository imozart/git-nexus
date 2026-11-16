// Ícones do app: traços simples em grade 24x24, desenhados para o GitNexus (não são o conjunto Octicons; a única marca de terceiros do app é a do
// GitHub, em GitHubButton.vue, que precisa ficar intacta). Cada ícone é uma lista de caminhos SVG: nenhum HTML é interpolado.
// Acrescentar um ícone = uma linha aqui; o GnIcon e o GnIconButton aceitam o novo nome sozinhos.

export const ICONS = {
  up: ['M6 15l6-6 6 6'],
  down: ['M6 9l6 6 6-6'],
  left: ['M15 6l-6 6 6 6'],
  right: ['M9 6l6 6-6 6'],
  'chevron-down': ['M7 10l5 5 5-5'],
  'chevron-right': ['M10 7l5 5-5 5'],
  'arrow-right': ['M5 12h14M13 6l6 6-6 6'],
  external: ['M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  x: ['M6 6l12 12M18 6L6 18'],
  check: ['M5 12l5 5 9-10'],
  alert: ['M12 4l9 16H3z', 'M12 10v4M12 17v.2'],
  trash: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6'],
  refresh: ['M20 11a8 8 0 10-2.3 5.7M20 4v7h-7'],
  history: ['M3 12a9 9 0 109-9 9 9 0 00-7 3.4M3 4v5h5M12 7v5l3 2'],
  person: ['M12 4a4 4 0 100 8 4 4 0 000-8z', 'M4 21c0-4 4-6 8-6s8 2 8 6'],
} as const satisfies Record<string, readonly string[]>;

export type GnIconName = keyof typeof ICONS;
