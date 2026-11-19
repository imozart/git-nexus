import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAIN_METHODS } from '../src/shared/channels';
import { TITLE_BAR_ARG, TITLE_BAR_COLORS, TITLE_BAR_HEIGHT, cssColorToHex, overlayHeight, parseTitleBarColors, titleBarMode, titleBarModeFromArgv, titleBarWindowOptions } from '../src/shared/title-bar';

describe('titleBarMode', () => {
  it('Windows e Linux: overlay; macOS: inset; outras plataformas: moldura nativa', () => {
    expect(titleBarMode('win32')).toBe('overlay');
    expect(titleBarMode('linux')).toBe('overlay');
    expect(titleBarMode('darwin')).toBe('inset');
    expect(titleBarMode('freebsd')).toBe('native');
  });
  it('GITNEXUS_NATIVE_FRAME=1 mantém a moldura do sistema em qualquer plataforma (saída para gerenciadores de janela sem overlay)', () => {
    for (const p of ['win32', 'linux', 'darwin']) expect(titleBarMode(p, { GITNEXUS_NATIVE_FRAME: '1' })).toBe('native');
    expect(titleBarMode('linux', { GITNEXUS_NATIVE_FRAME: '0' })).toBe('overlay');
  });
});

describe('titleBarWindowOptions', () => {
  it('overlay: barra escondida e botões nativos com as cores e a altura da faixa de abas', () => {
    expect(titleBarWindowOptions('overlay')).toEqual({ titleBarStyle: 'hidden', titleBarOverlay: { color: '#17181b', symbolColor: '#e3e5e8', height: TITLE_BAR_HEIGHT } });
  });
  it('a altura do overlay acompanha o zoom da interface', () => {
    expect(overlayHeight(1)).toBe(43);
    expect(overlayHeight(1.5)).toBe(65); // 64,5 arredondado
    expect(overlayHeight(0.5)).toBe(22);
    expect(overlayHeight(Number.NaN)).toBe(43);
    expect(overlayHeight(-2)).toBe(43);
    expect((titleBarWindowOptions('overlay', 2).titleBarOverlay as { height: number }).height).toBe(86);
  });
  it('macOS: hiddenInset; nativo: nenhuma opção', () => {
    expect(titleBarWindowOptions('inset')).toEqual({ titleBarStyle: 'hiddenInset' });
    expect(titleBarWindowOptions('native')).toEqual({});
  });
});

describe('cores vindas da interface', () => {
  it('só #rrggbb (qualquer caixa); o resto é recusado', () => {
    expect(parseTitleBarColors({ color: '#F4F5F7', symbolColor: '#1F2328' })).toEqual({ color: '#f4f5f7', symbolColor: '#1f2328' });
    for (const bad of [null, undefined, 'x', {}, { color: '#fff', symbolColor: '#000000' }, { color: 'red', symbolColor: '#000000' }, { color: '#17181b' }, { color: '#17181b', symbolColor: 'url(x)' }, { color: 1, symbolColor: 2 }]) {
      expect(parseTitleBarColors(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it('cssColorToHex entende o que o navegador devolve', () => {
    expect(cssColorToHex('#17181b')).toBe('#17181b');
    expect(cssColorToHex(' rgb(23, 24, 27) ')).toBe('#17181b');
    expect(cssColorToHex('rgba(244 245 247 / 0.5)')).toBe('#f4f5f7');
    expect(cssColorToHex('rgb(300, 0, 0)')).toBeNull();
    expect(cssColorToHex('var(--x)')).toBeNull();
    expect(cssColorToHex('')).toBeNull();
  });
  it('as cores iniciais são as dos tokens do tema (se mudarem os tokens, mude aqui)', () => {
    const tokens = readFileSync(join(__dirname, '..', '..', 'ui-kit', 'src', 'styles', 'tokens.scss'), 'utf8');
    const block = (from: string) => tokens.slice(tokens.indexOf(from)).split('}')[0]!;
    const dark = block(':root {');
    const light = block(":root[data-theme='light']");
    for (const [theme, text] of [['dark', dark], ['light', light]] as const) {
      expect(text, theme).toContain(`--gn-bg: ${TITLE_BAR_COLORS[theme].color}`);
      expect(text, theme).toContain(`--gn-text: ${TITLE_BAR_COLORS[theme].symbolColor}`);
    }
  });
});

describe('argumento do renderer (processo principal → preload)', () => {
  it('lê o modo; sem argumento ou com valor desconhecido é a moldura nativa', () => {
    expect(titleBarModeFromArgv(['electron', `${TITLE_BAR_ARG}overlay`])).toBe('overlay');
    expect(titleBarModeFromArgv([`${TITLE_BAR_ARG}inset`])).toBe('inset');
    expect(titleBarModeFromArgv(['electron'])).toBe('native');
    expect(titleBarModeFromArgv([`${TITLE_BAR_ARG}xyz`])).toBe('native');
  });
});

describe('ligações', () => {
  it('setTitleBar é método do processo principal (preload expõe, main trata)', () => {
    expect(MAIN_METHODS as readonly string[]).toContain('setTitleBar');
    const main = readFileSync(join(__dirname, '..', 'src', 'entrypoints', 'main.ts'), 'utf8');
    expect(main).toContain("channel('setTitleBar')");
    expect(main).toContain('titleBarWindowOptions(frameMode');
    expect(main).toContain('additionalArguments');
  });
  it('a altura da faixa de abas no CSS é a do overlay', () => {
    const vue = readFileSync(join(__dirname, '..', 'src', 'entrypoints', 'renderer', 'CoreInterface.vue'), 'utf8');
    expect(vue).toContain(`min-height: ${TITLE_BAR_HEIGHT}px`);
  });
});
