// Codificações de arquivo oferecidas na interface (o conjunto de editores como Notepad++ e IntelliJ). Núcleo PURO (sem APIs do
// Node): o catálogo e os tipos são usados pelo renderer; quem lê/grava bytes de verdade está em `encoding.ts`.

export type EncodingGroup =
  | 'unicode'
  | 'west-europe'
  | 'central-europe'
  | 'baltic-nordic'
  | 'cyrillic'
  | 'greek'
  | 'turkish'
  | 'hebrew'
  | 'arabic'
  | 'thai'
  | 'vietnamese'
  | 'japanese'
  | 'chinese-simplified'
  | 'chinese-traditional'
  | 'korean';

export interface EncodingDef {
  /** Identificador estável (é o que fica salvo na preferência do arquivo). */
  id: string;
  /** Nome técnico mostrado na interface (não se traduz). */
  label: string;
  group: EncodingGroup;
  /** Nome no iconv-lite quando a codificação não é UTF-8/UTF-16 (essas são tratadas direto). */
  codec?: string;
  /** Escreve (e, ao ler, retira) a marca de ordem de bytes. */
  bom?: boolean;
}

const sb = (id: string, label: string, group: EncodingGroup, codec: string): EncodingDef => ({ id, label, group, codec });

/** Ordem = ordem do menu. Os grupos seguem os dos editores (Notepad++: por idioma/região). */
export const FILE_ENCODINGS = [
  // Unicode. Os ids `-bom` gravam a marca de ordem de bytes; sem ela, o arquivo fica sem a marca.
  { id: 'utf-8', label: 'UTF-8', group: 'unicode' },
  { id: 'utf-8-bom', label: 'UTF-8 BOM', group: 'unicode', bom: true },
  { id: 'utf-16le-bom', label: 'UTF-16 LE BOM', group: 'unicode', bom: true },
  { id: 'utf-16be-bom', label: 'UTF-16 BE BOM', group: 'unicode', bom: true },
  { id: 'utf-16le', label: 'UTF-16 LE', group: 'unicode' },
  { id: 'utf-16be', label: 'UTF-16 BE', group: 'unicode' },
  { id: 'utf-32le-bom', label: 'UTF-32 LE BOM', group: 'unicode', codec: 'utf-32le', bom: true },
  { id: 'utf-32be-bom', label: 'UTF-32 BE BOM', group: 'unicode', codec: 'utf-32be', bom: true },
  { id: 'utf-32le', label: 'UTF-32 LE', group: 'unicode', codec: 'utf-32le' },
  { id: 'utf-32be', label: 'UTF-32 BE', group: 'unicode', codec: 'utf-32be' },
  { id: 'utf-7', label: 'UTF-7', group: 'unicode', codec: 'utf-7' },

  // Europa Ocidental
  sb('windows-1252', 'Windows-1252', 'west-europe', 'windows-1252'),
  sb('iso-8859-1', 'ISO-8859-1', 'west-europe', 'iso-8859-1'),
  sb('iso-8859-15', 'ISO-8859-15', 'west-europe', 'iso-8859-15'),
  sb('iso-8859-3', 'ISO-8859-3', 'west-europe', 'iso-8859-3'),
  sb('macintosh', 'Mac Roman', 'west-europe', 'macintosh'),
  sb('ibm437', 'IBM437 (DOS EUA)', 'west-europe', 'cp437'),
  sb('ibm850', 'IBM850 (DOS Latin-1)', 'west-europe', 'cp850'),
  sb('ibm858', 'IBM858 (DOS Latin-1 €)', 'west-europe', 'cp858'),
  sb('ibm860', 'IBM860 (DOS Português)', 'west-europe', 'cp860'),
  sb('ibm863', 'IBM863 (DOS Francês canadense)', 'west-europe', 'cp863'),

  // Europa Central e Oriental
  sb('windows-1250', 'Windows-1250', 'central-europe', 'windows-1250'),
  sb('iso-8859-2', 'ISO-8859-2', 'central-europe', 'iso-8859-2'),
  sb('iso-8859-16', 'ISO-8859-16', 'central-europe', 'iso-8859-16'),
  sb('ibm852', 'IBM852 (DOS Latin-2)', 'central-europe', 'cp852'),

  // Países bálticos e nórdicos
  sb('windows-1257', 'Windows-1257', 'baltic-nordic', 'windows-1257'),
  sb('iso-8859-4', 'ISO-8859-4', 'baltic-nordic', 'iso-8859-4'),
  sb('iso-8859-13', 'ISO-8859-13', 'baltic-nordic', 'iso-8859-13'),
  sb('iso-8859-10', 'ISO-8859-10', 'baltic-nordic', 'iso-8859-10'),
  sb('iso-8859-14', 'ISO-8859-14', 'baltic-nordic', 'iso-8859-14'),
  sb('ibm775', 'IBM775 (DOS Báltico)', 'baltic-nordic', 'cp775'),
  sb('ibm861', 'IBM861 (DOS Islandês)', 'baltic-nordic', 'cp861'),
  sb('ibm865', 'IBM865 (DOS Nórdico)', 'baltic-nordic', 'cp865'),

  // Cirílico
  sb('windows-1251', 'Windows-1251', 'cyrillic', 'windows-1251'),
  sb('iso-8859-5', 'ISO-8859-5', 'cyrillic', 'iso-8859-5'),
  sb('koi8-r', 'KOI8-R', 'cyrillic', 'koi8-r'),
  sb('koi8-u', 'KOI8-U', 'cyrillic', 'koi8-u'),
  sb('ibm866', 'IBM866 (DOS Cirílico)', 'cyrillic', 'cp866'),
  sb('ibm855', 'IBM855 (DOS Cirílico)', 'cyrillic', 'cp855'),
  sb('x-mac-cyrillic', 'Mac Cyrillic', 'cyrillic', 'maccyrillic'),

  // Grego
  sb('windows-1253', 'Windows-1253', 'greek', 'windows-1253'),
  sb('iso-8859-7', 'ISO-8859-7', 'greek', 'iso-8859-7'),
  sb('ibm737', 'IBM737 (DOS Grego)', 'greek', 'cp737'),
  sb('ibm869', 'IBM869 (DOS Grego 2)', 'greek', 'cp869'),

  // Turco
  sb('windows-1254', 'Windows-1254', 'turkish', 'windows-1254'),
  sb('iso-8859-9', 'ISO-8859-9', 'turkish', 'iso-8859-9'),
  sb('ibm857', 'IBM857 (DOS Turco)', 'turkish', 'cp857'),

  // Hebraico
  sb('windows-1255', 'Windows-1255', 'hebrew', 'windows-1255'),
  sb('iso-8859-8', 'ISO-8859-8', 'hebrew', 'iso-8859-8'),
  sb('ibm862', 'IBM862 (DOS Hebraico)', 'hebrew', 'cp862'),

  // Árabe
  sb('windows-1256', 'Windows-1256', 'arabic', 'windows-1256'),
  sb('iso-8859-6', 'ISO-8859-6', 'arabic', 'iso-8859-6'),
  sb('ibm864', 'IBM864 (DOS Árabe)', 'arabic', 'cp864'),

  // Tailandês e vietnamita
  sb('windows-874', 'Windows-874', 'thai', 'windows-874'),
  sb('tis-620', 'TIS-620', 'thai', 'tis620'),
  sb('windows-1258', 'Windows-1258', 'vietnamese', 'windows-1258'),

  // Japonês
  sb('shift_jis', 'Shift_JIS', 'japanese', 'shift_jis'),
  sb('windows-31j', 'Windows-31J (CP932)', 'japanese', 'cp932'),
  sb('euc-jp', 'EUC-JP', 'japanese', 'euc-jp'),

  // Chinês
  sb('gbk', 'GBK (GB2312)', 'chinese-simplified', 'cp936'),
  sb('gb18030', 'GB18030', 'chinese-simplified', 'gb18030'),
  sb('big5', 'Big5', 'chinese-traditional', 'big5'),
  sb('big5-hkscs', 'Big5-HKSCS', 'chinese-traditional', 'big5hkscs'),
  sb('cp950', 'Windows-950 (CP950)', 'chinese-traditional', 'cp950'),

  // Coreano
  sb('euc-kr', 'EUC-KR', 'korean', 'euc-kr'),
  sb('windows-949', 'Windows-949 (CP949)', 'korean', 'cp949'),
] as const satisfies readonly EncodingDef[];

