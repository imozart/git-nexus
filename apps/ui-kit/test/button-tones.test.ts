import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contraste das cores dos botões no tema escuro. As cores são lidas dos próprios arquivos (tokens.scss e GnButton.vue), então mudar um token
// ou o texto sobre o fundo sólido sem conferir a legibilidade reprova aqui. Fórmulas: WCAG 2.x (luminância relativa e razão de contraste).
const root = join(__dirname, '..');
const tokens = readFileSync(join(root, 'src', 'styles', 'tokens.scss'), 'utf8');
const button = readFileSync(join(root, 'src', 'components', 'GnButton.vue'), 'utf8').replace(/\r\n/g, '\n');
const badge = readFileSync(join(root, 'src', 'components', 'GnBadge.vue'), 'utf8');

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const token = (name: string): RGB => hex(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)![1]!);
/** `color-mix(in srgb, a pct%, b)`: mistura linear em sRGB, como o navegador. */
const mix = (a: RGB, pct: number, b: RGB): RGB => a.map((v, i) => (v * pct) / 100 + b[i]! * (1 - pct / 100)) as RGB;
const lum = (c: RGB): number => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const WHITE: RGB = [255, 255, 255];
// As porcentagens da mistura vêm do próprio CSS do botão: mudar o CSS muda o que o teste mede.
const TEXT_PCT = Number(/color: color-mix\(in srgb, var\(--tone\) (\d+)%, #fff\)/.exec(button)![1]);
const TINTS = [...button.matchAll(/background: color-mix\(in srgb, var\(--tone\) (\d+)%, var\(--gn-surface-2\)\)/g)].map((m) => Number(m[1]));
const surface2 = token('gn-surface-2');
const TONES = { accent: token('gn-accent'), success: token('gn-success'), warn: token('gn-warn'), danger: token('gn-danger') };
/** Texto sobre o preenchimento sólido, lido de `--on-tone` de cada tom em GnButton.vue (accent usa o `#fff` padrão). */
const onTone = (tone: string): RGB => {
  const m = new RegExp(`&--tone-${tone} \\{[^}]*--on-tone: (#[0-9a-fA-F]{6})`).exec(button);
  return m ? hex(m[1]!) : WHITE;
};

describe('contraste dos botões coloridos (tema escuro)', () => {
  for (const [tone, color] of Object.entries(TONES)) {
    it(`${tone}: texto do botão de contorno (tom clareado) tem contraste AA (4,5:1) sobre o fundo tingido, também no hover`, () => {
      const text = mix(color, TEXT_PCT, WHITE);
      expect(TINTS.length, "fundo normal e fundo no hover").toBe(2);
      for (const tint of TINTS) {
        const bg = mix(color, tint, surface2);
        expect(contrast(text, bg), `${tone} com fundo a ${tint}%`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${tone}: o texto sobre o botão sólido tem contraste suficiente`, () => {
      // o primary azul é o único que sempre teve texto branco (3,5:1, aceito como estava); os demais, com texto escuro, passam de 4,5:1
      const min = tone === 'accent' ? 3 : 4.5;
      expect(contrast(onTone(tone), color), tone).toBeGreaterThanOrEqual(min);
    });
  }

  it('o texto do botão neutro (cinza claro) continua legível sobre o fundo do botão', () => {
    expect(contrast(token('gn-text'), surface2)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('vocabulário dos tons', () => {
  it('GnButton e GnBadge usam os mesmos nomes de tom', () => {
    const names = (src: string) => [...(/tone\??:\s*([^;}]+)[;}]/.exec(src)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]!).sort();
    const buttonTone = /type GnTone = ([^;]+);/.exec(button)![1]!;
    expect([...buttonTone.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!).sort()).toEqual(names(badge));
  });

  it('todo tom colorido tem a cor definida e o conjunto de tokens existe', () => {
    for (const t of ['gn-accent', 'gn-success', 'gn-warn', 'gn-danger']) expect(token(t)).toHaveLength(3);
    for (const tone of ['accent', 'success', 'warn', 'danger']) expect(button).toContain(`&--tone-${tone} {`);
  });

  it('variant="danger" e variant="primary" continuam funcionando sem `tone` (compatível com o uso anterior)', () => {
    expect(button).toContain("props.variant === 'danger' ? 'danger' : props.variant === 'primary' ? 'accent' : 'neutral'");
  });
});
