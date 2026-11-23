// Eficácia do resolvedor sobre conflitos reais (issue #231, fase 7): dado um merge do histórico, reconstrói o conflito com `git merge-tree` e compara o que a
// tela comporia SEM digitar nada com a resolução humana do commit de merge. Conta quantos conflitos foram resolvidos só com seleção de linhas (de mim, da
// que chega ou da base) e lista os que exigiram texto digitado, que é o material para melhorar o motor.
import { execFileSync } from 'node:child_process';
import { buildMerge, diffHunks, emptyChoices, resolveMerge, splitLines, type MergeModel, type PickedLine } from '@git-nexus/git-core/pure';
import { deriveChoices, layoutResult } from '../src/entrypoints/renderer/merge-resolver-core';

export interface CaseResult {
  commit: string;
  file: string;
  conflicts: number;
  /** Conflitos do arquivo resolvidos só com seleção de linhas. */
  bySelection: number;
  /** O arquivo inteiro do merge humano é reproduzido só por escolhas (nada digitado e nada mudado fora dos conflitos). */
  explained: boolean;
  /** Conflitos em que o humano mexeu nas linhas em volta, então não dá para saber o que foi decidido (contam como "não por seleção"). */
  unanchored: number;
  /** Conflitos em que o humano só digitou linhas em branco (separador entre os blocos): candidato a melhoria do motor. */
  blankOnly: number;
  /** Primeiras linhas digitadas, para a lista de casos a melhorar. */
  typed: string[];
}

export interface Efficacy {
  merges: number;
  conflictedFiles: number;
  conflicts: number;
  bySelection: number;
  rate: number;
  cases: CaseResult[];
  /** Arquivos cujo commit de merge ficou com marcadores de conflito (ignorados). */
  withMarkers?: number;
}

type Outcome = { kind: 'selection' } | { kind: 'typed'; typed: string[] } | { kind: 'unanchored' };

/**
 * O que a resolução humana fez em CADA conflito. O arquivo do merge humano pode diferir do merge automático fora dos conflitos (merge com outra base, ajuste
 * à mão), e isso não é "resolver conflito": por isso cada conflito é achado pelas linhas iguais em volta dele (as âncoras) e só o que o humano pôs entre elas
 * é comparado com as linhas das duas versões. `unanchored` = o humano mexeu justo em volta do conflito, não dá para saber o que foi decidido.
 */
function outcomes(model: MergeModel, human: string): Outcome[] {
  const none: Record<number, PickedLine[]> = Object.fromEntries(model.conflicts.map((i) => [i, [] as PickedLine[]]));
  const skeleton = resolveMerge(model, { ...emptyChoices(), picks: none });
  const lay = layoutResult(model, skeleton);
  const base = skeleton.lines.map((l) => l.text);
  const work = splitLines(human).lines;
  // para cada linha igual do esqueleto, a linha do arquivo humano
  const eq = new Map<number, number>();
  let a = 0;
  let b = 0;
  for (const h of diffHunks(base, work)) {
    for (; a < h.aStart; a++, b++) eq.set(a, b);
    a = h.aEnd;
    b = h.bEnd;
  }
  for (; a < base.length; a++, b++) eq.set(a, b);
  const offsets = model.conflicts.map((i) => lay[i]!.offset);

  return model.conflicts.map((idx, n): Outcome => {
    const p = offsets[n]!;
    if (offsets.filter((o) => o === p).length > 1) return { kind: 'unanchored' };
    let left = p === 0 ? -1 : eq.get(p - 1);
    let right = p >= base.length ? work.length : eq.get(p);
    if (left === undefined || right === undefined) return { kind: 'unanchored' };
    const seg = model.segments[idx]!;
    const asPicks = (lines: string[]): PickedLine[] => {
      const used = new Set<string>();
      return lines.map((text): PickedLine => {
        for (const side of ['mine', 'theirs', 'base'] as const) {
          for (let k = seg[side].start; k < seg[side].end; k++) {
            if (model[side].lines[k] === text && !used.has(`${side}:${k}`)) {
              used.add(`${side}:${k}`);
              return { from: side, line: k };
            }
          }
        }
        return { from: 'typed', text };
      });
    };
    // a mesma inserção pode ser descrita deslizando as linhas repetidas das pontas para dentro ou para fora: tenta as duas direções
    const candidates: string[][] = [work.slice(left + 1, right)];
    for (const dir of [-1, 1] as const) {
      let [l, r, gap] = [left, right, candidates[0]!];
      for (let guard = 0; guard < 8; guard++) {
        if (dir === -1) {
          if (l < 0 || !gap.length || work[l] !== gap[gap.length - 1]) break;
          gap = [work[l]!, ...gap.slice(0, -1)];
          l--;
          r--;
        } else {
          if (r >= work.length || !gap.length || work[r] !== gap[0]) break;
          gap = [...gap.slice(1), work[r]!];
          l++;
          r++;
        }
        candidates.push(gap);
      }
    }
    let best: string[] = [];
    for (const gap of candidates) {
      const typed = asPicks(gap).filter((x) => x.from === 'typed');
      if (!typed.length) return { kind: 'selection' };
      if (!best.length) best = typed.map((x) => (x.from === 'typed' ? x.text : ''));
    }
    left = right = 0;
    return { kind: 'typed', typed: best };
  });
}

