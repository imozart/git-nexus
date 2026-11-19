// Fusão de três vias por linhas, calculada pelo app (puro: sem Node, roda também no renderer).
//
// Em vez de interpretar os marcadores que o Git deixou no arquivo, recebe as três versões (a base, a do usuário e a que chega) e
// devolve uma lista de SEGMENTOS: o que é estável, o que só um lado mudou, o que os dois mudaram do mesmo jeito e o que é conflito.
// As ESCOLHAS do usuário são um modelo à parte (`MergeChoices`) e o texto do resultado é sempre gerado dele (`resolveMerge`), nunca
// editado "no escuro" nem gravado com marcador.
//
// Mesma regra do Git (xdiff): dois trechos alterados que se sobrepõem OU ENCOSTAM (um termina onde o outro começa) formam um
// conflito, a não ser que as duas mudanças sejam idênticas. Como o `git merge-file` (nível "zealous"), o começo e o fim iguais
// nos dois lados saem do conflito. Para entradas sem conflito o resultado é o mesmo do `git merge-file -p` (veja os testes).
//
// Diferenças de propósito em relação ao Git: as linhas são comparadas SEM o terminador (CRLF e LF são a mesma linha, como no diff
// lado a lado do app), e cada linha guarda o terminador de onde nasceu, para regravar o arquivo exatamente como estava. Só a última
// linha sem quebra é diferente da mesma linha com quebra (como no Git).

import { diffHunks, lineEols, splitLines, type DiffHunk } from './line-diff.js';

export type MergeSide = 'mine' | 'theirs' | 'base';
export type SegmentKind = 'stable' | 'mine' | 'theirs' | 'same' | 'conflict';

/** Linhas `[start, end)` de uma versão (0-based). */
export interface LineRange {
  start: number;
  end: number;
}

export interface MergeSegment {
  kind: SegmentKind;
  /** Onde o segmento está em cada uma das três versões (um intervalo vazio marca "aqui entra / daqui saiu"). */
  base: LineRange;
  mine: LineRange;
  theirs: LineRange;
  /**
   * `same` que veio de aparar o começo ou o fim iguais de um conflito (o resto continua conflito): fica fora da lista de mudanças
   * desfazíveis, porque a base dele é vazia.
   */
  refined?: boolean;
}

export interface MergeDoc {
  /** Linhas sem o terminador. */
  lines: string[];
  /** Terminador real de cada linha (`\r\n`, `\n` ou `''` para a última sem quebra). */
  eols: string[];
  /** Fim de linha dominante (usado onde a linha não tem terminador próprio). */
  eol: '\n' | '\r\n';
  endsWithNewline: boolean;
  /** Chave de comparação: o texto da linha; a última sem quebra de linha ganha uma marca para diferir da mesma linha com quebra. */
  keys: string[];
}

export interface MergeModel {
  base: MergeDoc;
  mine: MergeDoc;
  theirs: MergeDoc;
  segments: MergeSegment[];
  /** Índices (em `segments`) dos conflitos, em ordem. */
  conflicts: number[];
  /** Índices das mudanças sem conflito que podem ser desfeitas (`mine`, `theirs` e `same`, exceto os aparados de um conflito). */
  changes: number[];
}

const NO_EOL_MARK = '\u0000sem-quebra';

function toDoc(text: string): MergeDoc {
  const s = splitLines(text);
  const last = s.lines.length - 1;
  return {
    lines: s.lines,
    eols: lineEols(text),
    eol: s.eol,
    endsWithNewline: s.endsWithNewline,
    keys: s.lines.map((l, i) => (i === last && !s.endsWithNewline ? l + NO_EOL_MARK : l)),
  };
}

const sameKeys = (a: MergeDoc, ar: LineRange, b: MergeDoc, br: LineRange): boolean => {
  if (ar.end - ar.start !== br.end - br.start) return false;
  for (let i = 0; i < ar.end - ar.start; i++) if (a.keys[ar.start + i] !== b.keys[br.start + i]) return false;
  return true;
};

