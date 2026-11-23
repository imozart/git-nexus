import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { measureFile, measureHistory, summarize } from './merge-efficacy-lib';

// Eficácia sobre conflitos reais (issue #231, fase 7): a taxa de conflitos que a tela resolve só com seleção de linhas, comparada com a resolução humana do
// commit de merge. Meta inicial: 80%. Os testes fixos usam um histórico montado aqui; `GN_MEASURE_REPO=<repositório>` mede um histórico de verdade e imprime
// a taxa e a lista dos casos que exigiram digitação (veja docs/DESENVOLVIMENTO.md).

const lines = (...l: string[]) => l.join('\n') + '\n';

describe('medição de um arquivo', () => {
  const base = lines('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i');
  it('a resolução que fica com um lado, com o outro ou com os dois é só seleção', () => {
    const mine = lines('a', 'B', 'c', 'd', 'e', 'f', 'g', 'H', 'i');
    const theirs = lines('a', 'X', 'c', 'd', 'e', 'f', 'g', 'Y', 'i');
    const r = measureFile({ base, mine, theirs, human: lines('a', 'B', 'c', 'd', 'e', 'f', 'g', 'Y', 'i') });
    expect(r).toMatchObject({ conflicts: 2, bySelection: 2, explained: true });
    expect(measureFile({ base, mine, theirs, human: lines('a', 'B', 'X', 'c', 'd', 'e', 'f', 'g', 'H', 'Y', 'i') })).toMatchObject({ conflicts: 2, bySelection: 2 });
  });

  it('texto digitado não conta como seleção e entra na lista de casos', () => {
    const mine = lines('a', 'B', 'c', 'd', 'e', 'f', 'g', 'H', 'i');
    const theirs = lines('a', 'X', 'c', 'd', 'e', 'f', 'g', 'Y', 'i');
    const r = measureFile({ base, mine, theirs, human: lines('a', 'B + X', 'c', 'd', 'e', 'f', 'g', 'H', 'i') });
    expect(r).toMatchObject({ conflicts: 2, bySelection: 1, explained: true });
    expect(r.typed).toEqual(['B + X']);
  });

  it('o que o humano mudou FORA dos conflitos não invalida a escolha feita no conflito (mas o arquivo inteiro deixa de ser reproduzível)', () => {
    const mine = lines('a', 'B', 'c', 'd', 'e', 'f', 'g', 'h', 'i');
    const theirs = lines('a', 'X', 'c', 'd', 'e', 'f', 'g', 'h', 'i');
    const r = measureFile({ base, mine, theirs, human: lines('a', 'B', 'c', 'd', 'e', 'f', 'g', 'MUDOU', 'i') });
    expect(r).toMatchObject({ conflicts: 1, bySelection: 1, explained: false, unanchored: 0 });
  });

  it('quando o humano mexe nas linhas em volta do conflito não dá para saber o que foi decidido: conta como não resolvido por seleção', () => {
    const mine = lines('a', 'B', 'c', 'd', 'e', 'f', 'g', 'h', 'i');
    const theirs = lines('a', 'X', 'c', 'd', 'e', 'f', 'g', 'h', 'i');
    const r = measureFile({ base, mine, theirs, human: lines('a', 'B', 'C', 'd', 'e', 'f', 'g', 'h', 'i') });
    expect(r.bySelection).toBe(0);
  });

  it('sem conflito não há o que medir, e a taxa de nenhum conflito é 100%', () => {
    expect(summarize([], 3).rate).toBe(1);
  });
});

