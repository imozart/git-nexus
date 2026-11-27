// Lista do Grafo (#291): as contas da interface (colunas, chips, avatar, janela virtual, paleta das lanes), sem Vue nem `window`, para testar.
import type { CommitInfo } from '@git-nexus/git-core/pure';

// --- colunas ------------------------------------------------------------------------------------------------------------------------------------------------------------

/** As colunas que se redimensionam e se ocultam. O traçado (lanes) tem a largura que o desenho pede, e a mensagem ocupa o que sobra. */
export type ColumnId = 'author' | 'date' | 'hash';
export const COLUMN_IDS: readonly ColumnId[] = ['author', 'date', 'hash'];
export const COLUMN_DEFAULT: Record<ColumnId, number> = { author: 168, date: 96, hash: 104 };
export const COLUMN_MIN: Record<ColumnId, number> = { author: 96, date: 64, hash: 76 };
export const COLUMN_MAX: Record<ColumnId, number> = { author: 340, date: 200, hash: 180 };
/** A mensagem nunca fica menor que isto (as outras colunas cedem). */
export const MESSAGE_MIN = 220;

export interface ColumnPrefs {
  widths: Record<ColumnId, number>;
  hidden: ColumnId[];
}

export const clampWidth = (id: ColumnId, w: number): number => Math.round(Math.max(COLUMN_MIN[id], Math.min(COLUMN_MAX[id], Number.isFinite(w) ? w : COLUMN_DEFAULT[id])));

/** Lê o que ficou gravado para o repositório (JSON): valor torto, fora dos limites ou desconhecido volta ao padrão, coluna a coluna. */
export function parseColumnPrefs(raw: string | null | undefined): ColumnPrefs {
  const out: ColumnPrefs = { widths: { ...COLUMN_DEFAULT }, hidden: [] };
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object') {
      const o = v as { widths?: Record<string, unknown>; hidden?: unknown };
      for (const id of COLUMN_IDS) {
        const w = o.widths?.[id];
        if (typeof w === 'number') out.widths[id] = clampWidth(id, w);
      }
      if (Array.isArray(o.hidden)) out.hidden = COLUMN_IDS.filter((id) => (o.hidden as unknown[]).includes(id));
    }
  } catch {
    /* gravado corrompido: o padrão */
  }
  return out;
}

/** As colunas à mostra, na ordem fixa (autor, data, hash). */
export const visibleColumns = (p: ColumnPrefs): ColumnId[] => COLUMN_IDS.filter((id) => !p.hidden.includes(id));

/**
 * As colunas que cabem na largura disponível: as que a pessoa deixou à mostra, tirando da direita para a esquerda (hash, data, autor) até a mensagem ter o
 * mínimo dela. Numa janela estreita, ou com o detalhe aberto ao lado, nada se sobrepõe nem ganha barra de rolagem lateral.
 */
export function fitColumns(p: ColumnPrefs, graphWidth: number, available: number, gap = 8, pad = 12): ColumnId[] {
  const cols = visibleColumns(p);
  const need = (list: ColumnId[]) => graphWidth + MESSAGE_MIN + list.reduce((n, id) => n + p.widths[id], 0) + gap * (list.length + 1) + pad;
  while (cols.length && need(cols) > available) cols.pop();
  return cols;
}

/** `grid-template-columns` da linha (e do cabeçalho): traçado, mensagem flexível e as colunas dadas (por padrão, as visíveis). */
export function gridTemplate(p: ColumnPrefs, graphWidth: number, cols: readonly ColumnId[] = visibleColumns(p)): string {
  return [`${Math.round(graphWidth)}px`, `minmax(${MESSAGE_MIN}px, 1fr)`, ...cols.map((id) => `${p.widths[id]}px`)].join(' ');
}

// --- densidade ------------------------------------------------------------------------------------------------------------------------------------------------------------

export type Density = 'compact' | 'comfortable';
export const ROW_HEIGHT: Record<Density, number> = { compact: 24, comfortable: 32 };
export const parseDensity = (raw: string | null | undefined): Density => (raw === 'comfortable' ? 'comfortable' : 'compact');

// --- o traçado ------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Largura de cada lane e do traçado: 16 px até caber em 190 px, depois compacta (a partir de 12 lanes), sem passar de 190 px nem de 5 px por lane. */
export function laneMetrics(lanes: number): { colW: number; graphW: number } {
  const n = Math.max(1, lanes);
  const colW = Math.max(5, Math.min(16, Math.floor(190 / n)));
  return { colW, graphW: n * colW + 8 };
}

