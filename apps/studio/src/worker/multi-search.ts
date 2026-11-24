// Busca em vários repositórios (fase 8 da #233): o orquestrador. Cada repositório roda a busca de um só (`searchRepository`) com concorrência limitada, um
// AbortSignal por repositório, limite por repositório e limite global, e o fim de um (erro, pasta sumida, sem a revisão) nunca derruba os outros.
// Puro de propósito: o worker injeta quem busca de fato (`run`) e quem anuncia (`emit`), então dá para testar sem Git e sem processo.
import { cpus } from 'node:os';
import type { MultiSearchOptions, RepositoryMeta, SearchBatchEvent, SearchDone, SearchHit, SearchQuery } from '@git-nexus/git-core/pure';

/** O que o worker faz por um repositório: a busca de um só (o `searchRepository`). */
export type RunOne = (repoPath: string, query: SearchQuery, hooks: { id: string; signal: AbortSignal; onBatch: (hits: SearchHit[]) => void }) => Promise<{ done: SearchDone }>;

export interface MultiDeps {
  run: RunOne;
  /** A pasta do repositório existe e dá para entrar nela? (disco desconectado, pasta apagada) */
  exists: (path: string) => Promise<boolean>;
  emit: (e: { event: 'searchBatch'; data: SearchBatchEvent } | { event: 'searchDone'; data: SearchDone }) => void;
}

export const DEFAULT_PER_REPO = 1000;
export const DEFAULT_GLOBAL = 5000;
/** Um nome a mais de ids que a interface manda por engano nunca vira milhares de processos. */
export const MAX_REPOS = 200;

/** Quantos repositórios rodam juntos: no máximo 4 e nunca mais que metade dos núcleos (mínimo 1). */
export function defaultConcurrency(cores = cpus().length): number {
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

/** O id do evento de um repositório dentro de uma busca em vários. */
export const subId = (id: string, repoId: string): string => `${id}#${repoId}`;

const empty = (id: string, repoId: string, patch: Partial<SearchDone>): SearchDone => ({ id, repoId, ok: true, dialect: 'fixed', hits: 0, files: 0, skipped: [], cancelled: false, truncated: false, ms: 0, ...patch });

interface Job {
  ctl: AbortController;
  repos: Map<string, AbortController>;
}

export function createMultiSearcher(deps: MultiDeps) {
  const jobs = new Map<string, Job>();

  /** Começa: devolve na hora o que foi aceito; a busca corre por trás e anuncia por `emit`. */
  function start(repos: RepositoryMeta[], query: SearchQuery, id: string, opts: MultiSearchOptions = {}): void {
    cancel(id); // o mesmo id recomeça (como a busca de um repositório só): a antiga para de verdade
    const job: Job = { ctl: new AbortController(), repos: new Map() };
    jobs.set(id, job);
    const concurrency = Math.max(1, Math.min(opts.concurrency ?? defaultConcurrency(), MAX_REPOS));
    const perRepo = Math.max(1, opts.perRepoLimit ?? DEFAULT_PER_REPO);
    const globalLimit = Math.max(1, opts.globalLimit ?? DEFAULT_GLOBAL);
    for (const r of repos) job.repos.set(r.id, new AbortController());
    let total = 0;
    let capped = false;
    let next = 0;

    const cap = (): void => {
      if (capped) return;
      capped = true;
      for (const c of job.repos.values()) c.abort(); // quem ainda roda para; quem não começou nem roda (ver `one`)
    };

    const one = async (r: RepositoryMeta): Promise<void> => {
      const sid = subId(id, r.id);
      const ctl = job.repos.get(r.id)!;
      const finish = (done: SearchDone): void => deps.emit({ event: 'searchDone', data: { ...done, id: sid, repoId: r.id } });
      if (job.ctl.signal.aborted || (ctl.signal.aborted && !capped)) return finish(empty(sid, r.id, { cancelled: true }));
      if (capped) return finish(empty(sid, r.id, { ok: true, truncated: true, truncatedReason: 'limit', reason: 'globalLimit' }));
      if (!(await deps.exists(r.path).catch(() => false))) return finish(empty(sid, r.id, { ok: false, reason: 'unavailable' }));
      let mine = 0;
      try {
        const { done } = await deps.run(r.path, { ...query, limit: perRepo, offset: 0 }, {
          id: sid,
          signal: ctl.signal,
          onBatch: (hits) => {
            // o limite global é exato: o lote que o ultrapassa é cortado, e o resto não entra
            const room = globalLimit - total;
            if (room <= 0) return cap();
            const take = hits.length > room ? hits.slice(0, room) : hits;
            total += take.length;
            mine += take.length;
            deps.emit({ event: 'searchBatch', data: { id: sid, repoId: r.id, hits: take } });
            if (total >= globalLimit) cap();
          },
        });
        const cut = capped && done.cancelled && !job.ctl.signal.aborted;
        finish({ ...done, hits: mine, ...(cut ? { cancelled: false, truncated: true, truncatedReason: 'limit' as const, reason: 'globalLimit' as const } : {}) });
      } catch (e) {
        const code = (e as { code?: string } | null)?.code;
        finish(empty(sid, r.id, { ok: false, reason: code === 'ENOENT' ? 'noGit' : undefined, message: e instanceof Error ? e.message : String(e) }));
      }
    };

    // `concurrency` operários puxam o próximo repositório da fila (a ordem pedida: o da aba ativa vem primeiro)
    const worker = async (): Promise<void> => {
      for (;;) {
        const r = repos[next++];
        if (!r) return;
        await one(r).catch(() => undefined);
      }
    };
    void Promise.all(Array.from({ length: Math.min(concurrency, repos.length) }, worker)).finally(() => {
      if (jobs.get(id) === job) jobs.delete(id);
    });
  }

  /** Cancela a busca inteira (`id`) ou só um repositório dela (`id#repoId`). Devolve se havia o que cancelar. */
  function cancel(id: string): boolean {
    const direct = jobs.get(id);
    if (direct) {
      direct.ctl.abort();
      for (const c of direct.repos.values()) c.abort();
      return true;
    }
    const at = id.indexOf('#');
    if (at < 0) return false;
    const job = jobs.get(id.slice(0, at));
    const ctl = job?.repos.get(id.slice(at + 1));
    if (!ctl) return false;
    ctl.abort();
    return true;
  }

  return { start, cancel, running: () => jobs.size };
}

export type MultiSearcher = ReturnType<typeof createMultiSearcher>;