/** Mede um arquivo: o conflito entre `mine` e `theirs` (com `base`) contra a resolução humana. */
export function measureFile(input: { base: string; mine: string; theirs: string; human: string }, commit = '', file = ''): CaseResult {
  const model = buildMerge({ base: input.base, mine: input.mine, theirs: input.theirs });
  const conflicts = model.conflicts.length;
  if (!conflicts) return { commit, file, conflicts, bySelection: 0, explained: false, unanchored: 0, blankOnly: 0, typed: [] };
  const found = outcomes(model, input.human);
  const typed: string[] = [];
  for (const o of found) if (o.kind === 'typed') typed.push(...o.typed.slice(0, 2).map((x) => x.trim().slice(0, 60)));
  return {
    commit,
    file,
    conflicts,
    bySelection: found.filter((o) => o.kind === 'selection').length,
    explained: deriveChoices(model, input.human) !== null,
    unanchored: found.filter((o) => o.kind === 'unanchored').length,
    blankOnly: found.filter((o) => o.kind === 'typed' && o.typed.every((x) => x.trim() === '')).length,
    typed,
  };
}

export const summarize = (cases: CaseResult[], merges: number): Efficacy => {
  const conflicts = cases.reduce((n, c) => n + c.conflicts, 0);
  const bySelection = cases.reduce((n, c) => n + c.bySelection, 0);
  return { merges, conflictedFiles: cases.length, conflicts, bySelection, rate: conflicts ? bySelection / conflicts : 1, cases };
};

const git = (repo: string, args: string[], input?: string): Buffer => execFileSync('git', args, { cwd: repo, input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
const text = (b: Buffer): string | null => (b.includes(0) ? null : b.toString('utf8'));

/** Percorre os merges do histórico (até `limit`), reconstrói cada conflito com `git merge-tree --write-tree` e mede os arquivos de texto. */
export function measureHistory(repo: string, limit = 400): Efficacy {
  const merges = git(repo, ['rev-list', '--merges', '--parents', `--max-count=${limit}`, 'HEAD']).toString('utf8').split('\n').filter(Boolean);
  const cases: CaseResult[] = [];
  let withMarkers = 0;
  for (const line of merges) {
    const [commit, p1, p2, ...rest] = line.split(' ');
    if (!commit || !p1 || !p2 || rest.length) continue; // só merges de dois pais
    let out: Buffer;
    try {
      out = git(repo, ['merge-tree', '--write-tree', '-z', '--no-messages', p1, p2]);
    } catch (e) {
      const err = e as { status?: number; stdout?: Buffer };
      if (err.status !== 1 || !err.stdout) continue; // 1 = com conflitos; outro código = erro
      out = err.stdout;
    }
    // saída: <tree>\0 e depois "<modo> <objeto> <estágio>\t<caminho>\0" por arquivo em conflito, até um campo vazio
    const parts = out.toString('utf8').split('\0');
    const stages = new Map<string, { 1?: string; 2?: string; 3?: string }>();
    for (const entry of parts.slice(1)) {
      if (entry === '') break;
      const m = /^\d+ ([0-9a-f]+) ([123])\t(.+)$/.exec(entry);
      if (!m) continue;
      const slot = stages.get(m[3]!) ?? {};
      slot[Number(m[2]) as 1 | 2 | 3] = m[1]!;
      stages.set(m[3]!, slot);
    }
    for (const [file, s] of stages) {
      if (!s[2] || !s[3]) continue; // apagado de um lado: não é "linha contra linha"
      let human: Buffer;
      try {
        human = git(repo, ['cat-file', 'blob', `${commit}:${file}`]);
      } catch {
        continue; // o merge humano apagou o arquivo
      }
      const blob = (oid?: string) => (oid ? git(repo, ['cat-file', 'blob', oid]) : Buffer.alloc(0));
      const [base, mine, theirs, h] = [text(blob(s[1])), text(blob(s[2])), text(blob(s[3])), text(human)];
      if (base === null || mine === null || theirs === null || h === null) continue; // binário
      if (/^(<{7}|={7}|>{7})( |$)/m.test(h)) {
        withMarkers++; // o commit de merge ficou com marcadores: ninguém resolveu, não há o que comparar
        continue;
      }
      cases.push(measureFile({ base, mine, theirs, human: h }, commit.slice(0, 8), file));
    }
  }
  return { ...summarize(cases, merges.length), withMarkers };
}
