// Busca v2 no conteúdo dos arquivos: dispara o `git grep` (o motor), lê o resultado em lotes, devolve o destaque nas colunas que o próprio Git achou e
// cancela de verdade. A busca de várias linhas escolhe os candidatos com o `git grep -l` e varre o conteúdo aqui, no núcleo (nunca na interface).
import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { decodeText, detectEncoding } from './encoding.js';
import { tm } from './messages.js';
import { resolveInsideRepo } from './paths.js';
import { runGit } from './runner.js';
import { GrepParser, byteColToIndex, type RawHit } from './search-parse.js';
import {
  SEARCH_MAX_FILE_BYTES,
  buildGrepArgs,
  candidateLiteral,
  clipAround,
  compileJsRegex,
  dialectOf,
  fixedRanges,
  jsRegexFor,
  literalPathspec,
  maskPathspecs,
  normalizeQuery,
  regexRanges,
  type Dialect,
  type NormalizedQuery,
} from './search-pure.js';
import type { SearchDone, SearchHit, SearchQuery, SearchSkipped } from './types/ipc.js';

export interface SearchHooks {
  /** Identificador da busca (padrão: um novo). */
  id?: string;
  /** Cancela de verdade: o processo do `git grep` termina. */
  signal?: AbortSignal;
  /** Chamado com cada lote de ocorrências assim que ele fica pronto (o primeiro sai logo). */
  onBatch?: (hits: SearchHit[]) => void;
}

export interface SearchOutcome {
  done: SearchDone;
  /** Todas as ocorrências desta página, na ordem em que o Git as achou. */
  hits: SearchHit[];
}

/** O Git daqui suporta `-P` (PCRE2)? Descoberto uma vez por executável: algumas builds do Git vêm sem. */
let pcreProbe: { git: string; ok: Promise<boolean> } | null = null;
export function supportsPcre(repoPath: string): Promise<boolean> {
  const git = process.env.GITNEXUS_GIT_PATH || 'git';
  if (!pcreProbe || pcreProbe.git !== git) {
    // todos os arquivos excluídos: o Git compila a expressão (e recusa se não houver PCRE2) sem ler nada
    pcreProbe = { git, ok: runGit(repoPath, ['grep', '-P', '-c', '-e', 'a', '--', ':(exclude)*'], { check: false }).then((r) => r.code <= 1, () => false) };
  }
  return pcreProbe.ok;
}

/** Mensagens do Git em inglês (a leitura de "Binary file x matches" não depende do idioma) e o resto da localização intacto. */
const GREP_ENV = { LC_MESSAGES: 'C', LANGUAGE: 'C' } as const;
/** Quantos arquivos o `changed` passa por vez ao git (o limite da linha de comando do Windows é ~32 mil caracteres). */
const CHANGED_CHUNK = 150;
const SKIPPED_CAP = 500;

const sleepTick = () => new Promise<void>((r) => setImmediate(r));

/** Os arquivos do escopo (já com as máscaras): serve de candidatos da busca de várias linhas e de contagem de "arquivos olhados". */
export async function listScopeFiles(repoPath: string, q: NormalizedQuery, signal?: AbortSignal): Promise<string[]> {
  const specs = maskPathspecs(q.masks);
  if (q.scope === 'changed') {
    const r = await runGit(repoPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { check: false, signal });
    const parts = r.stdout.split('\0');
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const e = parts[i]!;
      if (e.length < 4) continue;
      const [x, y] = [e[0]!, e[1]!];
      if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++; // o nome antigo vem no campo seguinte
      if (x === 'D' || y === 'D') continue;
      out.push(e.slice(3));
    }
    if (!specs.length) return out;
    const r2 = await runGit(repoPath, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...specs], { check: false, signal });
    const allowed = new Set(r2.stdout.split('\0').filter(Boolean));
    return out.filter((f) => allowed.has(f));
  }
  const args =
    q.scope === 'revision'
      ? ['ls-tree', '-r', '--name-only', '-z', q.revision, '--']
      : ['ls-files', '-z', ...(q.scope === 'worktree' && (q.includeUntracked || q.includeIgnored) ? ['--cached', '--others', ...(q.includeIgnored ? [] : ['--exclude-standard'])] : []), '--'];
  const r = await runGit(repoPath, [...args, ...(q.scope === 'revision' ? [] : specs)], { check: false, signal });
  const files = r.stdout.split('\0').filter(Boolean);
  return q.scope === 'revision' && specs.length ? filterRevisionFiles(files, q) : files;
}

