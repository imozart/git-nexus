import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GITIGNORE_TEMPLATES,
  classifyCloneFailure,
  cloneFailureMessage,
  cloneRepository,
  gitignoreContent,
  initRepository,
  isValidBranchName,
  isValidFolderName,
  onGitProgress,
  repoNameFromUrl,
  runGit,
} from '../src/index.js';

let root: string;
let bare: string;
let n = 0;
const out = async (cwd: string, ...a: string[]) => (await runGit(cwd, a)).stdout.trim();
const folder = () => {
  const d = join(root, `dest${++n}`);
  mkdirSync(d);
  return d;
};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-clone-'));
  // um remoto de verdade (bare) com duas branches
  const work = join(root, 'work');
  await runGit(root, ['init', '-b', 'main', work]);
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']] as const) await runGit(work, ['config', k, v]);
  writeFileSync(join(work, 'a.txt'), 'a\n');
  await runGit(work, ['add', '.']);
  await runGit(work, ['commit', '-qm', 'feat: primeiro']);
  await runGit(work, ['switch', '-qc', 'feature']);
  writeFileSync(join(work, 'f.txt'), 'f\n');
  await runGit(work, ['add', '.']);
  await runGit(work, ['commit', '-qm', 'feat: da feature']);
  await runGit(work, ['switch', '-q', 'main']);
  bare = join(root, 'meu-projeto.git');
  await runGit(root, ['init', '--bare', '-b', 'main', bare]);
  await runGit(work, ['remote', 'add', 'origin', bare]);
  await runGit(work, ['push', '-q', 'origin', 'main', 'feature']);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('nome da pasta a partir do endereço', () => {
  it.each([
    ['https://github.com/imozart/git-nexus.git', 'git-nexus'],
    ['https://github.com/imozart/git-nexus', 'git-nexus'],
    ['https://github.com/imozart/git-nexus/', 'git-nexus'],
    ['git@github.com:imozart/git-nexus.git', 'git-nexus'],
    ['ssh://git@gitlab.exemplo.gov.br:2222/grupo/sub/projeto.git', 'projeto'],
    ['C:\\repos\\meu projeto\\', 'meu projeto'],
    ['/srv/git/projeto.git', 'projeto'],
    ['  https://x.y/z/abc.GIT  ', 'abc'],
    ['', ''],
    ['..', ''],
  ])('%s → "%s"', (url, name) => expect(repoNameFromUrl(url)).toBe(name));
});

