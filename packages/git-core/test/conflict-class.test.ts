import { describe, expect, it } from 'vitest';
import { buildMerge, emptyChoices, mergeWords, resolveMerge, suggestConflict, suggestions } from '../src/pure.js';

const L = (...l: string[]) => l.join('\n') + '\n';

/** Monta a fusão, confere que há um conflito só e devolve a sugestão e o arquivo que ela produziria. */
function run(base: string, mine: string, theirs: string) {
  const model = buildMerge({ base, mine, theirs });
  expect(model.conflicts).toHaveLength(1);
  const idx = model.conflicts[0]!;
  const s = suggestConflict(model, idx);
  const text = s ? resolveMerge(model, { ...emptyChoices(), picks: { [idx]: s.picks } }).text : null;
  return { model, s, text };
}

describe('conflitos simples: classes', () => {
  it('só espaço: reindentação nas duas versões → a minha', () => {
    const r = run(L('a', 'f();', 'z'), L('a', '    f();', 'z'), L('a', '\tf();', 'z'));
    expect(r.s?.kind).toBe('space');
    expect(r.text).toBe(L('a', '    f();', 'z'));
  });

  it('um lado só reformatou e o outro mudou de verdade → o lado que mudou', () => {
    const r = run(L('a', 'f();', 'z'), L('a', '    f();', 'z'), L('a', 'g();', 'z'));
    expect(r.s?.kind).toBe('reformat');
    expect(r.text).toBe(L('a', 'g();', 'z'));
    const inv = run(L('a', 'f();', 'z'), L('a', 'g();', 'z'), L('a', '  f();', 'z'));
    expect(inv.s?.kind).toBe('reformat');
    expect(inv.text).toBe(L('a', 'g();', 'z'));
  });

  it('um lado apagou o trecho e o outro só reformatou → aceita a remoção', () => {
    const r = run(L('a', 'b', 'z'), L('a', '  b', 'z'), L('a', 'z'));
    expect(r.s?.kind).toBe('removed');
    expect(r.s?.picks).toEqual([]);
    expect(r.text).toBe(L('a', 'z'));
    const inv = run(L('a', 'b', 'z'), L('a', 'z'), L('a', 'b ', 'z'));
    expect(inv.s?.kind).toBe('removed');
    expect(inv.text).toBe(L('a', 'z'));
  });

  it('linhas vizinhas, sem sobreposição → junta as duas edições (o Git marca por vizinhança)', () => {
    const r = run(L('1', '2', '3', '4', '5'), L('1', 'dois', '3', '4', '5'), L('1', '2', 'tres', '4', '5'));
    expect(r.s?.kind).toBe('neighbors');
    expect(r.text).toBe(L('1', 'dois', 'tres', '4', '5'));
    // uma edição e uma remoção vizinhas
    const d = run(L('1', '2', '3', '4', '5'), L('1', '2', '4', '5'), L('1', 'dois', '3', '4', '5'));
    expect(d.model.conflicts).toHaveLength(1);
    expect(d.s?.kind).toBe('neighbors');
    expect(d.text).toBe(L('1', 'dois', '4', '5'));
  });

  it('uma edição e uma linha nova logo depois dela também são vizinhas', () => {
    const r = run(L('a', 'um', 'z'), L('a', 'UM', 'z'), L('a', 'um', 'dois', 'z'));
    expect(r.s?.kind).toBe('neighbors');
    expect(r.text).toBe(L('a', 'UM', 'dois', 'z'));
  });

  it('inserções no mesmo ponto → as duas, na ordem que mantém a lista ordenada (ou a minha primeiro)', () => {
    const base = L('import a', 'import d');
    const r = run(base, L('import a', 'import b', 'import d'), L('import a', 'import c', 'import d'));
    expect(r.s).toMatchObject({ kind: 'insertions', order: 'mine-first' });
    expect(r.text).toBe(L('import a', 'import b', 'import c', 'import d'));
    const inv = run(base, L('import a', 'import c', 'import d'), L('import a', 'import b', 'import d'));
    expect(inv.s).toMatchObject({ kind: 'insertions', order: 'theirs-first' });
    expect(inv.text).toBe(L('import a', 'import b', 'import c', 'import d'));
    // sem lista ordenada: a minha primeiro
    const un = run(L('x', 'y'), L('x', 'um', 'y'), L('x', 'dois', 'y'));
    expect(un.s).toMatchObject({ kind: 'insertions', order: 'mine-first' });
    expect(un.text).toBe(L('x', 'um', 'dois', 'y'));
  });

  it('inserções: não sugere quando juntar repetiria linha, quando são dois arquivos novos ou blocos grandes', () => {
    const dup = run(L('x', 'y'), L('x', 'um', 'comum', 'y'), L('x', 'comum', 'dois', 'y'));
    expect(dup.s).toBeNull();
    const added = buildMerge({ base: '', mine: L('a', 'b'), theirs: L('c', 'd') });
    expect(added.conflicts).toHaveLength(1);
    expect(suggestConflict(added, added.conflicts[0]!)).toBeNull();
    const many = (p: string) => Array.from({ length: 31 }, (_, i) => `${p}${i}`);
    const big = run(L('x', 'y'), L('x', ...many('m'), 'y'), L('x', ...many('t'), 'y'));
    expect(big.s).toBeNull();
  });

  it('pontas opostas da mesma linha → combina por palavra', () => {
    const r = run(L('a', 'const total = price * qty + tax;', 'z'), L('a', 'const total = cost * qty + tax;', 'z'), L('a', 'const total = price * qty + fee;', 'z'));
    expect(r.s?.kind).toBe('words');
    expect(r.s?.picks).toEqual([{ from: 'typed', text: 'const total = cost * qty + fee;' }]);
    expect(r.text).toBe(L('a', 'const total = cost * qty + fee;', 'z'));
  });

  it('várias linhas: onde só um lado mexeu vale o dele, onde os dois mexeram em pontas opostas combina', () => {
    const base = L('a', 'x = 1 + 2;', 'y = 3;', 'z');
    const mine = L('a', 'x = 10 + 2;', 'y = 3;', 'z');
    const theirs = L('a', 'x = 1 + 20;', 'y = 30;', 'z');
    const r = run(base, mine, theirs);
    expect(r.s?.kind).toBe('words');
    expect(r.text).toBe(L('a', 'x = 10 + 20;', 'y = 30;', 'z'));
  });
});

