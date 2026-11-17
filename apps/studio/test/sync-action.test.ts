import { describe, expect, it } from 'vitest';
import { remoteName, syncAction } from '../src/entrypoints/renderer/sync-action';

const base = { upstream: 'origin/main', ahead: 0, behind: 0, gone: false };

describe('syncAction: a ação certa para cada estado', () => {
  it('em dia ou HEAD desanexado: buscar', () => {
    expect(syncAction(base)).toBe('fetch');
    expect(syncAction({ ...base, upstream: null, detached: true })).toBe('fetch');
  });

  it('atrás: atualizar; à frente: enviar; divergida: escolher', () => {
    expect(syncAction({ ...base, behind: 2 })).toBe('update');
    expect(syncAction({ ...base, ahead: 2 })).toBe('push');
    expect(syncAction({ ...base, ahead: 1, behind: 1 })).toBe('choose');
  });

  it('sem upstream ou com a remota apagada: publicar', () => {
    expect(syncAction({ ...base, upstream: null })).toBe('publish');
    expect(syncAction({ ...base, gone: true, behind: 0 })).toBe('publish');
  });
});

describe('remoteName', () => {
  it('vem do upstream, senão da base, senão "origin"', () => {
    expect(remoteName({ upstream: 'upstream/feat/x' })).toBe('upstream');
    expect(remoteName({ upstream: null }, { base: 'fork/main', short: 'main', ahead: 0, behind: 0 })).toBe('fork');
    expect(remoteName({ upstream: null })).toBe('origin');
    expect(remoteName(null)).toBe('origin');
  });
});
