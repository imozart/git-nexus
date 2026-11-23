import { describe, expect, it } from 'vitest';
import { bulkChoices, buildMerge, emptyChoices, presetPicks, resolveMerge, suggestions } from '../src/pure.js';

// Metas de desempenho do resolvedor (issue #231, fase 7): arquivo de 20 mil linhas com 200 conflitos abre e aceita a primeira decisão em até 1 s e
// cada escolha seguinte atualiza o resultado em até 100 ms. Medidas no motor puro (o que roda no renderer), com folga para a CI mais lenta.
const LINES = 20_000;
const CONFLICTS = 200;
const STEP = LINES / CONFLICTS; // um conflito a cada 100 linhas

function big(): { base: string; mine: string; theirs: string } {
  const base: string[] = [];
  const mine: string[] = [];
  const theirs: string[] = [];
  for (let i = 0; i < LINES; i++) {
    const line = `const linha${i} = ${i}; // trecho ${i % 97}`;
    if (i % STEP === 50) {
      base.push(line);
      mine.push(`${line} // minha`);
      theirs.push(`${line} // da origin`);
    } else {
      base.push(line);
      mine.push(line);
      theirs.push(line);
    }
  }
  return { base: base.join('\n') + '\n', mine: mine.join('\n') + '\n', theirs: theirs.join('\n') + '\n' };
}

const input = big();
const now = () => performance.now();

describe('desempenho do motor de fusão (20 mil linhas, 200 conflitos)', () => {
  it('abre (constrói o modelo) e aceita a primeira decisão em até 1 s', () => {
    const t0 = now();
    const model = buildMerge(input);
    const conflicts = model.segments.filter((s) => s.kind === 'conflict').length;
    const choices = emptyChoices();
    choices.picks[model.segments.findIndex((s) => s.kind === 'conflict')] = presetPicks(model, model.segments.findIndex((s) => s.kind === 'conflict'), 'mine');
    const out = resolveMerge(model, choices);
    const ms = now() - t0;
    expect(conflicts).toBe(CONFLICTS);
    expect(out.lines.length).toBeGreaterThan(LINES - 1);
    expect(ms, `abrir + 1ª decisão: ${ms.toFixed(0)} ms`).toBeLessThan(1000);
  });

  it('cada escolha atualiza o resultado em até 100 ms (mediana de 20 escolhas)', () => {
    const model = buildMerge(input);
    const idx = model.segments.flatMap((s, i) => (s.kind === 'conflict' ? [i] : []));
    const choices = emptyChoices();
    const times: number[] = [];
    for (const i of idx.slice(0, 20)) {
      const t0 = now();
      choices.picks[i] = presetPicks(model, i, 'both');
      resolveMerge(model, choices);
      times.push(now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)] ?? 0;
    expect(median, `mediana por escolha: ${median.toFixed(1)} ms`).toBeLessThan(100);
  });

  it('"aceitar tudo" nos 200 conflitos e a classificação dos simples cabem em 1 s cada', () => {
    const model = buildMerge(input);
    let t0 = now();
    const all = resolveMerge(model, bulkChoices(model, { conflicts: 'theirs', changes: 'theirs' }));
    const bulk = now() - t0;
    expect(all.text.includes('<<<<<<<')).toBe(false);
    t0 = now();
    suggestions(model);
    const classify = now() - t0;
    expect(bulk, `em massa: ${bulk.toFixed(0)} ms`).toBeLessThan(1000);
    expect(classify, `classificar: ${classify.toFixed(0)} ms`).toBeLessThan(1000);
  });
});
