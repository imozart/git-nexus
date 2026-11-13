import { describe, expect, it } from 'vitest';
import { applyChoice, buildGraph, findConflictRegions, hasConflictMarkers } from '../src/pure.js';
import { parsePorcelainV1 } from '../src/status.js';
import { parseWslPath } from '../src/wsl.js';
import { parseLog } from '../src/history.js';

const CONFLICT = ['a', '<<<<<<< HEAD', 'ours1', 'ours2', '=======', 'theirs1', '>>>>>>> feature', 'z', ''].join('\n');
const DIFF3 = ['<<<<<<< HEAD', 'o', '||||||| base', 'b', '=======', 't', '>>>>>>> x', ''].join('\n');

describe('marcadores de conflito', () => {
  it('detecta e ignora texto limpo', () => {
    expect(hasConflictMarkers(CONFLICT)).toBe(true);
    expect(hasConflictMarkers('a\nb\n')).toBe(false);
    expect(hasConflictMarkers('x\n=======\n')).toBe(true);
    expect(hasConflictMarkers('x\r\n<<<<<<< HEAD\r\n')).toBe(true);
  });

  it('extrai regiões ours/theirs e aplica escolhas', () => {
    const [r] = findConflictRegions(CONFLICT);
    expect(r).toBeDefined();
    expect(r!.ours).toBe('ours1\nours2\n');
    expect(r!.theirs).toBe('theirs1\n');
    expect(r!.base).toBeNull();
    expect(applyChoice(CONFLICT, r!, 'ours')).toBe('a\nours1\nours2\nz\n');
    expect(applyChoice(CONFLICT, r!, 'theirs')).toBe('a\ntheirs1\nz\n');
    expect(applyChoice(CONFLICT, r!, 'both')).toBe('a\nours1\nours2\ntheirs1\nz\n');
  });

  it('suporta estilo diff3 (com base)', () => {
    const [r] = findConflictRegions(DIFF3);
    expect(r!.base).toBe('b\n');
    expect(applyChoice(DIFF3, r!, 'base')).toBe('b\n');
  });

  it('resolver todos os blocos remove todos os marcadores', () => {
    let text = CONFLICT + CONFLICT;
    for (let i = findConflictRegions(text).length - 1; i >= 0; i--) text = applyChoice(text, findConflictRegions(text)[i]!, 'theirs');
    expect(hasConflictMarkers(text)).toBe(false);
  });
});

describe('parsePorcelainV1', () => {
  it('separa staged, unstaged e não rastreados', () => {
    const raw = ['## main...origin/main [ahead 1]', 'M  a.ts', ' M b.ts', 'MM c.ts', '?? d.ts', 'R  novo.ts', 'velho.ts', ''].join('\0');
    const s = parsePorcelainV1(raw);
    expect(s.branch).toBe('main');
    expect(s.staged).toEqual(['a.ts', 'c.ts', 'novo.ts']);
    expect(s.unstaged).toEqual(['b.ts', 'c.ts', 'd.ts']);
  });

  it('expõe entradas com X/Y e caminho de origem em renomeações', () => {
    const raw = ['## main', 'MM both.ts', 'A  novo.ts', 'D  gone.ts', 'R  b.ts', 'a.ts', '?? u.txt', ''].join('\0');
    const { entries } = parsePorcelainV1(raw);
    expect(entries).toEqual([
      { path: 'both.ts', x: 'M', y: 'M' },
      { path: 'novo.ts', x: 'A', y: ' ' },
      { path: 'gone.ts', x: 'D', y: ' ' },
      { path: 'b.ts', x: 'R', y: ' ', origPath: 'a.ts' },
      { path: 'u.txt', x: '?', y: '?' },
    ]);
  });

  it('repositório sem commits', () => {
    expect(parsePorcelainV1('## No commits yet on main\0').branch).toBe('main');
  });
});

describe('WSL', () => {
  it('reconhece caminhos UNC do WSL', () => {
    expect(parseWslPath('\\\\wsl$\\Ubuntu\\home\\me\\app')).toEqual({ distro: 'Ubuntu', linuxPath: '/home/me/app' });
    expect(parseWslPath('\\\\wsl.localhost\\Debian\\srv')).toEqual({ distro: 'Debian', linuxPath: '/srv' });
    expect(parseWslPath('C:\\x')).toBeNull();
  });
});

describe('parseLog', () => {
  it('lê registros do git log', () => {
    const rec = ['h1', 'p1 p2', 'Ana', '1700000000', 'HEAD -> main, tag: v1', 'feat: x'].join('\x1f') + '\x1e\n';
    const [c] = parseLog(rec);
    expect(c).toMatchObject({ hash: 'h1', parents: ['p1', 'p2'], author: 'Ana', refs: ['HEAD -> main', 'tag: v1'], subject: 'feat: x' });
  });
});

describe('buildGraph', () => {
  it('histórico linear usa uma coluna', () => {
    const g = buildGraph([
      { hash: 'c', parents: ['b'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] },
    ]);
    expect(g.lanes).toBe(1);
    expect(g.rows.map((r) => r.lane)).toEqual([0, 0, 0]);
  });

  it('merge abre e fecha uma segunda coluna', () => {
    // m (merge de b e c) -> b -> a ; c -> a
    const g = buildGraph([
      { hash: 'm', parents: ['b', 'c'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'c', parents: ['a'] },
      { hash: 'a', parents: [] },
    ]);
    expect(g.lanes).toBe(2);
    expect(g.rows[0]!.outgoing).toEqual([{ from: 0, to: 0 }, { from: 0, to: 1 }]);
    expect(g.rows[2]!.lane).toBe(1);
    expect(g.rows[2]!.outgoing).toEqual([{ from: 1, to: 0 }]); // "c" converge na coluna 0, onde "a" o espera
  });
});
