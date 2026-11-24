// Núcleo puro da janela "Pesquisar no repositório" (sem Vue e sem DOM, para testar): o modelo dos resultados (agrupados por arquivo, recebidos em lotes),
// a janela de linhas visíveis da lista virtualizada, a navegação pelo teclado, as marcas de destaque no editor e pequenos formatadores.
import type { SearchHit } from '@git-nexus/git-core/pure';

/** Altura de cada linha da lista (cabeçalho de arquivo e ocorrência têm a mesma: é o que permite virtualizar sem medir). */
export const ROW_H = 24;
/** Linhas fora da tela que ficam montadas, para a rolagem rápida não mostrar vazio. */
export const OVERSCAN = 8;

/** Como a lista agrupa as ocorrências: por arquivo (o padrão), por pasta (pasta, arquivo, ocorrência) ou plana (só as ocorrências, com o arquivo na linha). */
export type Group = 'file' | 'folder' | 'flat';

export type Row =
  | { kind: 'dir'; key: string; dir: string; count: number; collapsed: boolean }
  | { kind: 'file'; key: string; file: string; count: number; collapsed: boolean; depth: number }
  | { kind: 'hit'; key: string; file: string; hit: SearchHit; depth: number; showFile: boolean }
  | { kind: 'ctx'; key: string; file: string; line: number; text: string; depth: number };

/** Chave estável de uma ocorrência (arquivo e linha: uma entrada por linha). */
export const hitKey = (h: Pick<SearchHit, 'file' | 'line'>): string => `${h.file}:${h.line}`;
/** A pasta de um arquivo ('' = a raiz do repositório). */
export const dirOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
/** Chaves de recolher: a mesma de cada linha de cabeçalho. */
export const fileKey = (file: string): string => `f:${file}`;
export const dirKey = (dir: string): string => `d:${dir}`;

/** O que a pessoa tirou da lista (sem refazer a busca): ocorrências, arquivos e pastas (com tudo que há dentro). */
export interface Hidden {
  hits: ReadonlySet<string>;
  files: ReadonlySet<string>;
  dirs: ReadonlySet<string>;
}
export const NO_HIDDEN: Hidden = { hits: new Set(), files: new Set(), dirs: new Set() };
export const hasHidden = (h: Hidden): boolean => h.hits.size + h.files.size + h.dirs.size > 0;

/** O arquivo está tirado da lista, por ele ou por uma pasta acima dele? */
export function isFileHidden(file: string, h: Hidden): boolean {
  if (h.files.has(file)) return true;
  if (!h.dirs.size) return false;
  let d = dirOf(file);
  if (!d) return h.dirs.has(''); // a raiz só vale para os arquivos direto nela
  for (; d; d = dirOf(d)) if (h.dirs.has(d)) return true;
  return false;
}

export interface RowsOptions {
  /** Chaves (`fileKey`/`dirKey`) dos cabeçalhos recolhidos. */
  collapsed?: ReadonlySet<string>;
  group?: Group;
  hidden?: Hidden;
  /** Mostra as linhas de contexto que a busca trouxe (`before`/`after`). */
  context?: boolean;
}

/**
 * Resultados da busca, agrupados por arquivo na ordem em que os arquivos chegam. Os lotes do Git trazem um arquivo por vez, mas a busca de várias
 * linhas pode devolver o mesmo arquivo em lotes diferentes: o grupo é por nome, não por vizinhança.
 */
export class ResultModel {
  private groups = new Map<string, SearchHit[]>();
  total = 0;

  add(hits: readonly SearchHit[]): void {
    for (const h of hits) {
      const g = this.groups.get(h.file);
      if (g) g.push(h);
      else this.groups.set(h.file, [h]);
      this.total++;
    }
  }

  clear(): void {
    this.groups.clear();
    this.total = 0;
  }

  get files(): number {
    return this.groups.size;
  }

  hitsOf(file: string): readonly SearchHit[] {
    return this.groups.get(file) ?? [];
  }

  /** Os arquivos e as ocorrências que sobram depois do que foi tirado da lista. */
  private shown(hidden: Hidden): Array<[string, readonly SearchHit[]]> {
    const out: Array<[string, readonly SearchHit[]]> = [];
    const none = !hasHidden(hidden);
    for (const [file, hits] of this.groups) {
      if (!none && isFileHidden(file, hidden)) continue;
      const keep = none || !hidden.hits.size ? hits : hits.filter((h) => !hidden.hits.has(hitKey(h)));
      if (keep.length) out.push([file, keep]);
    }
    return out;
  }

  /** Quantas ocorrências e arquivos a lista mostra (descontado o que foi tirado). */
  count(hidden: Hidden = NO_HIDDEN): { hits: number; files: number } {
    if (!hasHidden(hidden)) return { hits: this.total, files: this.files };
    const s = this.shown(hidden);
    return { hits: s.reduce((n, [, h]) => n + h.length, 0), files: s.length };
  }

