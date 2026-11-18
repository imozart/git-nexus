import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Tokens de elevação, raio, fundo de overlay, camadas e foco: existem nos dois temas quando dependem do tema, e as cores do sistema não mudam.
const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'tokens.scss'), 'utf8').replace(/\r\n/g, '\n');
const block = (sel: string) => {
  const start = css.indexOf(sel + ' {');
  expect(start, sel).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('\n}', start));
};
const dark = block(':root');
const light = block(":root[data-theme='light']");
const value = (b: string, name: string) => new RegExp('^\\s*' + name + ':\\s*([^;]+);', 'm').exec(b)?.[1]?.trim();

const ALL = ['--gn-shadow-sm', '--gn-shadow-md', '--gn-shadow-lg', '--gn-backdrop', '--gn-radius-sm', '--gn-radius-lg', '--gn-ring', '--gn-z-popover', '--gn-z-dialog', '--gn-z-palette', '--gn-z-tooltip', '--gn-z-confetti', '--gn-enter'];
const BY_THEME = ['--gn-shadow-sm', '--gn-shadow-md', '--gn-shadow-lg', '--gn-backdrop'];

describe('tokens de elevação e camadas', () => {
  it('todo token novo existe no tema escuro (:root)', () => {
    for (const n of ALL) expect(value(dark, n), n).toBeTruthy();
  });

  it('os que dependem do tema (sombras e fundo de overlay) existem também no claro, mais leves', () => {
    const alpha = (v?: string) => Number(/rgba\(0, 0, 0, ([\d.]+)\)\s*$/.exec(v ?? '')?.[1]);
    for (const n of BY_THEME) {
      expect(value(light, n), n).toBeTruthy();
      expect(alpha(value(light, n)), n).toBeLessThan(alpha(value(dark, n)));
    }
  });

  it('raios, anel, camadas e duração são iguais nos dois temas (não são redefinidos no claro)', () => {
    for (const n of ALL.filter((x) => !BY_THEME.includes(x))) expect(value(light, n), n).toBeUndefined();
  });

  it('as camadas estão em ordem: popover < diálogo < paleta < tooltip < confete', () => {
    const z = ['--gn-z-popover', '--gn-z-dialog', '--gn-z-palette', '--gn-z-tooltip', '--gn-z-confetti'].map((n) => Number(value(dark, n)));
    expect(z).toEqual([...z].sort((a, b) => a - b));
    expect(new Set(z).size).toBe(z.length);
  });

  it('sombra e fundo usam só preto com transparência; o anel só color-mix com o azul de destaque (nenhuma cor nova)', () => {
    for (const b of [dark, light]) for (const n of BY_THEME) expect(value(b, n), n).toMatch(/^(0 \d+px \d+px )?rgba\(0, 0, 0, [\d.]+\)$/);
    expect(value(dark, '--gn-ring')).toBe('0 0 0 3px color-mix(in srgb, var(--gn-accent) 30%, transparent)');
    for (const n of ALL) expect(value(dark, n), n).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('keyframes de entrada e movimento reduzido (a duração cai para quase zero)', () => {
    expect(css).toMatch(/@keyframes gn-pop-in \{[^}]*translateY\(8px\)/);
    expect(css).toMatch(/@keyframes gn-fade-in \{/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ :root \{ --gn-enter: 0\.01ms; \} \}/);
  });
});

describe('cores do sistema (congeladas: o marco não as altera)', () => {
  const DARK: Record<string, string> = {
    '--gn-bg': '#17181b', '--gn-surface': '#1f2023', '--gn-surface-2': '#2a2c31', '--gn-border': '#34363c', '--gn-text': '#e3e5e8', '--gn-muted': '#9097a1',
    '--gn-accent': '#4f86f7', '--gn-accent-hover': '#6a9aff', '--gn-accent-solid': '#4473d4', '--gn-accent-solid-hover': '#3d68bf',
    '--gn-danger': '#ef6a62', '--gn-success': '#4fb56a', '--gn-warn': '#e0a93b', '--gn-radius': '6px',
  };
  const LIGHT: Record<string, string> = {
    '--gn-bg': '#f4f5f7', '--gn-surface': '#ffffff', '--gn-surface-2': '#e9ebef', '--gn-border': '#ced2d9', '--gn-text': '#1f2328', '--gn-muted': '#5a6370',
    '--gn-accent': '#2a62d1', '--gn-accent-hover': '#1f4fb0', '--gn-accent-solid': '#2a62d1', '--gn-accent-solid-hover': '#234fa8',
    '--gn-danger': '#c62f2a', '--gn-success': '#1a7f37', '--gn-warn': '#8a5a00', '--gn-on-success': '#ffffff', '--gn-on-warn': '#ffffff', '--gn-on-danger': '#ffffff',
    '--gn-mix': '#000000', '--gn-diff-add-text': '#14612b', '--gn-diff-del-text': '#a1221d', '--gn-renamed': '#8a3fa3', '--gn-untracked': '#a35a10',
  };
  it('tema escuro', () => { for (const [n, v] of Object.entries(DARK)) expect(value(dark, n), n).toBe(v); });
  it('tema claro', () => { for (const [n, v] of Object.entries(LIGHT)) expect(value(light, n), n).toBe(v); });
});
