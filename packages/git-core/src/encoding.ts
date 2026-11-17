// Leitura e gravação de arquivos de texto SEM perder bytes: detecta a codificação, decodifica e codifica de volta na mesma.
// Antes, tudo era lido e gravado como UTF-8: num arquivo Windows-1252 os bytes inválidos viravam U+FFFD (�) e a gravação
// (descartar linha, stage por linha, resolver conflito) trocava "ç", "ã", "é" por "�" para sempre.
//
// A garantia de integridade é uma só, vale para TODAS as codificações do catálogo e não depende de tabela escrita à mão:
//  - ao LER, o texto é codificado de volta e comparado com os bytes originais; se não forem idênticos, o arquivo é marcado
//    `invalid` e a interface desliga as ações que gravam (nada é regravado a partir de uma leitura que perdeu informação);
//  - ao GRAVAR, o resultado é decodificado e comparado com o texto; se algum caractere não existe na codificação, lança
//    `EncodingError` ANTES de tocar no arquivo (em vez de trocar por "?").
import iconv from 'iconv-lite';
import { tm } from './messages.js';
import { encodingDef, type EncodingChoice, type FileEncoding } from './file-encoding.js';

const BOM_UTF8 = [0xef, 0xbb, 0xbf];
const BOM_LE = [0xff, 0xfe];
const BOM_BE = [0xfe, 0xff];
const BOM_32LE = [0xff, 0xfe, 0x00, 0x00];
const BOM_32BE = [0x00, 0x00, 0xfe, 0xff];
const startsWith = (b: Uint8Array, bom: number[]) => bom.every((v, i) => b[i] === v);
const BOM_OF = (bytes: number[]) => Buffer.from(bytes);

const hasNonAscii = (b: Uint8Array): boolean => b.some((v) => v >= 0x80);
const hasBom = (b: Uint8Array): boolean => [BOM_UTF8, BOM_LE, BOM_BE, BOM_32BE].some((m) => startsWith(b, m));

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Detecção de UMA sequência de bytes: BOM, depois UTF-8 válido, senão Windows-1252 (o legado mais comum no Windows). */
export function detectEncoding(bytes: Uint8Array): FileEncoding {
  if (startsWith(bytes, BOM_UTF8)) return 'utf-8-bom';
  if (startsWith(bytes, BOM_32LE)) return 'utf-32le-bom';
  if (startsWith(bytes, BOM_32BE)) return 'utf-32be-bom';
  if (startsWith(bytes, BOM_LE)) return 'utf-16le-bom';
  if (startsWith(bytes, BOM_BE)) return 'utf-16be-bom';
  try {
    UTF8_STRICT.decode(bytes);
    return 'utf-8';
  } catch {
    return 'windows-1252';
  }
}

/**
 * Detecção para um conjunto de versões do mesmo arquivo (HEAD, índice, disco): vale a primeira que tem algo além de ASCII
 * (ou um BOM). Passe a mais nova primeiro. Só ASCII em todas = UTF-8.
 */
export function detectEncodingOf(...versions: Array<Uint8Array | null | undefined>): FileEncoding {
  for (const v of versions) if (v && (hasNonAscii(v) || hasBom(v))) return detectEncoding(v);
  return 'utf-8';
}

const bomBytes = (enc: FileEncoding): number[] | null => {
  switch (enc) {
    case 'utf-8-bom':
      return BOM_UTF8;
    case 'utf-16le-bom':
      return BOM_LE;
    case 'utf-16be-bom':
      return BOM_BE;
    case 'utf-32le-bom':
      return BOM_32LE;
    case 'utf-32be-bom':
      return BOM_32BE;
    default:
      return null;
  }
};

const isUtf16 = (enc: FileEncoding): boolean => enc.startsWith('utf-16');

const swap16 = (b: Buffer): Buffer => Buffer.from(b).swap16();

