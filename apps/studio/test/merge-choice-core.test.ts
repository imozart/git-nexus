import { describe, expect, it } from 'vitest';
import type { ConflictSide, MergeConflictBlock } from '@git-nexus/git-core/pure';
import { choiceView, formatSize, isChoiceKind, isImagePath, kindShortKey, modeKind, previewLines } from '../src/entrypoints/renderer/merge-choice-core';

const side = (sha: string, mode = '100644'): ConflictSide => ({ mode, sha });
const block = (kind: MergeConflictBlock['kind'], sides: MergeConflictBlock['sides'], extra: Partial<MergeConflictBlock> = {}): MergeConflictBlock => ({
  filePath: 'f',
  kind,
  sides,
  ours: '',
  base: '',
  theirs: '',
  hasUnresolvedMarkers: true,
  ...extra,
});

describe('escolha para conflitos que não são "linha contra linha"', () => {
  it('só os tipos sem linhas vão para a tela de escolha (texto e adicionado nos dois lados seguem no resolvedor)', () => {
    expect(['text', 'both-added', undefined].map(isChoiceKind)).toEqual([false, false, false]);
    expect(['deleted', 'both-deleted', 'binary', 'lfs', 'mode', 'submodule'].map((k) => isChoiceKind(k as never))).toEqual([true, true, true, true, true, true]);
  });

  it('no merge "minha" é o estágio 2 (ours); no rebase o Git inverte, e "minha" é o estágio 3', () => {
    const b = block('binary', { ours: side('a'.repeat(40)), theirs: side('b'.repeat(40)) });
    const merge = choiceView(b, false);
    expect([merge.mine.stage, merge.theirs.stage]).toEqual(['ours', 'theirs']);
    expect(merge.mine.info?.sha).toBe('a'.repeat(40));
    const rebase = choiceView(b, true);
    expect([rebase.mine.stage, rebase.theirs.stage]).toEqual(['theirs', 'ours']);
    expect(rebase.mine.info?.sha).toBe('b'.repeat(40)); // o commit do usuário
    expect(rebase.options.map((o) => [o.side, o.stage])).toEqual([['mine', 'theirs'], ['theirs', 'ours']]);
  });

  it('apagado × alterado: diz quem apagou, e ficar com o lado que apagou é remover', () => {
    const base = side('1'.repeat(40));
    const kept = side('2'.repeat(40));
    const v = choiceView(block('deleted', { base, ours: kept }, { ours: 'novo\n', base: 'velho\n' }), false);
    expect(v.deletedBy).toBe('theirs');
    expect(v.keptUnchanged).toBe(false);
    expect(v.oneSide).toBe(false);
    expect(v.options).toEqual([
      { side: 'mine', stage: 'ours', effect: 'keep' },
      { side: 'theirs', stage: 'theirs', effect: 'remove' },
    ]);
    expect(v.mine.text).toBe('novo\n');
    // no rebase quem apagou é o outro lado da tela
    expect(choiceView(block('deleted', { base, ours: kept }), true).deletedBy).toBe('mine');
    // o lado mantido é igual à base: só mudou de lugar
    expect(choiceView(block('deleted', { base, ours: base }), false).keptUnchanged).toBe(true);
  });

  it('só existe de um lado (sem base) e apagado nos dois lados', () => {
    expect(choiceView(block('deleted', { theirs: side('3'.repeat(40)) }), false).oneSide).toBe(true);
    const both = choiceView(block('both-deleted', { base: side('4'.repeat(40)) }), false);
    expect(both.options).toEqual([{ side: 'mine', stage: 'ours', effect: 'remove' }]);
  });

  it('chave do texto curto da lista, tipo do arquivo e tamanho legível', () => {
    expect(kindShortKey(block('deleted', { base: side('1'.repeat(40)), ours: side('2'.repeat(40)) }))).toBe('mc.short.deleted');
    expect(kindShortKey(block('deleted', { ours: side('2'.repeat(40)) }))).toBe('mc.short.oneSide');
    expect(['binary', 'lfs', 'mode', 'submodule', 'both-deleted'].map((k) => kindShortKey(block(k as never, {})))).toEqual(['mc.short.binary', 'mc.short.lfs', 'mc.short.mode', 'mc.short.submodule', 'mc.short.bothDeleted']);
    expect(['100644', '100755', '120000', '160000', '040000'].map(modeKind)).toEqual(['file', 'exec', 'link', 'submodule', 'other']);
    expect([undefined, 0, 1023, 1536, 5 * 1024 * 1024].map((n) => formatSize(n, 'en-US'))).toEqual(['', '0 B', '1023 B', '1.5 KB', '5 MB']);
    expect(['a/logo.PNG', 'foto.jpeg', 'x.svg', 'dados.bin', 'png'].map(isImagePath)).toEqual([true, true, false, false, false]);
  });

  it('a prévia do texto mantido tem um limite de linhas e conta as que ficaram de fora', () => {
    expect(previewLines('a\r\nb\n', 10)).toEqual({ lines: ['a', 'b'], more: 0 });
    const long = Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n') + '\n';
    const p = previewLines(long, 40);
    expect(p.lines).toHaveLength(40);
    expect(p.more).toBe(10);
  });
});