/** `ls-tree` não entende máscara: filtra pelos globs aqui (só serve de contagem e de candidatos da busca de várias linhas numa revisão). */
function filterRevisionFiles(files: string[], q: NormalizedQuery): string[] {
  const toRe = (g: string) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\/\*\*$/, '/.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
  const inc = q.masks.include.map(toRe);
  const exc = q.masks.exclude.map(toRe);
  return files.filter((f) => (!inc.length || inc.some((r) => r.test(f))) && !exc.some((r) => r.test(f)));
}

const messageFor = (e: ReturnType<typeof normalizeQuery> & { error: unknown }): string => {
  const err = e.error as { code: string; max?: number; mask?: string; rev?: string };
  if (err.code === 'tooLong') return tm('search.tooLong', { max: err.max ?? 0 });
  if (err.code === 'badMask') return tm('search.badMask', { mask: err.mask ?? '' });
  return tm('search.badRevision', { rev: err.rev ?? '' });
};

/**
 * Busca no repositório. O `git grep` é o motor (vê o índice e outras revisões, respeita o `.gitignore`); o resultado chega em lotes por `onBatch` e a
 * busca pode ser cancelada de verdade por `signal` (o processo termina). Nunca lança por causa da busca: o motivo de uma falha vem em `done.message`.
 */