/** Cores das lanes por tema: cada uma com 3:1 ou mais sobre os fundos do tema (elemento gráfico), verificado em `graph-core.test.ts`. */
export const LANE_COLORS: Record<'dark' | 'light', readonly string[]> = {
  dark: ['#5b92ff', '#4fb56a', '#e0a93b', '#c678dd', '#ef6a62', '#2bb5c9', '#e58f4a', '#8bc34a'],
  light: ['#2a62d6', '#2b8a47', '#9a6200', '#9a3fb3', '#c93a32', '#0b7083', '#b5561a', '#4a7410'],
};

const hexToRgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
/** Razão de contraste WCAG entre duas cores `#rrggbb`. */
export function contrastRatio(a: string, b: string): number {
  const l = (h: string) => {
    const [r, g, bl] = hexToRgb(h);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  };
  const [hi, lo] = [l(a), l(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// --- chips de branch, tag e HEAD -------------------------------------------------------------------------------------------------------------------------------

export interface RefChip {
  kind: 'head' | 'local' | 'remote' | 'tag';
  /** O que aparece no chip. */
  label: string;
  /** O nome completo (tooltip e leitor de tela). */
  full: string;
}

/**
 * Lê as referências de um commit (`%D`: "HEAD -> main", "origin/main", "tag: v1", "feat/x") e as ordena por importância: HEAD, branches locais, remotas e tags.
 * `remotes` são os nomes dos remotos (origin...): é a única forma de saber que `feat/x` é local e `origin/x` é remota. Sem a lista, só "origin" vale como remoto.
 */
export function parseRefs(refs: readonly string[], remotes: readonly string[] = ['origin']): RefChip[] {
  const chips: RefChip[] = [];
  const isRemote = (r: string) => remotes.some((n) => r.startsWith(`${n}/`));
  for (const raw of refs) {
    const r = raw.trim();
    if (!r) continue;
    if (r.startsWith('HEAD -> ')) {
      const name = r.slice('HEAD -> '.length);
      chips.push({ kind: 'head', label: name, full: `HEAD → ${name}` });
    } else if (r === 'HEAD') chips.push({ kind: 'head', label: 'HEAD', full: 'HEAD' });
    else if (r.startsWith('tag: ')) chips.push({ kind: 'tag', label: r.slice(5), full: `tag ${r.slice(5)}` });
    else if (isRemote(r)) chips.push({ kind: 'remote', label: r, full: r });
    else chips.push({ kind: 'local', label: r, full: r });
  }
  const rank = { head: 0, local: 1, remote: 2, tag: 3 } as const;
  return chips.map((c, i) => ({ c, i })).sort((a, b) => rank[a.c.kind] - rank[b.c.kind] || a.i - b.i).map((x) => x.c);
}

/** Até `max` chips à mostra e o resto num "+N" (a lista completa vai no tooltip e no nome acessível). */
export function abbreviateChips(chips: readonly RefChip[], max = 3): { shown: RefChip[]; hidden: RefChip[] } {
  return chips.length <= max ? { shown: [...chips], hidden: [] } : { shown: chips.slice(0, max), hidden: chips.slice(max) };
}

// --- autor ---------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Iniciais para o avatar (até duas letras) e uma cor estável por e-mail (ou, sem e-mail, pelo nome): o mesmo autor tem sempre a mesma cor. */
export function avatarOf(name: string, email?: string): { initials: string; hue: number } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  const key = (email || name).trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return { initials, hue: h % 360 };
}

// --- estado do commit --------------------------------------------------------------------------------------------------------------------------------------------------

export interface CommitState {
  merge: boolean;
  /** `true` publicado (algum remoto o alcança), `false` só local, `null` o repositório não tem remotos ou a lista não sabe (resultado de busca). */
  published: boolean | null;
}
export const commitState = (c: Pick<CommitInfo, 'parents' | 'local'>): CommitState => ({ merge: c.parents.length > 1, published: c.local === undefined ? null : !c.local });

// --- lista virtual -----------------------------------------------------------------------------------------------------------------------------------------------------

/** As linhas que precisam existir no DOM: as da janela mais uma folga acima e abaixo (rolar rápido não mostra vazio). */
export function visibleRange(scrollTop: number, viewportH: number, rowH: number, total: number, overscan = 14): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowH);
  const count = Math.ceil(Math.max(0, viewportH) / rowH);
  return { start: Math.max(0, first - overscan), end: Math.min(total, first + count + overscan) };
}

/** Falta pouco para o fim do que está carregado: hora de pedir a próxima página. */
export const nearEnd = (range: { end: number }, loaded: number, margin = 60): boolean => loaded > 0 && range.end >= loaded - margin;

/** Mantém a seleção na janela com a menor rolagem possível (`null` = já está visível). */
export function scrollToRow(index: number, scrollTop: number, viewportH: number, rowH: number): number | null {
  const top = index * rowH;
  if (top < scrollTop) return top;
  if (top + rowH > scrollTop + viewportH) return top + rowH - viewportH;
  return null;
}
