// Diff por linhas (Myers) e montagem de linhas alinhadas lado a lado. Funções puras (usadas no renderer).

export type RowKind = 'eq' | 'change' | 'del' | 'add';

export interface DiffRow {
  kind: RowKind;
  /** Número da linha (1-based) na versão antiga / nova; ausente quando a linha não existe daquele lado. */
  oldNo?: number;
  newNo?: number;
  oldText?: string;
  newText?: string;
  /** Bloco de alterações ao qual a linha pertence (-1 para linhas iguais). */
  block: number;
}

export interface SplitText {
  lines: string[];
  eol: '\n' | '\r\n';
  endsWithNewline: boolean;
}

/** Quebra em linhas ignorando a diferença CRLF/LF (guarda o EOL dominante para regravar). */
export function splitLines(text: string): SplitText {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const endsWithNewline = text.endsWith('\n');
  const lines = text.split(/\r?\n/);
  if (endsWithNewline || text === '') lines.pop();
  return { lines, eol, endsWithNewline };
}

type Op = { t: 'eq' | 'del' | 'add'; a?: number; b?: number };

/** Limite de passos do Myers; acima disso o trecho é tratado como "removido tudo / adicionado tudo". */
const MAX_D = 2500;

function myers(a: string[], b: string[]): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_D);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: { lo: number; data: Int32Array }[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push({ lo: -d - 1, data: v.slice(off - d - 1, off + d + 2) });
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, d);
    }
  }
  return null; // passou do limite
}

function backtrack(trace: { lo: number; data: Int32Array }[], n: number, m: number, dEnd: number): Op[] {
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = dEnd; d >= 0; d--) {
    const t = trace[d]!;
    const get = (k: number) => t.data[k - t.lo]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ t: 'eq', a: x - 1, b: y - 1 });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push({ t: 'add', b: y - 1 });
      else ops.push({ t: 'del', a: x - 1 });
    }
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

function diffOps(a: string[], b: string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ t: 'eq', a: i, b: i });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const mid = midA.length === 0 || midB.length === 0 ? null : myers(midA, midB);
  if (mid) {
    for (const o of mid) ops.push({ t: o.t, a: o.a === undefined ? undefined : o.a + start, b: o.b === undefined ? undefined : o.b + start });
  } else {
    for (let i = start; i < endA; i++) ops.push({ t: 'del', a: i });
    for (let j = start; j < endB; j++) ops.push({ t: 'add', b: j });
  }
  for (let i = endA, j = endB; i < a.length; i++, j++) ops.push({ t: 'eq', a: i, b: j });
  return ops;
}

/** Linhas alinhadas: remoções e adições consecutivas são pareadas (linha "alterada"). */
export function diffLines(oldLines: string[], newLines: string[]): DiffRow[] {
  const ops = diffOps(oldLines, newLines);
  const rows: DiffRow[] = [];
  let block = -1;
  let i = 0;
  while (i < ops.length) {
    const op = ops[i]!;
    if (op.t === 'eq') {
      rows.push({ kind: 'eq', oldNo: op.a! + 1, newNo: op.b! + 1, oldText: oldLines[op.a!], newText: newLines[op.b!], block: -1 });
      i++;
      continue;
    }
    block++;
    const dels: number[] = [];
    const adds: number[] = [];
    while (i < ops.length && ops[i]!.t !== 'eq') {
      const o = ops[i]!;
      if (o.t === 'del') dels.push(o.a!);
      else adds.push(o.b!);
      i++;
    }
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p++) {
      rows.push({ kind: 'change', oldNo: dels[p]! + 1, newNo: adds[p]! + 1, oldText: oldLines[dels[p]!], newText: newLines[adds[p]!], block });
    }
    for (let p = pairs; p < dels.length; p++) rows.push({ kind: 'del', oldNo: dels[p]! + 1, oldText: oldLines[dels[p]!], block });
    for (let p = pairs; p < adds.length; p++) rows.push({ kind: 'add', newNo: adds[p]! + 1, newText: newLines[adds[p]!], block });
  }
  return rows;
}

/** Texto final depois de descartar (voltar ao valor antigo) as linhas `discard` (índices em `rows`). */
export function applyDiscard(
  rows: DiffRow[],
  discard: ReadonlySet<number>,
  opts: { eol: '\n' | '\r\n'; endsWithNewline: boolean },
): string {
  const out: string[] = [];
  rows.forEach((r, idx) => {
    const revert = discard.has(idx);
    switch (r.kind) {
      case 'eq':
        out.push(r.newText!);
        break;
      case 'change':
        out.push(revert ? r.oldText! : r.newText!);
        break;
      case 'del':
        if (revert) out.push(r.oldText!);
        break;
      case 'add':
        if (!revert) out.push(r.newText!);
        break;
    }
  });
  if (out.length === 0) return '';
  return out.join(opts.eol) + (opts.endsWithNewline ? opts.eol : '');
}

/** Índices das linhas de um bloco. */
export function blockRows(rows: DiffRow[], block: number): number[] {
  const idx: number[] = [];
  rows.forEach((r, i) => {
    if (r.block === block) idx.push(i);
  });
  return idx;
}
