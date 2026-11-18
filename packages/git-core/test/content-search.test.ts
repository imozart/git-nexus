import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_CONTENT_MATCHES, getFileContext, matchRanges, parseGrepOutput, runGit, searchContent } from '../src/index.js';

let root: string;
let dir: string;
const g = (...a: string[]) => runGit(dir, a);

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-grep-'));
  dir = join(root, 'repo');
  await runGit(root, ['init', '-b', 'main', dir]);
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']] as const) await g('config', k, v);
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'src', 'app.ts'), 'export function saudacao(nome: string) {\n  return `Olá, ${nome}`;\n}\n// TODO: revisar saudacao\n');
  writeFileSync(join(dir, 'src', 'util.ts'), 'export const SAUDACAO_PADRAO = "oi";\nexport const x = 1;\n');
  writeFileSync(join(dir, 'docs', 'leia.md'), '# Saudação\n\nA função saudacao diz olá.\n');
  writeFileSync(join(dir, 'crlf.txt'), 'primeira saudacao\r\nsegunda\r\n');
  writeFileSync(join(dir, 'latin1.txt'), Buffer.from('caf\xe9 saudacao\n', 'latin1'));
  writeFileSync(join(dir, 'binario.bin'), Buffer.from([0, 1, 2, 0x73, 0x61, 0x75, 0x64, 0x61, 0x63, 0x61, 0x6f, 0]));
  writeFileSync(join(dir, '.gitignore'), 'ignorado.txt\n');
  await g('add', '.');
  await g('commit', '-qm', 'feat: base');
  writeFileSync(join(dir, 'novo.txt'), 'arquivo novo com saudacao\n'); // não rastreado
  writeFileSync(join(dir, 'ignorado.txt'), 'saudacao no ignorado\n'); // ignorado
  writeFileSync(join(dir, 'src', 'app.ts'), 'export function saudacao(nome: string) {\n  return `Olá, ${nome}`;\n}\n// TODO: revisar saudacao\n// alterado agora: saudacao\n'); // modificado e não commitado
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const files = (r: Awaited<ReturnType<typeof searchContent>>) => [...new Set(r.matches.map((m) => m.file))].sort();

