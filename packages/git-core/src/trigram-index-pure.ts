// Índice de trigramas (fase 10 da #233): a parte pura. Sem Node, sem disco: extrai os trigramas de um conteúdo, tira de uma expressão regular os trechos que
// TÊM de aparecer no arquivo (análise conservadora: na dúvida, não filtra) e codifica as listas de arquivos de cada trigrama.
//
// O índice só escolhe quais arquivos o `git grep` precisa olhar; quem decide o resultado continua sendo o `git grep`. Por isso tudo aqui erra SÓ para o lado de
// devolver arquivos a mais: um arquivo que casa nunca pode ficar de fora.

/** Trigrama = 3 bytes (24 bits) do conteúdo CRU do arquivo, com A–Z dobrado para a–z: é o que o `git grep` compara (ele não decodifica nada). */
export const TRIGRAM_BITS = 24;
/** Tamanho da tabela de bits que serve para tirar os trigramas repetidos de um arquivo (um bit por trigrama possível). */
const BITSET_BYTES = 1 << (TRIGRAM_BITS - 3);

const fold = (b: number): number => (b >= 65 && b <= 90 ? b + 32 : b);

/** O trigrama (já dobrado) de três bytes. */
export const trigramKey = (a: number, b: number, c: number): number => (fold(a) << 16) | (fold(b) << 8) | fold(c);

/**
 * Tira os trigramas DISTINTOS de um conteúdo. Janelas com quebra de linha (`\n` ou `\r`) não entram: a busca de uma linha nunca tem quebra no texto, e assim
 * o mesmo arquivo com CRLF ou LF (o `core.autocrlf` do Windows) gera o mesmo índice. Reutilizável: a tabela de bits é limpa a cada chamada.
 */
export class TrigramCollector {
  private readonly bits = new Uint8Array(BITSET_BYTES);
  private out = new Uint32Array(1 << 14);

  collect(bytes: Uint8Array): Uint32Array {
    let n = 0;
    let run = 0;
    let b0 = 0;
    let b1 = 0;
    const bits = this.bits;
    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i]!;
      if (c === 10 || c === 13) {
        run = 0;
        continue;
      }
      const f = c >= 65 && c <= 90 ? c + 32 : c;
      if (++run >= 3) {
        const k = (b0 << 16) | (b1 << 8) | f;
        const w = k >>> 3;
        const m = 1 << (k & 7);
        if ((bits[w]! & m) === 0) {
          bits[w] = bits[w]! | m;
          if (n === this.out.length) {
            const bigger = new Uint32Array(this.out.length * 2);
            bigger.set(this.out);
            this.out = bigger;
          }
          this.out[n++] = k;
        }
      }
      b0 = b1;
      b1 = f;
    }
    for (let i = 0; i < n; i++) {
      const k = this.out[i]!;
      bits[k >>> 3] = 0;
    }
    return this.out.slice(0, n);
  }
}

// ---------------------------------------------------------------- o que a expressão exige

/** Quantos trigramas no máximo uma alternativa da busca consulta (os dos trechos mais longos): menos trigramas só deixam mais candidatos, nunca menos. */
export const MAX_KEYS_PER_BRANCH = 24;

const SAFE_ESCAPES = '.^$*+?()[]{}|/\\-,:;=!#%&@~" ';
/** Escapes de um caractere só que não são literais (limites de palavra, classes, tabulação...) e não carregam argumento: só quebram o trecho. */
const BREAK_ESCAPES = 'bBAzZGdDwWsShHvVRXKtnrfea';