/** Calcula a fusão. As três versões já vêm decodificadas na mesma codificação (`getMergeConflicts`). */
export function buildMerge(input: { base: string; mine: string; theirs: string }): MergeModel {
  const base = toDoc(input.base);
  const mine = toDoc(input.mine);
  const theirs = toDoc(input.theirs);
  const hm = diffHunks(base.keys, mine.keys);
  const ht = diffHunks(base.keys, theirs.keys);

  const segments: MergeSegment[] = [];
  let i = 0;
  let j = 0;
  let pos = 0; // quanto da base já foi consumido
  let dm = 0; // índice na minha versão - índice na base, em `pos`
  let dt = 0;
  const stable = (to: number) => {
    if (to > pos) {
      segments.push({ kind: 'stable', base: { start: pos, end: to }, mine: { start: pos + dm, end: to + dm }, theirs: { start: pos + dt, end: to + dt } });
    }
  };

  while (i < hm.length || j < ht.length) {
    const start = Math.min(hm[i]?.aStart ?? Infinity, ht[j]?.aStart ?? Infinity);
    stable(start);
    // o grupo cresce enquanto algum trecho de qualquer lado se sobrepõe ou encosta nele
    let end = start;
    const usedM: DiffHunk[] = [];
    const usedT: DiffHunk[] = [];
    for (let grew = true; grew; ) {
      grew = false;
      while (i < hm.length && hm[i]!.aStart <= end) {
        usedM.push(hm[i]!);
        end = Math.max(end, hm[i]!.aEnd);
        i++;
        grew = true;
      }
      while (j < ht.length && ht[j]!.aStart <= end) {
        usedT.push(ht[j]!);
        end = Math.max(end, ht[j]!.aEnd);
        j++;
        grew = true;
      }
    }
    const nm = dm + usedM.reduce((n, h) => n + (h.bEnd - h.bStart) - (h.aEnd - h.aStart), 0);
    const nt = dt + usedT.reduce((n, h) => n + (h.bEnd - h.bStart) - (h.aEnd - h.aStart), 0);
    const b: LineRange = { start, end };
    const m: LineRange = { start: start + dm, end: end + nm };
    const t: LineRange = { start: start + dt, end: end + nt };

    if (!usedT.length) segments.push({ kind: 'mine', base: b, mine: m, theirs: { start: start + dt, end: end + dt } });
    else if (!usedM.length) segments.push({ kind: 'theirs', base: b, mine: { start: start + dm, end: end + dm }, theirs: t });
    else if (sameKeys(mine, m, theirs, t)) segments.push({ kind: 'same', base: b, mine: m, theirs: t });
    else {
      // os dois mexeram no mesmo trecho e de formas diferentes: conflito, sem o começo e o fim que os dois lados têm em comum
      const lenM = m.end - m.start;
      const lenT = t.end - t.start;
      let p = 0;
      while (p < lenM && p < lenT && mine.keys[m.start + p] === theirs.keys[t.start + p]) p++;
      let s = 0;
      while (s < lenM - p && s < lenT - p && mine.keys[m.end - 1 - s] === theirs.keys[t.end - 1 - s]) s++;
      if (p) {
        segments.push({
          kind: 'same',
          refined: true,
          base: { start, end: start },
          mine: { start: m.start, end: m.start + p },
          theirs: { start: t.start, end: t.start + p },
        });
      }
      segments.push({ kind: 'conflict', base: b, mine: { start: m.start + p, end: m.end - s }, theirs: { start: t.start + p, end: t.end - s } });
      if (s) {
        segments.push({
          kind: 'same',
          refined: true,
          base: { start: end, end },
          mine: { start: m.end - s, end: m.end },
          theirs: { start: t.end - s, end: t.end },
        });
      }
    }
    pos = end;
    dm = nm;
    dt = nt;
  }
  stable(base.lines.length);

  const conflicts: number[] = [];
  const changes: number[] = [];
  segments.forEach((seg, idx) => {
    if (seg.kind === 'conflict') conflicts.push(idx);
    else if (seg.kind !== 'stable' && !seg.refined) changes.push(idx);
  });
  return { base, mine, theirs, segments, conflicts, changes };
}

/** As linhas (sem terminador) que o segmento tem em uma das versões. */
export function sideLines(model: MergeModel, seg: MergeSegment, side: MergeSide): string[] {
  const doc = model[side];
  const r = seg[side];
  return doc.lines.slice(r.start, r.end);
}

// ---------------------------------------------------------------- escolhas

