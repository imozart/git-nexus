// Núcleo da substituição no arquivo (sem Vue e sem DOM, só o estado do CodeMirror, para testar). Procurar, destacar e substituir usam a MESMA
// consulta (`SearchQuery`, ver find-core.ts); aqui está o que é só da substituição: o texto novo (grupos e escapes), manter a caixa, o plano de
// mudanças de "substituir todas" (uma única transação = um único Ctrl+Z) e as várias seleções ("selecionar todas as ocorrências").
//
// Dialeto do texto novo (o do JavaScript, que é o do motor do editor; a unificação com o núcleo do Git fica para a fase 4):
//   modo texto      o texto novo é LITERAL, do jeito que foi digitado ("$1" e "\n" não significam nada);
//   modo regex      `$1`..`$99` e `$<nome>` (grupos; um grupo que não existe fica literal, como no JavaScript), `$&` (o trecho achado), `$$` ou `\$` ($ literal),
//                   `\n`, `\r`, `\t` e `\\`; qualquer outra barra fica como está.
import type { SearchQuery } from '@codemirror/search';
import { EditorSelection, type ChangeSpec, type EditorState } from '@codemirror/state';
import type { Span } from './find-core';

export interface ReplaceOptions {
  /** O texto de busca é regex: liga grupos e escapes no texto novo. */
  regex: boolean;
  /** Manter a caixa: `foo`→`bar`, `Foo`→`Bar`, `FOO`→`BAR`. */
  preserveCase: boolean;
}

export interface MatchInfo extends Span {
  /** O trecho achado. */
  text: string;
  /** Grupos de captura 1..n (um que não participou do casamento é `''`). */
  groups: string[];
  /** Grupos nomeados, ou `null` se a regex não tem. */
  named: Record<string, string> | null;
}

/** Acima disto "substituir todas" recusa (e diz): milhões de mudanças numa transação travam o editor. */
export const MAX_REPLACE = 100_000;
/** Teto de cursores de "selecionar todas as ocorrências". */
export const MAX_SELECT = 5_000;

type CursorValue = { from: number; to: number; match?: RegExpExecArray };

/** As ocorrências (com grupos) em `[from, to]`, em ordem, sem as vazias. */
export function collect(state: EditorState, q: SearchQuery, from: number, to: number, limit: number): MatchInfo[] {
  const out: MatchInfo[] = [];
  const cur = q.getCursor(state, from, to) as Iterator<CursorValue>;
  for (let r = cur.next(); !r.done && out.length < limit; r = cur.next()) {
    const { from: a, to: b, match } = r.value;
    if (b <= a) continue;
    out.push({ from: a, to: b, text: state.sliceDoc(a, b), groups: match ? match.slice(1).map((g) => g ?? '') : [], named: match?.groups ? Object.fromEntries(Object.entries(match.groups).map(([k, v]) => [k, v ?? ''])) : null });
  }
  return out;
}

/** A ocorrência que é exatamente `span` (com os grupos), ou `null` se `span` não é uma ocorrência. Começa na linha, para âncoras (`^`) e `\b` valerem. */
export function infoAt(state: EditorState, q: SearchQuery, range: Span | null, span: Span): MatchInfo | null {
  const lo = Math.max(range?.from ?? 0, state.doc.lineAt(span.from).from);
  const hi = Math.min(range?.to ?? state.doc.length, state.doc.lineAt(span.to).to);
  if (span.to > hi || span.from < lo) return null;
  const cur = q.getCursor(state, lo, hi) as Iterator<CursorValue>;
  for (let r = cur.next(); !r.done; r = cur.next()) {
    if (r.value.from > span.from) return null;
    if (r.value.from === span.from && r.value.to === span.to && r.value.to > r.value.from) {
      const { match } = r.value;
      return { from: span.from, to: span.to, text: state.sliceDoc(span.from, span.to), groups: match ? match.slice(1).map((g) => g ?? '') : [], named: match?.groups ? Object.fromEntries(Object.entries(match.groups).map(([k, v]) => [k, v ?? ''])) : null };
    }
  }
  return null;
}

