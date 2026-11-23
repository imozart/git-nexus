// Extensão do CodeMirror da busca no arquivo: guarda a consulta ativa e destaca TODAS as ocorrências da parte visível (a atual com mais ênfase).
// Só desenha o que está na tela: um arquivo de 30 mil linhas abre sem varrer o texto todo para pintar.
import type { SearchQuery } from '@codemirror/search';
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { MAX_DRAWN, matchesIn, type Span } from './find-core';

export interface FindSpec {
  query: SearchQuery | null;
  /** Só neste trecho ("na seleção"); `null` = o arquivo todo. */
  range: Span | null;
}

export const setFind = StateEffect.define<FindSpec>();

export const findField = StateField.define<FindSpec>({
  create: () => ({ query: null, range: null }),
  update(spec, tr) {
    for (const e of tr.effects) if (e.is(setFind)) return e.value;
    // o trecho acompanha as edições (quem digita dentro dele não o perde)
    if (tr.docChanged && spec.range) return { query: spec.query, range: { from: tr.changes.mapPos(spec.range.from, 1), to: tr.changes.mapPos(spec.range.to, -1) } };
    return spec;
  },
});

const MATCH = Decoration.mark({ class: 'cm-gn-find' });
const CURRENT = Decoration.mark({ class: 'cm-gn-find cm-gn-find-current' });
/** Folga ao redor da parte visível, para o destaque já estar pronto quando a rolagem chega. */
const MARGIN = 2_000;

function draw(view: EditorView): DecorationSet {
  const { query, range } = view.state.field(findField);
  if (!query) return Decoration.none;
  const sel = view.state.selection.main;
  const b = new RangeSetBuilder<Decoration>();
  let last = 0;
  let n = 0;
  for (const vr of view.visibleRanges) {
    const from = Math.max(range?.from ?? 0, vr.from - MARGIN);
    const to = Math.min(range?.to ?? view.state.doc.length, vr.to + MARGIN);
    if (from >= to) continue;
    for (const m of matchesIn(view.state, query, Math.max(from, last), to, MAX_DRAWN - n)) {
      b.add(m.from, m.to, m.from === sel.from && m.to === sel.to ? CURRENT : MATCH);
      last = m.to;
      if (++n >= MAX_DRAWN) return b.finish();
    }
  }
  return b.finish();
}

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = draw(view);
    }
    update(u: ViewUpdate) {
      const changedSpec = u.startState.field(findField) !== u.state.field(findField);
      if (changedSpec || u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = draw(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

/**
 * Trechos destacados que vêm de FORA (a janela de pesquisa do repositório): as colunas que o núcleo da busca já calculou, em vez de buscar de novo no editor.
 * Acompanham as edições (quem digita perto de um trecho não o desloca para o lugar errado).
 */
export const setMarks = StateEffect.define<Span[]>();
const EXTERNAL = Decoration.mark({ class: 'cm-gn-find' });
export const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setMarks)) next = Decoration.set([...e.value].sort((a, b) => a.from - b.from).map((m) => EXTERNAL.range(m.from, m.to)), true);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** O que o editor precisa para a busca: o estado da consulta, o destaque da barra e os trechos vindos de fora. */
export const findExtension: Extension = [findField, highlighter, marksField];
