import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { defaultExe } from '../scripts/ui-tests/proc.mjs';

// A parte dos testes da janela real que não precisa de Electron: onde achar o executável e como o CI liga tudo.
// O teste de verdade (abrir o app e usar) está em scripts/ui-tests/tests-electron e roda com `pnpm test:e2e` e no smoke.yml.
const studio = join(__dirname, '..');
const root = join(studio, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'e2e-exe-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function fake(...parts: string[]): void {
  const file = join(tmp, ...parts);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '');
}

describe('defaultExe: onde o electron-builder --dir deixa o executável', () => {
  it('Windows, Linux e macOS (x64 ou ARM64)', () => {
    fake('release', 'win-unpacked', 'GitNexus.exe');
    fake('release', 'linux-unpacked', 'gitnexus');
    fake('release', 'mac-arm64', 'GitNexus.app', 'Contents', 'MacOS', 'GitNexus');
    expect(defaultExe(tmp, 'win32')).toBe(join(tmp, 'release', 'win-unpacked', 'GitNexus.exe'));
    expect(defaultExe(tmp, 'linux')).toBe(join(tmp, 'release', 'linux-unpacked', 'gitnexus'));
    expect(defaultExe(tmp, 'darwin')).toBe(join(tmp, 'release', 'mac-arm64', 'GitNexus.app', 'Contents', 'MacOS', 'GitNexus'));
  });

  it('devolve null quando o app ainda não foi empacotado, ou para um sistema desconhecido', () => {
    const empty = mkdtempSync(join(tmpdir(), 'e2e-empty-'));
    try {
      expect(defaultExe(empty, 'linux')).toBeNull();
      expect(defaultExe(tmp, 'freebsd')).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('o nome do executável do Linux é o mesmo que o smoke.yml usa (e que o electron-builder gera)', () => {
    const smoke = readFileSync(join(root, '.github', 'workflows', 'smoke.yml'), 'utf8');
    expect(smoke).toContain('apps/studio/release/linux-unpacked/gitnexus');
    expect(readFileSync(join(studio, 'electron-builder.yml'), 'utf8')).toMatch(/executableName: gitnexus/);
  });
});

describe('o smoke.yml usa o pacote para os testes da janela real', () => {
  const smoke = readFileSync(join(root, '.github', 'workflows', 'smoke.yml'), 'utf8').replace(/\r\n/g, '\n');

  it('roda o runner depois do smoke, sobre o mesmo empacotamento (um único electron-builder)', () => {
    expect(smoke.indexOf('GITNEXUS_SMOKE_OK')).toBeLessThan(smoke.indexOf('run-electron.mjs'));
    expect(smoke.match(/electron-builder --linux/g)?.length).toBe(1);
  });

  it('com display virtual e os argumentos que o Linux do runner exige', () => {
    expect(smoke).toContain('xvfb-run');
    expect(smoke).toMatch(/GN_APP_ARGS: --no-sandbox --disable-gpu/);
  });

  it('guarda as capturas de tela quando falha', () => {
    expect(smoke).toMatch(/if: \$\{\{ failure\(\) \}\}[\s\S]*name: e2e-output/);
  });

  it('o nome do job de fumaça não mudou (documentos e checks citam esse nome)', () => {
    expect(smoke).toContain('name: Teste de fumaça do app empacotado');
  });
});

describe('os testes da janela real', () => {
  const dir = join(studio, 'scripts', 'ui-tests', 'tests-electron');
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));

  it('há pelo menos um fluxo', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f}: usa a biblioteca, confere no git de verdade, vigia erros do console e encerra com t.close()`, () => {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src).toContain("from '../lib.mjs'");
      expect(src).toMatch(/\bgit\(repo,/);
      expect(src).toContain('t.errors()');
      expect(src).toContain('t.close()');
    });
  }

  it('o runner nunca deixa o app em modo de fumaça (ele encerraria sozinho no meio do teste)', () => {
    expect(readFileSync(join(studio, 'scripts', 'ui-tests', 'run-electron.mjs'), 'utf8')).toContain('delete env.GITNEXUS_SMOKE');
  });

  it('cada teste usa uma pasta de dados nova (não enxerga o app instalado nem o teste anterior)', () => {
    expect(readFileSync(join(studio, 'scripts', 'ui-tests', 'run-electron.mjs'), 'utf8')).toMatch(/GITNEXUS_DATA_DIR: data/);
  });
});
