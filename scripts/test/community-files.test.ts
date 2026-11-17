import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { BRANCH_PREFIXES } from '../lib/branch-name.mjs';
// @ts-expect-error módulo .mjs sem tipos
import { MAX_TITLE, PR_TYPES } from '../lib/pr-title.mjs';

// Os documentos da comunidade afirmam coisas sobre o código e a CI. Estes testes amarram cada afirmação ao que existe de verdade:
// se alguém renomear um check, mudar o sandbox do Electron ou criar um workflow sem `permissions`, o texto deixa de ser verdade e o teste reprova.
const root = join(__dirname, '..', '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n');
const workflows = readdirSync(join(root, '.github', 'workflows'))
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ file: f, text: read(`.github/workflows/${f}`) }));
const labels = new Set((JSON.parse(read('.github/labels.json')) as Array<{ name: string }>).map((l) => l.name));

describe('CONTRIBUTING.md', () => {
  const text = read('CONTRIBUTING.md');

  it('lista todos os tipos aceitos para branch e para o título do PR', () => {
    for (const t of [...BRANCH_PREFIXES, ...PR_TYPES]) expect(text, `tipo "${t}"`).toContain(`\`${t}\``);
  });

  it('os checks citados existem como jobs nos workflows', () => {
    const step = text.slice(text.indexOf('5. O CI precisa passar'), text.indexOf('6. Os **rótulos**'));
    const names = [...step.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const n of names) {
      expect(
        workflows.some((w) => w.text.includes(`name: ${n}`)),
        `check "${n}" não é o nome de nenhum job`,
      ).toBe(true);
    }
  });

  it('os rótulos citados existem no catálogo', () => {
    for (const l of ['conflito', 'bloqueado', 'tamanho: XL']) {
      expect(text).toContain(l);
      expect(labels.has(l), l).toBe(true);
    }
  });

  it('os comandos citados existem no package.json', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    for (const m of text.matchAll(/^pnpm ([a-z:]+)/gm)) {
      if (m[1] === 'install') continue;
      expect(scripts[m[1]!], `pnpm ${m[1]}`).toBeTruthy();
    }
  });

  it('os arquivos que manda editar existem (i18n e .node-version)', () => {
    for (const f of ['.node-version', 'apps/studio/test/i18n.test.ts', 'apps/studio/src/entrypoints/renderer/i18n/pt-BR.ts', 'apps/studio/src/entrypoints/renderer/i18n/en.ts']) {
      expect(existsSync(join(root, f)), f).toBe(true);
    }
  });
});

describe('SECURITY.md', () => {
  const text = read('SECURITY.md');

  it('"contextIsolation e sandbox ligados e sem nodeIntegration" é verdade no código', () => {
    expect(text).toMatch(/contextIsolation.*sandbox.*nodeIntegration/s);
    const main = read('apps/studio/src/entrypoints/main.ts');
    expect(main).toContain('contextIsolation: true');
    expect(main).toContain('sandbox: true');
    expect(main).toContain('nodeIntegration: false');
  });

  it('tokens criptografados com safeStorage e a lista de canais existem', () => {
    expect(text).toContain('safeStorage');
    expect(read('apps/studio/src/entrypoints/hosting-store.ts')).toContain('safeStorage');
    expect(text).toContain('apps/studio/src/shared/channels.ts');
    expect(existsSync(join(root, 'apps/studio/src/shared/channels.ts'))).toBe(true);
  });

  it('todo workflow declara `permissions` (a política diz que são mínimas)', () => {
    for (const w of workflows) expect(w.text, w.file).toMatch(/^permissions:/m);
  });

  it('a release traz SHA256SUMS e SBOM (o texto manda conferir)', () => {
    const release = read('.github/workflows/release.yml');
    expect(release).toContain('SHA256SUMS.txt');
    expect(release).toContain('cdx.json');
  });

  it('não promete o que não existe hoje: sem CodeQL, e diz que Windows/macOS não são assinados', () => {
    expect(existsSync(join(root, '.github', 'workflows', 'codeql.yml'))).toBe(false);
    expect(text).not.toMatch(/CodeQL/);
    expect(text).toMatch(/não são assinados/);
  });
});

describe('modelo de PR e código de conduta', () => {
  it('o modelo de PR tem seções e checklist, e cita os dois arquivos de idioma', () => {
    const t = read('.github/pull_request_template.md');
    for (const s of ['## O que muda', '## Por quê', '## Como testar', '## Checklist']) expect(t).toContain(s);
    expect(t.match(/^- \[ \] /gm)?.length).toBeGreaterThanOrEqual(5);
    expect(t).toContain('pt-BR.ts');
    expect(t).toContain('en.ts');
  });

  it('o modelo de PR e o guia de contribuição dizem o limite do título (o mesmo que o check aplica)', () => {
    expect(read('.github/pull_request_template.md')).toContain(`${MAX_TITLE} caracteres`);
    expect(read('CONTRIBUTING.md')).toContain(`${MAX_TITLE} caracteres`);
  });

  it('o código de conduta diz como relatar e não deixa e-mail pessoal', () => {
    const t = read('CODE_OF_CONDUCT.md');
    expect(t).toContain('## Aplicação');
    expect(t).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it('nenhum dos documentos da comunidade traz e-mail', () => {
    for (const f of ['CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', '.github/pull_request_template.md']) {
      expect(read(f), f).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });
});