export async function searchRepository(repoPath: string, query: SearchQuery, hooks: SearchHooks = {}): Promise<SearchOutcome> {
  const started = Date.now();
  const id = hooks.id ?? randomUUID();
  const base: SearchDone = { id, ok: true, dialect: 'fixed', hits: 0, files: 0, skipped: [], cancelled: false, truncated: false, ms: 0 };
  const finish = (patch: Partial<SearchDone>, hits: SearchHit[] = []): SearchOutcome => ({ done: { ...base, ...patch, ms: Date.now() - started }, hits });

  const norm = normalizeQuery(query);
  if ('error' in norm) return norm.error.code === 'empty' ? finish({}) : finish({ ok: false, message: messageFor(norm) });
  const q = norm.query;

  // sinal único: o do chamador, o tempo máximo e o limite de ocorrências encerram o mesmo processo; `stop` diz quem foi
  let stop: 'cancel' | 'time' | 'limit' | null = null;
  const ctl = new AbortController();
  const halt = (why: 'cancel' | 'time' | 'limit') => {
    stop ??= why;
    ctl.abort();
  };
  if (hooks.signal?.aborted) return finish({ cancelled: true });
  hooks.signal?.addEventListener('abort', () => halt('cancel'), { once: true });
  const timer = setTimeout(() => halt('time'), q.timeoutMs);

  try {
    if (q.scope === 'revision') {
      const rev = await runGit(repoPath, ['rev-parse', '--verify', '--quiet', `${q.revision}^{commit}`], { check: false, signal: ctl.signal });
      if (rev.code !== 0 && !stop) return finish({ ok: false, reason: 'noRevision', message: tm('search.noRevision', { rev: q.revision }) });
    }
    const pcre = q.multiline ? false : await supportsPcre(repoPath);
    const dialect: Dialect | 'javascript' = q.multiline ? 'javascript' : dialectOf(q, pcre);
    const hits: SearchHit[] = [];
    const skipped: SearchSkipped[] = [];
    const filesSeen = new Set<string>();
    let seen = 0;
    let nextOffset: number | undefined;
    let batch: SearchHit[] = [];
    let lastFlush = 0;
    const flush = () => {
      if (!batch.length) return;
      const b = batch;
      batch = [];
      lastFlush = Date.now();
      try {
        hooks.onBatch?.(b);
      } catch {
        /* quem recebe os lotes não pode derrubar a busca */
      }
    };
    /** `false` = a página encheu: não precisa de mais nada. */
    const emit = (h: SearchHit): boolean => {
      if (stop !== null) return false; // cancelada, no limite ou sem tempo: o que ainda estava na fila não sai
      seen++;
      if (seen <= q.offset) return true;
      if (hits.length >= q.limit) {
        nextOffset = q.offset + q.limit;
        halt('limit');
        return false;
      }
      hits.push(h);
      filesSeen.add(h.file);
      batch.push(h);
      if (hits.length === 1 || batch.length >= 200 || Date.now() - lastFlush >= 50) flush();
      return true;
    };
    const skip = (file: string, reason: SearchSkipped['reason']) => {
      if (skipped.length < SKIPPED_CAP && !skipped.some((s) => s.file === file)) skipped.push({ file, reason });
    };

    // arquivos olhados (estimativa): em paralelo com a busca
    const looked = listScopeFiles(repoPath, q, ctl.signal).then((f) => f.length, () => undefined);

    let failure: string | undefined;
    if (q.multiline) failure = await multilineSearch(repoPath, q, pcre, ctl.signal, emit, skip, () => stop !== null);
    else failure = await grepSearch(repoPath, q, pcre, dialect as Dialect, ctl.signal, emit, skip, () => stop !== null);
    flush();

    if (failure && !stop) return finish({ ok: false, message: failure, dialect }, []);
    const filesLooked = await looked;
    return finish(
      {
        dialect,
        hits: hits.length,
        files: filesSeen.size,
        ...(filesLooked !== undefined ? { filesLooked } : {}),
        skipped,
        cancelled: stop === 'cancel',
        truncated: stop === 'limit' || stop === 'time',
        ...(stop === 'limit' || stop === 'time' ? { truncatedReason: stop } : {}),
        ...(stop === 'limit' && nextOffset !== undefined ? { nextOffset } : {}),
        ...(stop === 'time' ? { message: tm('search.timeout', { s: Math.round(q.timeoutMs / 1000) }) } : {}),
      },
      hits,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- busca por linha (git grep em fluxo)

interface LineHit {
  line: number;
  endLine: number;
  ranges: Array<[number, number]>;
}
type Emit = (h: SearchHit) => boolean;
type Skip = (file: string, reason: SearchSkipped['reason']) => void;

async function grepSearch(repoPath: string, q: NormalizedQuery, pcre: boolean, dialect: Dialect, signal: AbortSignal, emit: Emit, skip: Skip, stopped: () => boolean): Promise<string | undefined> {
  // o `changed` passa os arquivos ao git em pedaços; os demais escopos são uma execução só
  const runs: Array<string[] | undefined> = [undefined];
  if (q.scope === 'changed') {
    const files = await listScopeFiles(repoPath, q, signal);
    if (!files.length) return undefined;
    runs.length = 0;
    for (let i = 0; i < files.length; i += CHANGED_CHUNK) runs.push(files.slice(i, i + CHANGED_CHUNK).map(literalPathspec));
  }
  const oracleCache = new Map<string, Map<number, Array<{ byteCol: number; len: number }>>>();

  /** Os trechos achados na linha, nas colunas do `git grep -o` (o oráculo), para quando a RegExp do JavaScript não reproduz o que o Git achou. */
  const oracle = async (file: string): Promise<Map<number, Array<{ byteCol: number; len: number }>>> => {
    let m = oracleCache.get(file);
    if (m) return m;
    m = new Map();
    oracleCache.set(file, m);
    const args = buildGrepArgs({ ...q, contextBefore: 0, contextAfter: 0 }, { pcre, threads: 1, onlyMatching: true, files: [literalPathspec(file)] });
    const r = await runGit(repoPath, args, { check: false, env: GREP_ENV, signal });
    const prefix = q.scope === 'revision' ? `${q.revision}:` : '';
    const buf = r.bytes;
    let from = 0;
    for (let nl = buf.indexOf(0x0a, from); from < buf.length; nl = buf.indexOf(0x0a, from)) {
      const end = nl < 0 ? buf.length : nl;
      const rec = buf.subarray(from, end);
      from = end + 1;
      const a = rec.indexOf(0);
      const b = a < 0 ? -1 : rec.indexOf(0, a + 1);
      const c = b < 0 ? -1 : rec.indexOf(0, b + 1);
      if (c < 0) continue;
      const name = rec.subarray(0, a).toString('utf8');
      if ((prefix && name !== `${prefix}${file}`) || (!prefix && name !== file)) continue;
      const line = Number(rec.subarray(a + 1, b).toString('ascii'));
      const col = Number(rec.subarray(b + 1, c).toString('ascii'));
      const len = stripLen(rec.subarray(c + 1));
      if (!m.has(line)) m.set(line, []);
      m.get(line)!.push({ byteCol: col, len });
      if (nl < 0) break;
    }
    return m;
  };

  /** Todos os trechos da linha: a posição vem do Git e o resto, da mesma expressão aplicada à linha (conferida com a coluna do Git). */
  const rangesFor = async (raw: RawHit): Promise<Array<[number, number]>> => {
    const col = byteColToIndex(raw.bytes, raw.byteCol);
    let r: Array<[number, number]> | null;
    if (dialect === 'fixed') r = fixedRanges(raw.text, q.pattern, q.caseSensitive, q.wholeWord);
    else {
      const re = jsRegexFor(q);
      r = re ? regexRanges(raw.text, re) : null;
    }
    if (raw.byteCol > 0 && !r?.some((x) => x[0] === col)) {
      if (dialect === 'fixed') r = [[col, col + q.pattern.length]];
      else {
        // dialeto diferente: o `git grep -o` diz onde cada trecho começa e termina
        const list = (await oracle(raw.file)).get(raw.line) ?? [];
        r = list.map((x) => [byteColToIndex(raw.bytes, x.byteCol), byteColToIndex(raw.bytes, x.byteCol) + x.len] as [number, number]);
        if (!r.length) r = [[col, col + 1]];
      }
    }
    return r ?? [];
  };

  let failure: string | undefined;
  for (const files of runs) {
    if (stopped()) break;
    const pending: RawHit[] = [];
    const binaries: string[] = [];
    let pump: Promise<void> = Promise.resolve();
    let open = true;
    const drain = async (): Promise<void> => {
      while (pending.length && open) {
        const raw = pending.shift()!;
        const ranges = await rangesFor(raw);
        const clip = clipAround(raw.text, ranges);
        const ok = emit({
          file: raw.file,
          line: raw.line,
          text: clip.text,
          ...(clip.clippedStart ? { clippedStart: true } : {}),
          ...(clip.clippedEnd ? { clippedEnd: true } : {}),
          ranges: clip.ranges,
          before: raw.before,
          after: raw.after,
        });
        if (!ok) open = false;
      }
    };
    const parser = new GrepParser((h) => pending.push(h), { before: q.contextBefore, after: q.contextAfter }, q.scope === 'revision' ? `${q.revision}:` : '');
    const args = buildGrepArgs(q, { pcre, threads: Math.min(8, Math.max(1, cpus().length)), ...(files ? { files } : {}) });
    const r = await runGit(repoPath, args, {
      check: false,
      env: GREP_ENV,
      signal,
      discardStdout: true,
      onStdout: (chunk) => {
        parser.push(chunk);
        if (pending.length) pump = pump.then(drain);
      },
    });
    parser.end();
    pump = pump.then(drain);
    await pump;
    binaries.push(...parser.binaries);
    for (const b of binaries) skip(b, 'binary');
    // 0 = achou, 1 = não achou, o resto é erro (expressão inválida, caminho fora do repositório...); encerrar pelo sinal não é erro
    if (!r.aborted && r.code > 1) {
      const detail = r.stderr.trim().split('\n').find((l) => l.trim()) ?? '';
      failure = q.regex ? tm('search.badRegex', { detail }) : detail || tm('search.failed');
      break;
    }
  }
  return failure;
}

/** Comprimento (em caracteres) do trecho que o `-o` imprimiu. */
const stripLen = (b: Buffer): number => b.toString('utf8').replace(/\r$/, '').length;

// ---------------------------------------------------------------- busca de várias linhas (candidatos do git + varredura no núcleo)

async function multilineSearch(repoPath: string, q: NormalizedQuery, pcre: boolean, signal: AbortSignal, emit: Emit, skip: Skip, stopped: () => boolean): Promise<string | undefined> {
  const compiled = compileJsRegex(q, 'ms');
  if ('error' in compiled) return tm('search.badRegex', { detail: compiled.error });
  const re = compiled.re;

  // 1) candidatos: o `git grep -l` com o trecho fixo mais longo da pergunta; sem trecho fixo, todos os arquivos do escopo
  let candidates: string[];
  const literal = candidateLiteral(q.pattern, q.regex);
  if (literal && q.scope !== 'changed') {
    const args = buildGrepArgs(q, { pcre, threads: Math.min(8, Math.max(1, cpus().length)), listFiles: true, pattern: literal, fixed: true });
    const r = await runGit(repoPath, args, { check: false, env: GREP_ENV, signal });
    if (!r.aborted && r.code > 1) return r.stderr.trim().split('\n').find((l) => l.trim()) || tm('search.failed');
    const prefix = q.scope === 'revision' ? `${q.revision}:` : '';
    candidates = r.stdout.split('\0').filter(Boolean).map((f) => (prefix && f.startsWith(prefix) ? f.slice(prefix.length) : f));
  } else {
    candidates = await listScopeFiles(repoPath, q, signal);
  }

  // 2) varredura do conteúdo (decodificado), um arquivo por vez, devolvendo o controle ao laço de eventos entre eles para o cancelamento valer
  for (const file of candidates) {
    if (stopped()) break;
    await sleepTick();
    const bytes = await readCandidate(repoPath, q, file, signal, skip);
    if (!bytes) continue;
    const text = decodeText(bytes, detectEncoding(bytes)).text;
    const lines = text.split(/\r\n|\n/);
    const starts: number[] = [];
    for (let i = 0, at = 0; i < lines.length; i++) {
      starts.push(at);
      at += lines[i]!.length + (text.startsWith('\r\n', at + lines[i]!.length) ? 2 : 1);
    }
    const lineOf = (pos: number): number => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid]! <= pos) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    re.lastIndex = 0;
    let current = null as LineHit | null;
    const done: LineHit[] = [];
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const li = lineOf(m.index);
      const lj = lineOf(m.index + m[0].length - 1);
      const from = m.index - starts[li]!;
      const to = Math.min(lines[li]!.length, m.index + m[0].length - starts[li]!);
      if (current && current.line === li) {
        current.ranges.push([from, to]);
        current.endLine = Math.max(current.endLine, lj);
      } else {
        if (current) done.push(current);
        current = { line: li, endLine: lj, ranges: [[from, to]] };
      }
    }
    if (current) done.push(current);
    for (const h of done) {
      const clip = clipAround(lines[h.line]!, h.ranges);
      const ctx = (lo: number, hi: number) => {
        const out = [];
        for (let i = Math.max(0, lo); i <= Math.min(lines.length - 1, hi); i++) out.push({ line: i + 1, text: lines[i]! });
        return out;
      };
      const ok = emit({
        file,
        line: h.line + 1,
        ...(h.endLine > h.line ? { endLine: h.endLine + 1 } : {}),
        text: clip.text,
        ...(clip.clippedStart ? { clippedStart: true } : {}),
        ...(clip.clippedEnd ? { clippedEnd: true } : {}),
        ranges: clip.ranges,
        before: q.contextBefore ? ctx(h.line - q.contextBefore, h.line - 1) : [],
        after: q.contextAfter ? ctx(h.endLine + 1, h.endLine + q.contextAfter) : [],
      });
      if (!ok) return undefined;
    }
  }
  return undefined;
}

/** O conteúdo de um candidato no escopo da busca, ou `null` (e registra o motivo) se é binário, grande demais, link simbólico ou não dá para ler. */
async function readCandidate(repoPath: string, q: NormalizedQuery, file: string, signal: AbortSignal, skip: Skip): Promise<Buffer | null> {
  let bytes: Buffer;
  try {
    if (q.scope === 'revision' || q.scope === 'staged') {
      const r = await runGit(repoPath, ['show', q.scope === 'staged' ? `:${file}` : `${q.revision}:${file}`], { check: false, signal });
      if (r.code !== 0) return null;
      bytes = r.bytes;
    } else {
      const full = resolveInsideRepo(repoPath, file);
      const st = await lstat(full);
      if (st.isSymbolicLink() || !st.isFile()) return null; // nunca sai do repositório por atalho
      if (st.size > SEARCH_MAX_FILE_BYTES) return skip(file, 'large'), null;
      bytes = await readFile(full);
    }
  } catch {
    return null;
  }
  if (bytes.length > SEARCH_MAX_FILE_BYTES) return skip(file, 'large'), null;
  if (bytes.subarray(0, 8000).includes(0)) return skip(file, 'binary'), null;
  return bytes;
}
