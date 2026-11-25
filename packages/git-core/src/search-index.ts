// Índice de busca persistente (fase 10 da #233): o gerenciador. Constrói e atualiza, em segundo plano, um índice de trigramas do que está no disco de cada repositório
// e responde, antes de cada busca, "quais arquivos podem conter este texto?". O `git grep` continua sendo quem acha e confere: o índice só encurta a lista de
// arquivos que ele lê. Por isso o resultado é IDÊNTICO ao da busca sem índice (mesmos acertos, mesma ordem, mesma lista de binários):
//   - o índice vale para o que está limpo (o disco é igual ao que o Git tem, `git ls-files -s`); o que está sujo (`git status`), o que ainda não entrou no índice e o
//     que o índice nunca guarda (binário, grande demais, atalho) é sempre conferido direto, junto com os candidatos;
//   - qualquer dúvida (índice corrompido, arquivo fora do UTF-8, máscara estranha, expressão que a análise não entende) devolve `null` e a busca roda como sempre.
import { createHash, randomInt } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { tm } from './messages.js';
import { resolveInsideRepo } from './paths.js';
import { runGit } from './runner.js';
import type { NormalizedQuery } from './search-pure.js';
import { untrackedOrder, type AccelCandidates, type SearchAccelerator } from './search-run.js';
import { INDEX_RULE, suggestIndex, type IndexRule } from './search-index-pure.js';
import { Segment, clearDictCache, mergeSegments, writeSegment } from './trigram-index.js';
import {
  CorruptIndexError,
  TrigramCollector,
  intersect,
  maskMatcher,
  masksAreSimple,
  planTrigrams,
  sortGitPaths,
} from './trigram-index-pure.js';
import { parseWslPath } from './wsl.js';
import type { SearchDone, SearchIndexAction, SearchIndexInfo, SearchIndexMode, SearchIndexState } from './types/ipc.js';

/** Arquivos maiores que isto não entram no índice: o Git os confere sempre (poucos, e ler um deles custa mais que guardar o índice dele). */
export const INDEX_MAX_FILE_BYTES = 2 * 1024 * 1024;
const BATCH_FILES = 4000;
const BATCH_BYTES = 12 * 1024 * 1024;
const MAX_SEGMENTS = 8;
const MERGE_COUNT = 4;
const READ_CONCURRENCY = 8;
const CHECKPOINT_MS = 10_000;
const DEFAULT_LIMIT_MB = 2048;
/** Mais candidatos que isto (e que a fração abaixo dos arquivos do repositório): o índice não ajuda, a busca roda como sempre. */
const MAX_CANDIDATES_FLOOR = 3000;
const MAX_CANDIDATES_FRACTION = 0.35;
const STALE_CAP = 5000;
const KEEP_RECENT = 10;
const TREE_MEASURE_TTL = 24 * 3_600_000;
const DISMISS_TTL = 7 * 24 * 3_600_000;
const SAMPLE_EVERY_MS = 60_000;
const SAMPLE_FILES = 6;
const OBSOLETE_DELAY_MS = 60_000;
const MEASURE_DELAY_MS = 3000;
/** Intervalo mínimo (padrão) entre o começo de duas atualizações: uma busca atrás da outra não faz uma atualização para cada. */
const SYNC_MIN_GAP_MS = 5000;
/** Linha de comando do Windows: ~32 mil caracteres no total; os arquivos de uma execução do `git grep` ficam abaixo disto. */


/** Um arquivo no manifesto: segmento, número no segmento (-1 = nunca vai ao índice), blob, 1 = sempre conferido, resumo do conteúdo lido. */
type Entry = [seg: number, doc: number, blob: string, always: number, hash: string];

interface Meta {
  v: 1;
  repo: string;
  mode: SearchIndexMode;
  state: SearchIndexState;
  paused: boolean;
  limitMB: number;
  rev: number;
  nextSeg: number;
  segs: number[];
  builtAt?: number;
  updatedAt?: number;
  /** Tamanho e data do arquivo `index` do Git quando o manifesto foi conferido com ele pela última vez. */
  sig?: IndexSig;
  /** Arquivos que o manifesto não cobre (ou cobre com outro blob) naquele momento: o Git os confere direto. */
  stale: string[];
  files: number;
  alwaysChecked: number;
  bytes: number;
  recent: number[];
  treeFiles?: number;
  treeBytes?: number;
  treeAt?: number;
  dismissedAt?: number;
  message?: string;
  invalidations: number;
}

/** O caminho de verdade do repositório (a mesma pasta pode chegar com o nome curto do Windows, `IAGO~1`, ou com outra caixa): um índice só por pasta. */
const canon = new Map<string, string>();
function canonical(repoPath: string): string {
  let c = canon.get(repoPath);
  if (c === undefined) {
    try {
      c = realpathSync.native(repoPath);
    } catch {
      c = resolve(repoPath);
    }
    canon.set(repoPath, c);
  }
  return c;
}

/** A pasta do índice de um repositório (um nome só, derivado do caminho de verdade). */
export function indexKey(repoPath: string): string {
  let p = canonical(repoPath);
  if (process.platform === 'win32') p = p.toLowerCase();
  return createHash('sha1').update(p).digest('hex').slice(0, 20);
}

const blankMeta = (repo: string): Meta => ({ v: 1, repo, mode: 'auto', state: 'none', paused: false, limitMB: DEFAULT_LIMIT_MB, rev: 0, nextSeg: 1, segs: [], stale: [], files: 0, alwaysChecked: 0, bytes: 0, recent: [], invalidations: 0 });

// ---------------------------------------------------------------- Git

/** `flagged`: o Git foi mandado ignorar o disco deste arquivo (`assume-unchanged` ou `skip-worktree`): o `status` não vê as mudanças dele, então o índice nunca confia nele. */
interface ListedFile {
  mode: string;
  blob: string;
  flagged: boolean;
}

