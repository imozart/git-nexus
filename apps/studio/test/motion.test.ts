import { describe, expect, it } from 'vitest';
import { MOTION_PREFS, isReducedMotion, motionAttribute, pickMotionPref } from '../src/entrypoints/renderer/motion-core';

describe('preferência de movimento', () => {
  it('as opções, em ordem: Sistema, Reduzido, Normal', () => {
    expect(MOTION_PREFS).toEqual(['system', 'reduced', 'normal']);
  });

  it('valor guardado inválido, vazio ou ausente cai em "Sistema"; os válidos passam', () => {
    for (const bad of [null, undefined, '', 'x', 'REDUCED', '1']) expect(pickMotionPref(bad)).toBe('system');
    for (const ok of MOTION_PREFS) expect(pickMotionPref(ok)).toBe(ok);
  });

  it('o atributo do <html>: reduzido "true", normal "false" (vale mesmo que o sistema peça menos) e sistema sem atributo', () => {
    expect(motionAttribute('reduced')).toBe('true');
    expect(motionAttribute('normal')).toBe('false');
    expect(motionAttribute('system')).toBeUndefined();
  });

  it('isReducedMotion (confete etc.): a opção do app manda; em "Sistema" vale o que o sistema pede', () => {
    expect(isReducedMotion('reduced', false)).toBe(true);
    expect(isReducedMotion('reduced', true)).toBe(true);
    expect(isReducedMotion('normal', true)).toBe(false);
    expect(isReducedMotion('normal', false)).toBe(false);
    expect(isReducedMotion('system', true)).toBe(true);
    expect(isReducedMotion('system', false)).toBe(false);
  });
});
