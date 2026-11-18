<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { bracketMatching, syntaxHighlighting, defaultHighlightStyle, type LanguageSupport } from '@codemirror/language';
import { Compartment, EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { fontRevision } from '../font';
import { theme } from '../theme';
import { Decoration, EditorView, ViewPlugin, keymap, lineNumbers, type DecorationSet, type ViewUpdate } from '@codemirror/view';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    readOnly?: boolean;
    filename?: string;
    /** Destaca visualmente as regiões ours/base/theirs entre marcadores de conflito. */
    highlightConflicts?: boolean;
  }>(),
  { readOnly: false, filename: '', highlightConflicts: false },
);
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const host = ref<HTMLDivElement>();
let view: EditorView | null = null;

function languageFor(name: string): LanguageSupport | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': case 'jsx': return javascript({ jsx: true });
    case 'ts': case 'mts': case 'cts': return javascript({ typescript: true });
    case 'tsx': return javascript({ typescript: true, jsx: true });
    case 'json': return json();
    case 'html': case 'htm': case 'vue': return html();
    case 'css': case 'scss': return css();
    case 'java': case 'kt': return java();
    case 'xml': case 'xsd': case 'svg': return xml();
    case 'sql': return sql();
    case 'md': return markdown();
    case 'py': return python();
    default: return null;
  }
}

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
});

function extensions(): Extension[] {
  const ext: Extension[] = [
    lineNumbers(),
    history(),
    bracketMatching(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    themeSlot.of(theme.value === 'dark' ? oneDark : []),
    baseTheme,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorState.readOnly.of(props.readOnly),
    EditorView.editable.of(!props.readOnly),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) emit('update:modelValue', u.state.doc.toString());
    }),
  ];
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
  document.fonts?.ready.then(remeasure);
  document.fonts?.addEventListener('loadingdone', remeasure);
});

watch(theme, (v) => view?.dispatch({ effects: themeSlot.reconfigure(v === 'dark' ? oneDark : []) }));

watch(
  () => props.modelValue,
  (v) => {
    if (view && v !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    }
  },
);

onBeforeUnmount(() => {
  document.fonts?.removeEventListener('loadingdone', remeasure);
  view?.destroy();
});

/** Rola até a posição (offset) informada. */
function scrollTo(pos: number): void {
  view?.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
}
defineExpose({ scrollTo });
</script>

<template>
  <div ref="host" class="code-editor"></div>
</template>

<style scoped>
.code-editor { height: 100%; min-height: 0; overflow: hidden; }
</style>