/** Identificador de uma codificação do catálogo. */
export type FileEncoding = (typeof FILE_ENCODINGS)[number]['id'];

/** A pessoa pode pedir uma codificação ou deixar a detecção automática decidir. */
export type EncodingChoice = FileEncoding | 'auto';

export const ENCODING_GROUPS: readonly EncodingGroup[] = [
  'unicode', 'west-europe', 'central-europe', 'baltic-nordic', 'cyrillic', 'greek', 'turkish', 'hebrew', 'arabic', 'thai', 'vietnamese',
  'japanese', 'chinese-simplified', 'chinese-traditional', 'korean',
];

export const isFileEncoding = (s: unknown): s is FileEncoding => FILE_ENCODINGS.some((e) => e.id === s);

export const encodingDef = (id: FileEncoding): EncodingDef => FILE_ENCODINGS.find((e) => e.id === id) as EncodingDef;

export const encodingLabel = (id: FileEncoding): string => encodingDef(id).label;

/** O que a interface precisa saber sobre a codificação do arquivo aberto. */
export interface FileEncodingInfo {
  /** Codificação usada para ler (e gravar) o arquivo: a escolhida pela pessoa ou a detectada. */
  encoding: FileEncoding;
  /** O que a detecção automática concluiu (para mostrar "automático" e para voltar a ela). */
  detected: FileEncoding;
  /**
   * O arquivo NÃO sobrevive a uma ida e volta nesta codificação (há bytes que ela não representa, ou o texto não volta aos
   * mesmos bytes): o texto mostrado pode ter "�" e gravar o arquivo o alteraria. As ações que gravam ficam desligadas.
   */
  invalid: boolean;
}
