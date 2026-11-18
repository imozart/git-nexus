// Núcleo PURO do combobox (sem Vue nem DOM): normaliza opções e filtra com limite.
// O combobox de arquivos recebe dezenas de milhares de caminhos: filtrar é linear e só o que cabe na lista vira elemento da tela
// (o <datalist> nativo criava um <option> para CADA arquivo e o popup do sistema os desenhava todos, o que travava o app).

export interface ComboOption {
  value: string;
  /** Texto mostrado (padrão: o próprio `value`). */
  label?: string;
  /** Texto auxiliar, mais claro, ao lado do rótulo. */
  hint?: string;
  disabled?: boolean;
  /** Grupo da opção: a lista mostra o título do grupo antes do primeiro item dele. As opções do mesmo grupo devem vir juntas, e as sem grupo, primeiro. */
  group?: string;
}

export type ComboInput = string | ComboOption;

export const optionOf = (o: ComboInput): ComboOption => (typeof o === 'string' ? { value: o } : o);
export const labelOf = (o: ComboOption): string => o.label ?? o.value;

/** Quantos itens a lista mostra por padrão. */
export const DEFAULT_MAX = 80;

export interface ComboResult {
  items: ComboOption[];
  /** Quantas opções casam com a busca (podem ser mais que `items`). */
  total: number;
  /** Casam, mas não cabem na lista (`total - items.length`). */
  hidden: number;
}

/** 0 = começa com a busca · 1 = o nome do arquivo (depois da última /) começa com ela · 2 = contém · 3 = letras na ordem (salteadas) · -1 = não casa */
export function scoreMatch(text: string, q: string): number {
  const s = text.toLowerCase();
  if (s.startsWith(q)) return 0;
  const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (slash >= 0 && s.startsWith(q, slash + 1)) return 1;
  if (s.includes(q)) return 2;
  let i = 0;
  for (const ch of s) if (ch === q[i] && ++i === q.length) return 3;
  return -1;
}

/**
 * Filtra `options` por `query` e devolve no máximo `max` itens, os melhores primeiro (ordem original dentro de cada faixa).
 * Uma passada só, sem ordenar tudo: guarda no máximo `max` por faixa. Busca vazia devolve as primeiras `max`.
 */
export function filterOptions(options: readonly ComboInput[], query: string, max = DEFAULT_MAX): ComboResult {
  const q = query.trim().toLowerCase();
  if (!q) {
    const items = options.slice(0, max).map(optionOf);
    return { items, total: options.length, hidden: Math.max(0, options.length - items.length) };
  }
  const buckets: ComboInput[][] = [[], [], [], []];
  let total = 0;
  for (const o of options) {
    const opt = optionOf(o);
    // casa pelo rótulo ou, se for diferente, pelo valor; vale a melhor faixa
    const byLabel = scoreMatch(labelOf(opt), q);
    const byValue = opt.label !== undefined ? scoreMatch(opt.value, q) : -1;
    const score = byLabel < 0 ? byValue : byValue < 0 ? byLabel : Math.min(byLabel, byValue);
    if (score < 0) continue;
    total++;
    const bucket = buckets[score]!;
    if (bucket.length < max) bucket.push(o);
  }
  const items = buckets.flat().slice(0, max).map(optionOf);
  return { items, total, hidden: total - items.length };
}

/** Título de grupo a mostrar ANTES do item `i` (o grupo dele, se for o primeiro do grupo); vazio quando não há título a mostrar. */
export function groupHeaderAt(items: readonly ComboOption[], i: number): string {
  const g = items[i]?.group;
  return g && g !== items[i - 1]?.group ? g : '';
}

/**
 * Devolve `items` (um filtro, que embaralha por relevância) com os grupos de volta juntos, na ordem em que aparecem em `options`
 * (sem grupo primeiro). Estável: dentro de cada grupo a ordem de relevância do filtro continua.
 */
export function sortByGroup(options: readonly ComboInput[], items: readonly ComboOption[]): ComboOption[] {
  const order = new Map<string, number>();
  for (const o of options) {
    const g = optionOf(o).group;
    if (g && !order.has(g)) order.set(g, order.size);
  }
  const rank = (o: ComboOption) => (o.group ? (order.get(o.group) ?? order.size) : -1);
  return items.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i).map((x) => x.o);
}
