import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Os badges do README só valem se mostrarem algo: um badge de workflow que nunca roda na main fica "sem status" para sempre,
// e um que aponta para um arquivo que sumiu vira imagem quebrada. Aqui se confere o que dá para conferir sem rede.
const root = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n');
const readme = read('README.md');
const repo = 'imozart/git-nexus';

const badges = [...readme.matchAll(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g)].map((m) => ({ alt: m[1] ?? '', src: m[2] ?? '' })).filter((b) => /badge|shields\.io/.test(b.src));

describe('badges do README', () => {
  it('há badges, todos com texto alternativo', () => {
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) expect(b.alt.length, b.src).toBeGreaterThan(0);
  });

  it('os badges de workflow apontam para um arquivo que existe', () => {
    for (const b of badges) {
      const m = new RegExp(`github\\.com/${repo}/actions/workflows/([\\w.-]+\\.ya?ml)/badge\\.svg`).exec(b.src);
      if (m) expect(existsSync(join(root, '.github', 'workflows', m[1]!)), m[1]).toBe(true);
    }
  });

  it('o badge de status da main é de um workflow que roda na main (push, agenda ou manual), não só em PR', () => {
    for (const b of badges) {
      const m = new RegExp(`/actions/workflows/([\\w.-]+\\.ya?ml)/badge\\.svg\\?branch=main`).exec(b.src);
      if (!m) continue;
      const on = read(`.github/workflows/${m[1]}`).split(/^on:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
      expect(on, `${m[1]} só roda em pull_request: o badge ficaria sem status`).toMatch(/^\s{2}(push|schedule|workflow_dispatch):/m);
    }
  });

  it('os badges do shields.io apontam para este repositório', () => {
    for (const b of badges.filter((x) => x.src.includes('shields.io/github/'))) expect(b.src, b.src).toContain(repo);
  });

  it('o badge de licença confere com o arquivo LICENSE e o package.json', () => {
    const license = readme.includes('Licença: GPL-3.0');
    expect(license).toBe(true);
    expect(JSON.parse(read('package.json')).license).toBe('GPL-3.0-only');
    expect(read('LICENSE')).toContain('GNU GENERAL PUBLIC LICENSE');
  });
});