/** O texto novo de UMA ocorrência: grupos e escapes (só no modo regex). */
export function expandTemplate(template: string, m: Pick<MatchInfo, 'text' | 'groups' | 'named'>, regex: boolean): string {
  if (!regex) return template;
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i]!;
    const n = template[i + 1];
    if (c === '\\' && n !== undefined) {
      if (n === 'n') out += '\n';
      else if (n === 'r') out += '\r';
      else if (n === 't') out += '\t';
      else if (n === '\\') out += '\\';
      else if (n === '$') out += '$';
      else {
        out += c;
        continue;
      }
      i++;
      continue;
    }
    if (c !== '$' || n === undefined) {
      out += c;
      continue;
    }
    if (n === '$') {
      out += '$';
      i++;
    } else if (n === '&') {
      out += m.text;
      i++;
    } else if (n === '<' && m.named) {
      const end = template.indexOf('>', i + 2);
      if (end < 0) {
        out += c;
        continue;
      }
      out += m.named[template.slice(i + 2, end)] ?? '';
      i = end;
    } else if (/\d/.test(n)) {
      const two = template.slice(i + 1, i + 3);
      if (/^\d\d$/.test(two) && Number(two) >= 1 && Number(two) <= m.groups.length) {
        out += m.groups[Number(two) - 1]!;
        i += 2;
      } else if (Number(n) >= 1 && Number(n) <= m.groups.length) {
        out += m.groups[Number(n) - 1]!;
        i++;
      } else out += c;
    } else out += c;
  }
  return out;
}

/** Manter a caixa: TUDO MAIÚSCULO, tudo minúsculo ou Primeira maiúscula no trecho achado passam para o texto novo; outra mistura deixa como foi digitado. */
export function applyCase(replacement: string, matched: string): string {
  if (!replacement) return replacement;
  const up = matched.toUpperCase();
  const low = matched.toLowerCase();
  if (up === low) return replacement; // sem letras ("123"): nada a copiar
  if (matched === up) return replacement.toUpperCase();
  if (matched === low) return replacement.toLowerCase();
  const first = matched.slice(0, 1);
  if (first !== first.toLowerCase() && matched.slice(1) === low.slice(1)) return replacement.slice(0, 1).toUpperCase() + replacement.slice(1);
  return replacement;
}

/** O arquivo usa CRLF em TODAS as linhas? Então o editor mantém CRLF (sem isso a primeira edição troca CRLF por LF no arquivo inteiro). Misto ou LF: o padrão. */
export function crlfOnly(text: string): boolean {
  return text.includes('\r\n') && !/(^|[^\r])\n/.test(text) && !/\r(?!\n)/.test(text);
}

/** Toda quebra de linha do texto vira a do ARQUIVO (CRLF num arquivo CRLF, LF num LF): nada de LF solto no meio de um arquivo CRLF. */
export const withBreaks = (text: string, lineBreak: string): string => text.replace(/\r\n|\r|\n/g, lineBreak);

/** O texto novo de uma ocorrência já com a caixa e com a quebra de linha do arquivo (`state.lineBreak`). */
export function replacementFor(template: string, m: MatchInfo, o: ReplaceOptions, lineBreak = '\n'): string {
  const text = expandTemplate(template, m, o.regex);
  return withBreaks(o.preserveCase ? applyCase(text, m.text) : text, lineBreak);
}

export interface ReplacePlan {
  changes: ChangeSpec[];
  /** Quantas ocorrências serão trocadas. */
  count: number;
  /** Passou de `MAX_REPLACE`: nada foi planejado. */
  tooMany: boolean;
}

/**
 * "Substituir todas": todas as mudanças de uma vez, para uma única transação (um Ctrl+Z desfaz tudo). As posições são as do texto ANTES da troca;
 * o CodeMirror aplica as mudanças como um conjunto, então uma troca não desloca a seguinte nem é buscada de novo (`a`→`aa` não vira infinito).
 */
export function planReplaceAll(state: EditorState, q: SearchQuery, range: Span | null, template: string, o: ReplaceOptions): ReplacePlan {
  const found = collect(state, q, range?.from ?? 0, range?.to ?? state.doc.length, MAX_REPLACE + 1);
  if (found.length > MAX_REPLACE) return { changes: [], count: 0, tooMany: true };
  return { changes: found.map((m) => ({ from: m.from, to: m.to, insert: replacementFor(template, m, o, state.lineBreak) })), count: found.length, tooMany: false };
}

/** "Selecionar todas as ocorrências": uma seleção por ocorrência (a primeira depois do cursor é a principal). `null` se não há ocorrência. */
export function selectAllMatches(state: EditorState, q: SearchQuery, range: Span | null): { selection: EditorSelection; count: number; capped: boolean } | null {
  const found = collect(state, q, range?.from ?? 0, range?.to ?? state.doc.length, MAX_SELECT + 1);
  if (!found.length) return null;
  const capped = found.length > MAX_SELECT;
  const used = capped ? found.slice(0, MAX_SELECT) : found;
  const head = state.selection.main.head;
  const main = Math.max(0, used.findIndex((m) => m.from >= head));
  return { selection: EditorSelection.create(used.map((m) => EditorSelection.range(m.from, m.to)), main), count: used.length, capped };
}
