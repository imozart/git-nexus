import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Links relativos entre os documentos: mover ou renomear um arquivo sem atualizar quem aponta para ele deixa o link quebrado em silêncio.
// Confere se o arquivo existe e, quando o link tem âncora (#secao), se o título existe no destino (mesma regra de slug do GitHub).
const root = join(__dirname, '..', '..');

/** Documentos que escrevemos à mão (o CHANGELOG é gerado e só tem links absolutos). */
function markdownFiles(): string[] {
  const files = ['README.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md'].filter((f) => existsSync(join(root, f)));
  for (const f of readdirSync(join(root, 'docs'))) if (f.endsWith('.md')) files.push(`docs/${f}`);
  return files;
}

const read = (file: string) => readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n');

/** Como o GitHub gera a âncora de um título: minúsculas, sem pontuação, espaços viram "-". */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function anchors(file: string): Set<string> {
  const out = new Set<string>();
  let fence = false;
  for (const line of read(file).split('\n')) {
    if (/^```/.test(line)) fence = !fence;
    const m = !fence && /^#{1,6}\s+(.+?)\s*#*$/.exec(line);
    if (m) out.add(slug(m[1]!));
  }
  return out;
}

/** Links `[texto](destino)` fora de blocos de código. Ignora endereços absolutos e e-mails. */
function links(file: string): Array<{ target: string; line: number }> {
  const out: Array<{ target: string; line: number }> = [];
  let fence = false;
  read(file)
    .split('\n')
    .forEach((line, i) => {
      if (/^```/.test(line)) fence = !fence;
      if (fence) return;
      for (const m of line.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)\)/g)) {
        const t = m[1]!;
        if (/^([a-z]+:|\/\/)/i.test(t)) continue;
        out.push({ target: t, line: i + 1 });
      }
    });
  return out;
}

describe('links relativos dos documentos', () => {
  const files = markdownFiles();

  it('há documentos para conferir', () => {
    expect(files).toEqual(expect.arrayContaining(['README.md', 'docs/USO.md', 'docs/DESENVOLVIMENTO.md']));
  });

  for (const file of files) {
    it(`${file}: todo link aponta para um arquivo (e uma seção) que existe`, () => {
      const broken: string[] = [];
      for (const { target, line } of links(file)) {
        const [path, anchor] = target.split('#') as [string, string | undefined];
        const dest = path ? resolve(root, dirname(file), decodeURIComponent(path)) : join(root, file);
        const shown = relative(root, dest).replace(/\\/g, '/');
        if (!existsSync(dest)) {
          broken.push(`${file}:${line} -> ${target} (arquivo "${shown}" não existe)`);
          continue;
        }
        if (anchor && dest.endsWith('.md') && !anchors(shown).has(decodeURIComponent(anchor).toLowerCase())) {
          broken.push(`${file}:${line} -> ${target} (seção "#${anchor}" não existe em ${shown})`);
        }
      }
      expect(broken).toEqual([]);
    });
  }
});
