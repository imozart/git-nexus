import { describe, expect, it } from 'vitest';
import type { GitCommandEvent } from '@git-nexus/git-core/pure';
import { MAX_ENTRIES, appendEvents, repoKey } from '../src/entrypoints/renderer/gitlog-core';

const ev = (id: number): GitCommandEvent => ({ id, repoPath: 'C:\\r', command: `git x${id}`, readOnly: true, startedAt: id, durationMs: 1, code: 0 });

describe('log do git (store)', () => {
  it('repoKey ignora barras, maiúsculas e barra final', () => {
    expect(repoKey('C:\\Dev\\Proj\\')).toBe(repoKey('c:/dev/proj'));
    expect(repoKey('/home/u/a')).not.toBe(repoKey('/home/u/b'));
  });

  it('appendEvents mantém a ordem e descarta os mais antigos além do limite', () => {
    expect(appendEvents([ev(1)], [ev(2), ev(3)]).map((e) => e.id)).toEqual([1, 2, 3]);
    const full = Array.from({ length: MAX_ENTRIES }, (_, i) => ev(i));
    const out = appendEvents(full, [ev(1000)]);
    expect(out).toHaveLength(MAX_ENTRIES);
    expect(out[0]!.id).toBe(1);
    expect(out[out.length - 1]!.id).toBe(1000);
  });

  it('não altera a lista original', () => {
    const base = [ev(1)];
    appendEvents(base, [ev(2)]);
    expect(base).toHaveLength(1);
  });
});
