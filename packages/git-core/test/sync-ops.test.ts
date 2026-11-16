import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fetchRepo, getSyncCommits, onGitProgress, parseProgressLine, progressReader, pushRepo, runGit, updateRepo, type GitProgressEvent } from '../src/index.js';

const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true, maxRetries: 3 })));

const g = (repo: string, ...a: string[]) => runGit(repo, a);
const out = async (repo: string, ...a: string[]) => (await g(repo, ...a)).stdout.trim();
async function config(repo: string): Promise<void> {
  await g(repo, 'config', 'user.name', 'T');
  await g(repo, 'config', 'user.email', 't@e.com');
  await g(repo, 'config', 'commit.gpgsign', 'false');
  await g(repo, 'config', 'core.autocrlf', 'false');
}
async function commitFile(repo: string, file: string, text: string, msg: string): Promise<void> {
  writeFileSync(join(repo, file), text);
  await g(repo, 'add', '.');
  await g(repo, 'commit', '-m', msg);
}

/** Um remoto (bare) com a main, um clone `repo` com upstream e um segundo clone `other` (outra pessoa). */
async function withRemote(): Promise<{ repo: string; remote: string; other: string }> {
  const remote = tmp('gn-sy-remote-');
  await runGit(remote, ['init', '--bare', '-b', 'main']);
  const repo = tmp('gn-sy-repo-');
  await g(repo, 'init', '-b', 'main');
  await config(repo);
  await g(repo, 'remote', 'add', 'origin', remote);
  await commitFile(repo, 'a.txt', 'um\n', 'init');
  await commitFile(repo, 'b.txt', 'b\n', 'segundo');
  await g(repo, 'push', '-u', 'origin', 'main');
  await g(repo, 'remote', 'set-head', 'origin', 'main');
  const other = tmp('gn-sy-other-');
  await runGit(other, ['clone', '-c', 'core.autocrlf=false', remote, '.']); // sem isto o clone sai com CRLF e o 'git add .' do teste reescreve os arquivos
  await config(other);
  return { repo, remote, other };
}

describe('progresso do git (puro)', () => {
  it('lê porcentagem e etapa, com ou sem "remote: "', () => {
    expect(parseProgressLine('Receiving objects:  45% (9/20)')).toEqual({ phase: 'Receiving objects', percent: 45 });
    expect(parseProgressLine('remote: Counting objects: 100% (5/5), done.')).toEqual({ phase: 'Counting objects', percent: 100 });
    expect(parseProgressLine('Resolving deltas: 7% (1/14)')).toEqual({ phase: 'Resolving deltas', percent: 7 });
  });

  it('ignora o que não é progresso ou é absurdo', () => {
    expect(parseProgressLine('From github.com:x/y')).toBeNull();
    expect(parseProgressLine('Updating files: 150% (3/2)')).toBeNull();
    expect(parseProgressLine('')).toBeNull();
    expect(parseProgressLine(' * [new branch]      feat/x -> origin/feat/x')).toBeNull();
  });

  it('o leitor junta pedaços que terminam no meio de uma linha e entende "\\r"', () => {
    const got: Array<{ phase: string; percent: number }> = [];
    const read = progressReader((p) => got.push(p));
    read('Receiving objects:  10% (1/10)\rReceiving obj');
    read('ects:  50% (5/10)\rReceiving objects: 100% (10/10), done.\n');
    expect(got.map((p) => p.percent)).toEqual([10, 50, 100]);
    expect(new Set(got.map((p) => p.phase))).toEqual(new Set(['Receiving objects']));
  });

  it('uma linha incompleta no fim não vira evento', () => {
    const got: number[] = [];
    progressReader((p) => got.push(p.percent))('Receiving objects:  90% (9/10)');
    expect(got).toEqual([]);
  });
});

describe('getSyncCommits', () => {
  it('lista o que chega e o que sai do upstream', async () => {
    const { repo, other } = await withRemote();
    await commitFile(repo, 'l1.txt', 'l1\n', 'local 1');
    await commitFile(repo, 'l2.txt', 'l2\n', 'local 2');
    await commitFile(other, 'o1.txt', 'o1\n', 'remoto 1');
    await g(other, 'push', 'origin', 'main');
    await g(repo, 'fetch', 'origin');
    const s = await getSyncCommits(repo);
    expect(s.incoming.map((c) => c.subject)).toEqual(['remoto 1']);
    expect(s.outgoing.map((c) => c.subject)).toEqual(['local 2', 'local 1']); // mais recente primeiro
    expect(s.incoming[0]).toMatchObject({ author: 'T' });
    expect(s.incoming[0]!.hash).toMatch(/^[0-9a-f]{7,}$/);
    expect(s.incoming[0]!.date).toBeGreaterThan(1_700_000_000);
  });

  it('sem upstream: o que sai é o que ainda não existe em nenhum remoto', async () => {
    const { repo } = await withRemote();
    await g(repo, 'checkout', '-b', 'feat/x');
    await commitFile(repo, 'f.txt', 'f\n', 'so na feature');
    const s = await getSyncCommits(repo);
    expect(s.incoming).toEqual([]);
    expect(s.outgoing.map((c) => c.subject)).toEqual(['so na feature']);
  });

  it('limita a lista e devolve vazio com HEAD desanexado', async () => {
    const { repo } = await withRemote();
    for (let i = 0; i < 23; i++) await commitFile(repo, `m${i}.txt`, `${i}\n`, `c${i}`);
    expect((await getSyncCommits(repo)).outgoing).toHaveLength(20);
    await g(repo, 'checkout', '--detach');
    expect(await getSyncCommits(repo)).toEqual({ incoming: [], outgoing: [] });
  });
});

