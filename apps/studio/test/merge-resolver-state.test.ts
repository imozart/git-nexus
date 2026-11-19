import { describe, expect, it } from 'vitest';
import { buildMerge, emptyChoices, presetPicks, resolveMerge, type MergeChoices } from '@git-nexus/git-core/pure';
import {
  applyBulk,
  draftSignature,
  emptyHistory,
  fileSummary,
  MAX_HISTORY,
  parseDraft,
  pendingOf,
  recordChange,
  redoChoice,
  serializeDraft,
  sideLabels,
  stepConflict,
  undoChoice,
  validateChoices,
} from '../src/entrypoints/renderer/merge-resolver-core';

const L = (...l: string[]) => l.join('\n') + '\n';

/** Três conflitos separados + uma mudança só da origin e uma só minha. */
const base = L('a', 's1', 'b1', 's2', 'c', 's3', 'b2', 's4', 'd', 's5', 'b3', 's6', 'e', 's7', 'f');
const mine = L('a', 's1', 'M1', 's2', 'c', 's3', 'M2', 's4', 'd', 's5', 'M3', 's6', 'e', 's7', 'FM');
const theirs = L('A', 's1', 'T1', 's2', 'c', 's3', 'T2', 's4', 'd', 's5', 'T3', 's6', 'e', 's7', 'f');
const model = buildMerge({ base, mine, theirs });

describe('desfazer e refazer', () => {
  const c0 = emptyChoices();
  const c1: MergeChoices = { ...c0, picks: { 3: [] } };
  const c2: MergeChoices = { ...c1, reverted: [0] };

  it('desfaz e refaz na ordem, e uma escolha nova descarta o "refazer"', () => {
    let h = recordChange(emptyHistory(), c0); // c0 -> c1
    h = recordChange(h, c1); // c1 -> c2
    const u1 = undoChoice(h, c2)!;
    expect(u1.choices).toBe(c1);
    const u2 = undoChoice(u1.history, u1.choices)!;
    expect(u2.choices).toBe(c0);
    expect(undoChoice(u2.history, u2.choices)).toBeNull();
    const r1 = redoChoice(u2.history, u2.choices)!;
    expect(r1.choices).toBe(c1);
    expect(redoChoice(r1.history, r1.choices)!.choices).toBe(c2);
    expect(redoChoice(emptyHistory(), c0)).toBeNull();
    // uma escolha nova no meio zera o que dava para refazer
    expect(recordChange(u1.history, u1.choices).future).toEqual([]);
  });

  it('a pilha tem limite', () => {
    let h = emptyHistory();
    for (let i = 0; i < MAX_HISTORY + 50; i++) h = recordChange(h, c0);
    expect(h.past).toHaveLength(MAX_HISTORY);
  });
});

describe('ações em massa', () => {
  it('"tudo meu"/"tudo da origin" decidem só os conflitos PENDENTES (o que já foi decidido não muda)', () => {
    const [c1] = model.conflicts;
    const decided: MergeChoices = { ...emptyChoices(), picks: { [c1!]: presetPicks(model, c1!, 'theirs') } };
    const mineAll = applyBulk(model, decided, 'pendingMine');
    expect(pendingOf(model, mineAll)).toEqual([]);
    expect(mineAll.picks[c1!]).toEqual(decided.picks[c1!]); // o primeiro continua com a origin
    expect(mineAll.picks[model.conflicts[1]!]).toEqual(presetPicks(model, model.conflicts[1]!, 'mine'));
    const theirsAll = applyBulk(model, emptyChoices(), 'pendingTheirs');
    expect(resolveMerge(model, theirsAll).text).toBe(L('A', 's1', 'T1', 's2', 'c', 's3', 'T2', 's4', 'd', 's5', 'T3', 's6', 'e', 's7', 'FM'));
  });

  it('aplicar as mudanças sem conflito: todas, só as minhas ou só as da origin', () => {
    const all = (a: Parameters<typeof applyBulk>[2]) => resolveMerge(model, { ...applyBulk(model, { ...emptyChoices(), picks: Object.fromEntries(model.conflicts.map((i) => [i, presetPicks(model, i, 'mine')])) }, a) }).text;
    expect(all('changesAll')).toBe(L('A', 's1', 'M1', 's2', 'c', 's3', 'M2', 's4', 'd', 's5', 'M3', 's6', 'e', 's7', 'FM'));
    expect(all('changesMine')).toBe(L('a', 's1', 'M1', 's2', 'c', 's3', 'M2', 's4', 'd', 's5', 'M3', 's6', 'e', 's7', 'FM'));
    expect(all('changesTheirs')).toBe(L('A', 's1', 'M1', 's2', 'c', 's3', 'M2', 's4', 'd', 's5', 'M3', 's6', 'e', 's7', 'f'));
  });
});

