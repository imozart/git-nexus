import { describe, expect, it } from 'vitest';
import { syncState, type SyncInfo } from '../src/pure.js';

const base: SyncInfo = { upstream: 'origin/main', ahead: 0, behind: 0, gone: false };

describe('syncState', () => {
  it('em dia, atrás, à frente e divergida', () => {
    expect(syncState(base)).toBe('in-sync');
    expect(syncState({ ...base, behind: 3 })).toBe('behind');
    expect(syncState({ ...base, ahead: 2 })).toBe('ahead');
    expect(syncState({ ...base, ahead: 2, behind: 3 })).toBe('diverged');
  });

  it('sem upstream, remota apagada e HEAD desanexado', () => {
    expect(syncState({ ...base, upstream: null })).toBe('no-upstream');
    expect(syncState({ ...base, gone: true })).toBe('gone');
    expect(syncState({ ...base, upstream: null, detached: true })).toBe('detached');
  });

  it('desanexado e remota apagada vencem os números', () => {
    expect(syncState({ ...base, ahead: 1, behind: 1, detached: true })).toBe('detached');
    expect(syncState({ ...base, ahead: 4, gone: true })).toBe('gone');
  });
});
