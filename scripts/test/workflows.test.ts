import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Regras de consistência dos workflows que o actionlint não cobre (ele valida sintaxe e expressões, não convenções do projeto).
const root = join(__dirname, '..', '..');
const dir = join(root, '.github', 'workflows');
const workflows = readdirSync(dir)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n') }));

/** Trechos de cada job (texto entre um `  nome:` de primeiro nível dentro de `jobs:` e o próximo). */
function jobs(text: string): Array<{ name: string; body: string }> {
  const start = text.indexOf('\njobs:\n');
  if (start < 0) return [];
  const body = text.slice(start + 6);
  const parts = body.split(/^(?=  [A-Za-z0-9_-]+:\s*$)/m).filter((p) => /^  [A-Za-z0-9_-]+:\s*$/m.test(p.split('\n')[0] ?? ''));
  return parts.map((p) => ({ name: (p.split('\n')[0] ?? '').trim().replace(/:$/, ''), body: p }));
}

describe('versão do Node dos workflows', () => {
  const version = readFileSync(join(root, '.node-version'), 'utf8').trim();

  it('.node-version é só o número maior e combina com engines.node do package.json', () => {
    expect(version).toMatch(/^\d+$/);
    const engines = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines.node as string;
    expect(Number(/(\d+)/.exec(engines)![1])).toBe(Number(version));
  });

  it('nenhum workflow fixa a versão do Node: todos leem o .node-version', () => {
    for (const w of workflows) {
      expect(w.text, w.file).not.toMatch(/node-version:\s*['"]?\d/);
    }
    const using = workflows.filter((w) => w.text.includes('node-version-file: .node-version'));
    expect(using.length).toBeGreaterThanOrEqual(5);
  });

  it('o actions/setup-node vem depois do checkout no mesmo job (o arquivo precisa existir)', () => {
    for (const w of workflows) {
      for (const j of jobs(w.text)) {
        const node = j.body.indexOf('node-version-file: .node-version');
        if (node < 0) continue;
        const checkout = j.body.indexOf('actions/checkout');
        expect(checkout, `${w.file} > ${j.name}: sem checkout antes do setup-node`).toBeGreaterThanOrEqual(0);
        expect(checkout, `${w.file} > ${j.name}`).toBeLessThan(node);
      }
    }
  });
});

describe('actions de terceiros nos workflows novos', () => {
  it('usam SHA fixo (com o comentário da versão), nunca uma tag móvel', () => {
    // Os workflows que já existiam na main (ci.yml e release.yml) ainda usam tags móveis; os demais nasceram fixados.
    const legacy = new Set(['ci.yml', 'release.yml']);
    for (const w of workflows.filter((x) => !legacy.has(x.file))) {
      for (const m of w.text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
        const ref = m[1]!;
        if (ref.startsWith('./')) continue;
        expect(ref, `${w.file}: ${ref}`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });
});
