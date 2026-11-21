// Lógica pura (sem Vue) da comparação no resolvedor de conflitos: destaque por palavra sobre o HTML realçado, caracteres invisíveis,
// fim de linha das versões e o que a visão "lado a lado" precisa saber.
import type { CharRange, MergeModel, MergeSide } from '@git-nexus/git-core/pure';

/** Largura mínima (px) da área do resolvedor para a visão lado a lado: abaixo disso as três colunas ficariam apertadas e a visão padrão assume. */
export const MIN_SIDE_BY_SIDE = 980;

/** Altura de uma linha de código (px): os conectores do lado a lado são desenhados com ela. */
export const LINE_PX = 19;

/** Uma "unidade" de texto dentro do HTML do realce: uma entidade (`&lt;`) conta como UM caractere do texto original. */
const UNIT = /&[a-z]+;|[\s\S]/g;

/**
 * Envolve em `<mark class="wd">` os trechos `ranges` (posições no TEXTO da linha, sem o HTML) de uma linha já realçada por sintaxe.
 * As marcas ficam dentro de cada pedaço de texto, então não cruzam os `<span>` do realce.
 */
export function markHtml(html: string, ranges: readonly CharRange[] | undefined): string {
  if (!ranges?.length) return html;
  let out = '';
  let pos = 0; // posição no texto original
  let ri = 0;
  for (const part of html.split(/(<[^>]*>)/)) {
    if (part.startsWith('<')) {
      out += part;
      continue;
    }
    let open = false;
    for (const unit of part.match(UNIT) ?? []) {
      while (ri < ranges.length && ranges[ri]!.end <= pos) ri++;
      const inside = ri < ranges.length && pos >= ranges[ri]!.start && pos < ranges[ri]!.end;
      if (inside && !open) out += '<mark class="wd">';
      if (!inside && open) out += '</mark>';
      open = inside;
      out += unit;
      pos++;
    }
    if (open) out += '</mark>';
  }
  return out;
}

/** O nome curto de um terminador de linha. */
export const eolName = (eol: string): 'LF' | 'CRLF' | '' => (eol === '\r\n' ? 'CRLF' : eol === '\n' ? 'LF' : '');

/**
 * Mostra os caracteres invisíveis de uma linha (HTML já realçado): espaço, tab e o fim de linha. O texto continua o mesmo (cada
 * marca é desenhada por CSS), então a largura das colunas não muda.
 */
export function showInvisibles(html: string, eol = ''): string {
  const body = html
    .split(/(<[^>]*>)/)
    .map((part) => (part.startsWith('<') ? part : part.replace(/ /g, '<i class="inv inv--sp"> </i>').replace(/\t/g, '<i class="inv inv--tab">\t</i>')))
    .join('');
  const name = eolName(eol);
  return name ? `${body}<i class="inv inv--eol inv--${name === 'CRLF' ? 'crlf' : 'lf'}" aria-hidden="true"></i>` : body;
}

export interface EolInfo {
  /** Fim de linha dominante de cada versão que tem linhas. */
  mine: 'LF' | 'CRLF' | '';
  theirs: 'LF' | 'CRLF' | '';
  base: 'LF' | 'CRLF' | '';
  /** As versões usam fim de linha diferente (a escolha de qual vale no resultado só aparece nesse caso). */
  differs: boolean;
}

/** O fim de linha de cada versão, para o aviso "a minha usa CRLF, a que chega usa LF". */
export function eolInfo(model: MergeModel): EolInfo {
  const name = (side: MergeSide) => (model[side].lines.length ? eolName(model[side].eol) : '');
  const mine = name('mine');
  const theirs = name('theirs');
  const base = name('base');
  const used = [mine, theirs, base].filter(Boolean);
  return { mine, theirs, base, differs: new Set(used).size > 1 };
}

/** Qual das três colunas está de fora na visão lado a lado de um segmento: nenhuma; a base nunca aparece (fica no cartão). */
export const SIDE_COLUMNS = ['mine', 'result', 'theirs'] as const;
export type SideColumn = (typeof SIDE_COLUMNS)[number];

/** Resumo curto de uma pessoa/commit do histórico do trecho: "abc1234 · Fulana · 12/11/2026 · assunto". */
export function historyLine(h: { hash: string; author: string; date: string; subject: string }, locale: string): string {
  const d = new Date(h.date);
  const when = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale);
  return [h.hash.slice(0, 7), h.author, when, h.subject].filter(Boolean).join(' · ');
}
