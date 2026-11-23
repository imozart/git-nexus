// Busca v2: a leitura da saída do `git grep` (bytes). Fica fora do `pure.ts` porque usa `Buffer` (só o núcleo roda isto; a interface recebe o resultado pronto).
import type { SearchContextLine } from './types/ipc.js';

export interface RawHit {
  file: string;
  line: number;
  /** A linha inteira (sem o fim de linha). */
  text: string;
  /** Coluna (1 = primeira) em bytes, do primeiro trecho achado; `0` quando a saída não trouxe. */
  byteCol: number;
  /** A mesma linha em bytes, para converter a coluna. */
  bytes: Buffer;
  before: SearchContextLine[];
  after: SearchContextLine[];
}

interface Rec {
  line: number;
  text: string;
  bytes: Buffer;
  col: number;
  match: boolean;
}

const stripCr = (b: Buffer): Buffer => (b.length && b[b.length - 1] === 0x0d ? b.subarray(0, b.length - 1) : b);

/**
 * Leitor incremental da saída de `git grep -z -n --column [-B n -A n]`: a ocorrência é `arquivo NUL linha NUL coluna NUL texto`, o contexto é
 * `arquivo NUL linha NUL texto` (um NUL a menos) e os separadores `--` são ignorados. Lê BYTES (um caractere multibyte pode chegar cortado entre dois
 * pedaços) e só decodifica cada linha inteira. `stripPrefix` tira o `revisão:` que o Git põe na frente do nome quando se busca numa revisão.
 */
export class GrepParser {
  private rest: Buffer = Buffer.alloc(0);
  private file = '';
  private recs: Rec[] = [];
  readonly binaries: string[] = [];

  constructor(
    private readonly onHit: (h: RawHit) => void,
    private readonly ctx: { before: number; after: number },
    private readonly stripPrefix = '',
  ) {}

  push(chunk: Buffer): void {
    let data = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    let from = 0;
    for (let nl = data.indexOf(0x0a, from); nl >= 0; nl = data.indexOf(0x0a, from)) {
      this.record(data.subarray(from, nl));
      from = nl + 1;
    }
    this.rest = Buffer.from(data.subarray(from));
    data = Buffer.alloc(0);
  }

  end(): void {
    if (this.rest.length) this.record(this.rest);
    this.rest = Buffer.alloc(0);
    this.flush();
  }

  private record(raw: Buffer): void {
    if (!raw.length) return;
    if (raw.length === 2 && raw[0] === 0x2d && raw[1] === 0x2d) return; // separador "--" entre grupos de contexto
    const a = raw.indexOf(0);
    if (a < 0) {
      const s = raw.toString('utf8').replace(/\r$/, '');
      const m = /^Binary file (.+) matches$/.exec(s);
      if (m) this.binaries.push(this.name(m[1]!));
      return;
    }
    const b = raw.indexOf(0, a + 1);
    if (b < 0) return;
    const line = Number(raw.subarray(a + 1, b).toString('ascii'));
    if (!Number.isInteger(line) || line < 1) return;
    const c = raw.indexOf(0, b + 1);
    const isMatch = c >= 0 && /^\d+$/.test(raw.subarray(b + 1, c).toString('ascii'));
    const textBytes = stripCr(raw.subarray(isMatch ? c + 1 : b + 1));
    const file = this.name(raw.subarray(0, a).toString('utf8'));
    if (file !== this.file) {
      this.flush();
      this.file = file;
    }
    this.recs.push({ line, text: textBytes.toString('utf8'), bytes: Buffer.from(textBytes), col: isMatch ? Number(raw.subarray(b + 1, c).toString('ascii')) : 0, match: isMatch });
  }

  private name(n: string): string {
    return this.stripPrefix && n.startsWith(this.stripPrefix) ? n.slice(this.stripPrefix.length) : n;
  }

  private flush(): void {
    const recs = this.recs;
    this.recs = [];
    for (const r of recs) {
      if (!r.match) continue;
      const ctx = (lo: number, hi: number): SearchContextLine[] => recs.filter((x) => !x.match && x.line >= lo && x.line <= hi).map((x) => ({ line: x.line, text: x.text }));
      this.onHit({
        file: this.file,
        line: r.line,
        text: r.text,
        byteCol: r.col,
        bytes: r.bytes,
        before: this.ctx.before ? ctx(r.line - this.ctx.before, r.line - 1) : [],
        after: this.ctx.after ? ctx(r.line + 1, r.line + this.ctx.after) : [],
      });
    }
  }
}

/** Coluna em bytes (1 = primeira) → índice do texto (UTF-16, 0 = primeiro). */
export const byteColToIndex = (bytes: Buffer, byteCol: number): number => (byteCol <= 1 ? 0 : bytes.subarray(0, byteCol - 1).toString('utf8').length);