/** Marca no manifesto: o arquivo é "sempre conferir" porque o Git o marcou, não por ser grande ou atalho. */
const FLAG_HASH = 'flag';
/** O manifesto está em dia com o que o Git lista? (mesmo blob, e a marca "sempre conferir" vinda do Git igual) */
const needsUpdate = (e: Entry | undefined, f: ListedFile): boolean => !e || e[2] !== f.blob || (f.flagged && e[4] !== FLAG_HASH) || (!f.flagged && e[4] === FLAG_HASH);

/** `git ls-files -s`: o que o Git tem (estágio 0, sem submódulos). `unsafe` = algum caminho não é UTF-8 válido (o índice não o enxerga direito). */
async function listIndex(repoPath: string, signal?: AbortSignal): Promise<{ files: Map<string, ListedFile>; unsafe: boolean } | null> {
  const r = await runGit(repoPath, ['ls-files', '-s', '-v', '-z'], { check: false, signal });
  if (r.aborted || r.code !== 0) return null;
  const files = new Map<string, ListedFile>();
  let unsafe = false;
  for (const rec of r.stdout.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [tag, mode, blob, stage] = rec.slice(0, tab).split(' ');
    if (stage !== '0' || mode === '160000') continue;
    const path = rec.slice(tab + 1);
    if (path.includes('�')) unsafe = true;
    files.set(path, { mode: mode!, blob: blob!, flagged: tag !== 'H' });
  }
  return { files, unsafe };
}

interface Dirty {
  /** Modificados, apagados, novos no índice ou em conflito: tudo o que o Git rastreia e o disco já não confere com ele. */
  tracked: Set<string>;
  /** Fora do Git e fora do `.gitignore`. */
  untracked: Set<string>;
  unsafe: boolean;
}

