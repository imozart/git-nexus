// Lista do Grafo (#291): colunas gravadas, chips, avatar, janela virtual e a paleta das lanes (contraste medido nos dois temas).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COLUMN_DEFAULT, COLUMN_MAX, COLUMN_MIN, LANE_COLORS, MESSAGE_MIN, abbreviateChips, avatarOf, clampWidth, commitState, contrastRatio, fitColumns, gridTemplate, laneMetrics, nearEnd, parseColumnPrefs, parseDensity, parseRefs, scrollToRow, visibleColumns, visibleRange,
} from '../src/entrypoints/renderer/graph-core';

describe('colunas', () => {
  it('as larguras ficam entre o mínimo e o máximo; valor torto volta ao padrão', () => {
    expect(clampWidth('author', 5)).toBe(COLUMN_MIN.author);
    expect(clampWidth('author', 9999)).toBe(COLUMN_MAX.author);
    expect(clampWidth('date', 120.4)).toBe(120);
    expect(clampWidth('hash', Number.NaN)).toBe(COLUMN_DEFAULT.hash);
  });

  it('o que está gravado é lido coluna a coluna: o que presta fica, o resto volta ao padrão', () => {
    expect(parseColumnPrefs(null)).toEqual({ widths: COLUMN_DEFAULT, hidden: [] });
    expect(parseColumnPrefs('{não é json')).toEqual({ widths: COLUMN_DEFAULT, hidden: [] });
    const p = parseColumnPrefs(JSON.stringify({ widths: { author: 250, date: 'x', hash: 5 }, hidden: ['date', 'inventada', 'author'] }));
    expect(p.widths).toEqual({ author: 250, date: COLUMN_DEFAULT.date, hash: COLUMN_MIN.hash });
    expect(p.hidden).toEqual(['author', 'date']); // na ordem fixa, só as que existem
  });

  it('a grade tem o traçado, a mensagem flexível e só as colunas visíveis, na ordem fixa', () => {
    const p = parseColumnPrefs(JSON.stringify({ hidden: ['date'] }));
    expect(visibleColumns(p)).toEqual(['author', 'hash']);
    expect(gridTemplate(p, 120.6)).toBe(`121px minmax(${MESSAGE_MIN}px, 1fr) ${COLUMN_DEFAULT.author}px ${COLUMN_DEFAULT.hash}px`);
    expect(gridTemplate(parseColumnPrefs(JSON.stringify({ hidden: ['author', 'date', 'hash'] })), 0)).toBe(`0px minmax(${MESSAGE_MIN}px, 1fr)`);
  });

  it('as colunas que não cabem saem da direita para a esquerda (hash, data, autor), e a mensagem nunca fica abaixo do mínimo', () => {
    const p = parseColumnPrefs(null); // autor 168, data 96, hash 104
    const full = 24 + MESSAGE_MIN + 168 + 96 + 104 + 8 * 4 + 12; // largura que todas pedem
    expect(fitColumns(p, 24, full)).toEqual(['author', 'date', 'hash']);
    expect(fitColumns(p, 24, full - 1)).toEqual(['author', 'date']);
    expect(fitColumns(p, 24, 24 + MESSAGE_MIN + 168 + 8 * 2 + 12)).toEqual(['author']);
    expect(fitColumns(p, 24, 100)).toEqual([]); // janela minúscula: só o traçado e a mensagem
    expect(fitColumns(parseColumnPrefs(JSON.stringify({ hidden: ['date'] })), 24, 5000)).toEqual(['author', 'hash']); // o que a pessoa ocultou continua oculto
    expect(gridTemplate(p, 24, ['author'])).toBe(`24px minmax(${MESSAGE_MIN}px, 1fr) 168px`);
  });

  it('densidade: compacta é o padrão; só "comfortable" muda', () => {
    expect(parseDensity(null)).toBe('compact');
    expect(parseDensity('comfortable')).toBe('comfortable');
    expect(parseDensity('gigante')).toBe('compact');
  });
});