describe('pushRepo', () => {
  it('envia os commits locais para o upstream', async () => {
    const { repo, remote } = await withRemote();
    await commitFile(repo, 'l1.txt', 'l1\n', 'local 1');
    const r = await pushRepo(repo);
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining("origin/main") });
    expect(await out(remote, 'log', '-1', '--format=%s', 'main')).toBe('local 1');
    expect(await pushRepo(repo)).toMatchObject({ ok: true, message: expect.stringContaining('já está em dia') });
  });

  it('publica uma branch sem upstream e cria o upstream', async () => {
    const { repo, remote } = await withRemote();
    await g(repo, 'checkout', '-b', 'feat/nova', '--no-track', 'origin/main');
    await commitFile(repo, 'n.txt', 'n\n', 'nova');
    const r = await pushRepo(repo);
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('publicada') });
    expect(await out(repo, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/feat/nova');
    expect(await out(remote, 'log', '-1', '--format=%s', 'feat/nova')).toBe('nova');
  });

  it('com upstream de outro nome, envia para a branch do upstream', async () => {
    const { repo, remote } = await withRemote();
    await g(repo, 'checkout', '-b', 'nome-local', '--no-track');
    await g(repo, 'push', '-u', 'origin', 'nome-local:refs/heads/nome-remoto');
    await commitFile(repo, 'x.txt', 'x\n', 'em outro nome');
    expect(await pushRepo(repo)).toMatchObject({ ok: true });
    expect(await out(remote, 'log', '-1', '--format=%s', 'nome-remoto')).toBe('em outro nome');
    expect((await g(remote, 'branch', '--list', 'nome-local')).stdout.trim()).toBe('');
  });

  it('NUNCA força: se o remoto tem commits novos, recusa, manda atualizar e nada muda no remoto', async () => {
    const { repo, remote, other } = await withRemote();
    await commitFile(other, 'o.txt', 'o\n', 'da outra pessoa');
    await g(other, 'push', 'origin', 'main');
    const before = await out(remote, 'rev-parse', 'main');
    await commitFile(repo, 'l.txt', 'l\n', 'meu commit');
    const r = await pushRepo(repo);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('atualize a branch antes de enviar');
    expect(await out(remote, 'rev-parse', 'main')).toBe(before);
  });

  it('erros claros: HEAD desanexado e repositório sem remoto', async () => {
    const { repo } = await withRemote();
    await g(repo, 'checkout', '--detach');
    expect(await pushRepo(repo)).toMatchObject({ ok: false, message: expect.stringContaining('HEAD desanexado') });
    const lonely = tmp('gn-sy-lonely-');
    await g(lonely, 'init', '-b', 'main');
    await config(lonely);
    await commitFile(lonely, 'a.txt', 'a\n', 'init');
    expect(await pushRepo(lonely)).toMatchObject({ ok: false, message: expect.stringContaining('não tem remoto') });
  });

  it('o progresso é publicado como evento com a operação "push"', async () => {
    const { repo } = await withRemote();
    const seen: GitProgressEvent[] = [];
    const off = onGitProgress((e) => seen.push(e));
    await commitFile(repo, 'p.txt', 'p\n', 'p');
    await pushRepo(repo);
    off();
    // o git só escreve progresso quando há o que transferir; em repositórios minúsculos pode ser pouco, mas nunca de outra operação
    expect(seen.every((e) => e.op === 'push' && e.repoPath === repo && e.percent !== null && e.percent >= 0 && e.percent <= 100)).toBe(true);
  });
});

