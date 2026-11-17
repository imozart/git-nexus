import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import {
  ENCODING_GROUPS,
  EncodingError,
  FILE_ENCODINGS,
  decodeText,
  detectEncoding,
  detectEncodingOf,
  encodeText,
  isFileEncoding,
  resolveEncoding,
} from '../src/index.js';

const bytes = (...n: number[]) => Buffer.from(n);

describe('catálogo de codificações', () => {
  it('ids únicos, todo grupo existe e todo codec existe no iconv-lite', () => {
    const ids = FILE_ENCODINGS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of FILE_ENCODINGS) {
      expect(ENCODING_GROUPS).toContain(e.group);
      if ('codec' in e && e.codec) expect(iconv.encodingExists(e.codec), `${e.id} → ${e.codec}`).toBe(true);
    }
  });

  it('tem o conjunto dos editores: Unicode, Europa, Cirílico, Grego, Turco, Hebraico, Árabe, Tailandês, CJK', () => {
    for (const id of ['utf-8', 'utf-8-bom', 'utf-16le-bom', 'utf-32be', 'windows-1252', 'iso-8859-1', 'ibm437', 'ibm850', 'ibm852', 'windows-1251', 'koi8-r', 'ibm866', 'windows-1253', 'windows-1254', 'windows-1255', 'windows-1256', 'windows-874', 'windows-1258', 'shift_jis', 'euc-jp', 'gbk', 'gb18030', 'big5', 'euc-kr', 'macintosh']) {
      expect(isFileEncoding(id), id).toBe(true);
    }
    expect(isFileEncoding('klingon')).toBe(false);
  });

  it('TODAS as codificações escrevem e leem de volta o mesmo texto (ASCII e acentos comuns quando existem)', () => {
    for (const e of FILE_ENCODINGS) {
      const text = 'Aa1 linha\nsegunda linha\r\n';
      const out = encodeText(text, e.id);
      const back = decodeText(out, e.id);
      expect(back.text, e.id).toBe(text);
      expect(back.invalid, e.id).toBe(false);
    }
  });
});

describe('detecção', () => {
  it('BOMs: UTF-8, UTF-16 LE/BE, UTF-32 LE/BE', () => {
    expect(detectEncoding(bytes(0xef, 0xbb, 0xbf, 0x41))).toBe('utf-8-bom');
    expect(detectEncoding(bytes(0xff, 0xfe, 0x41, 0x00))).toBe('utf-16le-bom');
    expect(detectEncoding(bytes(0xfe, 0xff, 0x00, 0x41))).toBe('utf-16be-bom');
    expect(detectEncoding(bytes(0xff, 0xfe, 0x00, 0x00, 0x41, 0, 0, 0))).toBe('utf-32le-bom');
    expect(detectEncoding(bytes(0x00, 0x00, 0xfe, 0xff, 0, 0, 0, 0x41))).toBe('utf-32be-bom');
  });

  it('UTF-8 válido (com acento) é UTF-8; bytes soltos viram Windows-1252; só ASCII é UTF-8', () => {
    expect(detectEncoding(Buffer.from('ação', 'utf8'))).toBe('utf-8');
    expect(detectEncoding(bytes(0x61, 0xe7, 0xe3, 0x6f))).toBe('windows-1252'); // "ação" em Windows-1252
    expect(detectEncoding(Buffer.from('ascii'))).toBe('utf-8');
  });

  it('com várias versões vale a primeira que tem algo além de ASCII', () => {
    const ascii = Buffer.from('so ascii');
    const latin = bytes(0xe7);
    expect(detectEncodingOf(ascii, latin)).toBe('windows-1252'); // a nova é ASCII: decide a antiga
    expect(detectEncodingOf(Buffer.from('ç', 'utf8'), latin)).toBe('utf-8'); // a nova manda
    expect(detectEncodingOf(null, undefined, ascii)).toBe('utf-8');
  });

  it('resolveEncoding: o pedido vence; auto ou ausente usa o detectado', () => {
    expect(resolveEncoding('utf-8', 'windows-1252')).toBe('utf-8');
    expect(resolveEncoding('auto', 'windows-1252')).toBe('windows-1252');
    expect(resolveEncoding(undefined, 'utf-16le-bom')).toBe('utf-16le-bom');
  });
});

