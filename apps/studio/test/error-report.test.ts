import { describe, expect, it } from 'vitest';
import { ErrorThrottle, MAX_REPORTS, REPEAT_WINDOW_MS, describeThrown, isBenignError } from '../src/entrypoints/renderer/error-report';

describe('ErrorThrottle', () => {
  it('o mesmo erro em sequência só é registrado uma vez por janela de tempo', () => {
    const t = new ErrorThrottle();
    expect(t.allow('falhou', 1000)).toBe(true);
    expect(t.allow('falhou', 1000 + REPEAT_WINDOW_MS - 1)).toBe(false);
    expect(t.allow('falhou', 1000 + REPEAT_WINDOW_MS)).toBe(true);
  });

  it('erros diferentes passam; há um teto por sessão', () => {
    const t = new ErrorThrottle();
    let ok = 0;
    for (let i = 0; i < MAX_REPORTS + 10; i++) if (t.allow(`erro ${i}`, i)) ok++;
    expect(ok).toBe(MAX_REPORTS);
    expect(t.allow('outro', 99999)).toBe(false);
  });
});

describe('describeThrown', () => {
  it('Error: mensagem e pilha; texto e objetos também', () => {
    const e = new Error('quebrou');
    expect(describeThrown(e)).toMatchObject({ message: 'quebrou', stack: expect.stringContaining('quebrou') });
    expect(describeThrown('texto solto')).toEqual({ message: 'texto solto' });
    expect(describeThrown({ code: 7 })).toEqual({ message: '{"code":7}' });
    expect(describeThrown(undefined).message).toBe('undefined');
  });
});

describe('isBenignError', () => {
  it('o aviso do ResizeObserver não é erro do app', () => {
    expect(isBenignError('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isBenignError('ResizeObserver loop limit exceeded')).toBe(true);
    expect(isBenignError('Cannot read properties of undefined')).toBe(false);
  });
});
