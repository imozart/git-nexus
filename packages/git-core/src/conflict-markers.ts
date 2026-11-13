// Funções puras (sem Node) — usadas também pelo renderer.

const START = /^<{7}(?: (.*))?$/;
const BASE = /^\|{7}(?: (.*))?$/;
const MID = /^={7}$/;
const END = /^>{7}(?: (.*))?$/;

/** Trava de segurança: true se restar qualquer marcador (`<<<<<<<`, `=======`, `>>>>>>>`). */
export function hasConflictMarkers(content: string): boolean {
  return /^(?:<{7}(?: .*)?|={7}|>{7}(?: .*)?)\r?$/m.test(content);
}

export interface ConflictRegion {
  /** Offsets no texto: [from, to) cobre da linha `<<<<<<<` até a quebra de linha após `>>>>>>>`. */
  from: number;
  to: number;
  /** Linha (0-based) do marcador inicial. */
  startLine: number;
  ours: string;
  /** null quando o arquivo não está em estilo diff3. */
  base: string | null;
  theirs: string;
  oursLabel: string;
  theirsLabel: string;
}

export type ConflictChoice = 'ours' | 'base' | 'theirs' | 'both';

/** Localiza blocos de conflito completos (ignora blocos mal formados/sem fechamento). */
export function findConflictRegions(text: string): ConflictRegion[] {
  const lines = text.split('\n');
  const regions: ConflictRegion[] = [];
  let offset = 0;
  let cur: {
    from: number;
    startLine: number;
    oursLabel: string;
    section: 'ours' | 'base' | 'theirs';
    ours: string;
    base: string | null;
    theirs: string;
  } | null = null;

  lines.forEach((raw, i) => {
    const lineLen = raw.length + (i < lines.length - 1 ? 1 : 0);
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const withNl = i < lines.length - 1 ? raw + '\n' : raw;
    let m: RegExpExecArray | null;
    if (!cur) {
      if ((m = START.exec(line))) {
        cur = { from: offset, startLine: i, oursLabel: m[1] ?? '', section: 'ours', ours: '', base: null, theirs: '' };
      }
    } else if (cur.section === 'ours' && BASE.test(line)) {
      cur.section = 'base';
      cur.base = '';
    } else if (cur.section !== 'theirs' && MID.test(line)) {
      cur.section = 'theirs';
    } else if (cur.section === 'theirs' && (m = END.exec(line))) {
      regions.push({
        from: cur.from,
        to: offset + lineLen,
        startLine: cur.startLine,
        ours: cur.ours,
        base: cur.base,
        theirs: cur.theirs,
        oursLabel: cur.oursLabel,
        theirsLabel: m[1] ?? '',
      });
      cur = null;
    } else if (START.test(line)) {
      // novo início sem fechar o anterior: descarta o incompleto
      cur = { from: offset, startLine: i, oursLabel: START.exec(line)?.[1] ?? '', section: 'ours', ours: '', base: null, theirs: '' };
    } else {
      cur[cur.section] = (cur[cur.section] ?? '') + withNl;
    }
    offset += lineLen;
  });
  return regions;
}

/** Texto que substitui o bloco de conflito conforme a escolha. */
function choiceText(region: ConflictRegion, choice: ConflictChoice): string {
  switch (choice) {
    case 'ours':
      return region.ours;
    case 'theirs':
      return region.theirs;
    case 'base':
      return region.base ?? '';
    case 'both':
      return region.ours + region.theirs;
  }
}

/** Aplica a escolha ao bloco `index` e devolve o novo texto. */
export function applyChoice(text: string, region: ConflictRegion, choice: ConflictChoice): string {
  return text.slice(0, region.from) + choiceText(region, choice) + text.slice(region.to);
}
