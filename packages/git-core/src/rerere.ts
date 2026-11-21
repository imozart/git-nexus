// Resoluções gravadas pelo Git (`rerere`): reconhecer o arquivo que o Git já preencheu, esquecer a resolução e gravar a do usuário.
//
// O `rerere` guarda cada resolução em `.git/rr-cache/<id>/` (`preimage` = o conflito, `postimage` = como foi resolvido, `thisimage` = o
// conflito da última vez que apareceu). O <id> é o SHA do conflito normalizado (os dois lados de cada trecho, em ordem). Quando o
// conflito reaparece, o Git preenche o arquivo (`Resolved 'x' using previous resolution`), MAS deixa o índice em conflito e tira o
// caminho do MERGE_RR: `git rerere status` não lista mais o arquivo. Por isso aqui se reconhece o arquivo pela prova: o id do conflito
// atual tem resolução gravada E refazer a mesclagem que o Git faz (`merge-file thisimage preimage postimage`) dá o arquivo que está
// no disco. Se qualquer parte não bater, o arquivo é tratado como um arquivo qualquer sem marcador (nada é afirmado sem prova).

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RerereState } from './types/ipc.js';
import { resolveInsideRepo } from './paths.js';
import { runGit } from './runner.js';

/** O diretório `rr-cache` (pelo Git, que sabe onde fica o .git num worktree). */
async function rrCacheDir(repoPath: string): Promise<string> {
  const r = await runGit(repoPath, ['rev-parse', '--git-path', 'rr-cache'], { check: false });
  return resolve(repoPath, r.stdout.trim() || '.git/rr-cache');
}

/** O `rerere` está ligado neste repositório? (`rerere.enabled`; sem a chave, o Git liga se a pasta `rr-cache` existe.) */
async function rerereEnabled(repoPath: string): Promise<boolean> {
  const value = await runGit(repoPath, ['config', '--type=bool', '--get', 'rerere.enabled'], { check: false });
  const set = value.code === 0 ? value.stdout.trim() : '';
  return set === 'true' || (set === '' && existsSync(await rrCacheDir(repoPath)));
}

/** O estado do `rerere` neste repositório: ligado (por qualquer configuração) e se a chave está no `.git/config` do próprio repositório. */
export async function getRerereState(repoPath: string): Promise<RerereState> {
  const [enabled, local] = await Promise.all([rerereEnabled(repoPath), runGit(repoPath, ['config', '--local', '--type=bool', '--get', 'rerere.enabled'], { check: false })]);
  return { enabled, local: local.code === 0 };
}

/** Liga ou desliga o `rerere` SÓ neste repositório (`git config --local`): nunca mexe na configuração global do usuário. */
export async function setRerereEnabled(repoPath: string, enabled: boolean): Promise<RerereState> {
  await runGit(repoPath, ['config', '--local', 'rerere.enabled', enabled ? 'true' : 'false']);
  return getRerereState(repoPath);
}

// ---------------------------------------------------------------- o id do conflito

/** O texto do conflito como o Git o escreve (`git merge-file`, o mesmo motor da mesclagem), a partir dos três estágios. */
async function conflictText(repoPath: string, base: Buffer | null, ours: Buffer, theirs: Buffer): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'gnrr-'));
  try {
    const [b, o, t] = [join(dir, 'base'), join(dir, 'ours'), join(dir, 'theirs')];
    await Promise.all([writeFile(b, base ?? Buffer.alloc(0)), writeFile(o, ours), writeFile(t, theirs)]);
    const r = await runGit(repoPath, ['merge-file', '-p', '-L', 'ours', '-L', 'base', '-L', 'theirs', o, b, t], { check: false });
    // o código de saída é o número de conflitos (1 a 127); 0 = sem conflito; outro = erro
    return r.code >= 1 && r.code <= 127 ? r.bytes : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** O id que o `rerere` dá ao conflito: SHA dos dois lados de cada trecho (o menor primeiro), como em `rerere.c`. */
function conflictId(text: Buffer, algo: 'sha1' | 'sha256'): string | null {
  const hash = createHash(algo);
  let state: 'out' | 'ours' | 'base' | 'theirs' = 'out';
  let one: Buffer[] = [];
  let two: Buffer[] = [];
  let found = false;
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf(10, start);
    const end = nl === -1 ? text.length : nl + 1;
    const line = text.subarray(start, end);
    start = end;
    const bare = line.toString('latin1').replace(/\r?\n$/, '');
    if (bare.startsWith('<<<<<<<') && state === 'out') {
      state = 'ours';
      one = [];
      two = [];
    } else if (bare.startsWith('|||||||') && state === 'ours') state = 'base';
    else if (bare === '=======' && (state === 'ours' || state === 'base')) state = 'theirs';
    else if (bare.startsWith('>>>>>>>') && state === 'theirs') {
      let a = Buffer.concat(one);
      let b = Buffer.concat(two);
      if (Buffer.compare(a, b) > 0) [a, b] = [b, a];
      hash.update(a).update(Buffer.from([0])).update(b).update(Buffer.from([0]));
      found = true;
      state = 'out';
    } else if (state === 'ours') one.push(line);
    else if (state === 'theirs') two.push(line);
  }
  return found ? hash.digest('hex') : null;
}

