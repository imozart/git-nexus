// Núcleo puro da substituição em vários arquivos (sem Vue e sem DOM, só o estado do CodeMirror, para testar). A troca usa as MESMAS regras do arquivo único
// (`replace-core.ts`: grupos, escapes, manter a caixa, quebra de linha do arquivo) sobre o texto que está NO DISCO; a lista da busca só diz em que linhas a pessoa
// quer trocar. O que a lista mostrava nunca é a fonte do texto novo: se uma linha da lista não casa mais no disco, o arquivo é recusado.
import type { SearchQuery } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { clipAround } from '@git-nexus/git-core/pure';
import { MAX_REPLACE, collect, replacementFor, type MatchInfo, type ReplaceOptions } from './replace-core';

/** Por que um arquivo não é alterado. */
export type RefuseReason =
  | 'binary' //     binário: nunca se mexe
  | 'tooLarge' //   acima do limite de edição
  | 'mixedEol' //   CRLF e LF no mesmo arquivo: gravar mudaria linhas que não foram tocadas
  | 'invalid' //    bytes que a codificação não entende: regravar corromperia
  | 'missing' //    não está mais no disco
  | 'changed' //    mudou depois da busca (o hash não é mais o da prévia)
  | 'diverged' //   uma linha da lista não casa no conteúdo do disco
  | 'tooMany' //    ocorrências demais num arquivo só
  | 'unencodable' // um caractere do texto novo não existe na codificação do arquivo
  | 'failed'; //    erro do sistema de arquivos

/** O texto novo de uma linha com ocorrências (todas as ocorrências da linha trocadas), pronto para a lista: uma linha só, cortada em volta do trecho trocado. */
export interface LinePlan {
  line: number;
  /** Quantas ocorrências a linha tem (a contagem de "N substituições"). */
  count: number;
  after: string;
  /** Os trechos trocados dentro de `after` (colunas UTF-16). */
  ranges: Array<[number, number]>;
  clippedStart: boolean;
  clippedEnd: boolean;
}

export type FilePlan = { ok: true; lines: Map<number, LinePlan>; extraLines: number[] } | { ok: false; reason: RefuseReason; lines?: number[] };

/** O estado do CodeMirror do arquivo: com o fim de linha dele (CRLF conta uma quebra por linha), como o editor de baixo faz. */
export function stateOf(text: string, eol: 'lf' | 'crlf' | 'none' | 'mixed'): EditorState {
  return EditorState.create({ doc: text, extensions: eol === 'crlf' ? [EditorState.lineSeparator.of('\r\n')] : [] });
}

const lineOf = (state: EditorState, m: MatchInfo): number => state.doc.lineAt(m.from).number;

/** Agrupa as ocorrências pela linha onde COMEÇAM (a lista tem uma entrada por linha). */
function groupByLine(state: EditorState, found: MatchInfo[]): Map<number, MatchInfo[]> {
  const g = new Map<number, MatchInfo[]>();
  for (const m of found) {
    const n = lineOf(state, m);
    const list = g.get(n);
    if (list) list.push(m);
    else g.set(n, [m]);
  }
  return g;
}

/** Quebra de linha vira ⏎ (um caractere por caractere, então as colunas do destaque não mudam; o texto já vem só com \n). */
const visible = (s: string): string => s.replace(/\n/g, '⏎');

/**
 * O plano de um arquivo: para cada linha da lista (`hitLines`) o texto como ficará. Recusa (`diverged`) se alguma linha da lista não tem ocorrência no texto
 * do disco; ocorrências do disco em linhas que a lista não tem (`extraLines`) não são trocadas.
 */