describe('searchContent', () => {
  it('acha no conteúdo, com arquivo e linha, e vê as alterações ainda não commitadas', async () => {
    const r = await searchContent(dir, { pattern: 'saudacao' });
    expect(r.ok).toBe(true);
    const app = r.matches.filter((m) => m.file === 'src/app.ts');
    expect(app.map((m) => m.line)).toEqual([1, 4, 5]);
    expect(app[2]!.text).toBe('// alterado agora: saudacao');
  });

  it('inclui arquivo novo não rastreado, não inclui o ignorado nem o binário', async () => {
    const f = files(await searchContent(dir, { pattern: 'saudacao' }));
    expect(f).toContain('novo.txt');
    expect(f).not.toContain('ignorado.txt');
    expect(f).not.toContain('binario.bin');
  });

  it('por padrão não diferencia maiúsculas; com caseSensitive diferencia', async () => {
    const livre = files(await searchContent(dir, { pattern: 'SAUDACAO' }));
    expect(livre).toContain('src/util.ts');
    expect(livre).toContain('src/app.ts');
    expect(files(await searchContent(dir, { pattern: 'SAUDACAO', caseSensitive: true }))).toEqual(['src/util.ts']);
  });

  it('palavra inteira: "saudacao" não casa dentro de SAUDACAO_PADRAO nem de outra palavra', async () => {
    writeFileSync(join(dir, 'palavras.txt'), 'saudacaoX\nsaudacao\n_saudacao\n');
    const r = await searchContent(dir, { pattern: 'saudacao', wholeWord: true, paths: 'palavras.txt' });
    expect(r.matches.map((m) => m.line)).toEqual([2]);
  });

  it('texto comum: caracteres de regex valem como texto; modo regex interpreta', async () => {
    writeFileSync(join(dir, 'regex.txt'), 'a.b\naxb\nf(x)\n');
    expect((await searchContent(dir, { pattern: 'a.b', paths: 'regex.txt' })).matches.map((m) => m.line)).toEqual([1]);
    expect((await searchContent(dir, { pattern: 'a.b', regex: true, paths: 'regex.txt' })).matches.map((m) => m.line)).toEqual([1, 2]);
    expect((await searchContent(dir, { pattern: 'f(x)', paths: 'regex.txt' })).matches.map((m) => m.line)).toEqual([3]);
  });

  it('expressão regular inválida não lança: devolve ok=false com a explicação', async () => {
    const r = await searchContent(dir, { pattern: 'a(', regex: true });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/inválida|Invalid/i);
    expect(r.matches).toEqual([]);
  });

  it('filtro de caminhos: pasta, extensão e vários juntos', async () => {
    expect(files(await searchContent(dir, { pattern: 'saudacao', paths: 'docs/' }))).toEqual(['docs/leia.md']);
    expect(files(await searchContent(dir, { pattern: 'saudacao', paths: '*.md' }))).toEqual(['docs/leia.md']);
    expect(files(await searchContent(dir, { pattern: 'saudacao', paths: '*.md *.ts' }))).toEqual(['docs/leia.md', 'src/app.ts', 'src/util.ts']);
  });

  it('sem resultado: ok com lista vazia (não é erro)', async () => {
    const r = await searchContent(dir, { pattern: 'texto-que-nao-existe-em-lugar-nenhum' });
    expect(r).toEqual({ ok: true, matches: [], files: 0, truncated: false });
  });

  it('texto vazio não roda a busca', async () => {
    expect((await searchContent(dir, { pattern: '   ' })).matches).toEqual([]);
  });

  it('texto que começa com "-" é procurado como texto (não vira opção do git)', async () => {
    writeFileSync(join(dir, 'traco.txt'), 'use --force-with-lease aqui\n');
    const r = await searchContent(dir, { pattern: '--force-with-lease' });
    expect(r.ok).toBe(true);
    expect(files(r)).toContain('traco.txt');
  });

  it('um filtro de caminho que parece opção não vira opção do git', async () => {
    const r = await searchContent(dir, { pattern: 'saudacao', paths: '--no-index' });
    expect(r.matches).toEqual([]);
  });

  it('o fim de linha CRLF não vai junto no texto', async () => {
    const r = await searchContent(dir, { pattern: 'primeira', paths: 'crlf.txt' });
    expect(r.matches[0]!.text).toBe('primeira saudacao');
  });

  it('texto longo (arquivo minificado) é cortado, e o texto procurado também tem limite', async () => {
    writeFileSync(join(dir, 'min.js'), 'x'.repeat(5000) + 'saudacao' + 'y'.repeat(5000) + '\n');
    const r = await searchContent(dir, { pattern: 'saudacao', paths: 'min.js' });
    expect(r.matches[0]!.text.length).toBeLessThanOrEqual(301);
    expect((await searchContent(dir, { pattern: 'a'.repeat(501) })).ok).toBe(false);
  });

  it('limita o número de ocorrências e avisa que havia mais', async () => {
    writeFileSync(join(dir, 'muitas.txt'), 'repetida\n'.repeat(MAX_CONTENT_MATCHES + 50));
    const r = await searchContent(dir, { pattern: 'repetida', paths: 'muitas.txt' });
    expect(r.matches).toHaveLength(MAX_CONTENT_MATCHES);
    expect(r.truncated).toBe(true);
    expect(r.files).toBe(1);
  });

  it('nomes de arquivo com espaço e acento saem inteiros', async () => {
    writeFileSync(join(dir, 'relatório final.txt'), 'conteudo-unico-xyz\n');
    const r = await searchContent(dir, { pattern: 'conteudo-unico-xyz' });
    expect(r.matches[0]!.file).toBe('relatório final.txt');
  });
});