/** O Git calcula o id sobre o arquivo do disco, que no Windows costuma ter CRLF (autocrlf) mesmo com o índice em LF: tenta as duas formas. */
function candidateIds(text: Buffer, algo: 'sha1' | 'sha256'): string[] {
  const lf = Buffer.from(text.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  const crlf = Buffer.from(lf.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');
  const ids = [text, lf, crlf].map((t) => conflictId(t, algo)).filter((x): x is string => !!x);
  return [...new Set(ids)];
}

/** Os estágios do índice do arquivo em conflito (já lidos por quem chama, para não ler de novo). */
export interface Stages {
  base: Buffer | null;
  ours: Buffer | null;
  theirs: Buffer | null;
}

interface Recorded {
  id: string;
  dir: string;
  /** Quando a resolução foi gravada (o `postimage`). */
  at: Date;
}

/** Os arquivos `preimage.N`/`postimage.N` de cada variante gravada (a variante 0 não tem sufixo). */
async function variants(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => n === 'postimage' || /^postimage\.\d+$/.test(n)).map((n) => n.slice('postimage'.length));
}

const stripCr = (b: Buffer): string => b.toString('latin1').replace(/\r/g, '');

/**
 * A resolução gravada que o Git aplicou a este arquivo, se houver PROVA: o id do conflito atual tem resolução no `rr-cache` e refazer a
 * mesclagem do `rerere` sobre o conflito atual dá exatamente o arquivo que está no disco. `null` caso contrário.
 */
async function recordedFor(repoPath: string, filePath: string, working?: Buffer, known?: Stages): Promise<Recorded | null> {
  if (!(await rerereEnabled(repoPath))) return null;
  const stage = async (n: 1 | 2 | 3) => {
    const r = await runGit(repoPath, ['show', `:${n}:${filePath}`], { check: false });
    return r.code === 0 ? r.bytes : null;
  };
  const [base, ours, theirs] = known ? [known.base, known.ours, known.theirs] : await Promise.all([stage(1), stage(2), stage(3)]);
  if (!ours || !theirs) return null;
  const [text, format, cache] = await Promise.all([
    conflictText(repoPath, base, ours, theirs),
    runGit(repoPath, ['rev-parse', '--show-object-format'], { check: false }),
    rrCacheDir(repoPath),
  ]);
  if (!text) return null;
  const algo = format.stdout.trim() === 'sha256' ? 'sha256' : 'sha1';
  for (const id of candidateIds(text, algo)) {
    const dir = join(cache, id);
    const vs = await variants(dir);
    if (!vs.length) continue;
    const at = (await stat(join(dir, `postimage${vs[0]}`)).catch(() => null))?.mtime;
    if (!at) continue;
    if (!working) return { id, dir, at };
    for (const v of vs) {
      const pre = join(dir, `preimage${v}`);
      const post = join(dir, `postimage${v}`);
      const thisimage = join(dir, 'thisimage');
      if (![pre, post, thisimage].every((p) => existsSync(p))) continue;
      // o que o Git fez ao aplicar: a mescla de "o conflito atual" com a mudança preimage → postimage
      const replay = await runGit(repoPath, ['merge-file', '-p', '-L', '', '-L', '', '-L', '', thisimage, pre, post], { check: false });
      if (replay.code === 0 && (replay.bytes.equals(working) || stripCr(replay.bytes) === stripCr(working))) return { id, dir, at };
    }
  }
  return null;
}

/** Quando a resolução gravada que o Git aplicou a este arquivo foi gravada (ISO), ou `null` se o arquivo não veio do `rerere`. */
export async function recordedResolutionDate(repoPath: string, filePath: string, working: Buffer, stages?: Stages): Promise<string | null> {
  try {
    return (await recordedFor(repoPath, filePath, working, stages))?.at.toISOString() ?? null;
  } catch {
    return null; // sem prova, nada é afirmado
  }
}

/**
 * Esquece a resolução gravada deste arquivo e devolve o conflito original (com os marcadores no disco). Apaga a entrada do `rr-cache`
 * (o `git rerere forget` não acha o id quando o arquivo do disco tem CRLF e o índice LF) e recria o conflito (`git checkout -m`); o
 * `git rerere` seguinte volta a acompanhar o arquivo, para gravar a resolução nova. Devolve false se não havia o que esquecer.
 */
export async function forgetRecordedResolution(repoPath: string, filePath: string): Promise<boolean> {
  resolveInsideRepo(repoPath, filePath);
  const working = await readFile(resolveInsideRepo(repoPath, filePath)).catch(() => undefined);
  const rec = await recordedFor(repoPath, filePath, working);
  if (!rec) return false;
  await rm(rec.dir, { recursive: true, force: true });
  const r = await runGit(repoPath, ['checkout', '-m', '--', filePath], { check: false });
  if (r.code !== 0) return false;
  await runGit(repoPath, ['rerere'], { check: false });
  return true;
}

/**
 * Grava as resoluções que o usuário acabou de marcar como resolvidas (`git rerere`; o Git só faria isso no commit seguinte). Devolve os
 * caminhos gravados. Sem `rerere` ligado não faz nada.
 */
export async function recordResolutions(repoPath: string): Promise<string[]> {
  if (!(await rerereEnabled(repoPath))) return [];
  const r = await runGit(repoPath, ['rerere'], { check: false });
  const out: string[] = [];
  for (const m of `${r.stderr}\n${r.stdout}`.matchAll(/Recorded resolution for '(.+)'\./g)) out.push(m[1]!);
  return out;
}