/** Decodificação bruta (sem a verificação de ida e volta). `invalid` = a própria decodificação já viu bytes impossíveis. */
function rawDecode(bytes: Buffer, enc: FileEncoding): { text: string; invalid: boolean } {
  const bom = bomBytes(enc);
  const body = bom && startsWith(bytes, bom) ? bytes.subarray(bom.length) : bytes;
  if (enc === 'utf-8' || enc === 'utf-8-bom') {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body), invalid: false };
    } catch {
      return { text: new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(body), invalid: true };
    }
  }
  if (isUtf16(enc)) {
    const even = body.length - (body.length % 2);
    const units = body.subarray(0, even);
    const text = (enc.startsWith('utf-16le') ? units : swap16(units)).toString('utf16le');
    return { text, invalid: body.length % 2 !== 0 };
  }
  const codec = encodingDef(enc).codec ?? 'windows-1252';
  return { text: iconv.decode(body, codec, { stripBOM: false }), invalid: false };
}

/** Codificação bruta (sem a verificação). */
function rawEncode(text: string, enc: FileEncoding): Buffer {
  const bom = bomBytes(enc);
  let body: Buffer;
  if (enc === 'utf-8' || enc === 'utf-8-bom') body = Buffer.from(text, 'utf8');
  else if (isUtf16(enc)) {
    const le = Buffer.from(text, 'utf16le');
    body = enc.startsWith('utf-16le') ? le : swap16(le);
  } else body = iconv.encode(text, encodingDef(enc).codec ?? 'windows-1252', { addBOM: false });
  return bom ? Buffer.concat([BOM_OF(bom), body]) : body;
}

/** Texto lido + se o arquivo NÃO sobrevive a uma ida e volta nesta codificação (veja o cabeçalho do arquivo). */
export interface Decoded {
  text: string;
  invalid: boolean;
}

export function decodeText(bytes: Uint8Array, encoding: FileEncoding): Decoded {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const raw = rawDecode(buf, encoding);
  if (raw.invalid) return raw;
  // UTF-8 sem BOM, quando válido, sempre volta igual. Para as demais (inclusive as com BOM: se o arquivo não tem o BOM da
  // codificação escolhida, gravar o acrescentaria) a prova é refazer o caminho e comparar byte a byte com o original.
  if (encoding === 'utf-8') return raw;
  let back: Buffer | null = null;
  try {
    back = rawEncode(raw.text, encoding);
  } catch {
    /* não consegue nem codificar: inválido */
  }
  return { text: raw.text, invalid: back === null || !back.equals(buf) };
}

/** Lançado quando o texto tem um caractere que a codificação não consegue representar (gravar trocaria por "?" ou perderia o caractere). */
export class EncodingError extends Error {
  constructor(
    readonly encoding: FileEncoding,
    readonly char: string,
  ) {
    const cp = `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
    super(
      tm(
        `O caractere "${char}" (${cp}) não existe na codificação ${encodingDef(encoding).label}. O arquivo não foi alterado.`,
        `The character "${char}" (${cp}) does not exist in the ${encodingDef(encoding).label} encoding. The file was not changed.`,
      ),
    );
    this.name = 'EncodingError';
  }
}

/** Primeiro caractere que não faz a ida e volta (só roda quando já se sabe que há um). */
function firstUnencodable(text: string, enc: FileEncoding): string {
  for (const ch of text) {
    try {
      if (rawDecode(rawEncode(ch, enc), enc).text === ch) continue;
    } catch {
      /* conta como não codificável */
    }
    return ch;
  }
  return text.slice(0, 1) || '?';
}

/** Codifica o texto na codificação pedida. Lança `EncodingError` se algum caractere não existir nela (nunca troca por "?"). */
export function encodeText(text: string, encoding: FileEncoding): Buffer {
  const out = rawEncode(text, encoding);
  const bom = bomBytes(encoding);
  const back = rawDecode(bom ? out.subarray(bom.length) : out, encoding).text;
  // a comparação é por texto: o que foi gravado tem de ler de volta como EXATAMENTE o que foi pedido
  if (back !== text) throw new EncodingError(encoding, firstUnencodable(text, encoding));
  return out;
}

/** Resolve a codificação a usar: a pedida ou, em `auto`/ausente, a detectada. */
export function resolveEncoding(requested: EncodingChoice | undefined, detected: FileEncoding): FileEncoding {
  return requested && requested !== 'auto' ? requested : detected;
}
