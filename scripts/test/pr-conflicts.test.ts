import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { CONFLICT_LABEL, conflictAction } from '../lib/pr-conflicts.mjs';

describe('conflictAction', () => {
  it('CONFLICTING sem a label -> adiciona; com a label -> nada', () => {
    expect(conflictAction('CONFLICTING', ['bug'])).toBe('add');
    expect(conflictAction('CONFLICTING', ['bug', CONFLICT_LABEL])).toBe('none');
  });

  it('MERGEABLE com a label -> remove; sem a label -> nada', () => {
    expect(conflictAction('MERGEABLE', [CONFLICT_LABEL])).toBe('remove');
    expect(conflictAction('MERGEABLE', [])).toBe('none');
  });

  it('UNKNOWN (ou valor inesperado) nunca muda a label: pede nova consulta', () => {
    for (const m of ['UNKNOWN', undefined, '', 'OUTRA_COISA']) expect(conflictAction(m, [CONFLICT_LABEL])).toBe('retry');
  });

  it('a label existe no catálogo', () => {
    const catalog = JSON.parse(readFileSync(join(__dirname, '..', '..', '.github', 'labels.json'), 'utf8')) as Array<{ name: string }>;
    expect(catalog.map((l) => l.name)).toContain(CONFLICT_LABEL);
  });
});
