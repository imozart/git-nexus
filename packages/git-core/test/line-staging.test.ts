import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDiscard, applyStage, blockRows, diffLines, getFileSides, runGit, splitLines, writeIndexContent } from '../src/index.js';

const rowsOf = (a: string, b: string) => diffLines(splitLines(a).lines, splitLines(b).lines);

describe('applyStage (puro)', () => {
  const a = 'um\ndois\ntres\nquatro\n';
  const b = 'um\nDOIS\ntres\nQUATRO\nextra\n';
  const opts = { eol: '\n' as const, endsWithNewline: true };

  it('sem nada aceito, devolve a versão antiga; aceitando tudo, a nova', () => {
    const rows = rowsOf(a, b);
    expect(applyStage(rows, new Set(), opts)).toBe(a);
    expect(applyStage(rows, new Set(rows.keys()), opts)).toBe(b);
  });

  it('aceita só uma linha ou um bloco', () => {
    const rows = rowsOf(a, b);
    const blocks = [...new Set(rows.filter((r) => r.block >= 0).map((r) => r.block))];
    expect(blocks.length).toBe(2);
    expect(applyStage(rows, new Set(blockRows(rows, blocks[0]!)), opts)).toBe('um\nDOIS\ntres\nquatro\n');
    const extra = rows.findIndex((r) => r.newText === 'extra');
    expect(applyStage(rows, new Set([extra]), opts)).toBe('um\ndois\ntres\nquatro\nextra\n');
  });

  it('remoções: aceitar remove a linha, não aceitar mantém', () => {
    const rows = rowsOf('x\ny\nz\n', 'x\nz\n');
    const del = rows.findIndex((r) => r.kind === 'del');
    expect(applyStage(rows, new Set([del]), opts)).toBe('x\nz\n');
    expect(applyStage(rows, new Set(), opts)).toBe('x\ny\nz\n');
  });

  it('é o inverso do descarte: stage + descarte do resto reproduz a versão nova', () => {
    const rows = rowsOf(a, b);
    const some = new Set([1]);
    const rest = new Set([...rows.keys()].filter((i) => !some.has(i)));
    // o que NÃO foi aceito, aplicado sobre a versão nova com descarte, equivale ao que foi aceito sobre a antiga
    expect(applyDiscard(rows, rest, opts)).toBe(applyStage(rows, some, opts));
  });
});

describe('stage por linha no índice (repositório real)', () => {
  let repo: string;
  const git = (...a: string[]) => runGit(repo, a);
  const cached = async () => (await git('diff', '--cached')).stdout;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), 'gitnexus-lines-'));
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'T');
    await git('config', 'user.email', 't@e.com');
    await git('config', 'commit.gpgsign', 'false');
    await git('config', 'core.autocrlf', 'false');
    writeFileSync(join(repo, 'f.txt'), 'um\ndois\ntres\nquatro\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('inclui só uma linha no stage e deixa o disco intacto', async () => {
    const wt = 'um\nDOIS\ntres\nQUATRO\n';
    writeFileSync(join(repo, 'f.txt'), wt);
    const s = await getFileSides(repo, 'f.txt', 'index');
    const rows = diffLines(splitLines(s.oldText).lines, splitLines(s.newText).lines);
    const idx = rows.findIndex((r) => r.newText === 'DOIS');
    await writeIndexContent(repo, 'f.txt', applyStage(rows, new Set([idx]), { eol: '\n', endsWithNewline: true }));

    const d = await cached();
    expect(d).toContain('+DOIS');
    expect(d).not.toContain('QUATRO');
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe(wt); // working tree não mudou
    // o que sobrou pendente é exatamente a outra linha
    const pend = await getFileSides(repo, 'f.txt', 'index');
    const rest = diffLines(splitLines(pend.oldText).lines, splitLines(pend.newText).lines).filter((r) => r.block >= 0);
    expect(rest.map((r) => r.newText)).toEqual(['QUATRO']);
  });

  it('tira uma linha do stage (unstage por linha) revertendo o índice para o HEAD', async () => {
    const s = await getFileSides(repo, 'f.txt', 'staged'); // HEAD x índice
    const rows = diffLines(splitLines(s.oldText).lines, splitLines(s.newText).lines);
    await writeIndexContent(repo, 'f.txt', applyDiscard(rows, new Set(rows.keys()), { eol: '\n', endsWithNewline: true }));
    expect((await cached()).trim()).toBe('');
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('um\nDOIS\ntres\nQUATRO\n');
  });

  it('arquivo novo: inclui parte das linhas e depois esvazia o stage', async () => {
    writeFileSync(join(repo, 'novo.txt'), 'a\nb\nc\n');
    const s = await getFileSides(repo, 'novo.txt', 'index'); // índice vazio x working tree
    expect(s.isNew).toBe(true);
    const rows = diffLines(splitLines(s.oldText).lines, splitLines(s.newText).lines);
    await writeIndexContent(repo, 'novo.txt', applyStage(rows, new Set([0, 2]), { eol: '\n', endsWithNewline: true }));
    expect((await git('show', ':novo.txt')).stdout).toBe('a\nc\n');
    expect((await git('status', '--porcelain')).stdout).toContain('AM novo.txt');

    await writeIndexContent(repo, 'novo.txt', ''); // nada mais no stage: remove a entrada
    expect((await git('ls-files', '--', 'novo.txt')).stdout.trim()).toBe('');
    expect(readFileSync(join(repo, 'novo.txt'), 'utf8')).toBe('a\nb\nc\n');
  });

  it('rejeita caminhos fora do repositório', async () => {
    await expect(writeIndexContent(repo, '../fora.txt', 'x')).rejects.toThrow();
  });
});
