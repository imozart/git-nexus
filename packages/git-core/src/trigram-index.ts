// Índice de trigramas (fase 10 da #233): o armazenamento em disco. Um índice é uma lista de SEGMENTOS imutáveis; cada segmento tem três arquivos:
//   seg-N.dict   cabeçalho de 16 bytes + um registro de 16 bytes por trigrama, em ordem (trigrama, posição e tamanho da lista no .post, soma de verificação)
//   seg-N.post   as listas de arquivos de cada trigrama (diferenças em varint), lidas por posição: nunca carregadas por inteiro
//   seg-N.docs   os caminhos dos arquivos do segmento (JSON), o número do arquivo é a posição na lista
// Atualizar o índice cria um segmento novo e pequeno; quando há segmentos demais, `mergeSegments` junta vários num só.
import { open, readFile, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { CorruptIndexError, checksum, decodePostings } from './trigram-index-pure.js';

const MAGIC = 0x4e544e47; // "GNTN"
const VERSION = 1;
const HEADER = 16;
const REC = 16;
/** Cada número de arquivo cabe em 24 bits dentro do segmento (um segmento tem poucos milhares de arquivos). */
export const DOC_BITS = 24;
const DOC_MAX = 2 ** DOC_BITS;

export interface DictRecord {
  key: number;
  off: number;
  len: number;
  crc: number;
}

// ---------------------------------------------------------------- cache do dicionário (as chaves ficam na memória enquanto o índice é usado)

const DICT_CACHE_BYTES = 192 * 1024 * 1024;
const dictCache = new Map<string, Buffer>();
let dictCacheBytes = 0;

function cacheDict(path: string, buf: Buffer): void {
  if (buf.length > DICT_CACHE_BYTES / 2) return; // um dicionário gigante não fica na memória: é lido por posição
  dropDict(path);
  dictCache.set(path, buf);
  dictCacheBytes += buf.length;
  for (const [k, v] of dictCache) {
    if (dictCacheBytes <= DICT_CACHE_BYTES) break;
    if (k === path) continue;
    dictCache.delete(k);
    dictCacheBytes -= v.length;
  }
}

function dropDict(path: string): void {
  const old = dictCache.get(path);
  if (old) {
    dictCache.delete(path);
    dictCacheBytes -= old.length;
  }
}

/** Esquece os dicionários guardados na memória (todos, ou os de uma pasta de índice). */
export function clearDictCache(dirPrefix?: string): void {
  for (const k of [...dictCache.keys()]) if (!dirPrefix || k.startsWith(dirPrefix)) dropDict(k);
}

// ---------------------------------------------------------------- escrita em fluxo

class Sink {
  private buf = Buffer.allocUnsafe(1 << 22);
  n = 0;
  constructor(private readonly fh: FileHandle, public pos: number) {}

  /** Garante `k` bytes livres; se não cabem, grava o que há (só no começo de um registro). */
  async ensure(k: number): Promise<void> {
    if (this.buf.length - this.n >= k) return;
    await this.flush();
    if (this.buf.length < k) this.buf = Buffer.allocUnsafe(k);
  }
  async flush(): Promise<void> {
    if (!this.n) return;
    await this.fh.write(this.buf, 0, this.n, this.pos);
    this.pos += this.n;
    this.n = 0;
  }
  /** Número inteiro sem sinal (até 2^31) em varint, direto no buffer (sem alocar: são dezenas de milhões por índice). */
  varint(v: number): void {
    while (v >= 0x80) {
      this.buf[this.n++] = (v & 0x7f) | 0x80;
      v >>>= 7;
    }
    this.buf[this.n++] = v;
  }
  u32(v: number): void {
    this.buf.writeUInt32LE(v >>> 0, this.n);
    this.n += 4;
  }
  /** Posição, no arquivo, do próximo byte. */
  get at(): number {
    return this.pos + this.n;
  }
  bytesFrom(start: number): Buffer {
    return this.buf.subarray(start, this.n);
  }
}

/** Escreve um segmento: `pairs` guarda `trigrama * 2^24 + arquivo` (todos distintos); ele é ordenado aqui. Devolve o que o `Segment` precisa. */
export async function writeSegment(dir: string, id: number, docs: string[], pairs: Float64Array): Promise<Segment> {
  if (docs.length >= DOC_MAX) throw new Error('segmento com arquivos demais');
  pairs.sort();
  const base = join(dir, `seg-${id}`);
  const post = await open(`${base}.post.tmp`, 'w');
  const dict = await open(`${base}.dict.tmp`, 'w');
  let keyCount = 0;
  try {
    const ps = new Sink(post, 0);
    const ds = new Sink(dict, HEADER);
    await ps.ensure(8);
    ps.u32(MAGIC);
    ps.u32(VERSION);
    let i = 0;
    while (i < pairs.length) {
      const key = Math.floor(pairs[i]! / DOC_MAX);
      let j = i;
      while (j < pairs.length && Math.floor(pairs[j]! / DOC_MAX) === key) j++;
      await ps.ensure((j - i) * 5 + 8);
      const start = ps.n;
      const off = ps.at;
      let prev = 0;
      for (let k = i; k < j; k++) {
        const d = pairs[k]! - key * DOC_MAX;
        ps.varint(d - prev);
        prev = d;
      }
      const bytes = ps.bytesFrom(start);
      const crc = checksum(bytes);
      const len = ps.at - off;
      await ds.ensure(REC);
      ds.u32(key);
      ds.u32(off);
      ds.u32(len);
      ds.u32(crc);
      keyCount++;
      i = j;
    }
    await ps.flush();
    await ds.flush();
    const head = Buffer.alloc(HEADER);
    head.writeUInt32LE(MAGIC, 0);
    head.writeUInt32LE(VERSION, 4);
    head.writeUInt32LE(keyCount, 8);
    head.writeUInt32LE(docs.length, 12);
    await dict.write(head, 0, HEADER, 0);
  } finally {
    await post.close();
    await dict.close();
  }
  await writeFile(`${base}.docs.tmp`, JSON.stringify(docs), 'utf8');
  // só no fim viram arquivos do segmento (um segmento pela metade nunca é lido: o meta.json é quem diz quais valem)
  await rename(`${base}.post.tmp`, `${base}.post`);
  await rename(`${base}.dict.tmp`, `${base}.dict`);
  await rename(`${base}.docs.tmp`, `${base}.docs`);
  return Segment.open(dir, id);
}

// ---------------------------------------------------------------- leitura

export class Segment {
  private constructor(
    readonly dir: string,
    readonly id: number,
    readonly keyCount: number,
    readonly docCount: number,
    readonly bytes: number,
  ) {}

  get base(): string {
    return join(this.dir, `seg-${this.id}`);
  }
  get files(): string[] {
    return [`${this.base}.dict`, `${this.base}.post`, `${this.base}.docs`];
  }

  /** Abre o segmento conferindo o cabeçalho e o tamanho dos arquivos. Lança `CorruptIndexError` se não confere. */
  static async open(dir: string, id: number): Promise<Segment> {
    const base = join(dir, `seg-${id}`);
    let head: Buffer;
    let dictSize: number;
    let postSize: number;
    let docsSize: number;
    try {
      const fh = await open(`${base}.dict`, 'r');
      try {
        head = Buffer.alloc(HEADER);
        const { bytesRead } = await fh.read(head, 0, HEADER, 0);
        if (bytesRead < HEADER) throw new CorruptIndexError('dicionário sem cabeçalho');
        dictSize = (await fh.stat()).size;
      } finally {
        await fh.close();
      }
      postSize = (await stat(`${base}.post`)).size;
      docsSize = (await stat(`${base}.docs`)).size;
    } catch (e) {
      if (e instanceof CorruptIndexError) throw e;
      throw new CorruptIndexError(`segmento ${id} ausente ou ilegível`);
    }
    if (head.readUInt32LE(0) !== MAGIC || head.readUInt32LE(4) !== VERSION) throw new CorruptIndexError('formato desconhecido');
    const keyCount = head.readUInt32LE(8);
    const docCount = head.readUInt32LE(12);
    if (dictSize !== HEADER + keyCount * REC || postSize < 8) throw new CorruptIndexError('tamanho do dicionário');
    return new Segment(dir, id, keyCount, docCount, dictSize + postSize + docsSize);
  }

  /** O dicionário inteiro (as chaves ficam em memória enquanto couberem no cache). */
  async dict(): Promise<Buffer> {
    const path = `${this.base}.dict`;
    const hit = dictCache.get(path);
    if (hit) {
      // mais usado por último: sai do fim da fila de descarte
      dictCache.delete(path);
      dictCache.set(path, hit);
      return hit;
    }
    const buf = await readFile(path);
    if (buf.length !== HEADER + this.keyCount * REC) throw new CorruptIndexError('dicionário mudou de tamanho');
    cacheDict(path, buf);
    return buf;
  }

  /** O registro do trigrama (busca binária no dicionário) ou `null` se nenhum arquivo do segmento o tem. */
  static find(dict: Buffer, keyCount: number, key: number): DictRecord | null {
    let lo = 0;
    let hi = keyCount - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = HEADER + mid * REC;
      const k = dict.readUInt32LE(at);
      if (k === key) return { key: k, off: dict.readUInt32LE(at + 4), len: dict.readUInt32LE(at + 8), crc: dict.readUInt32LE(at + 12) };
      if (k < key) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  /** Registro de ordem `i` (para juntar segmentos). */
  static record(dict: Buffer, i: number): DictRecord {
    const at = HEADER + i * REC;
    return { key: dict.readUInt32LE(at), off: dict.readUInt32LE(at + 4), len: dict.readUInt32LE(at + 8), crc: dict.readUInt32LE(at + 12) };
  }

  /** A lista de arquivos do registro, lida por posição e conferida (soma de verificação, ordem, limite). */
  async postings(fh: FileHandle, rec: DictRecord): Promise<Uint32Array> {
    const buf = Buffer.allocUnsafe(rec.len);
    const { bytesRead } = await fh.read(buf, 0, rec.len, rec.off);
    if (bytesRead !== rec.len) throw new CorruptIndexError('lista cortada');
    return this.decode(buf, rec);
  }

  decode(buf: Uint8Array, rec: DictRecord): Uint32Array {
    if (checksum(buf) !== rec.crc) throw new CorruptIndexError('soma de verificação');
    return decodePostings(buf, this.docCount);
  }

  openPostings(): Promise<FileHandle> {
    return open(`${this.base}.post`, 'r');
  }

  async docs(): Promise<string[]> {
    let list: unknown;
    try {
      list = JSON.parse(await readFile(`${this.base}.docs`, 'utf8'));
    } catch {
      throw new CorruptIndexError('lista de arquivos');
    }
    if (!Array.isArray(list) || list.length !== this.docCount) throw new CorruptIndexError('lista de arquivos com tamanho errado');
    return list as string[];
  }

  /** Apaga os arquivos do segmento. */
  async remove(): Promise<void> {
    for (const f of this.files) {
      dropDict(f);
      await rm(f, { force: true });
    }
  }
}

// ---------------------------------------------------------------- juntar segmentos

/** Leitor sequencial das listas de um segmento (as posições sobem, então uma janela grande evita uma leitura por trigrama). */
class SequentialPostings {
  private win: Buffer = Buffer.alloc(0);
  private winAt = 0;
  constructor(private readonly fh: FileHandle) {}
  async read(off: number, len: number): Promise<Buffer> {
    if (off < this.winAt || off + len > this.winAt + this.win.length) {
      const size = Math.max(len, 4 * 1024 * 1024);
      const b = Buffer.allocUnsafe(size);
      const { bytesRead } = await this.fh.read(b, 0, size, off);
      this.win = b.subarray(0, bytesRead);
      this.winAt = off;
      if (this.win.length < len) throw new CorruptIndexError('lista cortada');
    }
    return this.win.subarray(off - this.winAt, off - this.winAt + len);
  }
}

export interface SegmentMergeResult {
  segment: Segment;
  /** Para cada segmento de entrada, o novo número de cada arquivo (`-1` = não vive mais). */
  remap: Map<number, Int32Array>;
}

/**
 * Junta `inputs` num segmento novo `newId`. `live(seg, local, path)` diz se o arquivo ainda vale (o manifesto ainda aponta para aquele segmento): os que não
 * valem somem. Os arquivos são renumerados na ordem das entradas, então as listas continuam crescentes sem reordenar.
 */
export async function mergeSegments(dir: string, inputs: Segment[], newId: number, live: (seg: Segment, local: number, path: string) => boolean): Promise<SegmentMergeResult> {
  const remap = new Map<number, Int32Array>();
  const docs: string[] = [];
  for (const seg of inputs) {
    const list = await seg.docs();
    const map = new Int32Array(list.length).fill(-1);
    list.forEach((p, i) => {
      if (live(seg, i, p)) {
        map[i] = docs.length;
        docs.push(p);
      }
    });
    remap.set(seg.id, map);
  }
  const base = join(dir, `seg-${newId}`);
  const post = await open(`${base}.post.tmp`, 'w');
  const dict = await open(`${base}.dict.tmp`, 'w');
  const handles: FileHandle[] = [];
  let keyCount = 0;
  try {
    const dicts = await Promise.all(inputs.map((s) => s.dict()));
    const readers: SequentialPostings[] = [];
    for (const s of inputs) {
      const fh = await s.openPostings();
      handles.push(fh);
      readers.push(new SequentialPostings(fh));
    }
    const at = inputs.map(() => 0);
    let merged = new Uint32Array(1 << 16);
    const ps = new Sink(post, 0);
    const ds = new Sink(dict, HEADER);
    await ps.ensure(8);
    ps.u32(MAGIC);
    ps.u32(VERSION);
    for (;;) {
      let min = Infinity;
      for (let s = 0; s < inputs.length; s++) {
        if (at[s]! < inputs[s]!.keyCount) min = Math.min(min, dicts[s]!.readUInt32LE(HEADER + at[s]! * REC));
      }
      if (min === Infinity) break;
      let count = 0;
      for (let s = 0; s < inputs.length; s++) {
        if (at[s]! >= inputs[s]!.keyCount) continue;
        const rec = Segment.record(dicts[s]!, at[s]!);
        if (rec.key !== min) continue;
        at[s] = at[s]! + 1;
        const ids = inputs[s]!.decode(await readers[s]!.read(rec.off, rec.len), rec);
        const map = remap.get(inputs[s]!.id)!;
        if (count + ids.length > merged.length) {
          const bigger = new Uint32Array(Math.max(merged.length * 2, count + ids.length));
          bigger.set(merged.subarray(0, count));
          merged = bigger;
        }
        for (let k = 0; k < ids.length; k++) {
          const n = map[ids[k]!]!;
          if (n >= 0) merged[count++] = n;
        }
      }
      if (!count) continue; // todos os arquivos desse trigrama morreram
      await ps.ensure(count * 5 + 8);
      const start = ps.n;
      const off = ps.at;
      let prev = 0;
      for (let k = 0; k < count; k++) {
        const d = merged[k]!;
        ps.varint(d - prev);
        prev = d;
      }
      const crc = checksum(ps.bytesFrom(start));
      const len = ps.at - off;
      await ds.ensure(REC);
      ds.u32(min);
      ds.u32(off);
      ds.u32(len);
      ds.u32(crc);
      keyCount++;
    }
    await ps.flush();
    await ds.flush();
    const head = Buffer.alloc(HEADER);
    head.writeUInt32LE(MAGIC, 0);
    head.writeUInt32LE(VERSION, 4);
    head.writeUInt32LE(keyCount, 8);
    head.writeUInt32LE(docs.length, 12);
    await dict.write(head, 0, HEADER, 0);
  } finally {
    for (const h of handles) await h.close();
    await post.close();
    await dict.close();
  }
  await writeFile(`${base}.docs.tmp`, JSON.stringify(docs), 'utf8');
  await rename(`${base}.post.tmp`, `${base}.post`);
  await rename(`${base}.dict.tmp`, `${base}.dict`);
  await rename(`${base}.docs.tmp`, `${base}.docs`);
  return { segment: await Segment.open(dir, newId), remap };
}
