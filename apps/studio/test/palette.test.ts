import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Paleta de comandos (issue #158): só elevação, fundo de overlay, raio, camada e entrada. Cores, largura e a linha ativa não mudam.
const src = readFileSync(join(__dirname, '..', 'src', 'entrypoints', 'renderer', 'components', 'CommandPalette.vue'), 'utf8').replace(/\r\n/g, '\n');
const css = src.slice(src.indexOf('<style'));

describe('CommandPalette.vue', () => {
  it('o overlay usa --gn-backdrop, a camada de paleta e fade; a caixa usa --gn-shadow-lg, --gn-radius-lg e gn-pop-in', () => {
    expect(css).toContain('z-index: var(--gn-z-palette);');
    expect(css).toContain('background: var(--gn-backdrop);');
    expect(css).toContain('animation: gn-fade-in var(--gn-enter) ease-out;');
    expect(css).toContain('border-radius: var(--gn-radius-lg);');
    expect(css).toContain('box-shadow: var(--gn-shadow-lg);');
    expect(css).toContain('animation: gn-pop-in var(--gn-enter) ease-out;');
  });
  it('sem z-index numérico, sombra literal nem fundo preto literal no contêiner', () => {
    expect(css).not.toMatch(/z-index:\s*\d/);
    expect(css).not.toMatch(/box-shadow:\s*\d/);
    expect(css).not.toMatch(/background:\s*rgba\(\s*0,\s*0,\s*0/);
  });
  it('o que não muda: largura, fundo e borda da caixa, e a linha ativa em azul (é cor)', () => {
    expect(css).toContain('width: min(640px, 92vw);');
    expect(css).toMatch(/&__box \{[^}]*background: var\(--gn-surface\);[^}]*border: 1px solid var\(--gn-border\);/s);
    expect(css).toContain('&--on { background: rgba(79, 134, 247, 0.22); }');
  });
  it('não virou GnDialog (a paleta tem o próprio teclado e o campo é o foco permanente)', () => {
    expect(src).not.toContain('GnDialog');
  });
});