/** Fim do grupo que abre em `open` (`(`), olhando escapes e classes `[...]` dentro dele; `-1` se não fecha. */
function groupEnd(p: string, open: number): number {
  let depth = 0;
  for (let i = open; i < p.length; i++) {
    const c = p[i]!;
    if (c === '\\') i++;
    else if (c === '[') {
      const e = classEnd(p, i);
      if (e < 0) return -1;
      i = e;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/** Fim da classe `[...]` que abre em `open`, no estilo POSIX (`[]a]`, `[^]a]`, `[[:alpha:]]`) e com `\` do PCRE; `-1` se não fecha. */
function classEnd(p: string, open: number): number {
  let i = open + 1;
  if (p[i] === '^') i++;
  if (p[i] === ']') i++;
  for (; i < p.length; i++) {
    const c = p[i]!;
    if (c === '\\') i++;
    else if (c === '[' && (p[i + 1] === ':' || p[i + 1] === '=' || p[i + 1] === '.')) {
      const close = p.indexOf(p[i + 1]! + ']', i + 2);
      if (close < 0) return -1;
      i = close + 1;
    } else if (c === ']') return i;
  }
  return -1;
}

/**
 * Os trechos de texto que uma expressão regular (ERE ou PCRE) exige, por alternativa de nível mais alto: `[['foo','bar'], ['baz']]` quer dizer "(foo e bar) ou baz".
 * `null` = não dá para garantir nada (expressão que esta análise não entende): a busca roda sem índice. Só entram caracteres que a expressão obriga a existir
 * seguidos, nesta ordem: um caractere seguido de `*`, `?` ou `{0,` sai, e grupos, classes e escapes de classe quebram o trecho.
 */
export function regexRequiredRuns(pattern: string): string[][] | null {
  const branches: string[][] = [];
  let runs: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur) runs.push(cur);
    cur = '';
  };
  const dropLast = () => {
    // o último caractere (por inteiro, também um par substituto) deixa de ser obrigatório
    const cps = Array.from(cur);
    cps.pop();
    cur = cps.join('');
    flush();
  };
  const p = pattern;
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '(') {
      const e = groupEnd(p, i);
      if (e < 0) return null;
      // `(?x)`: o espaço e o `#` deixam de valer como texto
      const head = /^\(\?[a-zA-Z^-]*/.exec(p.slice(i, e + 1))?.[0] ?? '';
      if (head.includes('x')) return null;
      flush();
      i = e;
    } else if (c === ')') return null;
    else if (c === '[') {
      const e = classEnd(p, i);
      if (e < 0) return null;
      flush();
      i = e;
    } else if (c === '\\') {
      const n = p[i + 1];
      if (n === undefined) return null;
      i++;
      if (SAFE_ESCAPES.includes(n)) cur += n;
      else if (BREAK_ESCAPES.includes(n)) flush();
      else if (n === '<' || n === '>' || n === '`' || n === "'") flush(); // limites de palavra do GNU (no PCRE seria o próprio caractere): só quebra
      else return null; // \x41, \1, \p{..}, \Q..\E, \k<..>: tem argumento que esta análise não lê
    } else if (c === '.' || c === '^' || c === '$') flush();
    else if (c === '|') {
      flush();
      branches.push(runs);
      runs = [];
    } else if (c === '*' || c === '?') dropLast();
    else if (c === '+') flush(); // o caractere anterior vale ao menos uma vez, mas o que vem depois não é vizinho dele
    else if (c === '{') {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(p.slice(i));
      if (m) {
        i += m[0].length - 1;
        if (Number(m[1]) === 0) dropLast();
        else flush();
      } else dropLast(); // chave que não é intervalo: na dúvida, o anterior não conta
    } else cur += c;
  }
  flush();
  branches.push(runs);
  return branches;
}

/** Os trigramas obrigatórios de um trecho de texto, ou `[]` se ele é curto demais (menos de 3 bytes) ou só tem janelas que não podem ser conferidas. */
export function literalKeys(lit: string, caseInsensitive: boolean): number[] {
  const bytes = new TextEncoder().encode(lit);
  const out = new Set<number>();
  for (let i = 0; i + 2 < bytes.length; i++) {
    const a = bytes[i]!;
    const b = bytes[i + 1]!;
    const c = bytes[i + 2]!;
    if (a === 10 || a === 13 || b === 10 || b === 13 || c === 10 || c === 13) continue;
    if (caseInsensitive) {
      // sem diferenciar caixa o Git compara fora do ASCII de um jeito que não conhecemos (e, no PCRE, `k` e `s` casam o sinal Kelvin e o `ſ`): essas janelas não filtram
      if (a >= 0x80 || b >= 0x80 || c >= 0x80) continue;
      const lower = (x: number) => fold(x);
      if ([a, b, c].some((x) => lower(x) === 107 || lower(x) === 115)) continue;
    }
    out.add(trigramKey(a, b, c));
  }
  return [...out];
}

export interface TrigramPlanInput {
  pattern: string;
  regex: boolean;
  caseSensitive: boolean;
  /** Trecho fixo já escolhido (a busca de várias linhas): vale no lugar do padrão. */
  literal?: string;
}

/** "Este ou aquele grupo de trigramas": cada alternativa é um E de trigramas. `null` = sem filtro (varredura completa). */
export type TrigramPlan = number[][];

/**
 * O que o índice pode exigir de um arquivo para a busca poder casar nele. `null` quando não há como garantir (menos de 3 caracteres, sem trecho fixo, expressão
 * que a análise não entende): a busca roda como sempre. `caseSensitive: true` ainda consulta o índice dobrado: devolve candidatos a mais, e o Git decide.
 */