  /** As linhas da lista: cabeçalhos (de pasta e de arquivo, conforme o agrupamento) e as ocorrências, menos as dos recolhidos e as tiradas. */
  rows(opts: RowsOptions = {}): Row[] {
    const { collapsed = EMPTY_SET, group = 'file', hidden = NO_HIDDEN, context = true } = opts;
    const out: Row[] = [];
    const emitHits = (file: string, hits: readonly SearchHit[], depth: number, showFile: boolean): void => {
      const lines = new Set<number>();
      for (const h of hits) for (let l = h.line; l <= (h.endLine ?? h.line); l++) lines.add(l);
      const seen = new Set<number>();
      const ctx = (list: readonly { line: number; text: string }[]): void => {
        for (const c of list) {
          if (lines.has(c.line) || seen.has(c.line)) continue;
          seen.add(c.line);
          out.push({ kind: 'ctx', key: `c:${file}:${c.line}`, file, line: c.line, text: c.text, depth });
        }
      };
      for (const hit of hits) {
        if (context) ctx(hit.before);
        out.push({ kind: 'hit', key: hitKey(hit), file, hit, depth, showFile });
        if (context) ctx(hit.after);
      }
    };
    const files = this.shown(hidden);
    if (group === 'flat') {
      for (const [file, hits] of files) emitHits(file, hits, 0, true);
      return out;
    }
    const fileBlock = (file: string, hits: readonly SearchHit[], depth: number): void => {
      const closed = collapsed.has(fileKey(file));
      out.push({ kind: 'file', key: fileKey(file), file, count: hits.length, collapsed: closed, depth });
      if (!closed) emitHits(file, hits, depth + 1, false);
    };
    if (group === 'file') {
      for (const [file, hits] of files) fileBlock(file, hits, 0);
      return out;
    }
    const dirs = new Map<string, Array<[string, readonly SearchHit[]]>>();
    for (const f of files) {
      const d = dirOf(f[0]);
      const list = dirs.get(d);
      if (list) list.push(f);
      else dirs.set(d, [f]);
    }
    for (const [dir, list] of dirs) {
      const closed = collapsed.has(dirKey(dir));
      out.push({ kind: 'dir', key: dirKey(dir), dir, count: list.reduce((n, [, h]) => n + h.length, 0), collapsed: closed });
      if (!closed) for (const [file, hits] of list) fileBlock(file, hits, 1);
    }
    return out;
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** O que "ocultar" atinge a partir de uma linha: a ocorrência (`hit`), o arquivo dela (`file`) ou a pasta dela (`dir`). Cabeçalhos ocultam o que representam. */
export function hideTarget(row: Row, level: 'hit' | 'file' | 'dir'): { kind: 'hit' | 'file' | 'dir'; key: string } | null {
  if (row.kind === 'ctx') return null;
  if (row.kind === 'dir') return { kind: 'dir', key: row.dir };
  if (row.kind === 'file') return level === 'dir' ? { kind: 'dir', key: dirOf(row.file) } : { kind: 'file', key: row.file };
  if (level === 'dir') return { kind: 'dir', key: dirOf(row.file) };
  if (level === 'file') return { kind: 'file', key: row.file };
  return { kind: 'hit', key: row.key };
}

/** Quais linhas montar: as visíveis mais a folga. `end` é exclusivo. */
export function windowRange(scrollTop: number, viewport: number, total: number, rowH = ROW_H, overscan = OVERSCAN): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowH);
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewport)) / rowH);
  return { start: Math.max(0, first - overscan), end: Math.min(total, last + overscan) };
}

/** Novo `scrollTop` para a linha `index` ficar visível (`null` se já está). */
export function scrollToRow(index: number, scrollTop: number, viewport: number, rowH = ROW_H): number | null {
  const top = index * rowH;
  if (top < scrollTop) return top;
  if (top + rowH > scrollTop + viewport) return top + rowH - viewport;
  return null;
}

/** Índices das linhas que são ocorrências. */
export function hitIndexes(rows: readonly Row[]): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => r.kind === 'hit' && out.push(i));
  return out;
}

/**
 * ↓ / ↑ (e F3 / Shift+F3): a ocorrência seguinte ou anterior à selecionada, pulando os cabeçalhos. Sem seleção, ↓ vai para a primeira e ↑ para a última.
 * No fim não dá a volta: devolve a mesma (a lista não "pula" do último para o primeiro sem querer; F3 dá a volta com `wrap`).
 */
