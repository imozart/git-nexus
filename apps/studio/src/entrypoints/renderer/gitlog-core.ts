// Parte PURA do log do Git (sem Vue nem `window`), para poder ser testada.
import type { GitCommandEvent } from '@git-nexus/git-core/pure';

/** Padrão de comandos guardados por repositório (os mais antigos saem primeiro); dá para mudar nas Configurações. */
export const MAX_ENTRIES = 500;
export const MAX_ENTRIES_CHOICES = [200, 500, 1000, 2000, 5000] as const;

/** Lê o limite escolhido (texto do localStorage): fora da lista ou torto volta ao padrão. */
export function parseMax(raw: string | null | undefined): number {
  const n = Number(raw);
  return (MAX_ENTRIES_CHOICES as readonly number[]).includes(n) ? n : MAX_ENTRIES;
}

/** Mesmo repositório com barras/maiúsculas diferentes (C:\x\ e c:/x) cai na mesma chave. */
export const repoKey = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Junta eventos novos aos existentes, respeitando o limite. */
export function appendEvents(current: readonly GitCommandEvent[], incoming: readonly GitCommandEvent[], max = MAX_ENTRIES): GitCommandEvent[] {
  const all = [...current, ...incoming];
  return all.length > max ? all.slice(all.length - max) : all;
}

// --- o que é "meu" -------------------------------------------------------------------------------------------------------------------------------------------------

/** Faz parte de "Minhas ações": a pessoa pediu, ou o comando ALTERA o repositório (um fetch em segundo plano também muda o que ela vê). */
export const isMine = (e: GitCommandEvent): boolean => e.origin === 'user' || !e.readOnly;

/**
 * Deu errado de um jeito que interessa: falhou E é da pessoa ou altera o repositório. Consulta de segundo plano que "falha" faz parte do funcionamento
 * (uma sonda `rev-parse --verify`, um `config --get` de chave que não existe) e não vira erro. Código -1 sem saída é um comando cancelado (a busca nova
 * cancela a anterior), não um erro.
 */
export const isError = (e: GitCommandEvent): boolean => {
  if (e.code === 0) return false;
  if (e.code === -1 && !e.output) return false;
  return isMine(e);
};

export type LogFilter = 'mine' | 'all' | 'read' | 'errors';
export const LOG_FILTERS: readonly LogFilter[] = ['mine', 'all', 'read', 'errors'];
export const DEFAULT_FILTER: LogFilter = 'mine';

/** Lê o filtro lembrado; qualquer coisa fora da lista volta ao padrão ("Minhas ações"). */
export function parseFilter(raw: string | null | undefined): LogFilter {
  return (LOG_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as LogFilter) : DEFAULT_FILTER;
}

/** Aplica o filtro e a busca por texto (no comando e na saída, sem diferenciar maiúsculas). */
export function filterEntries(entries: readonly GitCommandEvent[], filter: LogFilter, query = ''): GitCommandEvent[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter === 'mine' && !isMine(e)) return false;
    if (filter === 'read' && !e.readOnly) return false;
    if (filter === 'errors' && !isError(e)) return false;
    return !q || e.command.toLowerCase().includes(q) || (e.output?.toLowerCase().includes(q) ?? false);
  });
}

// --- texto: copiar e exportar --------------------------------------------------------------------------------------------------------------------------------

/** O computador da pessoa some do texto: a pasta do repositório vira `<repo>` e a pasta pessoal (`C:\Users\fulano`, `/home/fulano`, `/Users/fulano`), `~`. */
export function maskPaths(text: string, repoPath?: string): string {
  let out = text;
  if (repoPath) {
    const variants = new Set([repoPath, repoPath.replace(/\\/g, '/'), repoPath.replace(/\//g, '\\')]);
    for (const v of [...variants].sort((a, b) => b.length - a.length)) out = out.split(v).join('<repo>');
  }
  return out.replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s'"]+/gi, '~').replace(/\/(?:home|Users)\/[^/\s'"]+/g, '~');
}

const pad = (n: number) => String(n).padStart(2, '0');
/** `AAAA-MM-DD HH:MM:SS`, no fuso do computador. */
export const stamp = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** Uma linha por comando: hora, origem, resultado e duração. */
export function logLine(e: GitCommandEvent): string {
  return `[${stamp(e.startedAt)}] ${e.origin === 'user' ? 'usuário' : 'segundo plano'} ${e.code === 0 ? 'ok' : `exit ${e.code}`} ${e.durationMs}ms  ${e.command}`;
}

/** O log da sessão como texto para anexar a um relato de bug. `mask`: sem caminhos pessoais. O texto já vem sem segredos (o núcleo os tira de cada evento). */
export function exportText(entries: readonly GitCommandEvent[], opts: { mask?: boolean; repoPath?: string; version?: string } = {}): string {
  const lines = [`# Log do Git do GitNexus${opts.version ? ` ${opts.version}` : ''}`, `# ${entries.length} comando${entries.length === 1 ? '' : 's'}`, ''];
  for (const e of entries) {
    lines.push(logLine(e));
    if (e.output) lines.push(...e.output.split('\n').map((l) => `    ${l}`));
  }
  const text = lines.join('\n') + '\n';
  return opts.mask ? maskPaths(text, opts.repoPath) : text;
}