/** Uma linha do resultado de um conflito: de qual versão (e qual linha dela, 0-based) ou digitada à mão. */
export type PickedLine = { from: MergeSide; line: number } | { from: 'typed'; text: string };

/**
 * Tudo o que o usuário decidiu (serializável: vira o rascunho). `picks`: por conflito (índice do segmento), a lista ORDENADA de
 * linhas escolhidas; conflito sem entrada está pendente (e `[]` é "nenhuma linha", uma decisão). `reverted`: mudanças sem conflito
 * que NÃO entram (as demais são aplicadas, como o Git faria). `eol`: de qual versão vem o terminador das linhas intactas
 * (`mine`/`theirs`, cada linha mantém o seu) ou o fim de linha imposto a todas (`lf`/`crlf`).
 */
export interface MergeChoices {
  picks: Record<number, PickedLine[]>;
  reverted: number[];
  eol: 'mine' | 'theirs' | 'lf' | 'crlf';
}

export const emptyChoices = (): MergeChoices => ({ picks: {}, reverted: [], eol: 'mine' });

export type ConflictPreset = 'mine' | 'theirs' | 'both' | 'both-reversed' | 'base' | 'none';

/** As linhas escolhidas por um atalho do cartão do conflito ("usar a minha", "as duas", "trocar a ordem"…). */
export function presetPicks(model: MergeModel, segIndex: number, preset: ConflictPreset): PickedLine[] {
  const seg = model.segments[segIndex];
  if (!seg || seg.kind !== 'conflict') return [];
  const all = (side: MergeSide): PickedLine[] => Array.from({ length: seg[side].end - seg[side].start }, (_, k) => ({ from: side, line: seg[side].start + k }));
  switch (preset) {
    case 'mine':
      return all('mine');
    case 'theirs':
      return all('theirs');
    case 'base':
      return all('base');
    case 'both':
      return [...all('mine'), ...all('theirs')];
    case 'both-reversed':
      return [...all('theirs'), ...all('mine')];
    case 'none':
      return [];
  }
}

/**
 * Escolhas em massa: `conflicts` decide todos os conflitos (`pending` os deixa para o usuário); `changes` diz quais mudanças sem
 * conflito entram. `changes: 'mine'` aplica só as que o usuário fez (as da origin ficam de fora) e `'theirs'` o contrário.
 * `{ conflicts: 'mine', changes: 'mine' }` gera exatamente a versão do usuário e `{ 'theirs', 'theirs' }` a que chega.
 */
export function bulkChoices(
  model: MergeModel,
  opts: { conflicts: ConflictPreset | 'pending'; changes: 'all' | 'mine' | 'theirs' | 'none' },
): MergeChoices {
  const picks: Record<number, PickedLine[]> = {};
  if (opts.conflicts !== 'pending') for (const idx of model.conflicts) picks[idx] = presetPicks(model, idx, opts.conflicts);
  const reverted = model.changes.filter((idx) => {
    const kind = model.segments[idx]!.kind;
    if (opts.changes === 'all') return false;
    if (opts.changes === 'none') return true;
    if (kind === 'same') return false;
    return kind !== opts.changes;
  });
  return { picks, reverted, eol: opts.conflicts === 'theirs' ? 'theirs' : 'mine' };
}

/** Resumo do que um conflito levou ("2 de mim + 1 da origin"): quantas linhas de cada origem. */
export function summarizePicks(picks: readonly PickedLine[]): { mine: number; theirs: number; base: number; typed: number } {
  const n = { mine: 0, theirs: 0, base: 0, typed: 0 };
  for (const p of picks) n[p.from === 'typed' ? 'typed' : p.from]++;
  return n;
}

// ---------------------------------------------------------------- resultado

/** De onde veio uma linha do resultado (legenda `M`, `O`, `M+O`, `✎`): a faixa na margem da tela. */
export type LineOrigin = 'stable' | 'mine' | 'theirs' | 'both' | 'base' | 'typed' | 'pending';

export interface ResultLine {
  text: string;
  /** Terminador (`''` só na última linha de um arquivo sem quebra final). */
  eol: string;
  origin: LineOrigin;
  /** Segmento de onde a linha saiu (índice em `model.segments`). */
  segment: number;
}

