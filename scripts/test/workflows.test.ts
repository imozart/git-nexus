import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
    // direto (node-version-file) ou pela composite action .github/actions/setup, que por sua vez lê o .node-version
    const using = workflows.filter((w) => w.text.includes('node-version-file: .node-version') || w.text.includes('uses: ./.github/actions/setup'));
    expect(using.length).toBeGreaterThanOrEqual(5);
  });

  it('o actions/setup-node vem depois do checkout no mesmo job (o arquivo precisa existir)', () => {
    for (const w of workflows) {
      for (const j of jobs(w.text)) {
        const marks = ['node-version-file: .node-version', 'uses: ./.github/actions/setup'].map((m) => j.body.indexOf(m)).filter((i) => i >= 0);
        if (!marks.length) continue;
        const node = Math.min(...marks);
        const checkout = j.body.indexOf('actions/checkout');
        expect(checkout, `${w.file} > ${j.name}: sem checkout antes do setup-node`).toBeGreaterThanOrEqual(0);
        expect(checkout, `${w.file} > ${j.name}`).toBeLessThan(node);
      }
    }
  });
});

describe('composite action .github/actions/setup', () => {
  const action = readFileSync(join(root, '.github', 'actions', 'setup', 'action.yml'), 'utf8').replace(/\r\n/g, '\n');

  it('lê o .node-version, usa actions fixadas por SHA e tem o passo de instalação opcional', () => {
    expect(action).toContain('node-version-file: .node-version');
    for (const m of action.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) expect(m[1], m[1]).toMatch(/@[0-9a-f]{40}$/);
    expect(action).toContain("inputs.install == 'true'");
    expect(action).toContain('pnpm install --frozen-lockfile');
  });

  it('os workflows não repetem mais o trecho pnpm + node: usam a action', () => {
    for (const w of workflows) {
      const uses = w.text.includes('uses: ./.github/actions/setup');
      // quem instala pnpm direto (só a geração da SBOM na release) é o único caso permitido fora da composite
      const raw = (w.text.match(/uses: pnpm\/action-setup/g) ?? []).length;
      if (uses) expect(raw, w.file).toBeLessThanOrEqual(w.file === 'release.yml' ? 1 : 0);
    }
    expect(workflows.filter((w) => w.text.includes('uses: ./.github/actions/setup')).length).toBeGreaterThanOrEqual(7);
  });
});