export function planFile(text: string, eol: 'lf' | 'crlf' | 'none' | 'mixed', q: SearchQuery, template: string, o: ReplaceOptions, hitLines: ReadonlySet<number>): FilePlan {
  if (eol === 'mixed') return { ok: false, reason: 'mixedEol' };
  const state = stateOf(text, eol);
  const found = collect(state, q, 0, state.doc.length, MAX_REPLACE + 1);
  if (found.length > MAX_REPLACE) return { ok: false, reason: 'tooMany' };
  const groups = groupByLine(state, found);
  const missing = [...hitLines].filter((l) => !groups.has(l)).sort((a, b) => a - b);
  if (missing.length) return { ok: false, reason: 'diverged', lines: missing };
  const lines = new Map<number, LinePlan>();
  const extraLines: number[] = [];
  for (const [n, ms] of groups) {
    if (!hitLines.has(n)) {
      extraLines.push(n);
      continue;
    }
    // da primeira linha da primeira ocorrência até o fim da linha onde a última termina (uma ocorrência pode atravessar linhas)
    const first = state.doc.line(n);
    const lastEnd = state.doc.lineAt(Math.max(first.from, Math.max(...ms.map((m) => m.to)) - 1)).to;
    let out = '';
    let at = first.from;
    const ranges: Array<[number, number]> = [];
    for (const m of ms) {
      out += state.doc.sliceString(at, m.from, '\n');
      const rep = replacementFor(template, m, o, '\n');
      ranges.push([out.length, out.length + rep.length]);
      out += rep;
      at = m.to;
    }
    out += state.doc.sliceString(at, lastEnd, '\n');
    const clip = clipAround(visible(out), ranges);
    lines.set(n, { line: n, count: ms.length, after: clip.text, ranges: clip.ranges, clippedStart: clip.clippedStart, clippedEnd: clip.clippedEnd });
  }
  return { ok: true, lines, extraLines: extraLines.sort((a, b) => a - b) };
}

/** O texto novo do arquivo: troca só as ocorrências que começam nas linhas de `include`. Mesma regra, mesma quebra de linha do arquivo (uma única transação). */
export function applyFile(text: string, eol: 'lf' | 'crlf' | 'none' | 'mixed', q: SearchQuery, template: string, o: ReplaceOptions, include: ReadonlySet<number>): { text: string; replaced: number } {
  const state = stateOf(text, eol);
  const found = collect(state, q, 0, state.doc.length, MAX_REPLACE + 1).filter((m) => include.has(lineOf(state, m)));
  if (!found.length) return { text, replaced: 0 };
  const next = state.update({ changes: found.map((m) => ({ from: m.from, to: m.to, insert: replacementFor(template, m, o, state.lineBreak) })) }).state;
  return { text: next.doc.sliceString(0, next.doc.length, state.lineBreak), replaced: found.length };
}

/** Uma ocorrência da lista, do ponto de vista de quem decide o que trocar. */
export interface Chosen {
  file: string;
  line: number;
}

export interface Tally {
  /** Substituições (ocorrências) que serão feitas, e em quantos arquivos. */
  replacements: number;
  files: number;
  /** Arquivos que não serão alterados, e por quê (só os que teriam ocorrência escolhida). */
  refused: Array<{ file: string; reason: RefuseReason }>;
}

/**
 * Quanto vai ser trocado: soma as ocorrências das linhas escolhidas (não ocultas) dos arquivos cuja prévia está pronta e foi aceita. `plans` tem o plano de cada
 * arquivo (ou a recusa), `chosen` as linhas escolhidas por arquivo.
 */
export function tally(plans: ReadonlyMap<string, FilePlan>, chosen: ReadonlyMap<string, ReadonlySet<number>>): Tally {
  let replacements = 0;
  let files = 0;
  const refused: Tally['refused'] = [];
  for (const [file, lines] of chosen) {
    if (!lines.size) continue;
    const p = plans.get(file);
    if (!p) continue;
    if (!p.ok) {
      refused.push({ file, reason: p.reason });
      continue;
    }
    let n = 0;
    for (const l of lines) n += p.lines.get(l)?.count ?? 0;
    if (n) {
      replacements += n;
      files++;
    }
  }
  return { replacements, files, refused };
}

/** "2 ignorados (1 mudou depois da busca, 1 binário)": os motivos contados, do mais frequente para o menos. */
export function reasonCounts(refused: ReadonlyArray<{ reason: RefuseReason }>): Array<{ reason: RefuseReason; n: number }> {
  const m = new Map<RefuseReason, number>();
  for (const r of refused) m.set(r.reason, (m.get(r.reason) ?? 0) + 1);
  return [...m].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n);
}

/** O que impede de usar a substituição neste escopo: o stage e as outras revisões não são o arquivo do disco. */
export const scopeRefused = (scope: string): boolean => scope === 'revision' || scope === 'staged';