describe('parseGrepOutput', () => {
  it('lê arquivo NUL linha NUL texto, ignora linhas quebradas e linha zero', () => {
    const out = 'a.ts\x003\x00texto: com dois pontos\nb.ts\x0010\x00\nlixo sem separador\nc.ts\x000\x00zero\n';
    expect(parseGrepOutput(out).matches).toEqual([
      { file: 'a.ts', line: 3, text: 'texto: com dois pontos' },
      { file: 'b.ts', line: 10, text: '' },
    ]);
  });
});

describe('matchRanges (destaque)', () => {
  it('texto comum: acha todas as ocorrências, sem diferenciar maiúsculas', () => {
    expect(matchRanges('Foo foo FOO', { pattern: 'foo' })).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(matchRanges('Foo foo FOO', { pattern: 'foo', caseSensitive: true })).toEqual([[4, 7]]);
  });
  it('palavra inteira e regex', () => {
    expect(matchRanges('foo foobar', { pattern: 'foo', wholeWord: true })).toEqual([[0, 3]]);
    expect(matchRanges('a1 b22', { pattern: '[a-z]\\d+', regex: true })).toEqual([[0, 2], [3, 6]]);
  });
  it('caracteres especiais no texto comum não quebram; regex inválida não destaca nada; casamento vazio não trava', () => {
    expect(matchRanges('f(x) a.b', { pattern: '(x)' })).toEqual([[1, 4]]);
    expect(matchRanges('abc', { pattern: '(', regex: true })).toEqual([]);
    expect(matchRanges('abc', { pattern: 'x*', regex: true })).toEqual([]);
    expect(matchRanges('', { pattern: 'x' })).toEqual([]);
  });
});

describe('getFileContext', () => {
  it('devolve as linhas ao redor, com o número da primeira', async () => {
    const c = await getFileContext(dir, 'src/app.ts', 4, 2);
    expect(c.start).toBe(2);
    expect(c.line).toBe(4);
    expect(c.lines).toEqual(['  return `Olá, ${nome}`;', '}', '// TODO: revisar saudacao', '// alterado agora: saudacao']);
  });

  it('no começo e no fim do arquivo não passa dos limites; linha fora do arquivo é ajustada', async () => {
    const c = await getFileContext(dir, 'src/util.ts', 1, 5);
    expect(c.start).toBe(1);
    expect(c.lines[0]).toBe('export const SAUDACAO_PADRAO = "oi";');
    const fim = await getFileContext(dir, 'src/util.ts', 999, 1);
    expect(fim.line).toBe(fim.total);
  });

  it('lê arquivo em Windows-1252 com os acentos certos e arquivo CRLF sem sobras', async () => {
    expect((await getFileContext(dir, 'latin1.txt', 1, 0)).lines[0]).toBe('café saudacao');
    expect((await getFileContext(dir, 'crlf.txt', 1, 1)).lines.slice(0, 2)).toEqual(['primeira saudacao', 'segunda']);
  });

  it('recusa caminho fora do repositório (.. e absoluto) e arquivo que não existe', async () => {
    await expect(getFileContext(dir, '../fora.txt', 1)).rejects.toThrow(/fora do repositório|outside/i);
    await expect(getFileContext(dir, join(root, 'fora.txt'), 1)).rejects.toThrow(/fora do repositório|outside/i);
    await expect(getFileContext(dir, 'nao-existe.txt', 1)).rejects.toThrow();
  });

  it('recusa um atalho (link simbólico) que aponta para fora do repositório', async () => {
    writeFileSync(join(root, 'segredo.txt'), 'segredo\n');
    try {
      symlinkSync(join(root, 'segredo.txt'), join(dir, 'atalho.txt'));
    } catch {
      return; // sem permissão para criar links neste sistema: nada a verificar
    }
    await expect(getFileContext(dir, 'atalho.txt', 1)).rejects.toThrow(/fora do repositório|outside/i);
  });
});
