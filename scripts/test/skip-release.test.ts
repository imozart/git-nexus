import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { SKIP_LABEL, skipRequestedBy } from '../lib/skip-release.mjs';

const root = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8').replace(/\r\n/g, '\n');

describe('skipRequestedBy', () => {
  it('devolve os PRs que têm a label sem-release', () => {
    expect(skipRequestedBy([{ number: 1, labels: ['ci', 'sem-release'] }, { number: 2, labels: ['ci'] }, { number: 3, labels: ['sem-release'] }])).toEqual([1, 3]);
  });

  it('sem PR (push direto, como o chore(release)) ou sem a label, não pula', () => {
    expect(skipRequestedBy([])).toEqual([]);
    expect(skipRequestedBy([{ number: 4, labels: [] }, { number: 5 }])).toEqual([]);
  });

  it('não confunde com labels parecidas', () => {
    expect(skipRequestedBy([{ number: 6, labels: ['sem release', 'skip release', 'release-failure', 'Sem-Release'] }])).toEqual([]);
  });
});

describe('a label no catálogo e na documentação', () => {
  it('sem-release existe em .github/labels.json (o labels-sync a cria)', () => {
    const catalog = JSON.parse(read('.github', 'labels.json')) as Array<{ name: string }>;
    expect(catalog.map((l) => l.name)).toContain(SKIP_LABEL);
  });

  it('os documentos explicam as duas formas de pular', () => {
    for (const f of [['docs', 'LABELS.md'], ['docs', 'CI.md'], ['docs', 'AUTOMATION.md']]) {
      const t = read(...f);
      expect(t, f.join('/')).toContain('sem-release');
      expect(t, f.join('/')).toContain('[skip release]');
    }
  });
});

describe('release.yml usa a label', () => {
  const text = read('.github', 'workflows', 'release.yml');
  const version = text.slice(text.indexOf('\n  version:'), text.indexOf('\n  quality:'));

  it('o job de versão pode ler PRs (pull-requests: read) e continua só com leitura do conteúdo', () => {
    expect(version).toMatch(/permissions:\n {6}contents: read\n {6}pull-requests: read/);
    expect(version).not.toMatch(/pull-requests: write/);
  });

  it('consulta a label só no push e antes de calcular a versão', () => {
    const step = version.slice(version.indexOf('- name: Label sem-release'), version.indexOf('- name: Próxima versão'));
    expect(step).toContain('if: github.event_name == \'push\'');
    expect(step).toContain('run: node scripts/release-skip.mjs');
    expect(step).toContain('GH_TOKEN: ${{ github.token }}');
    expect(version.indexOf('- name: Label sem-release')).toBeLessThan(version.indexOf('- name: Próxima versão'));
  });

  it('com a label, a versão não é calculada e o resto do pipeline é pulado', () => {
    expect(version).toMatch(/id: next\n {8}if: steps\.skip\.outputs\.skip != 'true'/);
    expect(text.slice(text.indexOf('\n  quality:'), text.indexOf('\n  build:'))).toContain("needs.version.outputs.release == 'true'");
  });

  it('o [skip release] no texto continua valendo', () => {
    expect(version).toContain("contains(github.event.head_commit.message, '[skip release]')");
  });
});

// O script de verdade, com um `gh` de mentira no PATH que devolve o que a API devolveria. No Windows o Node não executa um .cmd sem shell,
// então este bloco só roda no Linux/macOS (o CI roda no Linux); a regra em si (skipRequestedBy) é testada em todos os sistemas acima.
describe.skipIf(process.platform === 'win32')('release-skip.mjs', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'release-skip-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const script = join(root, 'scripts', 'release-skip.mjs');

  function run(ghBody: string, extra: Record<string, string> = {}) {
    const bin = mkdtempSync(join(tmp, 'bin-'));
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\n${ghBody}\n`, { mode: 0o755 });
    const out = join(bin, 'out.txt');
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'dono/repo', SHA: 'a'.repeat(40), GITHUB_OUTPUT: out, ...extra };
    const stdout = execFileSync(process.execPath, [script], { env, encoding: 'utf8' });
    let output = '';
    try {
      output = readFileSync(out, 'utf8');
    } catch {
      /* sem saída escrita */
    }
    return { stdout, output };
  }

  const echo = (json: string) => `echo '${json}'`;

  it('PR com a label: skip=true e aviso com o número do PR', () => {
    const r = run(echo('[{"number":63,"labels":["refatoração","sem-release"]}]'));
    expect(r.output).toBe('skip=true\n');
    expect(r.stdout).toContain('#63');
  });

  it('PR sem a label, ou nenhum PR (push direto): skip=false', () => {
    expect(run(echo('[{"number":64,"labels":["enhancement"]}]')).output).toBe('skip=false\n');
    expect(run(echo('[]')).output).toBe('skip=false\n');
  });

  it('se a consulta falhar, não pula (e avisa)', () => {
    const r = run('exit 1');
    expect(r.output).toBe('skip=false\n');
    expect(r.stdout).toContain('::warning');
  });
});
