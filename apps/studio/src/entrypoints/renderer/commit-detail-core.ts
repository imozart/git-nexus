// Detalhe do commit fixo (#293) e comparação de revisões (#295): as contas puras (sem Vue nem `window`, para testar). A divisão da tela e sua memória, o filtro e o agrupamento por
// pasta dos arquivos, a barra proporcional de +/−, o cache dos últimos commits, o "voltar ao commit anterior" e a navegação por trechos do diff.
import type { CommitFile, CompareResult } from '@git-nexus/git-core/pure';

// --- divisão lista | detalhe -----------------------------------------------------------------------------------------------------------------------------------------------
export type SplitOrient = 'side' | 'bottom';
export interface SplitPrefs {
  orient: SplitOrient;
  /** A largura do detalhe (ao lado) ou a altura (embaixo), em px. */
  size: number;
  /** O detalhe está aberto (Esc o fecha e a lista fica inteira). */
  open: boolean;
}
export const SPLIT_LIMITS: Record<SplitOrient, { min: number; max: number; def: number }> = {
  side: { min: 300, max: 900, def: 440 },
  bottom: { min: 160, max: 640, def: 320 },
};
export const clampSize = (orient: SplitOrient, n: number): number => {
  const l = SPLIT_LIMITS[orient];
  return Number.isFinite(n) ? Math.min(l.max, Math.max(l.min, Math.round(n))) : l.def;
};
/** A divisão gravada (JSON); qualquer coisa fora do formato volta ao padrão, campo a campo. */
export function parseSplit(raw: string | null | undefined): SplitPrefs {
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    /* gravado corrompido: o padrão */
  }
  const orient: SplitOrient = o.orient === 'bottom' ? 'bottom' : 'side';
  return { orient, size: clampSize(orient, typeof o.size === 'number' ? o.size : SPLIT_LIMITS[orient].def), open: o.open !== false };
}
/** Trocar a orientação leva o tamanho padrão dela (as medidas de cada uma não se parecem). */
export const withOrient = (p: SplitPrefs, orient: SplitOrient): SplitPrefs => ({ ...p, orient, size: SPLIT_LIMITS[orient].def });
/** Mover a divisória: `delta` px (positivo = detalhe maior). */
export const resized = (p: SplitPrefs, delta: number): SplitPrefs => ({ ...p, size: clampSize(p.orient, p.size + delta) });

// --- arquivos do commit -----------------------------------------------------------------------------------------------------------------------------------------------------------
export interface FileGroup {
  /** A pasta ("" = a raiz ou, sem agrupar, todos). */
  dir: string;
  files: CommitFile[];
}
const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** Filtra pelo nome (sem diferenciar maiúscula, no caminho novo ou no antigo) e, se pedido, agrupa por pasta (pastas em ordem, raiz primeiro). */
export function groupFiles(files: readonly CommitFile[], filter: string, byFolder: boolean): FileGroup[] {
  const q = filter.trim().toLowerCase();
  const kept = q ? files.filter((f) => f.path.toLowerCase().includes(q) || (f.oldPath ?? '').toLowerCase().includes(q)) : [...files];
  if (!byFolder) return kept.length ? [{ dir: '', files: kept }] : [];
  const map = new Map<string, CommitFile[]>();
  for (const f of kept) {
    const d = dirOf(f.path);
    (map.get(d) ?? map.set(d, []).get(d)!).push(f);
  }
  return [...map.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))).map(([dir, fs]) => ({ dir, files: fs }));
}

export interface FileTotals {
  files: number;
  added: number;
  removed: number;
}
export const totalsOf = (files: readonly CommitFile[]): FileTotals => files.reduce((a, f) => ({ files: a.files + 1, added: a.added + (f.added ?? 0), removed: a.removed + (f.removed ?? 0) }), { files: 0, added: 0, removed: 0 });

