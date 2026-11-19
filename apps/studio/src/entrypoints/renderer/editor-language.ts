// Linguagem (CodeMirror) de um arquivo, pela extensão: usada pelo editor e pelo realce por linha do resolvedor de conflitos.
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import type { LanguageSupport } from '@codemirror/language';

export function languageFor(name: string): LanguageSupport | null {
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