describe('rótulos por pasta (.github/labeler.yml)', () => {
  const text = readFileSync(join(root, '.github', 'labeler.yml'), 'utf8').replace(/\r\n/g, '\n');
  const globs = [...text.matchAll(/any-glob-to-any-file:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((g) => g[1]!));

  it('todo glob de pasta aponta para uma pasta que existe (renomear uma pasta sem atualizar o labeler deixaria o rótulo morto)', () => {
    expect(globs.length).toBeGreaterThan(5);
    for (const g of globs) {
      const dir = /^([^*]+)\/\*\*$/.exec(g)?.[1];
      if (dir && !dir.startsWith('.')) expect(existsSync(join(root, dir)), g).toBe(true);
      if (dir?.startsWith('.')) expect(existsSync(join(root, dir)), g).toBe(true);
    }
  });

  it('o workflow do labeler não faz checkout (usa pull_request_target: nunca executar código do PR)', () => {
    const w = workflows.find((x) => x.file === 'labeler.yml')!;
    expect(w.text).toContain('pull_request_target');
    expect(w.text).not.toContain('actions/checkout');
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

describe('CHANGELOG empacotado com a versão da própria release (release.yml)', () => {
  const release = workflows.find((w) => w.file === 'release.yml')!;
  const version = jobs(release.text).find((j) => j.name === 'version')!;
  const build = jobs(release.text).find((j) => j.name === 'build')!;

  it('o job de versão gera o CHANGELOG até o commit da release (a tag ainda não existe) só para versão estável', () => {
    expect(version.body).toContain('node scripts/changelog.mjs --version "$VERSION" --ref HEAD');
    expect(version.body).toContain("steps.next.outputs.prerelease != 'true'");
    expect(version.body).toContain('continue-on-error: true'); // falhar aqui nunca impede a release
    expect(version.body).toContain('name: changelog');
  });

  it('a versão sai de saída de passo, por variável de ambiente (nunca interpolada no script)', () => {
    const line = version.body.split('\n').find((l) => l.includes('scripts/changelog.mjs'))!;
    expect(line).not.toContain('${{');
  });

  it('o build baixa o arquivo ANTES de compilar e empacotar, e o histórico completo fica só no job de versão', () => {
    const dl = build.body.indexOf('actions/download-artifact');
    expect(dl).toBeGreaterThan(0);
    expect(dl).toBeLessThan(build.body.indexOf('pnpm --filter @git-nexus/studio build'));
    expect(dl).toBeLessThan(build.body.indexOf('exec electron-builder'));
    expect(build.body).toContain('name: changelog');
    expect(build.body).not.toContain('fetch-depth: 0');
  });

  it('o job de versão tem o histórico e as tags inteiros (o changelog sai dos commits entre as tags)', () => {
    expect(version.body).toContain('fetch-depth: 0');
    expect(version.body).toContain('fetch-tags: true');
  });
});

describe('registro da release no código (release-sync.yml)', () => {
  const sync = workflows.find((w) => w.file === 'release-sync.yml')!;
  const release = workflows.find((w) => w.file === 'release.yml')!;

  it('é um workflow reutilizável e também roda à mão, com a versão como entrada', () => {
    expect(sync.text).toMatch(/^ {2}workflow_call:/m);
    expect(sync.text).toMatch(/^ {2}workflow_dispatch:/m);
    expect(sync.text.match(/^ {6}version:/gm)?.length).toBe(2);
    expect(sync.text).toMatch(/RELEASE_PUSH_TOKEN:\n\s+description:[^\n]*\n\s+required: false/);
  });

  it('o release.yml chama o workflow só para release estável e repassa o token', () => {
    const job = jobs(release.text).find((j) => j.name === 'sync-version')!;
    expect(job.body).toContain('uses: ./.github/workflows/release-sync.yml');
    expect(job.body).toContain("needs.version.outputs.prerelease != 'true'");
    expect(job.body).toContain('RELEASE_PUSH_TOKEN: ${{ secrets.RELEASE_PUSH_TOKEN }}');
    expect(job.body).toContain('needs: [version, release]');
  });

  it('a versão (campo digitável) nunca é interpolada em um script: entra por variável de ambiente', () => {
    for (const line of sync.text.split('\n')) {
      if (/^\s*#/.test(line) || /^\s+VERSION: /.test(line)) continue;
      expect(line, line).not.toContain('inputs.version');
    }
    expect(sync.text).toMatch(/^ {6}VERSION: \$\{\{ inputs\.version \}\}/m);
  });

  it('busca o histórico e as tags (o changelog sai dos commits entre as tags) antes de gerar o arquivo', () => {
    expect(sync.text).toContain('fetch-depth: 0');
    expect(sync.text).toContain('fetch-tags: true');
    expect(sync.text.indexOf('fetch-tags: true')).toBeLessThan(sync.text.indexOf('run: node scripts/changelog.mjs'));
  });

  it('versão e CHANGELOG vão no mesmo commit chore(release) com [skip release], e sem mudança não há commit', () => {
    expect(sync.text).toContain('git add CHANGELOG.md package.json');
    expect(sync.text).toContain('chore(release): v$VERSION [skip release]');
    expect(sync.text).toContain('git diff --cached --quiet');
  });

  it('o grupo de concorrência é diferente do "release" de quem chama (o mesmo nome travaria a execução)', () => {
    expect(sync.text).toMatch(/group: release-sync/);
    expect(sync.text).not.toMatch(/group: release\s*$/m);
  });
});