export function planTrigrams(q: TrigramPlanInput): TrigramPlan | null {
  const ci = !q.caseSensitive || (q.regex && q.literal === undefined && /\(\?[a-zA-Z]*i/.test(q.pattern));
  const branches: string[][] | null = q.literal !== undefined ? [[q.literal]] : q.regex ? regexRequiredRuns(q.pattern) : [[q.pattern]];
  if (!branches) return null;
  const plan: TrigramPlan = [];
  for (const runs of branches) {
    const sorted = [...runs].sort((a, b) => b.length - a.length);
    const keys = new Set<number>();
    for (const r of sorted) {
      for (const k of literalKeys(r, ci)) {
        if (keys.size >= MAX_KEYS_PER_BRANCH) break;
        keys.add(k);
      }
    }
    if (!keys.size) return null; // uma alternativa sem nada a exigir: qualquer arquivo pode casar por ela
    plan.push([...keys]);
  }
  return plan.length ? plan : null;
}

// ---------------------------------------------------------------- listas de arquivos de um trigrama

/** Número inteiro sem sinal em 1 a 5 bytes (7 bits por byte), como no protobuf. */
export function writeVarint(out: number[], v: number): void {
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

/** Lista crescente de números de arquivo → diferenças em varint. */
export function encodePostings(ids: ArrayLike<number>): Uint8Array {
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    writeVarint(out, id - prev);
    prev = id;
  }
  return Uint8Array.from(out);
}

export class CorruptIndexError extends Error {
  constructor(what: string) {
    super(`índice de busca corrompido: ${what}`);
    this.name = 'CorruptIndexError';
  }
}

/** Inverso de `encodePostings`. Confere o que lê: número que não cresce, que passa de `docCount` ou lista que não fecha lançam `CorruptIndexError`. */
export function decodePostings(bytes: Uint8Array, docCount: number): Uint32Array {
  // quantos números há = quantos bytes terminam um número (o bit alto limpo)
  let count = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i]! < 0x80) count++;
  if (bytes.length && bytes[bytes.length - 1]! >= 0x80) throw new CorruptIndexError('lista cortada');
  const out = new Uint32Array(count);
  let prev = 0;
  let i = 0;
  for (let n = 0; n < count; n++) {
    let v = 0;
    let mul = 1;
    for (;;) {
      const b = bytes[i++]!;
      v += (b & 0x7f) * mul;
      if (b < 0x80) break;
      mul *= 128;
      if (mul > 128 ** 5) throw new CorruptIndexError('número grande demais');
    }
    prev += v;
    if (prev >= docCount || (n > 0 && v === 0)) throw new CorruptIndexError('lista fora de ordem');
    out[n] = prev;
  }
  return out;
}

/** Soma de verificação (FNV-1a de 32 bits) de uma lista: pega bit trocado que ainda decodificaria como outra lista válida. */
export function checksum(bytes: Uint8Array, from = 0, to = bytes.length): number {
  let h = 0x811c9dc5;
  for (let i = from; i < to; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Interseção de duas listas crescentes. */
export function intersect(a: Uint32Array, b: Uint32Array): Uint32Array {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    const v = s[i]!;
    while (j < l.length && l[j]! < v) j++;
    if (j >= l.length) break;
    if (l[j] === v) out.push(v);
  }
  return Uint32Array.from(out);
}

/** União de listas crescentes (sem repetir). */
export function union(lists: Uint32Array[]): Uint32Array {
  if (lists.length === 1) return lists[0]!;
  const all = new Set<number>();
  for (const l of lists) for (let i = 0; i < l.length; i++) all.add(l[i]!);
  return Uint32Array.from([...all].sort((x, y) => x - y));
}

// ---------------------------------------------------------------- máscaras em JavaScript

/**
 * As máscaras da pesquisa viram `:(glob)` no Git. O índice filtra os candidatos em JavaScript, então só aceita máscaras com caracteres simples (letras, números,
 * `. _ - /`, `*` e `?`): com colchetes, chaves, barra invertida ou `!` volta `false` e a busca roda sem índice.
 */
export function masksAreSimple(globs: string[]): boolean {
  return globs.every((g) => !/[[\]{}\\!]/.test(g) && !/[\u0000-\u001f]/.test(g)); // eslint-disable-line no-control-regex
}

/** O glob do Git (`**\/x`, `x/**`, `*`, `?`) como expressão regular; vale só para o que `masksAreSimple` aceita. */
export function maskGlobToRegExp(g: string): RegExp {
  let out = '';
  for (let i = 0; i < g.length; ) {
    if ((i === 0 || g[i - 1] === '/') && g.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 3;
    } else if (g.startsWith('/**', i) && i + 3 === g.length) {
      out += '/.*';
      i += 3;
    } else if (g[i] === '*') {
      out += '[^/]*';
      i += g[i + 1] === '*' ? 2 : 1;
    } else if (g[i] === '?') {
      out += '[^/]';
      i++;
    } else {
      out += g[i]!.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return new RegExp('^' + out + '$');
}

/** O filtro de máscaras como o `git grep` o aplica: está dentro se casa alguma inclusão (ou não há inclusão) e nenhuma exclusão. */
export function maskMatcher(masks: { include: string[]; exclude: string[] }): (file: string) => boolean {
  const inc = masks.include.map(maskGlobToRegExp);
  const exc = masks.exclude.map(maskGlobToRegExp);
  return (f) => (!inc.length || inc.some((r) => r.test(f))) && !exc.some((r) => r.test(f));
}

/** Ordena caminhos na ordem em que o Git os lista: bytes do UTF-8 (não as unidades UTF-16 do JavaScript). */
export function sortGitPaths(paths: Iterable<string>): string[] {
  const keyed = [...paths].map((p) => [Buffer.from(p, 'utf8'), p] as const);
  keyed.sort((x, y) => Buffer.compare(x[0], y[0]));
  return keyed.map((k) => k[1]);
}
