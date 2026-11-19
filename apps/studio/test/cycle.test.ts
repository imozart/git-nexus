import { describe, expect, it } from 'vitest';
import { cycleArgs } from '../src/entrypoints/cycle';

describe('cycleArgs (gancho do teste do ciclo de atualização, só CI)', () => {
  it('sem a variável de ambiente o app abre normalmente', () => {
    expect(cycleArgs({})).toBeNull();
    expect(cycleArgs({ GITNEXUS_UPDATE_CYCLE: '' })).toBeNull();
  });

  it('lê o modo, o ZIP e o log; o modo padrão é a troca', () => {
    expect(cycleArgs({ GITNEXUS_UPDATE_CYCLE: JSON.stringify({ zip: 'a.zip', logFile: 'l.log' }) })).toEqual({ mode: 'swap', zip: 'a.zip', logFile: 'l.log' });
    expect(cycleArgs({ GITNEXUS_UPDATE_CYCLE: JSON.stringify({ mode: 'cleanup', zip: 'a.zip', logFile: 'l.log' }) })?.mode).toBe('cleanup');
    expect(cycleArgs({ GITNEXUS_UPDATE_CYCLE: JSON.stringify({ mode: 'qualquer', zip: 'a.zip', logFile: 'l.log' }) })?.mode).toBe('swap');
  });

  it('JSON inválido ou incompleto não é um ciclo (o app abre normalmente em vez de sair)', () => {
    expect(cycleArgs({ GITNEXUS_UPDATE_CYCLE: '{nao-e-json' })).toBeNull();
    expect(cycleArgs({ GITNEXUS_UPDATE_CYCLE: JSON.stringify({ zip: 'a.zip' }) })).toBeNull();
    expect(cycleArgs({ GITNEXUS_UPDATE_CYCLE: JSON.stringify({ zip: 1, logFile: 'l.log' }) })).toBeNull();
  });
});
