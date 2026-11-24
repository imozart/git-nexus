// Busca na história v2 (fase 9 da #233): dispara o `git log` (o motor: -S, -G, --grep ou -L), lê os commits em fluxo com o diff de cada um (para o selo
// entrou/saiu/mudou), conta os commits examinados e cancela de verdade. A parte pura (pedido, argumentos, leitura do commit) está em history-search-pure.ts.
import { StringDecoder } from 'node:string_decoder';
import { tm } from './messages.js';
import { runGit } from './runner.js';
import {
  HistoryStream,
  buildHistoryArgs,
  buildScopeArgs,
  makeRanger,
  normalizeHistoryQuery,
  parseHistoryRecord,
  type HistoryError,
  type NormalizedHistory,
} from './history-search-pure.js';
import type { HistoryDone, HistoryHit, HistoryQuery } from './types/ipc.js';

export interface HistoryHooks {
  id?: string;
  /** Cancela de verdade: o processo do `git log` termina. */
  signal?: AbortSignal;
  /** Cada lote de commits, assim que fica pronto (o primeiro sai logo), com os commits examinados até ali. */
  onBatch?: (hits: HistoryHit[], examined?: number) => void;
}

export interface HistoryOutcome {
  done: HistoryDone;
  hits: HistoryHit[];
}

/** Mensagens do Git em inglês: o que o núcleo reconhece no erro não depende do idioma do sistema. */
/** `GIT_FLUSH`: com a saída num pipe o Git a guarda em blocos de 64 KB (o primeiro commit só chegaria depois de varrer milhares); assim cada commit sai na hora. */
const GIT_ENV = { LC_MESSAGES: 'C', LANGUAGE: 'C', GIT_FLUSH: '1' } as const;
/** Acima disto o núcleo não guarda a ordem dos commits (a contagem de examinados fica só no total). */
const ORDER_CAP = 400_000;

function messageFor(e: HistoryError): string {
  switch (e.code) {
    case 'tooLong':
      return tm('search.tooLong', { max: e.max });
    case 'badMask':
      return tm('search.badMask', { mask: e.mask });
    case 'badRevision':
      return tm('search.badRevision', { rev: e.rev });
    case 'badDate':
      return tm('history.badDate', { value: e.value });
    case 'multiline':
      return tm('history.multiline');
    case 'badFollow':
      return tm('history.badFollow');
    case 'badLines':
      return tm('history.badLines');
    default:
      return tm('history.emptyQuery');
  }
}

/** O erro do Git em palavras de gente, com a categoria para a tela. */
export function classifyGitFailure(stderr: string, n: NormalizedHistory): { reason?: HistoryDone['reason']; message: string } {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines.find((l) => /^(fatal|error):/i.test(l))?.replace(/^(fatal|error):\s*/i, '') ?? lines[0] ?? '';
  if (/ambiguous argument|bad revision|unknown revision|bad object/i.test(stderr)) {
    const rev = n.revs.join('..') || 'HEAD';
    return { reason: 'noRevision', message: tm('search.noRevision', { rev }) };
  }
  if (/does not have any commits yet|bad default revision/i.test(stderr)) return { reason: 'noCommits', message: tm('history.noCommits') };
  if (/invalid regexp|invalid regular expression|regcomp|unmatched|invalid preceding|trailing backslash|repetition-operator|invalid character class/i.test(stderr)) {
    return { reason: 'badRegex', message: tm('search.badRegex', { detail: first }) };
  }
  if (n.mode === 'range' || n.follow) return { reason: 'badPath', message: first || tm('search.failed') };
  return { message: first || tm('search.failed') };
}

/**
 * Busca na história. Os commits chegam em lotes por `onBatch`; a página tem `limit` commits e, havendo mais, `done.nextSkip` diz de onde continuar
 * (o "carregar mais"). Nunca lança por causa da busca: o motivo de uma falha vem em `done.message`.
 */
