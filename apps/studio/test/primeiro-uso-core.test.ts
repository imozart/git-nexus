// Primeiro uso, dicas, folha de atalhos e "Novidades" (#288): as contas puras.
import { describe, expect, it } from 'vitest';
import { CHANGELOG_SEEN_KEY, compareVersions, newVersions, parseSemver } from '../src/entrypoints/renderer/changelog-new-core';
import { buildSheet, questionMarkOpensSheet, sheetCount } from '../src/entrypoints/renderer/shortcuts-sheet-core';
import { TOUR_STEPS, nextStep, parseTourState, placeCard, prevStep, shouldAutoStart } from '../src/entrypoints/renderer/tour-core';
import { canShowTip, isStashForgotten, oldestStashDays, parseDismissed } from '../src/entrypoints/renderer/tips-core';

describe('passeio', () => {
  it('são cinco passos, cada um com um controle destacado, título e texto', () => {
    expect(TOUR_STEPS).toHaveLength(5);
    for (const s of TOUR_STEPS) expect(s.target).toMatch(/^\[data-tour="[a-z]+"\]$/);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(5);
  });

  it('o estado gravado: vazio, torto ou fora do roteiro volta ao começo, sem quebrar', () => {
    expect(parseTourState(null)).toEqual({ done: false, step: 0 });
    expect(parseTourState('{não é json')).toEqual({ done: false, step: 0 });
    expect(parseTourState('[1]')).toEqual({ done: false, step: 0 });
    expect(parseTourState('{"done":true,"step":3}')).toEqual({ done: true, step: 3 });
    expect(parseTourState('{"done":"sim","step":99}')).toEqual({ done: false, step: 0 });
    expect(parseTourState('{"step":-1}')).toEqual({ done: false, step: 0 });
    expect(parseTourState('{"step":1.5}')).toEqual({ done: false, step: 0 });
  });

  it('começa sozinho só para quem chega: não terminou, idioma escolhido, catálogo lido e vazio', () => {
    const base = { state: { done: false, step: 0 }, askingLocale: false, catalogLoaded: true, repoCount: 0 };
    expect(shouldAutoStart(base)).toBe(true);
    expect(shouldAutoStart({ ...base, state: { done: true, step: 0 } })).toBe(false); // terminou ou pulou: não volta
    expect(shouldAutoStart({ ...base, askingLocale: true })).toBe(false); // primeiro o idioma
    expect(shouldAutoStart({ ...base, catalogLoaded: false })).toBe(false); // sem saber se há repositórios, espera (senão piscaria em quem já tem)
    expect(shouldAutoStart({ ...base, repoCount: 3 })).toBe(false); // quem já usa não é interrompido por uma atualização
    expect(shouldAutoStart({ ...base, state: { done: false, step: 3 } })).toBe(true); // interrompido no meio: continua
  });

  it('Voltar e Próximo não passam das pontas, e depois do último o passeio acaba', () => {
    expect(prevStep(0)).toBe(0);
    expect(prevStep(3)).toBe(2);
    expect(nextStep(0)).toBe(1);
    expect(nextStep(4)).toBeNull();
  });

  it('o cartão fica abaixo do controle, sobe se não couber embaixo, e vai ao centro sem controle; sempre dentro da janela', () => {
    const view = { width: 1000, height: 700 };
    const card = { width: 380, height: 180 };
    const top = placeCard({ left: 40, top: 60, width: 300, height: 40 }, card, view);
    expect(top).toMatchObject({ centered: false });
    expect(top.top).toBeGreaterThan(100);
    expect(top.left).toBeGreaterThanOrEqual(12);
    const bottom = placeCard({ left: 600, top: 640, width: 100, height: 40 }, card, view);
    expect(bottom.top).toBeLessThan(640); // sem espaço embaixo: acima do controle
    const edge = placeCard({ left: 950, top: 40, width: 40, height: 40 }, card, view);
    expect(edge.left + card.width).toBeLessThanOrEqual(view.width - 12);
    const none = placeCard(null, card, view);
    expect(none).toEqual({ left: 310, top: 260, centered: true });
    const huge = placeCard({ left: 0, top: 0, width: 1000, height: 700 }, card, view); // um painel do tamanho da tela
    expect(huge.top + card.height).toBeLessThanOrEqual(view.height);
  });
});

describe('dicas contextuais', () => {
  it('uma por sessão e nunca depois de dispensada', () => {
    expect(canShowTip('a', [], false)).toBe(true);
    expect(canShowTip('a', ['a'], false)).toBe(false);
    expect(canShowTip('b', ['a'], false)).toBe(true);
    expect(canShowTip('b', [], true)).toBe(false); // já houve uma nesta sessão
  });

  it('as dispensadas lidas do armazenamento: torto ou de outro tipo vira "nenhuma"', () => {
    expect(parseDismissed('["a","b"]')).toEqual(['a', 'b']);
    expect(parseDismissed('["a",1,null]')).toEqual(['a']);
    for (const bad of [null, undefined, '', '{', '{"a":1}', '3']) expect(parseDismissed(bad)).toEqual([]);
  });

  it('o stash esquecido: o mais antigo manda, de 30 dias para cima', () => {
    const now = Date.UTC(2026, 10, 26);
    const days = (n: number) => now / 1000 - n * 86_400;
    expect(oldestStashDays([], now)).toBeNull();
    expect(oldestStashDays([{ date: days(2) }, { date: days(45) }, { date: days(10) }], now)).toBe(45);
    expect(oldestStashDays([{ date: days(0.5) }], now)).toBe(0);
    expect(isStashForgotten(null)).toBe(false);
    expect(isStashForgotten(29)).toBe(false);
    expect(isStashForgotten(30)).toBe(true);
  });
});

