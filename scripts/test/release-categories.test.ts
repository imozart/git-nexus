import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { SECTIONS } from '../lib/release-core.mjs';

const root = join(__dirname, '..', '..');
const text = readFileSync(join(root, '.github', 'release.yml'), 'utf8').replace(/\r\n/g, '\n');
const catalog = new Set((JSON.parse(readFileSync(join(root, '.github', 'labels.json'), 'utf8')) as Array<{ name: string }>).map((l) => l.name));

/** Lê as categorias do .github/release.yml (formato fixo e simples: `- title:` seguido de `labels:` com itens). */
function categories(): Array<{ title: string; labels: string[] }> {
  const out: Array<{ title: string; labels: string[] }> = [];
  for (const block of text.split(/^ {4}- title: /m).slice(1)) {
    const [title, ...rest] = block.split('\n');
    const labels = [...rest.join('\n').matchAll(/^ {8}- '?([^'\n]+)'?$/gm)].map((m) => m[1]);
    out.push({ title: title.trim(), labels });
  }
  return out;
}

describe('.github/release.yml', () => {
  it('tem as mesmas seções, na mesma ordem e com os mesmos títulos das notas do pipeline', () => {
    expect(categories().map((c) => c.title)).toEqual(SECTIONS.map((s: { title: string }) => s.title));
  });

  it('toda label citada existe no catálogo (a última categoria pega o resto com "*")', () => {
    for (const c of categories()) for (const l of c.labels) if (l !== '*') expect(catalog.has(l), l).toBe(true);
    expect(categories().at(-1)?.labels).toEqual(['*']);
  });

  it('cada label de tipo cai em exatamente uma categoria', () => {
    const all = categories().flatMap((c) => c.labels).filter((l) => l !== '*');
    expect(new Set(all).size).toBe(all.length);
    for (const l of ['enhancement', 'bug', 'documentation', 'performance', 'refatoração', 'testes', 'build', 'ci', 'estilo', 'chore', 'reversão', 'breaking change']) {
      expect(all, l).toContain(l);
    }
  });
});