export async function searchHistoryStream(repoPath: string, query: HistoryQuery, hooks: HistoryHooks = {}): Promise<HistoryOutcome> {
  const started = Date.now();
  const id = hooks.id ?? `h-${started}`;
  const base: HistoryDone = { id, ok: true, count: 0, cancelled: false, truncated: false, ms: 0 };
  const finish = (patch: Partial<HistoryDone>, hits: HistoryHit[] = []): HistoryOutcome => ({ done: { ...base, ...patch, ms: Date.now() - started }, hits });

  const norm = normalizeHistoryQuery(query);
  if ('error' in norm) return finish({ ok: false, message: messageFor(norm.error) });
  const n = norm.query;

  let stop: 'cancel' | 'time' | 'limit' | null = null;
  const ctl = new AbortController();
  /** A contagem dos commits do escopo termina sozinha mesmo quando a página enche (só cancelar ou o tempo a interrompem). */
  const orderCtl = new AbortController();
  const halt = (why: 'cancel' | 'time' | 'limit') => {
    stop ??= why;
    ctl.abort();
    if (why !== 'limit') orderCtl.abort();
  };
  if (hooks.signal?.aborted) return finish({ cancelled: true });
  hooks.signal?.addEventListener('abort', () => halt('cancel'), { once: true });
  const timer = setTimeout(() => halt('time'), n.timeoutMs);

  try {
    // as pontas da revisão precisam existir (a mensagem diz qual); um repositório novo não tem HEAD. Tudo de uma vez: cada consulta é um processo do Git
    const verify = (rev: string) => runGit(repoPath, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { check: false, signal: ctl.signal, env: GIT_ENV });
    const [head, ...ends] = await Promise.all(['HEAD', ...n.revs].map(verify));
    if (stop) return finish({ cancelled: stop === 'cancel' });
    const missing = n.revs.find((_, i) => ends[i]!.code !== 0);
    if (missing !== undefined) return finish({ ok: false, reason: 'noRevision', message: tm('search.noRevision', { rev: missing }) });
    const headExists = head!.code === 0;
    if (!headExists && (n.scope === 'current' || n.mode === 'range')) return finish({ reason: 'noCommits', message: tm('history.noCommits') });

    // a ordem dos commits do escopo (sem o texto): dá os "examinados" (a posição do último achado) e o total
    let order: Map<string, number> | null = null;
    let total: number | undefined;
    const orderDone =
      n.mode === 'range' || n.follow
        ? Promise.resolve()
        : (async () => {
            const list = new Map<string, number>();
            let count = 0;
            let rest = '';
            const dec = new StringDecoder('utf8');
            const eat = (s: string) => {
              rest += s;
              let i = rest.indexOf('\n');
              while (i >= 0) {
                const h = rest.slice(0, i);
                rest = rest.slice(i + 1);
                if (h) {
                  if (count < ORDER_CAP) list.set(h, count);
                  count++;
                }
                i = rest.indexOf('\n');
              }
            };
            const r = await runGit(repoPath, buildScopeArgs(n, headExists), { check: false, signal: orderCtl.signal, discardStdout: true, env: GIT_ENV, onStdout: (c) => eat(dec.write(c)) });
            eat(dec.end());
            if (rest) eat('\n');
            if (r.code === 0) {
              total = count;
              if (count <= ORDER_CAP) order = list;
            }
          })().catch(() => undefined);

    const ranger = n.mode === 'message' || n.mode === 'range' ? null : makeRanger({ text: n.text, regex: n.regex, caseSensitive: n.caseSensitive, wholeWord: n.wholeWord });
    const hits: HistoryHit[] = [];
    let batch: HistoryHit[] = [];
    let lastFlush = 0;
    /** Registros que o Git devolveu e já foram lidos (inclui os que o filtro do JavaScript descartou). */
    let consumed = 0;
    let nextSkip: number | undefined;
    const examinedNow = (): number | undefined => {
      if (!order) return undefined;
      const idx = hits.length ? order.get(hits[hits.length - 1]!.hash) : undefined;
      return idx === undefined ? undefined : idx + 1;
    };
    const flush = () => {
      if (!batch.length) return;
      const b = batch;
      batch = [];
      lastFlush = Date.now();
      try {
        hooks.onBatch?.(b, examinedNow());
      } catch {
        /* quem recebe os lotes não pode derrubar a busca */
      }
    };
    const onRecord = (rec: string) => {
      if (stop !== null) return;
      const at = consumed++;
      if (at < n.skip) return; // achados das páginas anteriores: a mesma busca, de novo, sem mostrar o que já foi visto
      const hit = parseHistoryRecord(rec, { n, ranger });
      if (!hit) return;
      if (hits.length >= n.limit) {
        // o primeiro commit além da página: há mais; a próxima página começa nele
        nextSkip = at;
        halt('limit');
        return;
      }
      hits.push(hit);
      batch.push(hit);
      if (hits.length === 1 || batch.length >= 20 || Date.now() - lastFlush >= 50) flush();
    };
    const stream = new HistoryStream(onRecord);
    const dec = new StringDecoder('utf8');
    const r = await runGit(repoPath, buildHistoryArgs(n, headExists), {
      check: false,
      signal: ctl.signal,
      discardStdout: true,
      env: GIT_ENV,
      onStdout: (chunk) => stream.push(dec.write(chunk)),
    });
    if (!stop) stream.end();
    flush();
    if (!r.aborted && r.code !== 0 && !stop) {
      const f = classifyGitFailure(r.stderr, n);
      // repositório sem commit não é erro: é uma lista vazia dita em texto
      return finish(f.reason === 'noCommits' ? { reason: 'noCommits', message: f.message } : { ok: false, ...(f.reason ? { reason: f.reason } : {}), message: f.message });
    }
    // a contagem é rápida (só os nomes dos commits); não vale esperar muito por ela
    await Promise.race([orderDone, new Promise<void>((res) => setTimeout(res, 1500).unref())]);
    orderCtl.abort();
    const complete = !stop;
    if (stop === 'time') nextSkip = Math.max(n.skip, consumed);
    const examined = complete ? total : examinedNow();
    return finish(
      {
        count: hits.length,
        ...(examined !== undefined ? { examined } : {}),
        ...(total !== undefined ? { total } : {}),
        cancelled: stop === 'cancel',
        truncated: stop === 'limit' || stop === 'time',
        ...(stop === 'limit' || stop === 'time' ? { truncatedReason: stop } : {}),
        ...(nextSkip !== undefined && (stop === 'limit' || stop === 'time') ? { nextSkip } : {}),
        ...(stop === 'time' ? { message: tm('search.timeout', { s: Math.round(n.timeoutMs / 1000) }) } : {}),
      },
      hits,
    );
  } catch (e) {
    // o Git nem subiu (ENOENT) ou o sistema recusou: a mensagem vai inteira para a tela
    const code = (e as NodeJS.ErrnoException)?.code;
    return finish({ ok: false, ...(code === 'ENOENT' ? { reason: 'noGit' as const, message: tm('history.noGit') } : { message: e instanceof Error ? e.message : String(e) }) });
  } finally {
    clearTimeout(timer);
  }
}