describe('updateRepo (como o "Update" do IntelliJ, com autostash)', () => {
  it('fast-forward quando está só atrás', async () => {
    const { repo, other } = await withRemote();
    await commitFile(other, 'o.txt', 'o\n', 'remoto');
    await g(other, 'push', 'origin', 'main');
    const r = await updateRepo(repo, 'ff');
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('fast-forward') });
    expect(await out(repo, 'log', '-1', '--format=%s')).toBe('remoto');
    expect(await updateRepo(repo, 'ff')).toMatchObject({ ok: true, message: expect.stringContaining('atualizado') });
  });

  it('com alterações locais em outro arquivo: guarda, atualiza e devolve', async () => {
    const { repo, other } = await withRemote();
    await commitFile(other, 'o.txt', 'o\n', 'remoto');
    await g(other, 'push', 'origin', 'main');
    writeFileSync(join(repo, 'a.txt'), 'um\nminha alteração\n'); // alteração não commitada
    const r = await updateRepo(repo, 'ff');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('guardadas e devolvidas');
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('um\nminha alteração\n');
    expect(await out(repo, 'log', '-1', '--format=%s')).toBe('remoto');
    expect(await out(repo, 'stash', 'list')).toBe(''); // nada ficou esquecido no stash
  });

  it('o fast-forward recusa a divergência e manda escolher merge ou rebase', async () => {
    const { repo, other } = await withRemote();
    await commitFile(other, 'o.txt', 'o\n', 'remoto');
    await g(other, 'push', 'origin', 'main');
    await commitFile(repo, 'l.txt', 'l\n', 'local');
    const before = await out(repo, 'rev-parse', 'HEAD');
    const r = await updateRepo(repo, 'ff');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('merge ou com rebase');
    expect(await out(repo, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('divergida: merge e rebase', async () => {
    const a = await withRemote();
    await commitFile(a.other, 'o.txt', 'o\n', 'remoto');
    await g(a.other, 'push', 'origin', 'main');
    await commitFile(a.repo, 'l.txt', 'l\n', 'local');
    expect(await updateRepo(a.repo, 'merge')).toMatchObject({ ok: true, message: expect.stringContaining('merge') });
    expect(await out(a.repo, 'log', '--merges', '--format=%s', '-1')).toMatch(/Merge/);

    const b = await withRemote();
    await commitFile(b.other, 'o.txt', 'o\n', 'remoto');
    await g(b.other, 'push', 'origin', 'main');
    await commitFile(b.repo, 'l.txt', 'l\n', 'local');
    expect(await updateRepo(b.repo, 'rebase')).toMatchObject({ ok: true, message: expect.stringContaining('rebase') });
    expect((await out(b.repo, 'log', '--format=%s', '-3')).split('\n')).toEqual(['local', 'remoto', 'segundo']);
  });

  it('rebase com alterações locais: devolve as alterações depois do rebase', async () => {
    const { repo, other } = await withRemote();
    await commitFile(other, 'o.txt', 'o\n', 'remoto');
    await g(other, 'push', 'origin', 'main');
    await commitFile(repo, 'l.txt', 'l\n', 'local');
    writeFileSync(join(repo, 'a.txt'), 'um\nsuja\n');
    const r = await updateRepo(repo, 'rebase');
    expect(r.ok).toBe(true);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('um\nsuja\n');
  });

  it('conflito ao devolver as alterações guardadas: conflicted e as alterações continuam no stash', async () => {
    const { repo, other } = await withRemote();
    writeFileSync(join(other, 'a.txt'), 'remoto mudou a linha\n');
    await g(other, 'commit', '-am', 'remoto mexe em a.txt');
    await g(other, 'push', 'origin', 'main');
    writeFileSync(join(repo, 'a.txt'), 'local mudou a mesma linha\n'); // mexe no MESMO trecho, sem commitar
    const r = await updateRepo(repo, 'ff');
    expect(r).toMatchObject({ ok: false, conflicted: true });
    expect(r.message).toContain('stash');
    expect(await out(repo, 'log', '-1', '--format=%s')).toBe('remoto mexe em a.txt'); // a atualização aconteceu
    expect(await out(repo, 'stash', 'list')).not.toBe(''); // e nada foi perdido
  });

  it('erros claros: sem upstream e HEAD desanexado', async () => {
    const { repo } = await withRemote();
    await g(repo, 'checkout', '-b', 'solta', '--no-track');
    expect(await updateRepo(repo, 'ff')).toMatchObject({ ok: false, message: expect.stringContaining('não tem upstream') });
    await g(repo, 'checkout', '--detach');
    expect(await updateRepo(repo, 'ff')).toMatchObject({ ok: false, message: expect.stringContaining('HEAD desanexado') });
  });

  it('remota apagada: manda publicar de novo', async () => {
    const { repo, other } = await withRemote();
    await g(repo, 'checkout', '-b', 'efemera');
    await g(repo, 'push', '-u', 'origin', 'efemera');
    await g(other, 'push', 'origin', '--delete', 'efemera');
    await fetchRepo(repo);
    const r = await updateRepo(repo, 'ff');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('apagada');
  });
});
