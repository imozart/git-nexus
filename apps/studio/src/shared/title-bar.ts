// Barra de título integrada às abas: a parte pura (sem Electron), para testar. Quem cria a janela (main.ts) usa estas funções.
//
// - Windows e Linux: `titleBarStyle: 'hidden'` + `titleBarOverlay`: os botões nativos (minimizar, maximizar, fechar) são desenhados sobre a NOSSA faixa de abas.
// - macOS: `hiddenInset`: os botões do semáforo ficam à esquerda, e a interface deixa margem para eles.
// - Escape: `GITNEXUS_NATIVE_FRAME=1` mantém a moldura padrão do sistema (alguns gerenciadores de janela do Linux não suportam o overlay).

export type TitleBarMode = 'overlay' | 'inset' | 'native';

/** Altura da faixa de abas (`.core__top`, min-height 43px em CoreInterface.vue) em pixels com zoom 100 %. O overlay precisa ter a mesma altura. */
export const TITLE_BAR_HEIGHT = 43;

/** Como o processo principal avisa o preload do modo: um argumento da linha de comando do renderer (`webPreferences.additionalArguments`). */
export const TITLE_BAR_ARG = '--gn-titlebar=';

export interface TitleBarColors {
  /** Fundo do overlay (a mesma cor da faixa de abas, `--gn-bg`). */
  color: string;
  /** Cor dos símbolos dos botões (`--gn-text`). */
  symbolColor: string;
}

/** Cores iniciais, antes de a interface carregar e informar as do tema (iguais aos tokens `--gn-bg` e `--gn-text` do tema escuro e do claro). */
export const TITLE_BAR_COLORS: Record<'dark' | 'light', TitleBarColors> = {
  dark: { color: '#17181b', symbolColor: '#e3e5e8' },
  light: { color: '#f4f5f7', symbolColor: '#1f2328' },
};

/** Que moldura usar nesta plataforma. Qualquer outra coisa (FreeBSD…) fica com a moldura nativa. */
export function titleBarMode(platform: string, env: Record<string, string | undefined> = {}): TitleBarMode {
  if (env.GITNEXUS_NATIVE_FRAME === '1') return 'native';
  if (platform === 'darwin') return 'inset';
  if (platform === 'win32' || platform === 'linux') return 'overlay';
  return 'native';
}

/** Altura do overlay para um zoom: a faixa de abas cresce e encolhe com o zoom da interface, e os botões nativos precisam acompanhar. */
export function overlayHeight(zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return Math.max(1, Math.round(TITLE_BAR_HEIGHT * z));
}

/** Opções de `BrowserWindow` do modo (vazio no nativo). */
export function titleBarWindowOptions(mode: TitleBarMode, zoom = 1, colors: TitleBarColors = TITLE_BAR_COLORS.dark): Record<string, unknown> {
  if (mode === 'overlay') return { titleBarStyle: 'hidden', titleBarOverlay: { ...colors, height: overlayHeight(zoom) } };
  if (mode === 'inset') return { titleBarStyle: 'hiddenInset' };
  return {};
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Cores vindas da interface (IPC): só `#rrggbb`; qualquer outra coisa é recusada (devolve null). */
export function parseTitleBarColors(input: unknown): TitleBarColors | null {
  if (!input || typeof input !== 'object') return null;
  const { color, symbolColor } = input as Record<string, unknown>;
  if (typeof color !== 'string' || typeof symbolColor !== 'string' || !HEX.test(color) || !HEX.test(symbolColor)) return null;
  return { color: color.toLowerCase(), symbolColor: symbolColor.toLowerCase() };
}

/** Lê o modo dos argumentos do processo do renderer (preload). Sem o argumento, ou com valor desconhecido, é o nativo. */
export function titleBarModeFromArgv(argv: readonly string[]): TitleBarMode {
  const v = argv.find((a) => a.startsWith(TITLE_BAR_ARG))?.slice(TITLE_BAR_ARG.length);
  return v === 'overlay' || v === 'inset' ? v : 'native';
}

/** `rgb(23, 24, 27)` ou `#17181b` (como o navegador devolve a cor calculada) → `#rrggbb`; qualquer outra forma devolve null. */
export function cssColorToHex(css: string): string | null {
  const s = css.trim();
  if (HEX.test(s)) return s.toLowerCase();
  const m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i.exec(s);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].map(Number);
  if (parts.some((n) => n > 255)) return null;
  return `#${parts.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}
