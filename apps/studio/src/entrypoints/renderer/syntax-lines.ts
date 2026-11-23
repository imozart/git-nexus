// Realce de sintaxe por linha, para as telas que desenham o código como linhas próprias (o resolvedor de conflitos) em vez de um editor.
// Mesma gramática do CodeMirror (editor-language.ts); a saída é HTML já escapado, com as classes `tok-*` do `classHighlighter`.
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { languageFor } from './editor-language';

/** Acima disto o realce é desligado (o texto aparece sem cor): a análise do arquivo inteiro a cada escolha custaria caro. */
export const MAX_HIGHLIGHT_CHARS = 400_000;

const NEEDS_ESCAPE = /[&<>]/;
export const escapeHtml = (s: string): string => (NEEDS_ESCAPE.test(s) ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : s);

/** Uma string HTML por linha (os mesmos índices de `lines`). Sem gramática para o arquivo, ou grande demais, é só o texto escapado. */
export function highlightLines(lines: readonly string[], filename: string): string[] {
  const plain = () => lines.map(escapeHtml);
  const lang = languageFor(filename);
  const text = lines.join('\n');
  if (!lang || text.length > MAX_HIGHLIGHT_CHARS) return plain();
  try {
    const spans: Array<{ from: number; to: number; cls: string }> = [];
    highlightTree(lang.language.parser.parse(text), classHighlighter, (from, to, cls) => spans.push({ from, to, cls }));
    const out: string[] = [];
    let at = 0; // início da linha no texto
    let k = 0; // primeiro trecho que ainda pode tocar a linha
    for (const line of lines) {
      const end = at + line.length;
      while (k < spans.length && spans[k]!.to <= at) k++;
      let html = '';
      let cur = at;
      for (let i = k; i < spans.length && spans[i]!.from < end; i++) {
        const s = spans[i]!;
        const from = Math.max(s.from, at);
        const to = Math.min(s.to, end);
        if (from > cur) html += escapeHtml(text.slice(cur, from));
        if (to > from) html += `<span class="${s.cls}">${escapeHtml(text.slice(from, to))}</span>`;
        cur = Math.max(cur, to);
      }
      out.push(html + escapeHtml(text.slice(cur, end)));
      at = end + 1;
    }
    return out;
  } catch {
    return plain();
  }
}