export function stepHit(rows: readonly Row[], selectedKey: string | null, delta: 1 | -1, wrap = false): number {
  const hits = hitIndexes(rows);
  if (!hits.length) return -1;
  const at = selectedKey === null ? -1 : hits.findIndex((i) => rows[i]!.key === selectedKey);
  if (at < 0) return delta === 1 ? hits[0]! : hits[hits.length - 1]!;
  const next = at + delta;
  if (next < 0) return wrap ? hits[hits.length - 1]! : hits[0]!;
  if (next >= hits.length) return wrap ? hits[0]! : hits[hits.length - 1]!;
  return hits[next]!;
}

/** Ctrl+Alt+↓ / ↑: a primeira ocorrência do arquivo seguinte (ou anterior) ao da selecionada. */
export function stepFile(rows: readonly Row[], selectedKey: string | null, delta: 1 | -1): number {
  const hits = hitIndexes(rows);
  if (!hits.length) return -1;
  const cur = selectedKey === null ? -1 : rows.findIndex((r) => r.key === selectedKey);
  const files = [...new Set(hits.map((i) => (rows[i] as Extract<Row, { kind: 'hit' }>).file))];
  const curFile = cur < 0 ? null : (rows[cur] as { file: string }).file;
  const at = curFile === null ? -1 : files.indexOf(curFile);
  const target = at < 0 ? (delta === 1 ? 0 : files.length - 1) : Math.min(files.length - 1, Math.max(0, at + delta));
  return hits.find((i) => (rows[i] as Extract<Row, { kind: 'hit' }>).file === files[target])!;
}

export interface Mark {
  /** 1 = primeira linha. */
  line: number;
  /** Colunas `[from, to)` na linha inteira (UTF-16). */
  from: number;
  to: number;
}

/**
 * Os trechos achados numa linha, em colunas da linha INTEIRA: o núcleo da busca (git grep) já diz onde estão. Quando a linha foi cortada
 * (`clippedStart`) as colunas são do trecho mostrado, então o início do trecho é achado dentro da linha; se não achar, não marca (nunca marca no lugar errado).
 */
export function marksOf(hit: SearchHit, fullLine: string): Mark[] {
  let base = 0;
  if (hit.clippedStart) {
    base = fullLine.indexOf(hit.text);
    if (base < 0) return [];
  }
  return hit.ranges.map(([a, b]) => ({ line: hit.line, from: base + a, to: base + b })).filter((m) => m.to > m.from && m.to <= fullLine.length);
}

/** O trecho da lista com os destaques: pedaços de texto, marcando os achados (as reticências do corte entram como pedaços sem destaque). */
export function pieces(hit: Pick<SearchHit, 'text' | 'ranges' | 'clippedStart' | 'clippedEnd'>): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  if (hit.clippedStart) out.push({ text: '…', hit: false });
  let at = 0;
  for (const [a, b] of hit.ranges) {
    if (a > at) out.push({ text: hit.text.slice(at, a), hit: false });
    if (b > a) out.push({ text: hit.text.slice(a, b), hit: true });
    at = Math.max(at, b);
  }
  if (at < hit.text.length || !out.length) out.push({ text: hit.text.slice(at), hit: false });
  if (hit.clippedEnd) out.push({ text: '…', hit: false });
  return out;
}

export const SPLIT_MIN = 0.15;
export const SPLIT_MAX = 0.85;
/** A divisória (parte da altura que fica para a lista) sempre dentro de limites que deixam as duas áreas visíveis. */
export const clampSplit = (ratio: number): number => (Number.isFinite(ratio) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio)) : 0.4);

/** "0,2 s" / "1,3 s" / "2 min 5 s": o tempo da busca no formato do idioma. */
export function formatDuration(ms: number, locale: string): string {
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
  return `${(ms / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
}

/** O texto da seleção que vira a busca ao abrir: uma linha, até 200 caracteres; senão vazio. */
export function seedFromSelection(text: string): string {
  const s = text.trim();
  return s && s.length <= 200 && !/[\r\n]/.test(s) ? s : '';
}

export interface LoadedStamp {
  hash: string;
  size: number;
}
/** O arquivo mudou por fora? Compara pelo hash (data e tamanho sozinhos enganam: um programa pode regravar o mesmo tamanho). `null` = o arquivo sumiu. */
export function changedOutside(loaded: LoadedStamp, now: LoadedStamp | null): boolean {
  return now === null || now.hash !== loaded.hash;
}

export type ReadOnlyReason = 'binary' | 'tooLarge' | 'mixedEol' | 'invalid' | 'missing';

/** Por que o arquivo abre só para leitura (`null` = editável). */
export function readOnlyReason(f: { exists: boolean; binary: boolean; tooLarge: boolean; invalid: boolean; eol: string }): ReadOnlyReason | null {
  if (!f.exists) return 'missing';
  if (f.binary) return 'binary';
  if (f.tooLarge) return 'tooLarge';
  if (f.invalid) return 'invalid';
  if (f.eol === 'mixed') return 'mixedEol';
  return null;
}
