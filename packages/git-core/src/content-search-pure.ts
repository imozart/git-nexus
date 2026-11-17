// Busca no conteúdo dos arquivos (git grep): a parte pura, usada pelo núcleo (ler a saída do git) e pela interface (destacar o trecho achado).
import type { ContentMatch, ContentSearch } from './types/ipc.js';

/** Máximo de ocorrências devolvidas (o resto vira "mostrando as primeiras"). */
export const MAX_CONTENT_MATCHES = 1000;
/** Linhas maiores que isto (bundles minificados) são cortadas na resposta. */
export const MAX_MATCH_TEXT = 300;
/** Tamanho máximo do texto procurado. */
export const MAX_PATTERN = 500;

/**
 * Lê a saída de `git grep -z -n`: cada ocorrência é `arquivo NUL linha NUL texto`, uma por linha. Sem aspas nos nomes (é o `-z`).
 * Devolve só as primeiras `MAX_CONTENT_MATCHES` e diz se havia mais.
 */
export function parseGrepOutput(stdout: string): { matches: ContentMatch[]; truncated: boolean } {
  const matches: ContentMatch[] = [];
  let truncated = false;
  for (const raw of stdout.split('\n')) {
    if (!raw) continue;
    const a = raw.indexOf('\0');
    const b = a < 0 ? -1 : raw.indexOf('\0', a + 1);
    if (a < 0 || b < 0) continue;
    const line = Number(raw.slice(a + 1, b));
    if (!Number.isInteger(line) || line < 1) continue;
    if (matches.length >= MAX_CONTENT_MATCHES) {
      truncated = true;
      break;
    }
    const text = raw.slice(b + 1).replace(/\r$/, '');
    matches.push({ file: raw.slice(0, a), line, text: text.length > MAX_MATCH_TEXT ? text.slice(0, MAX_MATCH_TEXT) + '…' : text });
  }
  return { matches, truncated };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Trechos `[início, fim)` do texto que casam com a busca, para destacar. Usa a RegExp do JavaScript (parecida com a do git, mas não igual):
 * se a expressão não compila aqui, não destaca nada, e a busca em si continua valendo (quem decide o que casa é o git).
 */
export function matchRanges(text: string, q: Pick<ContentSearch, 'pattern' | 'regex' | 'caseSensitive' | 'wholeWord'>, max = 20): Array<[number, number]> {
  if (!q.pattern) return [];
  let re: RegExp;
  try {
    const body = q.regex ? q.pattern : escapeRegExp(q.pattern);
    re = new RegExp(q.wholeWord ? `\\b(?:${body})\\b` : body, q.caseSensitive ? 'g' : 'gi');
  } catch {
    return [];
  }
  const out: Array<[number, number]> = [];
  for (let m = re.exec(text); m && out.length < max; m = re.exec(text)) {
    if (m[0].length === 0) re.lastIndex++;
    else out.push([m.index, m.index + m[0].length]);
  }
  return out;
}