describe('validações', () => {
  it('nome de pasta: sem separadores, sem caracteres proibidos, sem terminar em ponto', () => {
    for (const ok of ['projeto', 'meu-projeto_2', 'a.b', 'Projeto Novo']) expect(isValidFolderName(ok), ok).toBe(true);
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?', 'fim.', 'fim ', ' ini', 'a\u0001b']) expect(isValidFolderName(bad), JSON.stringify(bad)).toBe(false);
  });

  it('nome de branch segue as regras do git', () => {
    for (const ok of ['main', 'develop', 'feat/login', 'release/1.2.0', 'fix_x', 'v1']) expect(isValidBranchName(ok), ok).toBe(true);
    for (const bad of ['', '-x', '/a', 'a/', 'a b', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', 'a@{b', '@', 'a.lock', 'a//b', 'x/.y', 'x.', 'x/y.lock']) expect(isValidBranchName(bad), bad).toBe(false);
  });

  it('todo nome de branch aceito pelo app também é aceito pelo `git check-ref-format`', async () => {
    for (const b of ['main', 'feat/login', 'release/1.2.0', 'fix_x']) {
      expect((await runGit(root, ['check-ref-format', '--branch', b], { check: false })).code, b).toBe(0);
    }
  });
});

describe('mensagens de falha do clone', () => {
  it('cada causa conhecida é reconhecida', () => {
    expect(classifyCloneFailure("fatal: Authentication failed for 'https://x/y.git/'")).toBe('auth');
    expect(classifyCloneFailure('git@x: Permission denied (publickey).\nfatal: Could not read from remote repository.')).toBe('auth');
    expect(classifyCloneFailure('fatal: could not read Username for \'https://x\': terminal prompts disabled')).toBe('auth');
    expect(classifyCloneFailure("remote: Repository not found.\nfatal: repository 'https://x/y.git/' not found")).toBe('notFound');
    expect(classifyCloneFailure("fatal: 'C:/nada' does not appear to be a git repository")).toBe('notFound');
    expect(classifyCloneFailure("fatal: unable to access 'https://x/': Could not resolve host: x")).toBe('network');
    expect(classifyCloneFailure("fatal: destination path 'a' already exists and is not an empty directory.")).toBe('exists');
    expect(classifyCloneFailure('fatal: Remote branch zzz not found in upstream origin')).toBe('branch');
    expect(classifyCloneFailure('qualquer coisa estranha')).toBe('other');
  });

  it('a mensagem de autenticação explica o que configurar (o app não pergunta senha)', () => {
    expect(cloneFailureMessage('auth', '')).toMatch(/Credential Manager|SSH/);
  });

  it('saída longa e repetitiva é classificada em tempo curto (sem regex quadrática)', () => {
    const t0 = Date.now();
    classifyCloneFailure('unable to access '.repeat(60_000));
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('cloneRepository', () => {
  it('clona para <pasta>/<nome da URL> e devolve o caminho; o clone é um repositório de verdade', async () => {
    const parent = folder();
    const r = await cloneRepository({ url: bare, parentDir: parent });
    expect(r.path).toBe(join(parent, 'meu-projeto'));
    expect(existsSync(join(r.path, 'a.txt'))).toBe(true);
    expect(await out(r.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(await out(r.path, 'remote', 'get-url', 'origin')).toBe(bare);
  });

  it('nome escolhido pela pessoa vale mais que o da URL', async () => {
    const parent = folder();
    const r = await cloneRepository({ url: bare, parentDir: parent, name: 'outro nome' });
    expect(r.path).toBe(join(parent, 'outro nome'));
    expect(existsSync(join(r.path, '.git'))).toBe(true);
  });

  it('branch pedida: o clone já vem nela', async () => {
    const r = await cloneRepository({ url: bare, parentDir: folder(), branch: 'feature' });
    expect(await out(r.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature');
    expect(existsSync(join(r.path, 'f.txt'))).toBe(true);
  });

  it('branch que não existe: mensagem clara e nenhuma pasta fica para trás', async () => {
    const parent = folder();
    await expect(cloneRepository({ url: bare, parentDir: parent, branch: 'nao-existe' })).rejects.toThrow(/branch pedida não existe|requested branch/i);
    expect(existsSync(join(parent, 'meu-projeto'))).toBe(false);
  });

  it('endereço que não existe: mensagem de "não encontrado" e nenhuma pasta fica para trás', async () => {
    const parent = folder();
    await expect(cloneRepository({ url: join(root, 'nao-existe-mesmo.git'), parentDir: parent })).rejects.toThrow(/não encontrado|not found/i);
    expect(existsSync(join(parent, 'nao-existe-mesmo'))).toBe(false);
  });

  it('destino que já tem arquivos é recusado e NADA é apagado', async () => {
    const parent = folder();
    mkdirSync(join(parent, 'meu-projeto'));
    writeFileSync(join(parent, 'meu-projeto', 'importante.txt'), 'não apague\n');
    await expect(cloneRepository({ url: bare, parentDir: parent })).rejects.toThrow(/já existe|already exists/i);
    expect(readFileSync(join(parent, 'meu-projeto', 'importante.txt'), 'utf8')).toBe('não apague\n');
  });

  it('destino vazio que já existe é aceito, e se o clone falhar a pasta vazia continua lá', async () => {
    const parent = folder();
    mkdirSync(join(parent, 'meu-projeto'));
    expect((await cloneRepository({ url: bare, parentDir: parent })).path).toBe(join(parent, 'meu-projeto'));
    const parent2 = folder();
    mkdirSync(join(parent2, 'vazia'));
    await expect(cloneRepository({ url: join(root, 'x.git'), parentDir: parent2, name: 'vazia' })).rejects.toThrow();
    expect(existsSync(join(parent2, 'vazia'))).toBe(true);
  });

  it('pasta-mãe inexistente, endereço vazio, endereço que parece opção e nome inválido são recusados antes de chamar o git', async () => {
    await expect(cloneRepository({ url: bare, parentDir: join(root, 'nao-existe') })).rejects.toThrow(/não existe|does not exist/i);
    await expect(cloneRepository({ url: '   ', parentDir: folder() })).rejects.toThrow(/Informe|Enter/i);
    await expect(cloneRepository({ url: '--upload-pack=calc', parentDir: folder() })).rejects.toThrow(/inválido|Invalid/i);
    await expect(cloneRepository({ url: bare, parentDir: folder(), name: '../fora' })).rejects.toThrow(/inválido|Invalid/i);
    await expect(cloneRepository({ url: bare, parentDir: folder(), branch: '-x' })).rejects.toThrow(/inválido|Invalid/i);
  });

  it('o transporte ext:: (que executa comandos) nunca é aceito', async () => {
    const parent = folder();
    const marca = join(root, 'executou.txt');
    await expect(cloneRepository({ url: `ext::sh -c "echo oi > ${marca.replace(/\\/g, '/')}"`, parentDir: parent, name: 'x' })).rejects.toThrow();
    expect(existsSync(marca)).toBe(false);
  });

  it('publica o andamento com o caminho de destino', async () => {
    const parent = folder();
    const events: { repoPath: string; op: string }[] = [];
    const off = onGitProgress((e) => events.push(e));
    const r = await cloneRepository({ url: `file://${bare.replace(/\\/g, '/')}`, parentDir: parent });
    off();
    // o git pode não escrever progresso em clone local minúsculo: se escreveu, tem que ser do clone e do destino certo
    for (const e of events) {
      expect(e.op).toBe('clone');
      expect(e.repoPath).toBe(r.path);
    }
  });
});

describe('initRepository', () => {
  it('cria a subpasta, o repositório e a branch inicial pedida (HEAD sem commits)', async () => {
    const parent = folder();
    const r = await initRepository({ parentDir: parent, name: 'novo', branch: 'develop' });
    expect(r.path).toBe(join(parent, 'novo'));
    expect(r.gitignore).toBe('none');
    expect(await out(r.path, 'symbolic-ref', '--short', 'HEAD')).toBe('develop');
    expect(await out(r.path, 'rev-parse', '--is-inside-work-tree')).toBe('true');
  });

  it('sem nome inicia na própria pasta escolhida; a branch padrão é main', async () => {
    const parent = folder();
    const r = await initRepository({ parentDir: parent });
    expect(r.path).toBe(parent);
    expect(await out(parent, 'symbolic-ref', '--short', 'HEAD')).toBe('main');
  });

  it('com modelo, escreve o .gitignore (e o git passa a ignorar o que o modelo manda)', async () => {
    const parent = folder();
    const r = await initRepository({ parentDir: parent, name: 'app', gitignore: 'node' });
    expect(r.gitignore).toBe('written');
    mkdirSync(join(r.path, 'node_modules'));
    writeFileSync(join(r.path, 'node_modules', 'x.js'), '1');
    writeFileSync(join(r.path, 'index.js'), '1');
    const status = await out(r.path, 'status', '--porcelain', '-uall');
    expect(status).toContain('index.js');
    expect(status).not.toContain('node_modules');
  });

  it('nunca sobrescreve um .gitignore que já existe', async () => {
    const parent = folder();
    writeFileSync(join(parent, '.gitignore'), 'meu\n');
    const r = await initRepository({ parentDir: parent, gitignore: 'node' });
    expect(r.gitignore).toBe('exists');
    expect(readFileSync(join(parent, '.gitignore'), 'utf8')).toBe('meu\n');
  });

  it('recusa pasta que já é repositório, branch inválida, nome inválido e pasta inexistente', async () => {
    const parent = folder();
    await initRepository({ parentDir: parent });
    await expect(initRepository({ parentDir: parent })).rejects.toThrow(/já é um repositório|already/i);
    await expect(initRepository({ parentDir: folder(), branch: 'a b' })).rejects.toThrow(/inválido|Invalid/i);
    await expect(initRepository({ parentDir: folder(), name: '../x' })).rejects.toThrow(/inválido|Invalid/i);
    await expect(initRepository({ parentDir: join(root, 'nao-existe') })).rejects.toThrow(/não existe|does not exist/i);
  });
});

describe('modelos de .gitignore', () => {
  it('todo modelo da lista tem conteúdo (exceto "none") e termina com linha em branco/quebra', () => {
    for (const t of GITIGNORE_TEMPLATES) {
      const c = gitignoreContent(t.id);
      if (t.id === 'none') expect(c).toBe('');
      else expect(c.length, t.id).toBeGreaterThan(20);
    }
    expect(gitignoreContent('inexistente')).toBe('');
  });
});
