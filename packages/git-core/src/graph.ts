// Layout de grafo de commits (algoritmo de "lanes"). Função pura, usada no renderer.
import type { CommitInfo } from './types/ipc.js';

export interface GraphSegment {
  from: number;
  to: number;
}

export interface GraphRow {
  hash: string;
  /** coluna do nó do commit */
  lane: number;
  /** linhas que atravessam a linha inteira (coluna i -> i) */
  through: number[];
  /** da metade superior: coluna `from` (topo) até o nó */
  incoming: GraphSegment[];
  /** do nó até a coluna `to` (base) */
  outgoing: GraphSegment[];
}

export interface GraphLayout {
  rows: GraphRow[];
  /** quantidade máxima de colunas usadas */
  lanes: number;
}

/** `commits` deve estar em ordem topológica (filhos antes dos pais), como `git log --topo-order`. */
export function buildGraph(commits: Pick<CommitInfo, 'hash' | 'parents'>[]): GraphLayout {
  let lanes: (string | null)[] = [];
  let maxLanes = 0;
  const rows: GraphRow[] = [];

  const freeSlot = (): number => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };

  for (const c of commits) {
    const waiting = lanes.reduce<number[]>((acc, h, i) => (h === c.hash ? [...acc, i] : acc), []);
    const lane = waiting[0] ?? freeSlot();
    if (waiting.length === 0) lanes[lane] = c.hash;

    const incoming: GraphSegment[] = waiting.map((from) => ({ from, to: lane }));
    const through: number[] = [];
    lanes.forEach((h, i) => {
      if (h !== null && h !== c.hash) through.push(i);
    });

    const next = [...lanes];
    for (const i of waiting) next[i] = null;
    next[lane] = null;
    lanes = next;

    const outgoing: GraphSegment[] = [];
    c.parents.forEach((p, idx) => {
      const existing = lanes.indexOf(p);
      if (existing !== -1) {
        outgoing.push({ from: lane, to: existing });
      } else {
        const slot = idx === 0 ? lane : freeSlot();
        lanes[slot] = p;
        outgoing.push({ from: lane, to: slot });
      }
    });

    maxLanes = Math.max(maxLanes, lane + 1, ...incoming.map((s) => s.from + 1), ...outgoing.map((s) => s.to + 1), ...through.map((t) => t + 1));
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ hash: c.hash, lane, through, incoming, outgoing });
  }
  return { rows, lanes: maxLanes };
}
