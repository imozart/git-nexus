import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entropy, globToRegExp, parseAddedLines, runGit, scanLine, scanStagedSecrets, type SecretsConfig } from '../src/index.js';

// Os "segredos" são montados em tempo de execução: o código-fonte não contém nenhum token literal
// (o push protection do GitHub e scanners de terceiros não devem confundir os testes com vazamentos).
const aws = 'AKIA' + 'IOSFODNN7EXAMPLQ';
const ghToken = 'ghp_' + 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6';
const pem = '-----BEGIN ' + 'RSA PRIVATE KEY-----';

describe('scanLine', () => {
  it('detecta chaves conhecidas e mascara o valor', () => {
    expect(scanLine(`const k = "${aws}"`)?.rule).toBe('Chave de acesso AWS');
    expect(scanLine(`token: ${ghToken}`)?.rule).toBe('Token do GitHub');
    expect(scanLine(pem)?.rule).toContain('Chave privada');
    const hit = scanLine(`const k = "${aws}"`)!;
    expect(hit.preview).not.toContain(aws);
    expect(hit.preview.startsWith('AKIA')).toBe(true);
  });

  it('detecta credenciais em URL e senha atribuída, mas ignora placeholders', () => {
    expect(scanLine('db = "postgres://admin:S3cr3tPassw0rd@db.interno:5432/app"')?.rule).toContain('URL');
    expect(scanLine('password = "Xk9$mQ2vLp7Zr4Tw"')?.rule).toContain('Senha');
    expect(scanLine('password = "your-password-here"')).toBeNull();
    expect(scanLine('password = "${DB_PASSWORD}"')).toBeNull();
    expect(scanLine('const password = process.env.DB_PASSWORD')).toBeNull();
    expect(scanLine('postgres://user:<password>@host/db')).toBeNull();
  });

  it('respeita o marcador de permissão na linha', () => {
    expect(scanLine(`const k = "${aws}" // gitnexus:allow-secret`)).toBeNull();
  });

  it('entropia separa texto comum de segredo aleatório', () => {
    expect(entropy('aaaaaaaa')).toBe(0);
    expect(entropy('Xk9$mQ2vLp7Zr4Tw')).toBeGreaterThan(3);
  });
});

describe('parseAddedLines / globToRegExp', () => {
  it('numera as linhas adicionadas a partir do cabeçalho do hunk', () => {
    const diff = ['diff --git a/x.ts b/x.ts', '--- a/x.ts', '+++ b/x.ts', '@@ -1,0 +5,2 @@', '+um', '+dois', '@@ -9 +20 @@', '-velho', '+novo'].join('\n');
    expect(parseAddedLines(diff)).toEqual([
      { file: 'x.ts', line: 5, text: 'um' },
      { file: 'x.ts', line: 6, text: 'dois' },
      { file: 'x.ts', line: 20, text: 'novo' },
    ]);
  });

  it('glob: ** atravessa pastas, * não', () => {
    expect(globToRegExp('test/fixtures/**').test('test/fixtures/a/b.json')).toBe(true);
    expect(globToRegExp('*.pem').test('a/b.pem')).toBe(false);
    expect(globToRegExp('**/*.pem').test('a/b.pem')).toBe(true);
  });
});

describe('scanStagedSecrets (repositório real)', () => {
  let root: string;
  const cfg: SecretsConfig = { mode: 'warn', ignorePaths: [], maxFileSizeMb: 1 };
  const git = (...a: string[]) => runGit(root, a);

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'gitnexus-sec-'));
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'Teste');
    await git('config', 'user.email', 'teste@example.com');
    writeFileSync(join(root, 'ok.txt'), 'nada demais\n');
    await git('add', '.');
    await git('commit', '-m', 'init');
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('sem nada em stage não há achados', async () => {
    expect(await scanStagedSecrets(root, cfg)).toEqual([]);
  });

  it('acha segredo (com arquivo e linha), arquivo sensível e arquivo grande', async () => {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'cfg.ts'), `// ok\nexport const key = "${aws}";\n`);
    writeFileSync(join(root, '.env'), 'A=1\n');
    writeFileSync(join(root, 'grande.bin'), Buffer.alloc(2 * 1024 * 1024, 7));
    writeFileSync(join(root, '.env.example'), 'A=\n');
    await git('add', '-A');
    const f = await scanStagedSecrets(root, cfg);
    const by = (k: string) => f.filter((x) => x.kind === k);
    expect(by('secret')).toMatchObject([{ file: 'src/cfg.ts', line: 2, rule: 'Chave de acesso AWS' }]);
    expect(by('sensitive-file').map((x) => x.file)).toEqual(['.env']); // .env.example é permitido
    expect(by('large-file').map((x) => x.file)).toEqual(['grande.bin']);
    expect(JSON.stringify(f)).not.toContain(aws);
  });

  it('ignorePaths e mode off silenciam o scanner', async () => {
    const ign = await scanStagedSecrets(root, { ...cfg, ignorePaths: ['src/**', '.env', 'grande.bin'] });
    expect(ign).toEqual([]);
    expect(await scanStagedSecrets(root, { ...cfg, mode: 'off' })).toEqual([]);
  });
});