describe('conflitos simples: o que NÃO é sugerido (nunca adivinha)', () => {
  it('os dois mudaram a mesma palavra, ou peças coladas, ou linhas diferentes em número', () => {
    expect(run(L('a', 'x = 1;', 'z'), L('a', 'x = 2;', 'z'), L('a', 'x = 3;', 'z')).s).toBeNull();
    expect(run(L('a', 'f(a)', 'z'), L('a', 'f[a)', 'z'), L('a', 'f(b)', 'z')).s).toBeNull(); // "(" e "a" colados
    expect(run(L('a', 'um', 'dois', 'z'), L('a', 'UM', 'dois', 'z'), L('a', 'z')).s).toBeNull(); // um mudou a linha que o outro apagou, junto com a vizinha
    expect(run(L('a', 'b', 'z'), L('a', 'B', 'z'), L('a', 'C', 'z')).s).toBeNull();
  });

  it('um lado apagou e o outro mudou de verdade: conflito de verdade', () => {
    expect(run(L('a', 'b', 'z'), L('a', 'z'), L('a', 'B', 'z')).s).toBeNull();
  });

  it('uma inserção no meio do que o outro lado reescreveu não é vizinhança', () => {
    const r = run(L('1', '2', '3', '4'), L('1', 'dois', 'três', '4'), L('1', '2', 'novo', '3', '4'));
    expect(r.s).toBeNull();
  });

  it('conflito muito grande não é classificado', () => {
    const many = Array.from({ length: 401 }, (_, i) => `l${i}`);
    const r = run(L('a', ...many, 'z'), L('a', ...many.map((l) => l + 'm'), 'z'), L('a', ...many.map((l) => l + 't'), 'z'));
    expect(r.s).toBeNull();
  });

  it('segmento que não é conflito não tem sugestão, e "suggestions" lista só os conflitos simples', () => {
    const base = L('inicio', 'if (x) {', 'f();', '}', 'meio', 'v = 1', 'fim');
    const mine = L('inicio', 'if (x) {', '    f();', '}', 'meio', 'v = 2', 'fim');
    const theirs = L('inicio', 'if (x) {', '\tf();', '}', 'meio', 'v = 3', 'fim');
    const m = buildMerge({ base, mine, theirs });
    expect(m.conflicts).toHaveLength(2);
    expect(suggestConflict(m, 0)).toBeNull(); // trecho estável
    const all = suggestions(m);
    expect([...all.keys()]).toEqual([m.conflicts[0]]);
    expect(all.get(m.conflicts[0]!)?.kind).toBe('space');
  });
});

describe('mergeWords', () => {
  it('une edições que não se tocam e recusa as que se tocam', () => {
    expect(mergeWords('a b c', 'x b c', 'a b y')).toBe('x b y');
    expect(mergeWords('a b c', 'x b c', 'x b c')).toBe('x b c');
    expect(mergeWords('a b c', 'x b c', 'z b c')).toBeNull();
    expect(mergeWords('a b c', 'a b c', 'a b y')).toBe('a b y');
    expect(mergeWords('foo(a)', 'foo[a)', 'foo(b)')).toBeNull();
    expect(mergeWords('a b', 'a' + ' b'.repeat(2000), 'x b')).toBeNull(); // linha enorme: sem custo extra
  });
});

describe('conflitos simples: oráculo com edições geradas', () => {
  it('duas edições (troca, remoção ou inserção) em pontos vizinhos sempre dão o que aplicar as duas à base daria', () => {
    let seed = 12345;
    const rnd = (n: number) => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) % n;
    type Edit = { at: number; del: number; ins: string[] };
    const apply = (base: string[], edits: Edit[]) => {
      const out: string[] = [];
      let pos = 0;
      for (const e of [...edits].sort((a, b) => a.at - b.at)) {
        out.push(...base.slice(pos, e.at), ...e.ins);
        pos = e.at + e.del;
      }
      return [...out, ...base.slice(pos)];
    };
    let checked = 0;
    for (let n = 0; n < 300; n++) {
      const base = Array.from({ length: 8 }, (_, i) => `base${i}`);
      const at = 1 + rnd(5);
      const a: Edit = { at, del: 1 + rnd(2), ins: Array.from({ length: rnd(3) }, (_, i) => `mine${n}_${i}`) };
      const b: Edit = { at: at + a.del, del: rnd(3), ins: Array.from({ length: rnd(3) }, (_, i) => `theirs${n}_${i}`) };
      if (b.del === 0 && !b.ins.length) continue;
      const model = buildMerge({ base: L(...base), mine: L(...apply(base, [a])), theirs: L(...apply(base, [b])) });
      if (model.conflicts.length !== 1) continue;
      const idx = model.conflicts[0]!;
      const s = suggestConflict(model, idx);
      expect(s, `caso ${n}`).not.toBeNull();
      const text = resolveMerge(model, { ...emptyChoices(), picks: { [idx]: s!.picks } }).text;
      expect(text, `caso ${n}`).toBe(L(...apply(base, [a, b])));
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });
});