describe('navegação entre conflitos', () => {
  const [a, b, c] = model.conflicts as [number, number, number];
  it('próximo e anterior dão a volta no arquivo', () => {
    const none = emptyChoices();
    expect(stepConflict(model, none, null, 1)).toBe(a);
    expect(stepConflict(model, none, null, -1)).toBe(c);
    expect(stepConflict(model, none, a, 1)).toBe(b);
    expect(stepConflict(model, none, c, 1)).toBe(a);
    expect(stepConflict(model, none, a, -1)).toBe(c);
    expect(stepConflict(model, none, b, -1)).toBe(a);
  });

  it('"próximo pendente" pula os decididos e devolve null quando não resta nenhum', () => {
    const some: MergeChoices = { ...emptyChoices(), picks: { [b]: [] } };
    expect(stepConflict(model, some, a, 1, true)).toBe(c);
    expect(stepConflict(model, some, c, 1, true)).toBe(a);
    const all: MergeChoices = { ...emptyChoices(), picks: { [a]: [], [b]: [], [c]: [] } };
    expect(stepConflict(model, all, a, 1, true)).toBeNull();
    expect(stepConflict(buildMerge({ base: 'x\n', mine: 'x\n', theirs: 'x\n' }), emptyChoices(), null, 1)).toBeNull();
  });
});

describe('rascunho', () => {
  const o = { base, mine, theirs };
  const sig = draftSignature(o);
  const choices: MergeChoices = {
    picks: { [model.conflicts[0]!]: presetPicks(model, model.conflicts[0]!, 'both'), [model.conflicts[1]!]: [{ from: 'typed', text: 'à mão' }] },
    reverted: [model.changes[0]!],
    eol: 'theirs',
  };

  it('a assinatura muda se qualquer das três versões mudar', () => {
    expect(draftSignature({ ...o })).toBe(sig);
    for (const k of ['base', 'mine', 'theirs'] as const) expect(draftSignature({ ...o, [k]: o[k] + 'x' })).not.toBe(sig);
    expect(draftSignature({ base: 'a', mine: 'b', theirs: 'c' })).not.toBe(draftSignature({ base: 'ab', mine: '', theirs: 'c' }));
  });

  it('guarda e lê de volta as mesmas escolhas', () => {
    const raw = serializeDraft(sig, choices)!;
    const back = parseDraft(raw, sig, model);
    expect(back.status).toBe('ok');
    expect(back.status === 'ok' && back.choices).toEqual(choices);
  });

  it('sem escolha nenhuma não há o que guardar; sem rascunho é "none"', () => {
    expect(serializeDraft(sig, emptyChoices())).toBeNull();
    expect(parseDraft(null, sig, model)).toEqual({ status: 'none' });
  });

  it('se as versões mudaram o rascunho é descartado ("stale"), e lixo no disco também', () => {
    const raw = serializeDraft(sig, choices)!;
    expect(parseDraft(raw, draftSignature({ ...o, mine: mine + 'z' }), model)).toEqual({ status: 'stale' });
    expect(parseDraft('{não é json', sig, model)).toEqual({ status: 'stale' });
    expect(parseDraft(JSON.stringify({ v: 2, sig, choices }), sig, model)).toEqual({ status: 'stale' });
  });

  it('valida as escolhas contra o modelo: segmento que não é conflito, linha fora do trecho ou mudança inexistente invalidam', () => {
    expect(validateChoices(model, choices)).toEqual(choices);
    expect(validateChoices(model, { ...choices, picks: { 0: [] } })).toBeNull(); // o segmento 0 é uma mudança só da origin, não um conflito
    expect(validateChoices(model, { ...choices, picks: { [model.conflicts[0]!]: [{ from: 'mine', line: 9999 }] } })).toBeNull();
    expect(validateChoices(model, { ...choices, picks: { [model.conflicts[0]!]: [{ from: 'xx', line: 0 }] } })).toBeNull();
    expect(validateChoices(model, { ...choices, reverted: [model.conflicts[0]!] })).toBeNull();
    expect(validateChoices(model, { ...choices, eol: 'cr' })).toBeNull();
    expect(validateChoices(model, null)).toBeNull();
    expect(validateChoices(model, 'x')).toBeNull();
  });
});

describe('situação na lista de arquivos', () => {
  it('conta conflitos e quantos já foram decididos', () => {
    const [c1] = model.conflicts;
    expect(fileSummary(model, null)).toEqual({ conflicts: 3, resolved: 0 });
    expect(fileSummary(model, { ...emptyChoices(), picks: { [c1!]: [] } })).toEqual({ conflicts: 3, resolved: 1 });
    expect(fileSummary(null, null)).toEqual({ conflicts: null, resolved: 0 });
  });

  it('rótulos genéricos do `git checkout -m` (reabrir conflito) não viram nome de lado', () => {
    const w = L('<<<<<<< ours', 'x', '=======', 'y', '>>>>>>> theirs');
    expect(sideLabels(w, false)).toEqual({ mine: '', theirs: '' });
  });
});
