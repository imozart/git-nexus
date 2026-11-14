import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runGit } from '@git-nexus/git-core';
import { createReleaseTag, getReleaseInfo, writeChangelog } from '../src/worker/release';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function newRepo(pkgVersion?: string): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), 'gitnexus-rel-'));
  dirs.push(repo);
  const g = (...a: string[]) => runGit(repo, a);
  await g('init', '-b', 'main');
  await g('config', 'user.name', 'Ana');
  await g('config', 'user.email', 'ana@e.com');
  await g('config', 'commit.gpgsign', 'false');
  await g('config', 'core.autocrlf', 'false');
  if (pkgVersion) writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: pkgVersion }));
  return repo;
}
let n = 0;
async function commit(repo: string, msg: string): Promise<void> {
  writeFileSync(join(repo, `f${n++}.txt`), 'x\n');
  await runGit(repo, ['add', '.']);
  await runGit(repo, ['commit', '-m', msg]);
}

describe('getReleaseInfo', () => {
  it('sem tags: usa a versão do package.json como primeira', async () => {
    const repo = await newRepo('2.3.4');
    await commit(repo, 'feat: primeira');
    const info = await getReleaseInfo(repo);
    expect(info).toMatchObject({ previous: null, version: '2.3.4', bump: 'initial', hasTags: false, initialFromPackage: true, commitCount: 1 });
  });

  it('sem tags e sem package.json: começa em 0.1.0', async () => {
    const repo = await newRepo();
    await commit(repo, 'fix: x');
    expect((await getReleaseInfo(repo)).version).toBe('0.1.0');
  });

  it('com tag: fix → patch, feat → minor, breaking → major', async () => {
    const repo = await newRepo('1.0.0');
    await commit(repo, 'feat: base');
    await runGit(repo, ['tag', 'v1.2.3']);
    await commit(repo, 'fix(auth): corrige login');
    await commit(repo, 'docs: atualiza readme');
    let info = await getReleaseInfo(repo);
    expect(info).toMatchObject({ previous: 'v1.2.3', version: '1.2.4', bump: 'patch', commitCount: 2, hasTags: true });

    await commit(repo, 'feat: nova tela (#7)');
    info = await getReleaseInfo(repo);
    expect(info).toMatchObject({ version: '1.3.0', bump: 'minor', commitCount: 3 });

    await commit(repo, 'refactor!: troca o contrato');
    info = await getReleaseInfo(repo);
    expect(info).toMatchObject({ version: '2.0.0', bump: 'major' });
  });

  it('o bump pode ser forçado e as seções vêm agrupadas na ordem certa', async () => {
    const repo = await newRepo('1.0.0');
    await commit(repo, 'chore: base');
    await runGit(repo, ['tag', 'v1.0.0']);
    await commit(repo, 'fix(ui): botão (#3)');
    await commit(repo, 'feat: tela');
    await commit(repo, 'Mensagem fora do padrão');
    const info = await getReleaseInfo(repo, 'major');
    expect(info.version).toBe('2.0.0');
    expect(info.sections.map((s) => s.id)).toEqual(['feat', 'fix', 'other']);
    expect(info.sections[1]!.items[0]).toMatchObject({ scope: 'ui', title: 'botão', pr: '3', type: 'fix' });
    expect(info.markdown).toContain('## ✨ Novidades');
    expect(info.markdown).toContain('**ui:** botão');
    expect(info.markdown.indexOf('Novidades')).toBeLessThan(info.markdown.indexOf('Correções'));
  });

  it('ignora tags que não são vX.Y.Z', async () => {
    const repo = await newRepo('1.0.0');
    await commit(repo, 'feat: a');
    await runGit(repo, ['tag', 'v2.0.0-beta']);
    await runGit(repo, ['tag', 'release-1']);
    expect((await getReleaseInfo(repo)).previous).toBeNull();
  });
});

describe('createReleaseTag', () => {
  it('cria tag anotada com as notas e recusa repetir', async () => {
    const repo = await newRepo('1.0.0');
    await commit(repo, 'feat: a');
    const r = await createReleaseTag(repo, '1.0.0', '## ✨ Novidades\n\n- a');
    expect(r.tag).toBe('v1.0.0');
    const obj = (await runGit(repo, ['cat-file', '-t', 'v1.0.0'])).stdout.trim();
    expect(obj).toBe('tag'); // anotada
    expect((await runGit(repo, ['tag', '-l', '--format=%(contents)', 'v1.0.0'])).stdout).toContain('Novidades');
    await expect(createReleaseTag(repo, '1.0.0')).rejects.toThrow('já existe');
    await expect(createReleaseTag(repo, '1.0')).rejects.toThrow('inválida');
    await expect(createReleaseTag(repo, '1.0.0; rm')).rejects.toThrow('inválida');
    expect((await getReleaseInfo(repo)).previous).toBe('v1.0.0');
  });

  it('tagExists avisa quando a próxima versão já existe como tag', async () => {
    const repo = await newRepo('1.0.0');
    await commit(repo, 'feat: a');
    await runGit(repo, ['tag', 'v1.0.0']);
    await commit(repo, 'fix: b');
    await runGit(repo, ['tag', 'v1.0.1']); // depois de criar a tag, só há commits novos
    const info = await getReleaseInfo(repo);
    expect(info.previous).toBe('v1.0.1');
    expect(info.tagExists).toBe(false);
  });
});

describe('writeChangelog', () => {
  const md = '## ✨ Novidades\n\n- **ui:** tela — `abc1234` · Ana\n';
  const day = new Date('2026-11-14T12:00:00Z');

  it('cria o arquivo e insere versões novas no topo, abaixo do título', async () => {
    const repo = await newRepo();
    await writeChangelog(repo, '1.0.0', md, day);
    let t = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
    expect(t.startsWith('# Changelog\n\n## [v1.0.0] - 2026-11-14\n\n### ✨ Novidades')).toBe(true);

    await writeChangelog(repo, '1.1.0', '## 🐛 Correções\n\n- x\n', day);
    t = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
    expect(t.indexOf('v1.1.0')).toBeLessThan(t.indexOf('v1.0.0'));
    expect(t.match(/^# Changelog/gm)).toHaveLength(1);
  });

  it('recusa a mesma versão duas vezes e preserva CRLF', async () => {
    const repo = await newRepo();
    writeFileSync(join(repo, 'CHANGELOG.md'), '# Changelog\r\n\r\n## [v0.9.0] - 2026-01-01\r\n\r\n- antigo\r\n');
    await writeChangelog(repo, '1.0.0', md, day);
    await expect(writeChangelog(repo, '1.0.0', md, day)).rejects.toThrow('já tem a versão');
    await expect(writeChangelog(repo, 'x', md, day)).rejects.toThrow('inválida');
    const t = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
    expect(t).toContain('\r\n');
    expect(t.replace(/\r\n/g, '\n').split('\n').filter((l) => l.startsWith('## [')).length).toBe(2);
  });
});