/** A barra de +/− de um arquivo: a parte de verde e a de vermelho em %, relativas ao arquivo que mais mudou (nunca passa de 100 juntas). */
export function barOf(f: CommitFile, maxChanges: number): { add: number; del: number } {
  const a = f.added ?? 0;
  const d = f.removed ?? 0;
  if (!maxChanges || (!a && !d)) return { add: 0, del: 0 };
  const total = Math.max(a + d, 1);
  const width = Math.max(8, Math.round(((a + d) / maxChanges) * 100)); // um arquivo pequeno ainda aparece
  return { add: Math.round((a / total) * width), del: Math.round((d / total) * width) };
}
export const maxChanges = (files: readonly CommitFile[]): number => files.reduce((m, f) => Math.max(m, (f.added ?? 0) + (f.removed ?? 0)), 0);
/** "+3 −1" em texto (nunca só cor); binário e sem contagem têm texto próprio na tela. */
export const countLabel = (f: Pick<CommitFile, 'added' | 'removed'>): string => [f.removed ? `−${f.removed}` : '', f.added ? `+${f.added}` : ''].filter(Boolean).join(' ');

// --- cache dos últimos commits e histórico de visitas ----------------------------------------------------------------------------------------------------------------
/** Guarda os últimos `max` itens usados (o mais antigo sai). */
export class Lru<V> {
  private map = new Map<string, V>();
  constructor(private max = 20) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v === undefined) return undefined;
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  has = (k: string): boolean => this.map.has(k);
  clear = (): void => this.map.clear();
  get size(): number {
    return this.map.size;
  }
}

/** Os commits visitados, para "voltar ao anterior" (Alt+←). Só entra o commit que a pessoa escolheu de verdade (a navegação de volta não empilha). */
export class Visited {
  private stack: string[] = [];
  constructor(private max = 50) {}
  visit(h: string): void {
    if (!h || this.stack[this.stack.length - 1] === h) return;
    this.stack.push(h);
    if (this.stack.length > this.max) this.stack.shift();
  }
  /** Tira o atual e devolve o anterior (ou `null` se não há). */
  back(): string | null {
    if (this.stack.length < 2) return null;
    this.stack.pop();
    return this.stack[this.stack.length - 1] ?? null;
  }
  get size(): number {
    return this.stack.length;
  }
  clear = (): void => void (this.stack = []);
}

// --- diff: trechos e arquivos ---------------------------------------------------------------------------------------------------------------------------------------------------
/** Os números das linhas que abrem um trecho (`@@`), para saltar entre eles. */
export function hunkStarts(diff: string): number[] {
  const out: number[] = [];
  const ls = diff.split('\n');
  for (let i = 0; i < ls.length; i++) if (ls[i]!.startsWith('@@')) out.push(i);
  return out;
}
/** O próximo (dir = 1) ou anterior (−1) trecho a partir da linha `from`; `null` se não há mais. */
export function nextHunk(starts: readonly number[], from: number, dir: 1 | -1): number | null {
  if (dir === 1) return starts.find((s) => s > from) ?? null;
  for (let i = starts.length - 1; i >= 0; i--) if (starts[i]! < from) return starts[i]!;
  return null;
}
/** O arquivo vizinho na lista (sem dar a volta). */
export function neighbour(paths: readonly string[], current: string, dir: 1 | -1): string | null {
  const i = paths.indexOf(current);
  const j = i < 0 ? (dir === 1 ? 0 : paths.length - 1) : i + dir;
  return paths[j] ?? null;
}

// --- comparação ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
export type CompareOk = Extract<CompareResult, { ok: true }>;
/** Os arquivos da comparação como estão (mesma forma do commit). */
export const compareTotals = (c: CompareOk): FileTotals => totalsOf(c.files);

/** A lista de commits em Markdown (hash curto e assunto), para colar em descrição de PR e changelog. */
export function commitsMarkdown(commits: ReadonlyArray<{ shortHash: string; subject: string }>): string {
  return commits.map((c) => `- ${c.shortHash} ${c.subject}`).join('\n');
}

/** A mesma comparação com os lados trocados (a tela refaz a consulta). */
export const swapped = (base: string, target: string): { base: string; target: string } => ({ base: target, target: base });
