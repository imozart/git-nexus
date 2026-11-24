<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { Compartment, EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { languageFor } from '../editor-language';
import { fontRevision } from '../font';
import { findExtension, setMarks } from '../find-ext';
import { seedText } from '../find-core';
import { crlfOnly } from '../replace-core';
import FindBar from './FindBar.vue';
import { theme } from '../theme';
import { selectNextOccurrence } from '@codemirror/search';
import { Decoration, EditorView, ViewPlugin, drawSelection, keymap, lineNumbers, type DecorationSet, type ViewUpdate } from '@codemirror/view';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    readOnly?: boolean;
    filename?: string;
    /** Destaca visualmente as regiões ours/base/theirs entre marcadores de conflito. */
    highlightConflicts?: boolean;
    /** Trechos a destacar, vindos de fora (a pesquisa do repositório): linha (de 1) e colunas na linha. */
    marks?: Array<{ line: number; from: number; to: number }>;
    /** O botão direito emite `menu` (no lugar do menu do navegador): quem usa mostra as ações da seleção. */
    contextMenu?: boolean;
  }>(),
  { readOnly: false, filename: '', highlightConflicts: false, marks: undefined, contextMenu: false },
);
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'menu', at: { x: number; y: number }): void }>();

const host = ref<HTMLDivElement>();
let view: EditorView | null = null;

// Busca no arquivo (Ctrl+F): a barra é nossa (FindBar); o motor é o do @codemirror/search. `shallowRef`: o EditorView não pode virar proxy do Vue.
const viewRef = shallowRef<EditorView | null>(null);
const findOpen = ref(false);
const findSeed = ref('');
/** A barra abre já com o campo "Substituir por" (Ctrl+H). */
const findReplace = ref(false);
/** Sobe a cada atualização do editor (edição, seleção, busca): é o sinal para a barra recontar. */
const revision = ref(0);
const bar = ref<InstanceType<typeof FindBar>>();

const LINE_CLASS = {
  marker: Decoration.line({ class: 'cm-cf-marker' }),
  ours: Decoration.line({ class: 'cm-cf-ours' }),
  base: Decoration.line({ class: 'cm-cf-base' }),
  theirs: Decoration.line({ class: 'cm-cf-theirs' }),
};

function conflictDecorations(v: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  let section: 'ours' | 'base' | 'theirs' | null = null;
  for (let n = 1; n <= v.state.doc.lines; n++) {
    const line = v.state.doc.line(n);
    const t = line.text.replace(/\r$/, '');
    if (/^<{7}( .*)?$/.test(t)) {
      section = 'ours';
      b.add(line.from, line.from, LINE_CLASS.marker);
    } else if (section && /^\|{7}( .*)?$/.test(t)) {
      section = 'base';
      b.add(line.from, line.from, LINE_CLASS.marker);
    } else if (section && /^={7}$/.test(t)) {
      section = 'theirs';
      b.add(line.from, line.from, LINE_CLASS.marker);
    } else if (section && /^>{7}( .*)?$/.test(t)) {
      section = null;
      b.add(line.from, line.from, LINE_CLASS.marker);
    } else if (section) {
      b.add(line.from, line.from, LINE_CLASS[section]);
    }
  }
  return b.finish();
}

const conflictPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(v: EditorView) {
      this.decorations = conflictDecorations(v);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = conflictDecorations(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

/** Espaço do tema do editor: trocado ao vivo quando o tema da interface muda. */
const themeSlot = new Compartment();

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px' },
  '.cm-scroller': { fontFamily: 'var(--gn-mono)', overflow: 'auto' },
  '.cm-cf-marker': { backgroundColor: 'rgba(224,169,59,0.25)', color: 'var(--gn-warn)' },
  '.cm-cf-ours': { backgroundColor: 'rgba(79,181,106,0.13)' },
  '.cm-cf-base': { backgroundColor: 'rgba(144,151,161,0.13)' },
  '.cm-cf-theirs': { backgroundColor: 'rgba(79,134,247,0.15)' },
  // busca no arquivo: todas as ocorrências com fundo e contorno; a atual com contorno mais grosso (não depende só da cor)
  '.cm-gn-find': { backgroundColor: 'color-mix(in srgb, var(--gn-warn) 32%, transparent)', borderRadius: '2px', boxShadow: '0 0 0 1px color-mix(in srgb, var(--gn-warn) 70%, transparent)' },
  '.cm-gn-find-current': { backgroundColor: 'color-mix(in srgb, var(--gn-accent) 38%, transparent)', boxShadow: '0 0 0 2px var(--gn-accent)' },
});

function openFind(replace = false): boolean {
  if (!view) return false;
  const seed = seedText(view.state);
  if (findOpen.value) bar.value?.reopen(seed, replace);
  else {
    findSeed.value = seed;
    findReplace.value = replace;
    findOpen.value = true;
  }
  return true;
}

function closeFind(): boolean {
  if (!findOpen.value) return false;
  findOpen.value = false;
  void nextTick(() => view?.focus());
  return true;
}
function findStep(backwards: boolean): boolean {
  if (!findOpen.value) return openFind();
  bar.value?.go(backwards);
  return true;
}

