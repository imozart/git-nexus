import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW, MIN_WINDOW, fitWindowState, readWindowState, writeWindowState } from '../src/entrypoints/window-state';

const dir = mkdtempSync(join(tmpdir(), 'gn-winstate-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('arquivo do estado da janela', () => {
  it('ida e volta: grava e lê o mesmo estado (inclusive em pasta que ainda não existe)', () => {
    const f = join(dir, 'sub', 'window-state.json');
    writeWindowState(f, { x: 100, y: 50, width: 1200, height: 800, maximized: true });
    expect(readWindowState(f)).toEqual({ x: 100, y: 50, width: 1200, height: 800, maximized: true });
  });

  it('sem arquivo, JSON quebrado ou campos errados: o padrão de sempre, sem lançar', () => {
    expect(readWindowState(join(dir, 'nao-existe.json'))).toEqual(DEFAULT_WINDOW);
    const quebrado = join(dir, 'quebrado.json');
    writeFileSync(quebrado, '{ isto não é json');
    expect(readWindowState(quebrado)).toEqual(DEFAULT_WINDOW);
    const errado = join(dir, 'errado.json');
    writeFileSync(errado, JSON.stringify({ width: 'larga', height: null }));
    expect(readWindowState(errado)).toEqual(DEFAULT_WINDOW);
  });

  it('posição só vale se x e y são números; maximizado só vale se for true', () => {
    const f = join(dir, 'parcial.json');
    writeFileSync(f, JSON.stringify({ x: 10, width: 1000, height: 700, maximized: 'sim' }));
    expect(readWindowState(f)).toEqual({ width: 1000, height: 700, maximized: false });
  });

  it('gravar onde não dá (um arquivo no lugar da pasta) nunca lança', () => {
    const bloqueio = join(dir, 'arquivo');
    writeFileSync(bloqueio, 'x');
    expect(() => writeWindowState(join(bloqueio, 'dentro', 'w.json'), DEFAULT_WINDOW)).not.toThrow();
    expect(existsSync(join(bloqueio, 'dentro'))).toBe(false);
  });
});

describe('fitWindowState: ajusta às telas de agora', () => {
  const tela = { x: 0, y: 0, width: 1920, height: 1040 };

  it('posição que cabe na tela é mantida', () => {
    expect(fitWindowState({ x: 200, y: 100, width: 1300, height: 800, maximized: false }, [tela])).toEqual({ x: 200, y: 100, width: 1300, height: 800, maximized: false });
  });

  it('o monitor onde ela estava sumiu: a posição é descartada (o sistema centraliza) e o tamanho fica', () => {
    // estava num segundo monitor à direita (x > 1920), que não existe mais
    const r = fitWindowState({ x: 2500, y: 100, width: 1300, height: 800, maximized: true }, [tela]);
    expect(r).toEqual({ width: 1300, height: 800, maximized: true });
  });

  it('com dois monitores, uma posição no segundo vale; fora de todos, não', () => {
    const dois = [tela, { x: 1920, y: 0, width: 1280, height: 1024 }];
    expect(fitWindowState({ x: 2000, y: 20, width: 1000, height: 700, maximized: false }, dois).x).toBe(2000);
    expect(fitWindowState({ x: 3400, y: 20, width: 1000, height: 700, maximized: false }, dois).x).toBeUndefined();
  });

  it('monitor à esquerda com coordenadas negativas', () => {
    const dois = [tela, { x: -1280, y: 0, width: 1280, height: 1024 }];
    expect(fitWindowState({ x: -1200, y: 40, width: 1000, height: 700, maximized: false }, dois).x).toBe(-1200);
  });

  it('só a ponta da janela aparecendo não conta (não dá para pegar a barra de título)', () => {
    expect(fitWindowState({ x: 1900, y: 100, width: 1300, height: 800, maximized: false }, [tela]).x).toBeUndefined();
  });

  it('tamanho: nunca menor que o mínimo do app nem maior que a maior tela', () => {
    expect(fitWindowState({ width: 300, height: 200, maximized: false }, [tela])).toMatchObject(MIN_WINDOW);
    expect(fitWindowState({ width: 5000, height: 4000, maximized: false }, [tela])).toMatchObject({ width: 1920, height: 1040 });
  });

  it('sem informação de telas, não quebra', () => {
    expect(fitWindowState({ x: 5, y: 5, width: 1000, height: 700, maximized: false }, [])).toMatchObject({ width: 1000, height: 700 });
  });
});
