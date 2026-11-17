import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEPS, clampZoom, isZoomAction, stepZoom, zoomActionForKey } from '../src/entrypoints/zoom';

describe('stepZoom', () => {
  it('anda um degrau para cada lado a partir de 100 %', () => {
    expect(stepZoom(1, 'in')).toBe(1.1);
    expect(stepZoom(1, 'out')).toBe(0.9);
    expect(stepZoom(1.1, 'in')).toBe(1.25);
  });

  it('para nos limites (50 % e 300 %)', () => {
    expect(stepZoom(MAX_ZOOM, 'in')).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, 'out')).toBe(MIN_ZOOM);
  });

  it('reset volta a 100 % de qualquer ponto', () => {
    for (const z of ZOOM_STEPS) expect(stepZoom(z, 'reset')).toBe(1);
  });

  it('um fator fora dos degraus (vindo de arquivo) vai para o degrau vizinho, sem pular', () => {
    expect(stepZoom(1.04, 'in')).toBe(1.1); // o mais próximo é 1 → 1.1
    expect(stepZoom(1.04, 'out')).toBe(0.9);
    expect(stepZoom(7, 'out')).toBe(2.5); // lixo é limitado a 300 % antes
  });

  it('subir e descer são inversos entre os degraus', () => {
    for (const z of ZOOM_STEPS.slice(1, -1)) expect(stepZoom(stepZoom(z, 'in'), 'out')).toBe(z);
  });
});

describe('clampZoom', () => {
  it('lixo, NaN e infinito viram 100 %; o resto é limitado', () => {
    expect(clampZoom('2')).toBe(1);
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(1);
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(1.25)).toBe(1.25);
  });
});

describe('zoomActionForKey', () => {
  const ctrl = { control: true, meta: false, alt: false };
  it('Ctrl + = ou + aumenta, - diminui, 0 restaura; numpad também', () => {
    expect(zoomActionForKey('=', ctrl)).toBe('in');
    expect(zoomActionForKey('+', ctrl)).toBe('in');
    expect(zoomActionForKey('Add', ctrl)).toBe('in');
    expect(zoomActionForKey('-', ctrl)).toBe('out');
    expect(zoomActionForKey('_', ctrl)).toBe('out');
    expect(zoomActionForKey('Subtract', ctrl)).toBe('out');
    expect(zoomActionForKey('0', ctrl)).toBe('reset');
  });
  it('⌘ no macOS vale; sem Ctrl/⌘ ou com Alt não é zoom (não atrapalha a digitação)', () => {
    expect(zoomActionForKey('=', { control: false, meta: true, alt: false })).toBe('in');
    expect(zoomActionForKey('=', { control: false, meta: false, alt: false })).toBeNull();
    expect(zoomActionForKey('=', { control: true, meta: false, alt: true })).toBeNull();
    expect(zoomActionForKey('a', ctrl)).toBeNull();
  });
  it('isZoomAction valida o que chega pelo IPC', () => {
    expect(isZoomAction('in') && isZoomAction('out') && isZoomAction('reset')).toBe(true);
    expect(isZoomAction('rm -rf')).toBe(false);
    expect(isZoomAction(undefined)).toBe(false);
  });
});
