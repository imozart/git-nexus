import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripHtmlComments } from './helpers/html';

describe('stripHtmlComments', () => {
  it('tira comentários simples, vários e de várias linhas', () => {
    expect(stripHtmlComments('a<!-- x -->b<!--\ny\n-->c')).toBe('abc');
    expect(stripHtmlComments('<!---->')).toBe('');
    expect(stripHtmlComments('sem comentário')).toBe('sem comentário');
  });

  it('não deixa um comentário formado pelo próprio corte (o que um replace de uma passada deixa)', () => {
    // `<!<!---->-->`: tirado o de dentro, sobra `<!-->` (sem `-->` depois do `<!--`, não é comentário completo)
    expect(stripHtmlComments('<!<!---->-->')).toBe('<!-->');
    expect(stripHtmlComments('<!-<!---->-- <select> -->')).not.toContain('<select');
    expect(stripHtmlComments('<!-<!---->-- oculto -->visível')).toBe('visível');
  });

  it('comentário sem fim não é cortado (nem trava)', () => {
    expect(stripHtmlComments('a <!-- sem fim <select>')).toBe('a <!-- sem fim <select>');
  });
});

// Guarda contra o alerta `js/incomplete-multi-character-sanitization`: `.replace(/<!--...-->/g, '')` solto deixa `<!--` para trás em entradas
// aninhadas. Quem precisa tirar comentários HTML usa `stripHtmlComments` (helpers/html.ts).
describe('comentários HTML não saem por replace de uma passada', () => {
  const repo = join(__dirname, '..', '..', '..');
  const skip = new Set(['node_modules', 'dist', 'release', 'coverage', '.git']);
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.isDirectory()) return skip.has(e.name) ? [] : sources(join(dir, e.name));
      return /\.(ts|mts|mjs|cjs|js|vue)$/.test(e.name) ? [join(dir, e.name)] : [];
    });
  }

  it('nenhum arquivo usa replace/replaceAll com um padrão de comentário HTML', () => {
    const bad: string[] = [];
    for (const dir of ['apps', 'packages', 'scripts']) {
      for (const f of sources(join(repo, dir))) {
        const rel = relative(repo, f).replace(/\\/g, '/');
        if (rel === 'apps/studio/test/html-comments.test.ts') continue; // este arquivo descreve o padrão
        if (/\.replace(All)?\(\s*\/<!--/.test(readFileSync(f, 'utf8'))) bad.push(rel);
      }
    }
    expect(bad, `Tirar comentários HTML com replace de uma passada deixa \`<!--\` para trás: use stripHtmlComments (apps/studio/test/helpers/html.ts). Arquivos: ${bad.join(', ')}`).toEqual([]);
  });
});
