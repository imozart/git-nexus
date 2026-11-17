import { describe, expect, it } from 'vitest';
import { newCommitsFromFetch, shouldNotify } from '../src/entrypoints/renderer/notifications-core';

describe('quando avisar', () => {
  it('só com a opção ligada E a janela em segundo plano', () => {
    expect(shouldNotify({ enabled: true, windowFocused: false })).toBe(true);
    expect(shouldNotify({ enabled: true, windowFocused: true })).toBe(false);
    expect(shouldNotify({ enabled: false, windowFocused: false })).toBe(false);
    expect(shouldNotify({ enabled: false, windowFocused: true })).toBe(false);
  });
});

describe('a busca trouxe commits novos?', () => {
  const up = 'origin/main';

  it('conta só o que chegou agora: atrás 0 → 3 são 3 commits novos', () => {
    expect(newCommitsFromFetch({ behind: 0, upstream: up }, { behind: 3, upstream: up })).toBe(3);
  });

  it('quem já estava atrás antes da busca não gera aviso repetido (2 → 2 = nada; 2 → 5 = 3)', () => {
    expect(newCommitsFromFetch({ behind: 2, upstream: up }, { behind: 2, upstream: up })).toBe(0);
    expect(newCommitsFromFetch({ behind: 2, upstream: up }, { behind: 5, upstream: up })).toBe(3);
  });

  it('sem novidade, ou atrás diminuiu (fez pull no meio): zero', () => {
    expect(newCommitsFromFetch({ behind: 0, upstream: up }, { behind: 0, upstream: up })).toBe(0);
    expect(newCommitsFromFetch({ behind: 4, upstream: up }, { behind: 1, upstream: up })).toBe(0);
  });

  it('sem upstream, com a cabeça solta ou sem o resumo de depois: zero (não há remoto da branch para comparar)', () => {
    expect(newCommitsFromFetch({ behind: 0, upstream: null }, { behind: 3, upstream: null })).toBe(0);
    expect(newCommitsFromFetch({ behind: 0, upstream: up }, { behind: 3, upstream: up, detached: true })).toBe(0);
    expect(newCommitsFromFetch({ behind: 0, upstream: up }, null)).toBe(0);
    expect(newCommitsFromFetch({ behind: 0, upstream: up }, undefined)).toBe(0);
  });

  it('sem o resumo de antes (primeira leitura), tudo o que está atrás conta como novo', () => {
    expect(newCommitsFromFetch(null, { behind: 2, upstream: up })).toBe(2);
  });

  it('a branch trocou de upstream entre as duas leituras: não compara com a antiga', () => {
    expect(newCommitsFromFetch({ behind: 9, upstream: 'origin/outra' }, { behind: 2, upstream: up })).toBe(2);
  });
});