describe('folha de atalhos', () => {
  const cmds = [
    { id: 'tab.next', title: 'Próxima aba', group: 'Navegação', shortcut: 'Mod+PageDown' },
    { id: 'search.window', title: 'Pesquisar no repositório', group: 'Navegação', shortcut: 'Mod+F', alias: 'Mod+Shift+F', keywords: 'buscar grep' },
    { id: 'go.home', title: 'Ir para a lista', group: 'Navegação' },
    { id: 'app.tour', title: 'Rever o passeio', group: 'App' },
    { id: 'app.palette', title: 'Abrir a paleta', group: 'App', shortcut: 'Mod+K' },
    { id: 'tab.next', title: 'Próxima aba (repetida)', group: 'Navegação', shortcut: 'Mod+PageDown' },
  ];
  const o = { shortcutOf: (c: { shortcut?: string; id: string }) => (c.id === 'go.home' ? 'Mod+1' : c.shortcut), isCustom: (id: string) => id === 'go.home', label: (s: string) => s.replace('Mod', 'Ctrl') };

  it('agrupa por área na ordem em que aparecem, com os que têm atalho primeiro, e sem repetir comando', () => {
    const g = buildSheet(cmds, o);
    expect(g.map((x) => x.name)).toEqual(['Navegação', 'App']);
    expect(g[0]!.items.map((i) => i.id)).toEqual(['go.home', 'search.window', 'tab.next']); // com atalho, por título
    expect(g[1]!.items.map((i) => i.id)).toEqual(['app.palette', 'app.tour']);
    expect(sheetCount(g)).toBe(5);
  });

  it('mostra o atalho que vale agora (o remapeado) e o alias só enquanto não foi remapeado', () => {
    const g = buildSheet(cmds, o).flatMap((x) => x.items);
    expect(g.find((i) => i.id === 'go.home')!.keys).toEqual(['Ctrl+1']); // remapeado: o padrão sumiu
    expect(g.find((i) => i.id === 'search.window')!.keys).toEqual(['Ctrl+F', 'Ctrl+Shift+F']);
    expect(g.find((i) => i.id === 'app.tour')!.keys).toEqual([]);
    const remapped = buildSheet(cmds, { ...o, isCustom: (id) => id === 'search.window' }).flatMap((x) => x.items);
    expect(remapped.find((i) => i.id === 'search.window')!.keys).toEqual(['Ctrl+F']);
  });

  it('a busca acha por título, área, tecla e palavra-chave, sem acento nem maiúscula', () => {
    const ids = (q: string) => buildSheet(cmds, { ...o, query: q }).flatMap((x) => x.items.map((i) => i.id));
    expect(ids('proxima')).toEqual(['tab.next']);
    expect(ids('NAVEGACAO').sort()).toEqual(['go.home', 'search.window', 'tab.next']);
    expect(ids('ctrl+k')).toEqual(['app.palette']);
    expect(ids('grep')).toEqual(['search.window']);
    expect(ids('zzz')).toEqual([]);
  });

  it('"?" abre a folha só fora de campos de texto e do editor, e sem Ctrl/Alt', () => {
    const div = { closest: () => null } as unknown as HTMLElement;
    const input = { closest: (s: string) => (/input/.test(s) ? {} : null) } as unknown as HTMLElement;
    expect(questionMarkOpensSheet({ key: '?', ctrlKey: false, metaKey: false, altKey: false, target: div })).toBe(true);
    expect(questionMarkOpensSheet({ key: '?', ctrlKey: false, metaKey: false, altKey: false, target: input })).toBe(false);
    expect(questionMarkOpensSheet({ key: '?', ctrlKey: true, metaKey: false, altKey: false, target: div })).toBe(false);
    expect(questionMarkOpensSheet({ key: 'a', ctrlKey: false, metaKey: false, altKey: false, target: div })).toBe(false);
  });
});

describe('Novidades: o que é novo', () => {
  it('lê versões e as compara (pré-lançamento antes da estável; beta.10 depois de beta.2)', () => {
    expect(parseSemver('v1.27.0')).toEqual({ core: [1, 27, 0], pre: '' });
    expect(parseSemver('1.27.0-beta.2')).toEqual({ core: [1, 27, 0], pre: 'beta.2' });
    for (const bad of [null, '', 'x', '1.2', '1.2.x']) expect(parseSemver(bad)).toBeNull();
    expect(compareVersions('1.27.0', '1.26.9')).toBeGreaterThan(0);
    expect(compareVersions('1.27.0-beta.1', '1.27.0')).toBeLessThan(0);
    expect(compareVersions('1.27.0-beta.10', '1.27.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.27.0', 'v1.27.0')).toBe(0);
  });

  it('novas = depois da última vista até a que está em uso; sem "última vista", nada é novo', () => {
    const listed = ['1.28.0', '1.27.1', '1.27.0', '1.26.0'];
    expect([...newVersions(listed, '1.26.0', '1.28.0')].sort()).toEqual(['1.27.0', '1.27.1', '1.28.0']);
    expect([...newVersions(listed, '1.27.1', '1.28.0')]).toEqual(['1.28.0']);
    expect([...newVersions(listed, '1.28.0', '1.28.0')]).toEqual([]);
    expect([...newVersions(listed, null, '1.28.0')]).toEqual([]);
    expect([...newVersions(listed, 'lixo', '1.28.0')]).toEqual([]);
    expect([...newVersions(['1.29.0', '1.28.0'], '1.27.0', '1.28.0')]).toEqual(['1.28.0']); // a versão futura (do changelog da main) não conta
    expect(CHANGELOG_SEEN_KEY).toBe('gitnexus.changelogSeen');
  });
});