describe('integridade: ler e gravar nunca perde bytes', () => {
  it('Windows-1252: "ação" volta byte a byte', () => {
    const original = bytes(0x61, 0xe7, 0xe3, 0x6f, 0x0a);
    const d = decodeText(original, 'windows-1252');
    expect(d).toEqual({ text: 'ação\n', invalid: false });
    expect(encodeText(d.text, 'windows-1252').equals(original)).toBe(true);
  });

  it('ler Windows-1252 como UTF-8 é marcado inválido (era aqui que o "�" corrompia o arquivo)', () => {
    const d = decodeText(bytes(0x61, 0xe7, 0xe3, 0x6f), 'utf-8');
    expect(d.invalid).toBe(true);
    expect(d.text).toContain('�');
  });

  it('byte sem significado na codificação (0x81 em Windows-1252) é inválido; em ISO-8859-1 todo byte existe', () => {
    expect(decodeText(bytes(0x81), 'windows-1252').invalid).toBe(true);
    const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const d = decodeText(all, 'iso-8859-1');
    expect(d.invalid).toBe(false);
    expect(encodeText(d.text, 'iso-8859-1').equals(all)).toBe(true);
  });

  it('gravar um caractere que a codificação não tem LANÇA, em vez de trocar por "?"', () => {
    expect(() => encodeText('preço €', 'iso-8859-1')).toThrow(EncodingError);
    expect(() => encodeText('日本', 'windows-1252')).toThrow(/não existe/);
    try {
      encodeText('a€b', 'iso-8859-1');
    } catch (e) {
      expect((e as EncodingError).char).toBe('€');
      expect((e as EncodingError).message).toMatch(/U\+20AC/);
    }
    expect(encodeText('preço €', 'windows-1252').includes(0x80)).toBe(true); // € existe em Windows-1252
  });

  it('BOM: UTF-8 BOM e UTF-16 mantêm a marca; sem a marca no arquivo, escolher a variante com BOM é inválido (gravar acrescentaria o BOM)', () => {
    const withBom = Buffer.concat([bytes(0xef, 0xbb, 0xbf), Buffer.from('olá')]);
    const d = decodeText(withBom, 'utf-8-bom');
    expect(d).toEqual({ text: 'olá', invalid: false });
    expect(encodeText(d.text, 'utf-8-bom').equals(withBom)).toBe(true);
    expect(decodeText(Buffer.from('olá'), 'utf-8-bom').invalid).toBe(true);
    // sem BOM, o BOM do arquivo é só um caractere e volta igual
    expect(decodeText(withBom, 'utf-8')).toEqual({ text: '﻿olá', invalid: false });

    const le = encodeText('Olá ✓', 'utf-16le-bom');
    expect([...le.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(decodeText(le, 'utf-16le-bom')).toEqual({ text: 'Olá ✓', invalid: false });
    const be = encodeText('Olá ✓', 'utf-16be-bom');
    expect([...be.subarray(0, 2)]).toEqual([0xfe, 0xff]);
    expect(decodeText(be, 'utf-16be-bom').text).toBe('Olá ✓');
    expect(decodeText(bytes(0xff, 0xfe, 0x41), 'utf-16le-bom').invalid).toBe(true); // número ímpar de bytes
  });

  it('idiomas asiáticos e cirílico fazem a ida e volta (e o que não faz é marcado)', () => {
    const casos: Array<[string, string]> = [
      ['shift_jis', '日本語のテキスト'],
      ['euc-jp', '日本語のテキスト'],
      ['gbk', '简体中文文本'],
      ['gb18030', '简体中文 😀'], // fora do plano básico: só o GB18030 tem
      ['big5', '繁體中文文字'],
      ['euc-kr', '한국어 텍스트'],
      ['koi8-r', 'Привет, мир'],
      ['windows-1251', 'Привет, мир'],
      ['ibm866', 'Привет, мир'],
      ['windows-1253', 'Γειά σου'],
      ['windows-1255', 'שלום'],
      ['windows-1256', 'مرحبا'],
      ['windows-874', 'สวัสดี'],
      ['ibm437', 'Çüéâäà ░▒▓'],
      ['ibm850', 'Çüéâäà ø£'],
      ['macintosh', 'ação ∑'],
      ['utf-32le', 'Olá 😀'],
      ['utf-32be-bom', 'Olá 😀'],
    ];
    for (const [enc, text] of casos) {
      const id = enc as Parameters<typeof encodeText>[1];
      const out = encodeText(text, id);
      expect(decodeText(out, id), enc).toEqual({ text, invalid: false });
    }
    expect(() => encodeText('😀', 'gbk')).toThrow(EncodingError);
    expect(() => encodeText('Привет', 'windows-1252')).toThrow(EncodingError);
  });

  it('bytes que o japonês não tem são inválidos, e arquivo inválido nunca "volta igual"', () => {
    expect(decodeText(bytes(0x81), 'shift_jis').invalid).toBe(true);
  });
});