function extensions(): Extension[] {
  const ext: Extension[] = [
    lineNumbers(),
    history(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    themeSlot.of(theme.value === 'dark' ? oneDark : []),
    baseTheme,
    findExtension,
    // vários cursores (selecionar todas as ocorrências da busca, Ctrl+D): sem a camada de seleção própria o navegador só desenha uma seleção
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    ...(crlfOnly(props.modelValue) ? [EditorState.lineSeparator.of('\r\n')] : []),
    keymap.of([
      { key: 'Mod-f', run: () => openFind(false), preventDefault: true },
      { key: 'Mod-h', mac: 'Mod-Alt-f', run: () => openFind(true), preventDefault: true },
      { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
      { key: 'Mod-g', run: () => findStep(false), shift: () => findStep(true), preventDefault: true },
      { key: 'F3', run: () => findStep(false), shift: () => findStep(true), preventDefault: true },
      { key: 'Escape', run: closeFind },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    ...(props.contextMenu
      ? [
          EditorView.domEventHandlers({
            contextmenu: (e) => {
              e.preventDefault();
              emit('menu', { x: e.clientX, y: e.clientY });
              return true;
            },
          }),
        ]
      : []),
    EditorState.readOnly.of(props.readOnly),
    EditorView.editable.of(!props.readOnly),
    EditorView.updateListener.of((u) => {
      revision.value++;
      if (u.docChanged) emit('update:modelValue', u.state.sliceDoc(0));
    }),
  ];
  // somente leitura: o conteúdo precisa receber foco (Tab), senão Ctrl+F, as setas e a seleção não chegam ao editor
  if (props.readOnly) ext.push(EditorView.contentAttributes.of({ tabindex: '0', 'aria-readonly': 'true' }));
  const lang = languageFor(props.filename);
  if (lang) ext.push(lang);
  if (props.highlightConflicts) ext.push(conflictPlugin);
  return ext;
}

/** O editor mede a largura dos caracteres: se a fonte carrega depois (ou muda), o cursor e as quebras ficam desalinhados. */
const remeasure = () => view?.requestMeasure();
// trocar a fonte do código ou as ligaduras (font.ts) muda a largura dos caracteres: re-mede ao vivo
watch(fontRevision, remeasure);

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({ doc: props.modelValue, extensions: extensions() }),
  });
  viewRef.value = view;
  applyMarks();
  document.fonts?.ready.then(remeasure);
  document.fonts?.addEventListener('loadingdone', remeasure);
});

watch(theme, (v) => view?.dispatch({ effects: themeSlot.reconfigure(v === 'dark' ? oneDark : []) }));

/** As marcas de fora, em posições do texto (linhas fora do arquivo são ignoradas). */
function applyMarks(): void {
  if (!view) return;
  const doc = view.state.doc;
  const spans = (props.marks ?? [])
    .filter((m) => m.line >= 1 && m.line <= doc.lines)
    .map((m) => {
      const l = doc.line(m.line);
      return { from: Math.min(l.to, l.from + m.from), to: Math.min(l.to, l.from + m.to) };
    })
    .filter((s) => s.to > s.from);
  view.dispatch({ effects: setMarks.of(spans) });
}

watch(
  () => props.modelValue,
  (v) => {
    if (view && v !== view.state.sliceDoc(0)) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    }
  },
);

// depois do watch do texto (a ordem importa: o texto novo entra primeiro, depois as marcas dele)
watch(() => props.marks, applyMarks);

onBeforeUnmount(() => {
  viewRef.value = null;
  document.fonts?.removeEventListener('loadingdone', remeasure);
  view?.destroy();
});

/** Rola até a posição (offset) informada. */
function scrollTo(pos: number): void {
  view?.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
}
/** Leva o cursor ao trecho (linha de 1, colunas na linha), rola até ele e, com `focus`, entrega o foco ao editor. */
function reveal(line: number, from: number, to: number, focus = false): void {
  if (!view || line < 1 || line > view.state.doc.lines) return;
  const l = view.state.doc.line(line);
  const a = Math.min(l.to, l.from + from);
  const b = Math.min(l.to, l.from + Math.max(from, to));
  view.dispatch({ selection: { anchor: a, head: b }, effects: EditorView.scrollIntoView(a, { y: 'center' }) });
  if (focus) view.focus();
}
const focusEditor = (): void => view?.focus();

/** O texto selecionado e as linhas que a seleção cobre (de 1); sem seleção, a linha do cursor e o texto vazio. */
function selectionInfo(): { text: string; startLine: number; endLine: number } {
  if (!view) return { text: '', startLine: 1, endLine: 1 };
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const startLine = doc.lineAt(from).number;
  // uma seleção que termina no começo de uma linha não cobre essa linha
  const endLine = to > from && doc.lineAt(to).from === to ? Math.max(startLine, doc.lineAt(to).number - 1) : doc.lineAt(to).number;
  return { text: view.state.sliceDoc(from, to), startLine, endLine };
}

defineExpose({ scrollTo, openFind, reveal, focus: focusEditor, selectionInfo });
</script>

<template>
  <!-- com a barra de busca aberta o Esc é dela (fecha a barra): um diálogo em volta não deve fechar junto -->
  <div class="code-editor-wrap" :data-dialog-esc="findOpen ? 'own' : undefined">
    <div ref="host" class="code-editor"></div>
    <FindBar v-if="findOpen && viewRef" ref="bar" :view="viewRef" :seed="findSeed" :replace="findReplace" :revision="revision" @close="closeFind" />
  </div>
</template>

<style scoped>
.code-editor-wrap { position: relative; height: 100%; min-height: 0; }
.code-editor { height: 100%; min-height: 0; overflow: hidden; }
</style>
