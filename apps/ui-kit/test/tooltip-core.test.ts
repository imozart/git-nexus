import { describe, expect, it } from 'vitest';
import { TIP_DELAY_MS, TIP_WARM_MS, placeTip, tipDelay } from '../src/tooltip-core';

const VIEW = { width: 1000, height: 700 };
const TIP = { width: 120, height: 24 };
const anchor = (left: number, top: number, width = 30, height = 24) => ({ left, top, width, height });

describe('placeTip', () => {
  it('por padrão fica acima do alvo, centralizada na horizontal, com 6 px de folga', () => {
    const p = placeTip(anchor(500, 300), TIP, VIEW);
    expect(p.side).toBe('top');
    expect(p.top).toBe(300 - 6 - 24);
    expect(p.left).toBe(500 + 15 - 60);
  });

  it('com prefer: "bottom" fica abaixo', () => {
    const p = placeTip(anchor(500, 300), TIP, VIEW, 'bottom');
    expect(p.side).toBe('bottom');
    expect(p.top).toBe(300 + 24 + 6);
  });

  it('troca de lado quando falta espaço no preferido', () => {
    // alvo colado no topo da janela: não cabe acima, vai para baixo
    expect(placeTip(anchor(500, 10), TIP, VIEW).side).toBe('bottom');
    // alvo colado no fundo, preferindo abaixo: vai para cima
    expect(placeTip(anchor(500, 680), TIP, VIEW, 'bottom').side).toBe('top');
  });

  it('o espaço mínimo é altura + gap + margem (o limite exato cabe)', () => {
    const need = 24 + 6 + 4;
    expect(placeTip(anchor(500, need), TIP, VIEW).side).toBe('top');
    expect(placeTip(anchor(500, need - 1), TIP, VIEW).side).toBe('bottom');
  });

  it('se nenhum lado couber, mantém o preferido', () => {
    const tiny = { width: 1000, height: 40 };
    expect(placeTip(anchor(500, 10, 30, 24), { width: 120, height: 80 }, tiny).side).toBe('top');
    expect(placeTip(anchor(500, 10, 30, 24), { width: 120, height: 80 }, tiny, 'bottom').side).toBe('bottom');
  });

  it('o left fica dentro da janela: encostado à esquerda e à direita, com a margem', () => {
    expect(placeTip(anchor(0, 300, 10), TIP, VIEW).left).toBe(4);
    expect(placeTip(anchor(990, 300, 10), TIP, VIEW).left).toBe(1000 - 120 - 4);
  });

  it('gap e margem customizados', () => {
    const p = placeTip(anchor(500, 300), TIP, VIEW, 'top', 10, 8);
    expect(p.top).toBe(300 - 10 - 24);
    expect(placeTip(anchor(0, 300, 10), TIP, VIEW, 'top', 10, 8).left).toBe(8);
  });

  it('dica maior que a janela: fica encostada à esquerda (não sai pela esquerda)', () => {
    expect(placeTip(anchor(100, 300), { width: 2000, height: 24 }, VIEW).left).toBe(4);
  });
});

describe('tipDelay', () => {
  it('sem dica fechada antes (null), vale o atraso normal', () => {
    expect(tipDelay(10_000, null)).toBe(TIP_DELAY_MS);
    expect(tipDelay(10_000, null, 800)).toBe(800);
  });
  it('dentro da janela quente depois de fechar uma dica, abre sem atraso', () => {
    expect(tipDelay(10_000, 10_000 - (TIP_WARM_MS - 1))).toBe(0);
    expect(tipDelay(10_000, 10_000)).toBe(0);
  });
  it('fora da janela quente volta ao atraso normal (o limite exato já é frio)', () => {
    expect(tipDelay(10_000, 10_000 - TIP_WARM_MS)).toBe(TIP_DELAY_MS);
    expect(tipDelay(10_000, 1_000)).toBe(TIP_DELAY_MS);
  });
  it('os padrões são 500 ms de atraso e 300 ms de janela quente', () => {
    expect(TIP_DELAY_MS).toBe(500);
    expect(TIP_WARM_MS).toBe(300);
  });
});