/** `git status`: o que mudou no disco. Sem travar o `index` do Git (`GIT_OPTIONAL_LOCKS=0`): o usuário pode estar usando o repositório ao mesmo tempo. */
async function dirtyPaths(repoPath: string, signal?: AbortSignal): Promise<Dirty | null> {
  const r = await runGit(repoPath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames', '--ignore-submodules=all'], { check: false, signal, env: { GIT_OPTIONAL_LOCKS: '0' } });
  if (r.aborted || r.code !== 0) return null;
  const out: Dirty = { tracked: new Set(), untracked: new Set(), unsafe: false };
  for (const rec of r.stdout.split('\0')) {
    if (rec.length < 4) continue;
    const path = rec.slice(3);
    if (path.includes('�')) out.unsafe = true;
    (rec.startsWith('??') ? out.untracked : out.tracked).add(path);
  }
  return out;
}

/** Onde está o arquivo `index` do Git (certo também em worktrees e submódulos). */
async function gitIndexFile(repoPath: string): Promise<string | null> {
  const r = await runGit(repoPath, ['rev-parse', '--git-path', 'index'], { check: false });
  const p = r.stdout.trim();
  if (r.code !== 0 || !p) return null;
  return isAbsolute(p) ? p : resolve(repoPath, p);
}

const hashOf = (bytes: Uint8Array): string => createHash('sha1').update(bytes).digest('hex').slice(0, 16);
/** Tamanho, data e número do arquivo `index` do Git: o Git o grava num arquivo novo e o renomeia, então o número muda a cada gravação mesmo quando o tamanho e a data (em sistemas de data grossa) não mudam. */
interface IndexSig {
  size: number;
  mtimeMs: number;
  ino: number;
}
const sameSig = (a: IndexSig | undefined, b: IndexSig): boolean => !!a && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;

// ---------------------------------------------------------------- índice de um repositório

class RepoIndex {
  meta: Meta;
  manifest: Map<string, Entry> | null = null;
  segs: Segment[] = [];
  private docs = new Map<number, string[]>();
  private loading: Promise<void> | null = null;
  private resumeChecked = false;
  task: Promise<void> | null = null;
  private ctl: AbortController | null = null;
  private progress: { done: number; total: number } | undefined;
  private gitIndex: string | null | undefined;
  private lastCheckpoint = 0;
  private lastEmit = 0;
  private lastSample = 0;
  private lastSync = 0;
  private metaTimer: NodeJS.Timeout | null = null;
  private treeMeasuring = false;
  private measureTimer: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  /** Sobe quando juntar segmentos troca os arquivos e renumera o manifesto: uma consulta que começou antes não pode misturar os dois estados. */
  private gen = 0;
  private rebuildPending = false;
  private lastSuggest: string | undefined;
  /** Trabalhos soltos (amostragem, medição, reconstrução): `dispose` espera por eles antes de soltar a pasta do repositório. */
  private readonly bg = new Set<Promise<unknown>>();

  constructor(
    private readonly owner: SearchIndexes,
    readonly repoPath: string,
    readonly dir: string,
  ) {
    this.meta = blankMeta(repoPath);
  }

  private get file(): string {
    return join(this.dir, 'meta.json');
  }

  // ------------------------------------------------------------ carregar e gravar

  load(): Promise<void> {
    this.loading ??= this.doLoad();
    return this.loading;
  }

  private async doLoad(): Promise<void> {
    let meta: Meta | null = null;
    try {
      const m = JSON.parse(await readFile(this.file, 'utf8')) as Meta;
      if (m && m.v === 1 && typeof m.mode === 'string') meta = { ...blankMeta(this.repoPath), ...m, repo: this.repoPath };
    } catch {
      /* sem meta (ou ilegível): começa do zero */
    }
    this.meta = meta ?? blankMeta(this.repoPath);
    if (this.meta.state !== 'none') {
      try {
        await this.openSegments();
      } catch {
        await this.reset('corrupt');
        this.rebuildPending = true; // abriu com o índice quebrado: recomeça sozinho (quem pediu a consulta já usa a busca sem ele)
      }
    }
    await this.sweep();
  }

  /** Abre os segmentos e o manifesto que o meta.json diz valerem (qualquer incoerência = índice corrompido). */
  private async openSegments(): Promise<void> {
    const segs: Segment[] = [];
    for (const id of this.meta.segs) segs.push(await Segment.open(this.dir, id));
    let list: unknown;
    try {
      list = JSON.parse(await readFile(join(this.dir, `manifest-${this.meta.rev}.json`), 'utf8'));
    } catch {
      throw new CorruptIndexError('manifesto');
    }
    if (!Array.isArray(list)) throw new CorruptIndexError('manifesto');
    const m = new Map<string, Entry>();
    for (const e of list as Array<[string, ...Entry]>) {
      if (!Array.isArray(e) || e.length !== 6 || typeof e[0] !== 'string') throw new CorruptIndexError('manifesto');
      m.set(e[0], [e[1], e[2], e[3], e[4], e[5]]);
    }
    this.segs = segs;
    this.manifest = m;
    this.docs.clear();
  }

  /** Apaga o que sobrou de uma construção interrompida: arquivos temporários, segmentos e manifestos que o meta.json não usa. */
  private async sweep(): Promise<void> {
    const keep = new Set(['meta.json', `manifest-${this.meta.rev}.json`]);
    for (const id of this.meta.segs) for (const ext of ['dict', 'post', 'docs']) keep.add(`seg-${id}.${ext}`);
    try {
      for (const name of await readdir(this.dir)) if (!keep.has(name)) await rm(join(this.dir, name), { force: true });
    } catch {
      /* a pasta pode ter sumido */
    }
  }

  private scheduleMeta(): void {
    if (this.metaTimer) return;
    this.metaTimer = setTimeout(() => {
      this.metaTimer = null;
      void this.writeMeta();
    }, 3000);
    this.metaTimer.unref?.();
  }

  async writeMeta(): Promise<void> {
    if (this.metaTimer) {
      clearTimeout(this.metaTimer);
      this.metaTimer = null;
    }
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(this.meta), 'utf8');
      await rename(`${this.file}.tmp`, this.file);
    } catch {
      /* sem disco: o índice segue na memória */
    }
  }

  /** Grava o manifesto e o meta.json (nesta ordem: o meta.json é quem torna o conjunto válido). */
  private async checkpoint(): Promise<void> {
    const manifest = this.manifest ?? new Map();
    const rev = this.meta.rev + 1;
    // em pedaços de 2 mil linhas: o manifesto de 100 mil arquivos não vira uma cópia inteira na memória
    const tmp = join(this.dir, `manifest-${rev}.json.tmp`);
    const fh = await open(tmp, 'w');
    let size = 0;
    try {
      let chunk: Array<[string, ...Entry]> = [];
      let first = true;
      const put = async (): Promise<void> => {
        if (!chunk.length) return;
        const text = (first ? '[' : ',') + JSON.stringify(chunk).slice(1, -1);
        first = false;
        chunk = [];
        size += Buffer.byteLength(text);
        await fh.write(text, null, 'utf8');
      };
      for (const [p, e] of manifest) {
        chunk.push([p, e[0], e[1], e[2], e[3], e[4]]);
        if (chunk.length >= 2000) await put();
      }
      await put();
      await fh.write(first ? '[]' : ']', null, 'utf8');
      size += 1;
    } finally {
      await fh.close();
    }
    await rename(tmp, join(this.dir, `manifest-${rev}.json`));
    const old = this.meta.rev;
    this.meta.rev = rev;
    this.meta.segs = this.segs.map((s) => s.id);
    this.meta.bytes = this.segs.reduce((n, s) => n + s.bytes, 0) + size;
    let always = 0;
    for (const e of manifest.values()) if (e[3]) always++;
    this.meta.files = manifest.size - always;
    this.meta.alwaysChecked = always;
    await this.writeMeta();
    if (old > 0) await rm(join(this.dir, `manifest-${old}.json`), { force: true });
    this.lastCheckpoint = Date.now();
  }

  /** Esquece o índice (arquivos e memória). O modo escolhido fica. */
  private async reset(why?: 'corrupt' | 'delete'): Promise<void> {
    // `nextSeg` NÃO volta ao começo: um segmento novo com o nome de um velho seria apagado pelo `retire` (minuto de atraso) do velho, ou lido com o dicionário velho do cache
    const keep = { nextSeg: this.meta.nextSeg, mode: this.meta.mode, limitMB: this.meta.limitMB, recent: this.meta.recent, treeFiles: this.meta.treeFiles, treeBytes: this.meta.treeBytes, treeAt: this.meta.treeAt, dismissedAt: this.meta.dismissedAt, invalidations: this.meta.invalidations + (why === 'corrupt' ? 1 : 0) };
    for (const s of this.segs) await s.remove();
    this.segs = [];
    this.manifest = null;
    this.docs.clear();
    clearDictCache(this.dir);
    try {
      for (const name of await readdir(this.dir)) await rm(join(this.dir, name), { force: true });
    } catch {
      /* pasta ausente */
    }
    this.meta = { ...blankMeta(this.repoPath), ...keep };
    if (why === 'corrupt') this.meta.message = tm('searchIndex.corrupt');
    await this.writeMeta();
  }

  // ------------------------------------------------------------ estado

  info(): SearchIndexInfo {
    const m = this.meta;
    const measured = { ...(m.treeFiles !== undefined ? { files: m.treeFiles } : {}), ...(m.treeBytes !== undefined ? { textBytes: m.treeBytes } : {}), ...(medianOf(m.recent) !== undefined ? { medianMs: medianOf(m.recent)! } : {}), samples: m.recent.length };
    const dismissed = m.dismissedAt !== undefined && Date.now() - m.dismissedAt < DISMISS_TTL;
    const suggest = m.mode === 'auto' && m.state === 'none' && !dismissed ? suggestIndex(measured, this.owner.rule) : null;
    return {
      repoPath: this.repoPath,
      mode: m.mode,
      state: m.state,
      files: m.files,
      alwaysChecked: m.alwaysChecked,
      bytes: m.bytes,
      limitBytes: m.limitMB * 1024 * 1024,
      ...(m.builtAt !== undefined ? { builtAt: m.builtAt } : {}),
      ...(m.updatedAt !== undefined ? { updatedAt: m.updatedAt } : {}),
      ...(this.progress && (m.state === 'building' || m.state === 'paused') ? { progress: this.progress } : {}),
      ...(m.message ? { message: m.message } : {}),
      ...(suggest ? { suggest } : {}),
      measured,
    };
  }

  emit(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastEmit < 400) return;
    this.lastEmit = now;
    this.owner.emit(this.info());
  }

  /** Chamado ao abrir a janela de pesquisa: retoma o que ficou pela metade, cria o que o modo `always` pede e mede o repositório para a regra de ativação. */
  async wake(): Promise<void> {
    await this.load();
    this.resumeRebuild();
    if (this.meta.state !== 'none' && this.meta.mode !== 'never') void untrackedOrder(); // medida uma vez; a primeira busca com índice não espera por ela
    if (!this.resumeChecked) {
      this.resumeChecked = true;
      if (this.meta.mode !== 'never' && ((this.meta.state === 'building' && !this.meta.paused) || (this.meta.mode === 'always' && this.meta.state === 'none'))) this.start();
    }
    // a medida do repositório espera um pouco: a primeira busca (que costuma abrir junto com a janela) não disputa o Git com ela
    if (this.meta.mode === 'auto' && this.meta.state === 'none' && !this.measureTimer) {
      this.measureTimer = setTimeout(() => {
        this.measureTimer = null;
        this.track(this.measureTree());
      }, MEASURE_DELAY_MS);
      this.measureTimer.unref?.();
    }
  }

  /** O índice que estava no disco não prestava (apagado ao abrir): se o modo deixa, recomeça. */
  private resumeRebuild(): void {
    if (!this.rebuildPending) return;
    this.rebuildPending = false;
    if (this.meta.mode !== 'never') this.start();
  }

  /** Arquivos e tamanho do texto do repositório (`git ls-tree -r -l`), no máximo uma vez por dia: alimenta a regra "mais de 50 mil arquivos / 2 GB". */
  private async measureTree(): Promise<void> {
    if (this.treeMeasuring || (this.meta.treeAt !== undefined && Date.now() - this.meta.treeAt < TREE_MEASURE_TTL)) return;
    this.treeMeasuring = true;
    try {
      const r = await runGit(this.repoPath, ['ls-tree', '-r', '-l', '-z', 'HEAD'], { check: false });
      if (r.code !== 0) return;
      let files = 0;
      let bytes = 0;
      for (const rec of r.stdout.split('\0')) {
        const tab = rec.indexOf('\t');
        if (tab < 0) continue;
        const parts = rec.slice(0, tab).split(/\s+/);
        if (parts[1] !== 'blob') continue;
        files++;
        bytes += Number(parts[3]) || 0;
      }
      this.meta.treeFiles = files;
      this.meta.treeBytes = bytes;
      this.meta.treeAt = Date.now();
      this.scheduleMeta();
      this.noteSuggest();
    } finally {
      this.treeMeasuring = false;
    }
  }

  private noteSuggest(): void {
    const s = this.info().suggest;
    if (s !== this.lastSuggest) {
      this.lastSuggest = s;
      this.emit(true);
    }
  }

  /** Registra quanto uma busca sem índice demorou (a regra olha a mediana das últimas). */
  note(done: SearchDone, accelerated: boolean): void {
    if (accelerated || !done.ok || done.cancelled || done.truncated) return;
    this.meta.recent = [...this.meta.recent, done.ms].slice(-KEEP_RECENT);
    this.scheduleMeta();
    this.noteSuggest();
  }

  // ------------------------------------------------------------ controle

  async configure(patch: { mode?: SearchIndexMode; limitMB?: number }): Promise<void> {
    await this.load();
    if (patch.mode && ['auto', 'always', 'never'].includes(patch.mode)) {
      this.meta.mode = patch.mode;
      if (patch.mode === 'never') this.stop('pause');
      if (patch.mode === 'always' && this.meta.state === 'none') this.start();
      if (patch.mode === 'always' || patch.mode === 'auto') delete this.meta.dismissedAt;
    }
    if (patch.limitMB !== undefined && Number.isFinite(patch.limitMB)) this.meta.limitMB = Math.min(1024 * 1024, Math.max(16, Math.floor(patch.limitMB)));
    await this.writeMeta();
    this.emit(true);
  }

  async control(action: SearchIndexAction): Promise<void> {
    await this.load();
    switch (action) {
      case 'build':
      case 'resume':
        if (this.meta.mode === 'never') this.meta.mode = 'auto';
        delete this.meta.message;
        this.start();
        break;
      case 'pause':
        await this.stopAndWait('pause');
        break;
      case 'cancel':
      case 'delete':
        await this.stopAndWait('cancel');
        await this.reset('delete');
        if (action === 'delete' && this.meta.mode === 'always') this.meta.mode = 'auto';
        await this.writeMeta();
        break;
      case 'rebuild':
        await this.stopAndWait('cancel');
        await this.reset('delete');
        this.start();
        break;
      case 'dismiss':
        this.meta.dismissedAt = Date.now();
        await this.writeMeta();
        this.noteSuggest();
        break;
    }
    this.emit(true);
  }

  private start(): void {
    if (this.task || this.meta.mode === 'never') return;
    let restart = false;
    const ctl = new AbortController();
    this.ctl = ctl;
    this.meta.state = 'building';
    this.meta.paused = false;
    this.lastSync = Date.now();
    this.emit(true);
    this.task = this.runSync(ctl.signal)
      .catch(async (e: unknown) => {
        if (e instanceof CorruptIndexError) {
          // o que estava sendo lido ou juntado não prestava: apaga e recomeça (no `finally`, quando a tarefa já saiu)
          await this.reset('corrupt');
          restart = true;
          return;
        }
        this.meta.state = 'error';
        this.meta.message = tm('searchIndex.failed', { detail: e instanceof Error ? e.message : String(e) });
        await this.writeMeta();
      })
      .finally(() => {
        this.task = null;
        this.ctl = null;
        if (restart) this.start();
        this.emit(true);
      });
  }

  private stop(reason: 'pause' | 'cancel' | 'dispose'): void {
    this.ctl?.abort(reason);
  }

  private async stopAndWait(reason: 'pause' | 'cancel' | 'dispose'): Promise<void> {
    const t = this.task;
    this.stop(reason);
    if (t) await t.catch(() => undefined);
  }

  private track(p: Promise<unknown>): void {
    const t = p.catch(() => undefined).finally(() => this.bg.delete(t));
    this.bg.add(t);
  }

  /** Para tudo e solta a memória (o app fechou o repositório ou vai sair). */
  async dispose(): Promise<void> {
    if (this.measureTimer) clearTimeout(this.measureTimer);
    this.measureTimer = null;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    await this.stopAndWait('dispose');
    await Promise.all([...this.bg]);
    await this.writeMeta();
    clearDictCache(this.dir);
  }

  /** O repositório saiu do app: o índice sai junto. */
  async drop(): Promise<void> {
    if (this.measureTimer) clearTimeout(this.measureTimer);
    this.measureTimer = null;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    await this.stopAndWait('cancel');
    await Promise.all([...this.bg]);
    if (this.metaTimer) clearTimeout(this.metaTimer);
    this.metaTimer = null;
    clearDictCache(this.dir);
    await rm(this.dir, { recursive: true, force: true });
  }

  // ------------------------------------------------------------ construir e atualizar

  private async runSync(signal: AbortSignal): Promise<void> {
    await this.load();
    await mkdir(this.dir, { recursive: true });
    const sigNow = await this.gitIndexSig();
    // a lista do Git e o `status` correm juntos (cada um é um processo do git)
    const dirtyP = dirtyPaths(this.repoPath, signal);
    const listed = await listIndex(this.repoPath, signal);
    if (!listed) {
      await dirtyP;
      if (signal.aborted) return this.finishAborted(signal);
      throw new Error(tm('searchIndex.noList'));
    }
    if (listed.unsafe) {
      await dirtyP;
      this.meta.state = 'error';
      this.meta.message = tm('searchIndex.badPaths');
      await this.writeMeta();
      return;
    }
    const manifest = (this.manifest ??= new Map());
    for (const p of [...manifest.keys()]) if (!listed.files.has(p)) manifest.delete(p);
    const dirty = await dirtyP;
    if (!dirty) {
      if (signal.aborted) return this.finishAborted(signal);
      throw new Error(tm('searchIndex.noList'));
    }

    const todo: string[] = [];
    for (const [p, f] of listed.files) {
      const e = manifest.get(p);
      if (needsUpdate(e, f) && !dirty.tracked.has(p)) todo.push(p);
    }
    this.progress = { done: 0, total: todo.length };
    this.emit(true);

    const collector = new TrigramCollector();
    const limit = this.meta.limitMB * 1024 * 1024;
    let item = 0;
    const fresh: string[] = [];
    while (item < todo.length) {
      if (signal.aborted) return this.finishAborted(signal);
      const docs: string[] = [];
      const keySets: Uint32Array[] = [];
      const adds: Array<{ path: string; entry: Entry; doc: number }> = [];
      let bytes = 0;
      while (item < todo.length && docs.length < BATCH_FILES && bytes < BATCH_BYTES) {
        const slice = todo.slice(item, item + READ_CONCURRENCY);
        item += slice.length;
        const read = await Promise.all(slice.map((p) => this.readForIndex(p, listed.files.get(p)!, collector)));
        for (let i = 0; i < slice.length; i++) {
          const r = read[i];
          if (!r) continue; // sumiu ou mudou durante a leitura: fica de fora, o Git o confere direto
          const path = slice[i]!;
          if (r.always) adds.push({ path, entry: [0, -1, listed.files.get(path)!.blob, 1, listed.files.get(path)!.flagged ? FLAG_HASH : ''], doc: -1 });
          else {
            adds.push({ path, entry: [0, docs.length, listed.files.get(path)!.blob, 0, r.hash], doc: docs.length });
            docs.push(path);
            keySets.push(r.keys);
            bytes += r.size;
          }
        }
        this.progress = { done: item, total: todo.length };
        this.emit();
      }
      if (docs.length) {
        const used = this.segs.reduce((n, g) => n + g.bytes, 0);
        if (used + bytes * 1.2 > limit) {
          this.meta.state = 'error';
          this.meta.message = tm('searchIndex.limit', { mb: this.meta.limitMB });
          await this.checkpoint();
          return;
        }
        let total = 0;
        for (const k of keySets) total += k.length;
        const pairs = new Float64Array(total);
        let n = 0;
        keySets.forEach((keys, d) => {
          for (let i = 0; i < keys.length; i++) pairs[n++] = keys[i]! * 2 ** 24 + d;
        });
        const id = this.meta.nextSeg++;
        const seg = await writeSegment(this.dir, id, docs, pairs);
        this.segs.push(seg);
        for (const a of adds) if (a.doc >= 0) a.entry[0] = id;
      }
      for (const a of adds) {
        manifest.set(a.path, a.entry);
        fresh.push(a.path);
      }
      await this.compact();
      if (Date.now() - this.lastCheckpoint >= CHECKPOINT_MS) await this.checkpoint();
    }

    // o que estava sujo logo depois de ler pode ter sido lido no meio de uma edição: sai do índice (volta quando estiver limpo)
    if (fresh.length) {
      const after = await dirtyPaths(this.repoPath, signal);
      if (after) for (const p of fresh) if (after.tracked.has(p)) manifest.delete(p);
    }
    this.dropEmptySegments();

    // o que o manifesto ainda não cobre fica anotado: a busca o confere direto até a próxima atualização
    const stale: string[] = [];
    for (const [p, f] of listed.files) if (needsUpdate(manifest.get(p), f)) stale.push(p);
    const complete = stale.length === 0;
    this.meta.stale = stale.slice(0, STALE_CAP);
    this.meta.sig = stale.length <= STALE_CAP && sigNow ? sigNow : undefined;
    this.meta.state = 'ready';
    this.meta.paused = false;
    this.meta.updatedAt = Date.now();
    if (this.meta.builtAt === undefined && complete) this.meta.builtAt = Date.now();
    delete this.meta.message;
    this.progress = undefined;
    await this.checkpoint();
    this.emit(true);
  }

  private async finishAborted(signal: AbortSignal): Promise<void> {
    if (this.manifest) await this.checkpoint();
    // fechar o app não é pausar: o que ficou pela metade continua sozinho na próxima vez
    this.meta.state = signal.reason === 'pause' ? 'paused' : signal.reason === 'dispose' ? 'building' : 'none';
    this.meta.paused = signal.reason === 'pause';
    await this.writeMeta();
  }

  /** Lê um arquivo para o índice: os trigramas e o resumo do conteúdo, ou `always` (o Git o confere sempre), ou `null` (sumiu ou mudou durante a leitura). */
  private async readForIndex(path: string, f: ListedFile, collector: TrigramCollector): Promise<{ always: true } | { always: false; keys: Uint32Array; hash: string; size: number } | null> {
    if (f.mode === '120000' || f.flagged) return { always: true };
    let full: string;
    try {
      full = resolveInsideRepo(this.repoPath, path);
    } catch {
      return { always: true };
    }
    try {
      const st = await lstat(full);
      if (st.isSymbolicLink() || !st.isFile() || st.size > INDEX_MAX_FILE_BYTES) return { always: true };
      const bytes = await readFile(full);
      const st2 = await lstat(full);
      if (st2.size !== st.size || st2.mtimeMs !== st.mtimeMs || bytes.length !== st.size) return null;
      return { always: false, keys: collector.collect(bytes), hash: hashOf(bytes), size: bytes.length };
    } catch {
      return null;
    }
  }

  /** Junta segmentos pequenos quando há segmentos demais (cada busca consulta todos). */
  private async compact(): Promise<void> {
    const manifest = this.manifest!;
    while (this.segs.length > MAX_SEGMENTS) {
      const pick = [...this.segs].sort((a, b) => a.bytes - b.bytes).slice(0, MERGE_COUNT);
      pick.sort((a, b) => a.id - b.id);
      const id = this.meta.nextSeg++;
      const { segment, remap } = await mergeSegments(this.dir, pick, id, (seg, local, path) => {
        const e = manifest.get(path);
        return !!e && e[0] === seg.id && e[1] === local;
      });
      for (const e of manifest.values()) {
        const map = remap.get(e[0]);
        if (map && e[1] >= 0) {
          const n = map[e[1]]!;
          if (n >= 0) {
            e[0] = id;
            e[1] = n;
          }
        }
      }
      this.segs = this.segs.filter((s) => !pick.includes(s));
      this.segs.push(segment);
      this.docs.clear();
      this.gen++;
      this.retire(pick);
      await this.checkpoint();
    }
  }

  /** Segmentos em que nenhum arquivo vale mais saem. */
  private dropEmptySegments(): void {
    const live = new Set<number>();
    for (const e of this.manifest!.values()) if (e[1] >= 0) live.add(e[0]);
    const dead = this.segs.filter((s) => !live.has(s.id));
    if (!dead.length) return;
    this.segs = this.segs.filter((s) => live.has(s.id));
    this.retire(dead);
  }

  /** Apaga os arquivos de segmentos que saíram, um minuto depois: uma busca que já os abriu termina em paz. */
  private retire(list: Segment[]): void {
    const t = setTimeout(() => {
      for (const s of list) void s.remove();
    }, OBSOLETE_DELAY_MS);
    t.unref?.();
  }

  private async gitIndexSig(): Promise<IndexSig | null> {
    this.gitIndex ??= await gitIndexFile(this.repoPath);
    if (!this.gitIndex) return null;
    try {
      const st = await stat(this.gitIndex);
      return { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino };
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ consultar

  /** Os arquivos que podem conter o texto, ou `null` (busca sem índice). Nunca lança. */
  async candidates(q: NormalizedQuery, literal: string | undefined, signal: AbortSignal): Promise<AccelCandidates | null> {
    try {
      await this.load();
      this.resumeRebuild();
      if (this.meta.mode === 'never' || this.meta.state === 'none' || this.meta.state === 'error' || !this.manifest || !this.segs.length) {
        if (this.meta.mode === 'always' && this.meta.state === 'none') this.start();
        return null;
      }
      if (q.scope !== 'worktree' || q.includeIgnored || q.includeSubmodules) return null;
      if (!masksAreSimple([...q.masks.include, ...q.masks.exclude])) return null;
      const plan = planTrigrams({ pattern: literal ?? q.pattern, regex: literal !== undefined ? false : q.regex, caseSensitive: q.caseSensitive });
      if (!plan) return null;

      const manifest = this.manifest;
      // 1) o que o índice ainda não cobre (arquivos novos no Git, blobs trocados) e o que está sujo no disco: sempre conferido direto
      const sig = await this.gitIndexSig();
      let tracked: Set<string>;
      let stale: Set<string>;
      const fast = !!sig && sameSig(this.meta.sig, sig) && this.meta.state === 'ready';
      const dirtyP = dirtyPaths(this.repoPath, signal);
      if (fast) {
        tracked = new Set(manifest.keys());
        for (const p of this.meta.stale) tracked.add(p);
        stale = new Set(this.meta.stale);
      } else {
        const listed = await listIndex(this.repoPath, signal);
        if (!listed || listed.unsafe) return null;
        tracked = new Set(listed.files.keys());
        stale = new Set();
        for (const [p, f] of listed.files) if (needsUpdate(manifest.get(p), f)) stale.add(p);
        if (this.meta.state === 'ready' && sig && stale.size <= STALE_CAP) {
          this.meta.sig = sig;
          this.meta.stale = [...stale];
          this.scheduleMeta();
        }
      }
      const dirty = await dirtyP;
      if (!dirty || dirty.unsafe || signal.aborted) return null;

      // 2) o índice: arquivos de cada alternativa (E dos trigramas) e a união delas
      let hit = new Set<string>();
      for (let attempt = 0; ; attempt++) {
        const g = this.gen;
        hit = new Set<string>();
        for (const branch of plan) for (const p of await this.lookup(branch)) hit.add(p);
        if (g === this.gen) break; // nenhuma junta de segmentos no meio da consulta
        if (attempt >= 2) return null;
      }

      // 3) os candidatos, na ordem do Git: os rastreados primeiro, depois os novos
      const cand = new Set<string>(hit);
      for (const p of stale) cand.add(p);
      for (const p of dirty.tracked) cand.add(p);
      for (const [p, e] of manifest) if (e[3]) cand.add(p);
      const allow = q.masks.include.length || q.masks.exclude.length ? maskMatcher(q.masks) : null;
      const trackedList: string[] = [];
      for (const p of cand) if (tracked.has(p) && (!allow || allow(p))) trackedList.push(p);
      const untrackedList: string[] = [];
      if (q.includeUntracked) for (const p of dirty.untracked) if (!allow || allow(p)) untrackedList.push(p);

      const total = allow ? [...tracked].filter(allow).length : tracked.size;
      if (trackedList.length + untrackedList.length > Math.max(MAX_CANDIDATES_FLOOR, total * MAX_CANDIDATES_FRACTION)) return null; // o índice não ajuda: busca como sempre

      this.afterQuery(stale, dirty);
      return {
        tracked: sortGitPaths(trackedList),
        untracked: sortGitPaths(untrackedList),
        filesLooked: total + untrackedList.length,
        builtAt: this.meta.builtAt ?? this.meta.updatedAt ?? 0,
        updatedAt: this.meta.updatedAt ?? 0,
      };
    } catch (e) {
      if (signal.aborted) return null;
      if (e instanceof CorruptIndexError) {
        // o índice não presta: apaga e reconstrói em segundo plano; esta busca roda sem ele
        this.track(this.rebuildAfterCorruption());
      }
      return null;
    }
  }

  private async rebuildAfterCorruption(): Promise<void> {
    if (this.task) await this.stopAndWait('cancel');
    await this.reset('corrupt');
    if (this.meta.mode !== 'never') {
      this.start();
      this.meta.message = tm('searchIndex.corrupt');
    }
    this.emit(true);
  }

  /** Arquivos (caminhos) que têm TODOS os trigramas, em todos os segmentos, só os que ainda valem. */
  private async lookup(keys: number[]): Promise<string[]> {
    const manifest = this.manifest!;
    const out: string[] = [];
    for (const seg of this.segs) {
      const dict = await seg.dict();
      const recs = keys.map((k) => Segment.find(dict, seg.keyCount, k));
      if (recs.some((r) => !r)) continue; // algum trigrama não aparece em nenhum arquivo deste segmento
      recs.sort((a, b) => a!.len - b!.len);
      const fh = await seg.openPostings();
      let ids: Uint32Array | null = null;
      try {
        for (const r of recs) {
          const list = await seg.postings(fh, r!);
          ids = ids ? intersect(ids, list) : list;
          if (!ids.length) break;
        }
      } finally {
        await fh.close();
      }
      if (!ids?.length) continue;
      let docs = this.docs.get(seg.id);
      if (!docs) {
        docs = await seg.docs();
        this.docs.set(seg.id, docs);
      }
      for (let i = 0; i < ids.length; i++) {
        const path = docs[ids[i]!]!;
        const e = manifest.get(path);
        if (e && e[0] === seg.id && e[1] === ids[i]) out.push(path);
      }
    }
    return out;
  }

  /** Depois de uma busca com índice: atualiza o que ficou para trás e confere, por amostragem, se o índice ainda reflete o disco. */
  private afterQuery(stale: Set<string>, dirty: Dirty): void {
    const now = Date.now();
    if (this.meta.mode !== 'never' && !this.task) {
      let clean = 0;
      for (const p of stale) if (!dirty.tracked.has(p)) clean++;
      if (clean > 0) {
        const wait = this.owner.syncGapMs - (now - this.lastSync);
        if (wait <= 0) this.start();
        else if (!this.syncTimer) {
          // muito cedo depois da última atualização: marca uma para já, em vez de depender de outra busca
          this.syncTimer = setTimeout(() => {
            this.syncTimer = null;
            if (!this.task && this.meta.mode !== 'never') this.start();
          }, wait);
          this.syncTimer.unref?.();
        }
      }
    }
    if (now - this.lastSample >= SAMPLE_EVERY_MS && !this.task) {
      this.lastSample = now;
      this.track(this.sample(dirty, stale));
    }
  }

  /**
   * Amostragem: relê alguns arquivos que o Git diz estarem limpos e compara com o resumo guardado. Se algum difere (e continua limpo), o índice não reflete mais o
   * disco (um filtro mudou, um arquivo foi trocado sem o Git ver): é apagado e reconstruído.
   */
  private async sample(dirty: Dirty, stale: Set<string>): Promise<void> {
    const manifest = this.manifest;
    if (!manifest || this.meta.state !== 'ready') return;
    const pool = [...manifest].filter(([p, e]) => !e[3] && e[1] >= 0 && !dirty.tracked.has(p) && !stale.has(p)); // o que o Git já mudou (blob novo) tem resumo velho: não é defeito
    if (!pool.length) return;
    for (let i = 0; i < Math.min(SAMPLE_FILES, pool.length); i++) {
      const [p, e] = pool[randomInt(pool.length)]!;
      let bytes: Buffer;
      try {
        bytes = await readFile(resolveInsideRepo(this.repoPath, p));
      } catch {
        continue; // sumiu: o `status` mostrará na próxima busca
      }
      if (hashOf(bytes) === e[4]) continue;
      const again = await dirtyPaths(this.repoPath);
      if (!again || again.tracked.has(p)) continue; // estava sendo editado
      // e o Git não pode ter trocado o blob (um commit no meio) desde que a busca começou
      const now = await listIndex(this.repoPath);
      if (!now || now.files.get(p)?.blob !== e[2]) continue;
      await this.rebuildAfterCorruption();
      return;
    }
  }
}

function medianOf(list: number[]): number | undefined {
  if (!list.length) return undefined;
  const s = [...list].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

// ---------------------------------------------------------------- gerenciador

/**
 * Os índices de busca de todos os repositórios, numa pasta só (`<root>/<chave>/`). É o `SearchAccelerator` da busca: `searchRepository(…, { accelerator })` pergunta a
 * ele quais arquivos conferir.
 */
export class SearchIndexes implements SearchAccelerator {
  private readonly repos = new Map<string, RepoIndex>();
  /** Os limites da regra de ativação (os testes baixam os números para não precisar de 50 mil arquivos). */
  readonly rule: IndexRule;

  constructor(
    private readonly root: string,
    private readonly onChange: (info: SearchIndexInfo) => void = () => undefined,
    rule: Partial<IndexRule> = {},
    /** Intervalo mínimo entre atualizações (os testes baixam para não esperar 5 s a cada commit). */
    readonly syncGapMs: number = SYNC_MIN_GAP_MS,
  ) {
    this.rule = { ...INDEX_RULE, ...rule };
  }

  emit(info: SearchIndexInfo): void {
    try {
      this.onChange(info);
    } catch {
      /* quem escuta não derruba o índice */
    }
  }

  private repo(repoPath: string): RepoIndex {
    const key = indexKey(repoPath);
    let r = this.repos.get(key);
    if (!r) {
      r = new RepoIndex(this, repoPath, join(this.root, key));
      this.repos.set(key, r);
    }
    return r;
  }

  /** Repositórios em WSL (caminho UNC) ficam sem índice: o disco deles passa pelo protocolo 9P, lento demais para valer a pena. */
  private usable(repoPath: string): boolean {
    return !(process.platform === 'win32' && parseWslPath(repoPath));
  }

  async info(repoPath: string): Promise<SearchIndexInfo> {
    const r = this.repo(repoPath);
    if (!this.usable(repoPath)) return { ...(await this.blank(r)), message: tm('searchIndex.wsl') };
    await r.wake();
    return r.info();
  }

  private async blank(r: RepoIndex): Promise<SearchIndexInfo> {
    await r.load();
    return { ...r.info(), state: 'none', mode: 'never' };
  }

  async configure(repoPath: string, patch: { mode?: SearchIndexMode; limitMB?: number }): Promise<SearchIndexInfo> {
    const r = this.repo(repoPath);
    if (this.usable(repoPath)) await r.configure(patch);
    return this.info(repoPath);
  }

  async control(repoPath: string, action: SearchIndexAction): Promise<SearchIndexInfo> {
    const r = this.repo(repoPath);
    if (this.usable(repoPath)) await r.control(action);
    return this.info(repoPath);
  }

  async candidates(repoPath: string, q: NormalizedQuery, literal: string | undefined, signal: AbortSignal): Promise<AccelCandidates | null> {
    if (!this.usable(repoPath)) return null;
    return this.repo(repoPath).candidates(q, literal, signal);
  }

  record(repoPath: string, done: SearchDone, accelerated: boolean): void {
    if (this.usable(repoPath)) this.repo(repoPath).note(done, accelerated);
  }

  /** Para a construção em andamento deste repositório (o repositório foi fechado). */
  async release(repoPath: string): Promise<void> {
    const r = this.repos.get(indexKey(repoPath));
    if (r) await r.dispose();
  }

  /** O repositório saiu do app: apaga o índice dele. */
  async drop(repoPath: string): Promise<void> {
    await this.repo(repoPath).drop();
    this.repos.delete(indexKey(repoPath));
  }

  /** Para tudo (o app vai sair). */
  async disposeAll(): Promise<void> {
    await Promise.all([...this.repos.values()].map((r) => r.dispose()));
  }
}
