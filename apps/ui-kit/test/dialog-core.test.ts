import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FOCUSABLE, createDialogStack, dialogStack, isDialogOpen, newDialogId, nextFocusIndex } from '../src/dialog-core';

describe('nextFocusIndex (Tab e Shift+Tab dentro do diálogo)', () => {
  it('Tab avança e volta ao primeiro depois do último', () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 1, false)).toBe(2);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });

  it('Shift+Tab recua e vai ao último a partir do primeiro', () => {
    expect(nextFocusIndex(3, 2, true)).toBe(1);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });

  it('lista vazia devolve -1 (o foco vai para a própria caixa)', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
  });

  it('foco fora da lista: Tab vai ao primeiro e Shift+Tab ao último', () => {
    expect(nextFocusIndex(4, -1, false)).toBe(0);
    expect(nextFocusIndex(4, -1, true)).toBe(3);
    expect(nextFocusIndex(4, 9, false)).toBe(0);
  });

  it('lista de um item: fica sempre nele', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });
});

describe('createDialogStack (diálogo dentro de diálogo)', () => {
  it('o último a entrar é o topo e só ele responde', () => {
    const s = createDialogStack();
    expect(s.size()).toBe(0);
    expect(s.isTop(1)).toBe(false);
    s.push(1);
    s.push(2);
    expect(s.size()).toBe(2);
    expect(s.isTop(2)).toBe(true);
    expect(s.isTop(1)).toBe(false);
  });

  it('remover o do meio mantém o topo; remover o topo devolve o anterior', () => {
    const s = createDialogStack();
    s.push(1);
    s.push(2);
    s.push(3);
    s.remove(2);
    expect(s.size()).toBe(2);
    expect(s.isTop(3)).toBe(true);
    s.remove(3);
    expect(s.isTop(1)).toBe(true);
    s.remove(1);
    expect(s.size()).toBe(0);
  });

  it('remover um id que não está na pilha não muda nada; push repetido leva ao topo sem duplicar', () => {
    const s = createDialogStack();
    s.push(1);
    s.push(2);
    s.remove(9);
    expect(s.size()).toBe(2);
    s.push(1);
    expect(s.size()).toBe(2);
    expect(s.isTop(1)).toBe(true);
  });
});

describe('pilha única do app', () => {
  beforeEach(() => {
    for (let i = 0; i < 50; i++) dialogStack.remove(i);
  });

  it('isDialogOpen acompanha a pilha e os ids são únicos', () => {
    const a = newDialogId();
    const b = newDialogId();
    expect(a).not.toBe(b);
    expect(isDialogOpen()).toBe(false);
    dialogStack.push(a);
    expect(isDialogOpen()).toBe(true);
    dialogStack.remove(a);
    expect(isDialogOpen()).toBe(false);
    dialogStack.remove(b);
  });
});

describe('FOCUSABLE', () => {
  it('cobre link, botão, campos e tabindex, e exclui desabilitado, hidden e tabindex -1', () => {
    for (const s of ['a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type=hidden])', 'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])']) {
      expect(FOCUSABLE).toContain(s);
    }
  });
});

describe('GnDialog.vue (regras que o compilador não vê)', () => {
  const vue = readFileSync(join(__dirname, '..', 'src', 'components', 'GnDialog.vue'), 'utf8').replace(/\r\n/g, '\n');
  const style = vue.slice(vue.indexOf('<style'));
  const script = vue.slice(0, vue.indexOf('<template>'));

  it('só tokens no CSS: nenhuma cor fixa', () => {
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(style).not.toMatch(/rgba?\(/);
  });

  it('usa os tokens de elevação, fundo, raio, camada e entrada', () => {
    for (const t of ['--gn-shadow-lg', '--gn-backdrop', '--gn-radius-lg', '--gn-z-dialog', '--gn-enter', 'gn-pop-in', 'gn-fade-in']) expect(style, t).toContain(t);
  });

  it('é um div projetado no body (não o <dialog> nativo, que esconderia os menus do app)', () => {
    const template = vue.slice(vue.indexOf('<template>'), vue.indexOf('<style'));
    expect(template).toContain('<Teleport to="body">');
    expect(template).not.toMatch(/<dialog[\s>]/);
    expect(script.replace(/^\s*\/\/.*$/gm, '')).not.toContain('showModal');
  });

  it('não importa i18n, stores nem api (é componente do kit)', () => {
    expect(script).not.toMatch(/from '(\.\.?\/)+(renderer|i18n|store|api)|useI18n|window\.gitNexus/);
  });

  it('Esc na captura, foco devolvido e fundo inerte', () => {
    expect(script).toContain("document.addEventListener('keydown', onKey, true)");
    expect(script).toContain("document.getElementById('app')");
    expect(script).toContain("'inert'");
    expect(script).toContain('opener.focus()');
  });
});
