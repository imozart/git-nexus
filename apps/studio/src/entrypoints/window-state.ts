// Tamanho, posição e estado maximizado da janela, lembrados entre as aberturas (`<dados>/window-state.json`). Sem Electron aqui dentro:
// quem conhece as telas (`screen`) passa as áreas de trabalho, e o arquivo é lido/gravado de forma que NUNCA impeça o app de abrir.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { clampZoom } from './zoom';

export interface WindowState {
  /** Canto superior esquerdo; ausente = deixa o sistema posicionar (centro). */
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
  /** Zoom da interface (1 = 100 %), lembrado junto com a janela. Ausente = 100 %. */
  zoom?: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** O que o app sempre fez antes de lembrar o estado. */
export const DEFAULT_WINDOW: WindowState = { width: 1360, height: 860, maximized: false };
export const MIN_WINDOW = { width: 960, height: 600 };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Lê o arquivo; qualquer problema (não existe, JSON quebrado, campos de tipo errado) devolve o padrão. */
export function readWindowState(file: string): WindowState {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (!isNum(raw.width) || !isNum(raw.height)) return { ...DEFAULT_WINDOW };
    return {
      width: Math.round(raw.width),
      height: Math.round(raw.height),
      maximized: raw.maximized === true,
      ...(isNum(raw.x) && isNum(raw.y) ? { x: Math.round(raw.x), y: Math.round(raw.y) } : {}),
      ...(isNum(raw.zoom) ? { zoom: clampZoom(raw.zoom) } : {}),
    };
  } catch {
    return { ...DEFAULT_WINDOW };
  }
}

/** Grava o estado. Nunca lança (sem permissão ou disco cheio: a janela só não é lembrada). */
export function writeWindowState(file: string, state: WindowState): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state), 'utf8');
  } catch {
    /* tudo bem: só não lembra */
  }
}

/** Quanto da janela precisa aparecer em alguma tela para ela contar como "visível" (dá para agarrar a barra de título e arrastar). */
const VISIBLE_W = 120;
const VISIBLE_H = 60;

function overlap(a: Rect, b: Rect): { w: number; h: number } {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { w: Math.max(0, w), h: Math.max(0, h) };
}

/**
 * Ajusta o estado salvo às telas de agora: o monitor onde a janela estava pode não existir mais (notebook sem o externo, resolução trocada).
 *  - tamanho: nunca menor que o mínimo do app nem maior que a maior área de trabalho;
 *  - posição: se a janela não aparece (o bastante) em nenhuma tela, a posição é descartada e o sistema centraliza.
 */
export function fitWindowState(state: WindowState, workAreas: Rect[]): WindowState {
  const areas = workAreas.length ? workAreas : [{ x: 0, y: 0, width: 1920, height: 1080 }];
  const maxW = Math.max(...areas.map((a) => a.width));
  const maxH = Math.max(...areas.map((a) => a.height));
  const width = Math.min(Math.max(state.width, MIN_WINDOW.width), Math.max(maxW, MIN_WINDOW.width));
  const height = Math.min(Math.max(state.height, MIN_WINDOW.height), Math.max(maxH, MIN_WINDOW.height));
  const out: WindowState = { width, height, maximized: state.maximized, ...(state.zoom !== undefined ? { zoom: state.zoom } : {}) };
  if (state.x !== undefined && state.y !== undefined) {
    const rect = { x: state.x, y: state.y, width, height };
    const visible = areas.some((a) => {
      const o = overlap(rect, a);
      return o.w >= Math.min(VISIBLE_W, width) && o.h >= Math.min(VISIBLE_H, height);
    });
    if (visible) {
      out.x = state.x;
      out.y = state.y;
    }
  }
  return out;
}