describe('traçado', () => {
  it('cada lane tem 16 px até caber em 190 px; depois as lanes compactam, sem passar de 190 px nem de 5 px', () => {
    expect(laneMetrics(1)).toEqual({ colW: 16, graphW: 24 });
    expect(laneMetrics(11).colW).toBe(16);
    expect(laneMetrics(12).colW).toBe(15); // a partir de 12 lanes
    expect(laneMetrics(20).colW).toBe(9);
    expect(laneMetrics(60).colW).toBe(5);
    for (const n of [1, 5, 12, 19, 38]) expect(laneMetrics(n).graphW).toBeLessThanOrEqual(190 + 8); // acima de 38 lanes o piso de 5 px por lane manda
    expect(laneMetrics(0).colW).toBe(16);
  });

  it('as cores das lanes passam de 3:1 sobre todos os fundos do tema (elemento gráfico), nos dois temas', () => {
    const tokens = readFileSync(join(__dirname, '..', '..', 'ui-kit', 'src', 'styles', 'tokens.scss'), 'utf8');
    const grab = (block: string, name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];
    const light = tokens.slice(tokens.indexOf(":root[data-theme='light']"));
    const dark = tokens.slice(0, tokens.indexOf(":root[data-theme='light']"));
    for (const [name, block, colors] of [['dark', dark, LANE_COLORS.dark], ['light', light, LANE_COLORS.light]] as const) {
      const bgs = ['--gn-bg', '--gn-surface', '--gn-surface-2'].map((v) => grab(block, v)!);
      expect(bgs.every(Boolean), `fundos do tema ${name}`).toBe(true);
      for (const c of colors) for (const bg of bgs) expect(contrastRatio(c, bg), `${name}: ${c} sobre ${bg}`).toBeGreaterThanOrEqual(3);
    }
    expect(LANE_COLORS.dark).toHaveLength(LANE_COLORS.light.length);
  });

  it('o contraste confere com valores conhecidos (preto sobre branco 21:1, igual 1:1)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });
});

describe('chips', () => {
  it('ordena HEAD, locais, remotas e tags; "feat/x" é local e "origin/x" é remota (pela lista de remotos)', () => {
    const chips = parseRefs(['tag: v1.0', 'origin/main', 'feat/x', 'HEAD -> main'], ['origin']);
    expect(chips.map((c) => [c.kind, c.label])).toEqual([['head', 'main'], ['local', 'feat/x'], ['remote', 'origin/main'], ['tag', 'v1.0']]);
    expect(chips[0]!.full).toBe('HEAD → main');
    expect(chips[3]!.full).toBe('tag v1.0');
  });

  it('um remoto com outro nome (upstream/dev) só é remoto se estiver na lista; HEAD solto é HEAD', () => {
    expect(parseRefs(['upstream/dev'], ['origin'])[0]!.kind).toBe('local');
    expect(parseRefs(['upstream/dev'], ['origin', 'upstream'])[0]!.kind).toBe('remote');
    expect(parseRefs(['HEAD'])[0]).toEqual({ kind: 'head', label: 'HEAD', full: 'HEAD' });
    expect(parseRefs(['', '  '])).toEqual([]);
  });

  it('abrevia depois de três e guarda o resto para o tooltip', () => {
    const chips = parseRefs(['HEAD -> main', 'a', 'b', 'c', 'd', 'tag: t'], []);
    const { shown, hidden } = abbreviateChips(chips, 3);
    expect(shown).toHaveLength(3);
    expect(hidden.map((c) => c.label)).toEqual(['c', 'd', 't']);
    expect(abbreviateChips(chips.slice(0, 3)).hidden).toEqual([]);
  });
});

describe('autor e estado', () => {
  it('iniciais (nome e sobrenome, ou as duas primeiras letras) e cor estável por e-mail', () => {
    expect(avatarOf('Ana Souza Lima').initials).toBe('AL');
    expect(avatarOf('Madonna').initials).toBe('MA');
    expect(avatarOf('  ').initials).toBe('?');
    const a = avatarOf('Ana', 'ANA@E.com');
    expect(avatarOf('Outro Nome', 'ana@e.com').hue).toBe(a.hue); // o e-mail manda, sem diferenciar maiúscula
    expect(avatarOf('Ana', 'bia@e.com').hue).not.toBe(a.hue);
    expect(avatarOf('Ana').hue).toBe(avatarOf('Ana').hue); // sem e-mail, o nome
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThan(360);
  });

  it('merge = dois pais; publicado/local só existe quando o repositório tem remotos', () => {
    expect(commitState({ parents: ['a', 'b'], local: false })).toEqual({ merge: true, published: true });
    expect(commitState({ parents: ['a'], local: true })).toEqual({ merge: false, published: false });
    expect(commitState({ parents: [], local: undefined })).toEqual({ merge: false, published: null });
  });
});

describe('janela virtual', () => {
  it('desenha só as linhas visíveis mais a folga, sem passar dos limites', () => {
    expect(visibleRange(0, 240, 24, 100000)).toEqual({ start: 0, end: 10 + 14 });
    expect(visibleRange(2400, 240, 24, 100000)).toEqual({ start: 100 - 14, end: 100 + 10 + 14 });
    expect(visibleRange(24 * 99_990, 240, 24, 100000).end).toBe(100000);
    expect(visibleRange(-50, 240, 24, 5)).toEqual({ start: 0, end: 5 });
    expect(visibleRange(0, 0, 24, 0)).toEqual({ start: 0, end: 0 });
  });

  it('pede a próxima página quando faltam menos de 60 linhas para o fim do carregado (e nunca sem nada carregado)', () => {
    expect(nearEnd({ end: 130 }, 200)).toBe(false);
    expect(nearEnd({ end: 140 }, 200)).toBe(true);
    expect(nearEnd({ end: 10 }, 0)).toBe(false);
  });

  it('a seleção entra na janela com a menor rolagem', () => {
    expect(scrollToRow(5, 0, 240, 24)).toBeNull(); // já aparece
    expect(scrollToRow(20, 0, 240, 24)).toBe(20 * 24 + 24 - 240); // abaixo: sobe até a base
    expect(scrollToRow(2, 240, 240, 24)).toBe(48); // acima: desce até o topo
  });
});