describe('histórico montado: merge-tree reconstrói cada conflito e a taxa sai da comparação com o commit de merge', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gitnexus-eff-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const write = (name: string, c: string) => writeFileSync(join(dir, name), c);
  const commit = (m: string) => {
    git('add', '.');
    git('commit', '-qm', m);
  };
  /** Cria uma branch com `mine` e outra com `theirs` a partir do mesmo ponto e faz o merge, resolvido por `human`. */
  function mergeCase(name: string, baseText: string, mine: string, theirs: string, human: string): void {
    git('checkout', '-q', 'main');
    write(name, baseText);
    commit(`base ${name}`);
    git('checkout', '-q', '-b', `m-${name}`);
    write(name, mine);
    commit(`minha ${name}`);
    git('checkout', '-q', 'main');
    git('checkout', '-q', '-b', `t-${name}`);
    write(name, theirs);
    commit(`origin ${name}`);
    git('checkout', '-q', `m-${name}`);
    try {
      git('merge', '--no-ff', '-q', `t-${name}`);
    } catch {
      /* conflito: é o esperado */
    }
    write(name, human);
    git('add', name);
    git('commit', '-qm', `merge ${name}`);
    git('checkout', '-q', 'main');
    git('merge', '--ff-only', '-q', `m-${name}`);
  }

  it('mede 5 merges: 4 resolvidos por seleção e 1 que precisou digitar', () => {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'eff@example.com');
    git('config', 'user.name', 'Eff');
    git('config', 'commit.gpgsign', 'false');
    git('commit', '--allow-empty', '-qm', 'inicio');
    const b = lines('inicio', 'x = 1', 'meio', 'a', 'b', 'c', 'd', 'fim');
    mergeCase('um.txt', b, lines('inicio', 'x = 2', 'meio', 'a', 'b', 'c', 'd', 'fim'), lines('inicio', 'x = 3', 'meio', 'a', 'b', 'c', 'd', 'fim'), lines('inicio', 'x = 2', 'meio', 'a', 'b', 'c', 'd', 'fim'));
    mergeCase('dois.txt', b, lines('inicio', 'x = 2', 'meio', 'a', 'b', 'c', 'd', 'fim'), lines('inicio', 'x = 3', 'meio', 'a', 'b', 'c', 'd', 'fim'), lines('inicio', 'x = 3', 'meio', 'a', 'b', 'c', 'd', 'fim'));
    mergeCase('tres.txt', b, lines('inicio', 'x = 2', 'meio', 'a', 'b', 'c', 'd', 'fim'), lines('inicio', 'x = 3', 'meio', 'a', 'b', 'c', 'd', 'fim'), lines('inicio', 'x = 2', 'x = 3', 'meio', 'a', 'b', 'c', 'd', 'fim'));
    mergeCase('quatro.txt', b, lines('inicio', 'x = 2', 'meio', 'a', 'b', 'c', 'd', 'fim'), lines('inicio', 'x = 3', 'meio', 'a', 'b', 'c', 'd', 'fim'), lines('inicio', 'x = 3', 'x = 2', 'meio', 'a', 'b', 'c', 'd', 'fim'));
    mergeCase('cinco.txt', b, lines('inicio', 'x = 2', 'meio', 'a', 'b', 'c', 'd', 'fim'), lines('inicio', 'x = 3', 'meio', 'a', 'b', 'c', 'd', 'fim'), lines('inicio', 'x = 2 + 3', 'meio', 'a', 'b', 'c', 'd', 'fim'));
    const eff = measureHistory(dir);
    expect(eff.merges).toBe(5);
    expect(eff.conflictedFiles).toBe(5);
    expect(eff.conflicts).toBe(5);
    expect(eff.bySelection).toBe(4);
    expect(eff.rate).toBeCloseTo(0.8, 5);
    expect(eff.cases.filter((c) => c.typed.length).map((c) => [c.file, c.typed])).toEqual([['cinco.txt', ['x = 2 + 3']]]);
  });
});

// Medição de um histórico de verdade (só quando pedida): GN_MEASURE_REPO=<caminho> [GN_MEASURE_LIMIT=400]
describe.runIf(process.env.GN_MEASURE_REPO)('histórico real', () => {
  it('taxa de conflitos resolvidos só com seleção de linhas', () => {
    const eff = measureHistory(process.env.GN_MEASURE_REPO!, Number(process.env.GN_MEASURE_LIMIT ?? 400));
    const pct = (eff.rate * 100).toFixed(1);
    const notExplained = eff.cases.reduce((n, c) => n + c.unanchored, 0);
    const blank = eff.cases.reduce((n, c) => n + c.blankOnly, 0);
    process.stderr.write(
      `\nEFICACIA merges=${eff.merges} arquivos=${eff.conflictedFiles} conflitos=${eff.conflicts} por-selecao=${eff.bySelection} taxa=${pct}% sem-ancora=${notExplained} so-linha-em-branco=${blank} commits-com-marcador=${eff.withMarkers}\n` +
        eff.cases
          .filter((c) => c.bySelection < c.conflicts)
          .slice(0, 25)
          .map((c) => `  ${c.commit} ${c.file}: ${c.unanchored ? `humano mexeu em volta (${c.unanchored})` : `digitou ${JSON.stringify(c.typed)}`}`)
          .join('\n') +
        '\n',
    );
    expect(eff.conflicts).toBeGreaterThanOrEqual(0);
  }, 1_800_000);
});
