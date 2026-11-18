import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Tipografia do app: tokens de fonte, corpo, elementos de código e o contrato dos atributos data-font-* do <html>. Lido do tokens.scss.
const root = join(__dirname, '..', '..', '..');
const tokens = readFileSync(join(root, 'apps', 'ui-kit', 'src', 'styles', 'tokens.scss'), 'utf8').replace(/\r\n/g, '\n');
const darkBlock = /:root \{([^}]*)\}/.exec(tokens)![1]!;
const lightBlock = /:root\[data-theme='light'\] \{([^}]*)\}/.exec(tokens)![1]!;
const decl = (block: string, name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();

describe('tokens de fonte', () => {
  it('as famílias: JetBrains Mono (embutida) e as duas pilhas "Sistema" de antes', () => {
    expect(decl(darkBlock, 'gn-font-jetbrains')).toBe("'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace");
    expect(decl(darkBlock, 'gn-font-sans')).toBe("'Segoe UI', system-ui, -apple-system, sans-serif");
    expect(decl(darkBlock, 'gn-font-mono-system')).toBe("ui-monospace, 'Cascadia Code', Consolas, 'Courier New', monospace");
  });

  it('o padrão é a JetBrains Mono em tudo, 12px, entrelinha 1,5 e ligaduras desligadas', () => {
    expect(decl(darkBlock, 'gn-font-ui')).toBe('var(--gn-font-jetbrains)');
    expect(decl(darkBlock, 'gn-font-code')).toBe('var(--gn-font-jetbrains)');
    expect(decl(darkBlock, 'gn-font-size')).toBe('12px');
    expect(decl(darkBlock, 'gn-line')).toBe('1.5');
    expect(decl(darkBlock, 'gn-ligatures')).toBe('none');
  });

  it('--gn-mono é apelido da fonte de código (os usos existentes continuam valendo)', () => {
    expect(decl(darkBlock, 'gn-mono')).toBe('var(--gn-font-code)');
  });

  it('o tema claro não mexe na tipografia', () => {
    for (const n of ['gn-font-ui', 'gn-font-code', 'gn-font-size', 'gn-line', 'gn-ligatures', 'gn-mono']) expect(decl(lightBlock, n), n).toBeUndefined();
  });
});

describe('contrato dos atributos do <html>', () => {
  it("data-font-ui='system' volta a fonte, o tamanho e a entrelinha de antes (13px/1.45)", () => {
    expect(tokens).toContain("html[data-font-ui='system'] { --gn-font-ui: var(--gn-font-sans); --gn-font-size: 13px; --gn-line: 1.45; }");
  });
  it("data-font-code='system' volta a pilha monoespaçada de antes", () => {
    expect(tokens).toContain("html[data-font-code='system'] { --gn-font-code: var(--gn-font-mono-system); }");
  });
  it("data-ligatures='on' liga as ligaduras", () => {
    expect(tokens).toContain("html[data-ligatures='on'] { --gn-ligatures: normal; }");
  });
});

describe('corpo e elementos de código', () => {
  const body = /\nbody \{([^}]*)\}/.exec(tokens)![1]!;
  it('o corpo usa os tokens, sem sintetizar negrito nem itálico', () => {
    expect(body).toContain('font: var(--gn-font-size)/var(--gn-line) var(--gn-font-ui);');
    expect(body).toContain('font-variant-ligatures: var(--gn-ligatures);');
    expect(body).toContain('font-synthesis: none;');
  });
  it('pre, code, kbd e samp usam a fonte de código (e não o monospace do navegador)', () => {
    expect(tokens).toContain('pre, code, kbd, samp { font-family: var(--gn-font-code); }');
  });
  it('nenhuma fonte literal no corpo: sem Segoe UI fora da definição do token', () => {
    expect(body).not.toMatch(/Segoe|system-ui|monospace/);
  });
});

describe('cores intactas', () => {
  it('os valores de cor do tema escuro continuam os mesmos', () => {
    const expected: Record<string, string> = {
      'gn-bg': '#17181b', 'gn-surface': '#1f2023', 'gn-surface-2': '#2a2c31', 'gn-border': '#34363c', 'gn-text': '#e3e5e8', 'gn-muted': '#9097a1',
      'gn-accent': '#4f86f7', 'gn-accent-hover': '#6a9aff', 'gn-accent-solid': '#4473d4', 'gn-accent-solid-hover': '#3d68bf', 'gn-danger': '#ef6a62',
      'gn-success': '#4fb56a', 'gn-warn': '#e0a93b', 'gn-diff-add-text': '#8fd7a1', 'gn-diff-del-text': '#f0a09a', 'gn-renamed': '#c678dd', 'gn-untracked': '#d99a54',
    };
    for (const [k, v] of Object.entries(expected)) expect(decl(darkBlock, k), k).toBe(v);
  });
  it('os valores de cor do tema claro continuam os mesmos', () => {
    const expected: Record<string, string> = {
      'gn-bg': '#f4f5f7', 'gn-surface': '#ffffff', 'gn-surface-2': '#e9ebef', 'gn-border': '#ced2d9', 'gn-text': '#1f2328', 'gn-muted': '#5a6370',
      'gn-accent': '#2a62d1', 'gn-danger': '#c62f2a', 'gn-success': '#1a7f37', 'gn-warn': '#8a5a00',
    };
    for (const [k, v] of Object.entries(expected)) expect(decl(lightBlock, k), k).toBe(v);
  });
});

describe('editor de código', () => {
  const editor = readFileSync(join(root, 'apps', 'studio', 'src', 'entrypoints', 'renderer', 'components', 'CodeEditor.vue'), 'utf8').replace(/\r\n/g, '\n');
  it('usa o token --gn-mono e re-mede quando a fonte carrega', () => {
    expect(editor).toContain("fontFamily: 'var(--gn-mono)'");
    expect(editor).toContain('document.fonts?.ready.then(remeasure)');
    expect(editor).toContain("document.fonts?.addEventListener('loadingdone', remeasure)");
    expect(editor).toContain("document.fonts?.removeEventListener('loadingdone', remeasure)");
  });
});
