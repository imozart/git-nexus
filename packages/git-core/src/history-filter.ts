// Filtros do Grafo (#294): o que a lista de commits mostra (branches, autor, período, pasta ou arquivo, merges, remotos, tags, não publicados) traduzido para argumentos do
// `git log`. Tudo no Git, nada no renderer (para valer em históricos grandes), com cada valor como argumento SEPARADO (nunca interpolado) e as mesmas regras de
// segurança da pesquisa (`isSafeRevision`, `cleanFolder`). Puro: sem processo, para testar.
import { cleanFolder, isSafeRevision } from './search-pure.js';

/** De onde vêm os commits: só o branch atual, todas as referências, só os branches locais, ou uma lista escolhida. */
export type RefScope = 'current' | 'all' | 'local' | 'chosen';

export interface HistoryFilter {
  /** Padrão: `current`. */
  scope?: RefScope;
  /** Os branches (ou tags) escolhidos, com `scope: 'chosen'`. */
  branches?: string[];
  /** Soma os branches remotos ao que se vê. */
  remotes?: boolean;
  /** Soma as tags. */
  tags?: boolean;
  /** Nome ou e-mail (um trecho; o Git casa por expressão regular simples, sem diferenciar maiúscula). */
  author?: string;
  /** Datas como o Git entende ("2026-11-01", "7 days ago", "yesterday"). */
  since?: string;
  until?: string;
  /** Um arquivo ou uma pasta do repositório. */
  path?: string;
  noMerges?: boolean;
  /** Só o que nenhum remoto alcança. */
  unpublished?: boolean;
  /** `topo` (filhos antes dos pais: o desenho de lanes precisa) ou `date` (mais recente primeiro). */
  order?: 'topo' | 'date';
  /** Com `path`: só os commits que são pontas de branch ou tag (`--simplify-by-decoration`), uma visão resumida. */
  simplify?: boolean;
}

export type FilterError = { code: 'badRevision'; value: string } | { code: 'badPath'; value: string } | { code: 'badDate'; value: string } | { code: 'badAuthor' };

export interface LogArgs {
  /** Antes do `--`: referências e opções do filtro. */
  args: string[];
  /** Depois do `--`: o caminho (vazio se não há). */
  pathspec: string[];
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f]/;
/** Uma data que o Git entende, sem nada que pareça opção: letras, números, espaço e `: . , / + -` (o `-` só no meio, e o valor sempre vai grudado em `--since=`). */
const DATE = /^[\p{L}\p{N} :.,/+-]{1,64}$/u;

/** O filtro está no padrão (branch atual, nada mais)? */
export function isDefaultFilter(f: HistoryFilter | undefined): boolean {
  if (!f) return true;
  return (f.scope ?? 'current') === 'current' && !f.remotes && !f.tags && !f.author?.trim() && !f.since?.trim() && !f.until?.trim() && !f.path?.trim() && !f.noMerges && !f.unpublished && !f.simplify && (f.order ?? 'topo') === 'topo';
}

/**
 * Esses filtros tiram commits do MEIO da história sem religar os pais (autor e "sem merges"): o traçado de lanes não forma linhas contínuas e a lista os mostra sem ele,
 * como o resultado de uma busca. O caminho (religa os pais com --parents), as datas (cortam nas pontas) e as referências mantêm o traçado.
 */
export const filterBreaksGraph = (f: HistoryFilter | undefined): boolean => !!f && (!!f.author?.trim() || !!f.noMerges);

/** Quantos filtros estão ligados (o selo do botão e o contador de chips). */
export function activeFilterCount(f: HistoryFilter | undefined): number {
  if (!f) return 0;
  const scope = f.scope ?? 'current';
  return [scope !== 'current', !!f.remotes, !!f.tags, !!f.author?.trim(), !!f.since?.trim() || !!f.until?.trim(), !!f.path?.trim(), !!f.noMerges, !!f.unpublished, !!f.simplify].filter(Boolean).length;
}

/** O filtro vira argumentos do `git log` / `git rev-list`; um valor inválido devolve o erro (nada vai ao Git). */
export function buildLogArgs(f: HistoryFilter | undefined): LogArgs | { error: FilterError } {
  const filter = f ?? {};
  const args: string[] = [];
  const scope = filter.scope ?? 'current';
  const chosen = (filter.branches ?? []).map((b) => b.trim()).filter(Boolean);
  for (const b of chosen) if (!isSafeRevision(b)) return { error: { code: 'badRevision', value: b } };

  if (scope === 'all') args.push('--all');
  else if (scope === 'local') args.push('--branches', 'HEAD');
  else if (scope === 'chosen' && chosen.length) args.push(...chosen);
  else args.push('HEAD');
  if (scope !== 'all') {
    if (filter.remotes) args.push('--remotes');
    if (filter.tags) args.push('--tags');
  }
  if (filter.unpublished) args.push('--not', '--remotes');

  const author = filter.author?.trim();
  if (author) {
    if (author.length > 200 || CONTROL.test(author)) return { error: { code: 'badAuthor' } };
    args.push('--regexp-ignore-case', `--author=${author}`); // o Git diferencia maiúscula por padrão; aqui "bia" acha "Bia"
  }
  for (const [flag, v] of [['--since', filter.since], ['--until', filter.until]] as const) {
    const d = v?.trim();
    if (!d) continue;
    if (!DATE.test(d)) return { error: { code: 'badDate', value: d } };
    args.push(`${flag}=${d}`);
  }
  if (filter.noMerges) args.push('--no-merges');
  args.push(filter.order === 'date' ? '--date-order' : '--topo-order', '--parents');
  if (filter.simplify && filter.path?.trim()) args.push('--simplify-by-decoration');

  const raw = filter.path?.trim();
  if (raw) {
    const p = cleanFolder(raw);
    if (p === null || p === '') return { error: { code: 'badPath', value: raw } };
    // o caminho é literal (sem magia de pathspec): um arquivo com `*` no nome é esse arquivo
    return { args, pathspec: [`:(literal)${p}`] };
  }
  return { args, pathspec: [] };
}