export interface MergeResult {
  lines: ResultLine[];
  /** O arquivo final. `null` enquanto houver conflito pendente: nada é gravado "adivinhando" um lado. */
  text: string | null;
  /** Prévia: igual ao texto, mas com os conflitos pendentes mostrando a versão do usuário. Nunca tem marcador. */
  preview: string;
  /** Conflitos ainda sem decisão (índices em `model.segments`). */
  pending: number[];
}

function pushRange(out: ResultLine[], doc: MergeDoc, r: LineRange, origin: LineOrigin, segment: number) {
  for (let k = r.start; k < r.end; k++) out.push({ text: doc.lines[k]!, eol: doc.eols[k] ?? '', origin, segment });
}

/**
 * Terminador final de cada linha: o da própria linha, ou o fim de linha imposto (`lf`/`crlf`). Só a última pode ficar sem terminador;
 * uma linha sem terminador no meio (a última de uma das versões) ganha o dominante.
 */
function finalizeEols(lines: ResultLine[], fallback: '\n' | '\r\n', eol: MergeChoices['eol']): void {
  const forced = eol === 'lf' ? '\n' : eol === 'crlf' ? '\r\n' : null;
  lines.forEach((l, i) => {
    const last = i === lines.length - 1;
    l.eol = last && l.eol === '' ? '' : (forced ?? (l.eol || fallback));
  });
}

/** Monta o resultado a partir das escolhas. É a ÚNICA fonte do texto que a tela mostra e que é gravado. */
export function resolveMerge(model: MergeModel, choices: MergeChoices): MergeResult {
  const reverted = new Set(choices.reverted);
  const stableSide: 'mine' | 'theirs' = choices.eol === 'theirs' ? 'theirs' : 'mine';
  const lines: ResultLine[] = [];
  const pending: number[] = [];
  const fallback = model[stableSide].lines.length ? model[stableSide].eol : model.mine.lines.length ? model.mine.eol : model.theirs.lines.length ? model.theirs.eol : model.base.eol;

  model.segments.forEach((seg, idx) => {
    switch (seg.kind) {
      case 'stable':
        pushRange(lines, model[stableSide], seg[stableSide], 'stable', idx);
        break;
      case 'mine': // desfazer = voltar ao que a outra versão (que não mexeu aqui) tem
        if (reverted.has(idx)) pushRange(lines, model.theirs, seg.theirs, 'base', idx);
        else pushRange(lines, model.mine, seg.mine, 'mine', idx);
        break;
      case 'theirs':
        if (reverted.has(idx)) pushRange(lines, model.mine, seg.mine, 'base', idx);
        else pushRange(lines, model.theirs, seg.theirs, 'theirs', idx);
        break;
      case 'same':
        if (reverted.has(idx) && !seg.refined) pushRange(lines, model.base, seg.base, 'base', idx);
        else pushRange(lines, model[stableSide], seg[stableSide], 'both', idx);
        break;
      case 'conflict': {
        const picks = choices.picks[idx];
        if (!picks) {
          pending.push(idx);
          pushRange(lines, model.mine, seg.mine, 'pending', idx);
          break;
        }
        for (const p of picks) {
          if (p.from === 'typed') lines.push({ text: p.text, eol: model[stableSide].eol, origin: 'typed', segment: idx });
          else pushRange(lines, model[p.from], { start: p.line, end: p.line + 1 }, p.from, idx);
        }
      }
    }
  });
  finalizeEols(lines, fallback, choices.eol);
  const preview = lines.map((l) => l.text + l.eol).join('');
  return { lines, text: pending.length ? null : preview, preview, pending };
}

/** O resultado mistura `\r\n` e `\n`? (aviso antes de marcar como resolvido). */
export function hasMixedEol(lines: readonly ResultLine[]): boolean {
  let crlf = false;
  let lf = false;
  lines.forEach((l, i) => {
    if (i === lines.length - 1 && l.eol === '') return;
    if (l.eol === '\r\n') crlf = true;
    else lf = true;
  });
  return crlf && lf;
}

/** As versões diferem no fim de linha dominante? (aviso e escolha do fim de linha do resultado). */
export function eolDiffers(model: MergeModel): boolean {
  const eols = [model.mine, model.theirs, model.base].filter((d) => d.lines.length > 0).map((d) => d.eol);
  return new Set(eols).size > 1;
}
