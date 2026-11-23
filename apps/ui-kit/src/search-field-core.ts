// Núcleo puro do GnSearchField (sem Vue nem DOM, para testar): atalhos das opções, histórico do campo e validação de regex.

export type SearchToggle = 'case' | 'word' | 'regex';

/** A letra de cada opção. Vale `Alt+letra` (`⌘+Alt+letra` no macOS). */
export const TOGGLE_KEYS: Record<SearchToggle, 'KeyC' | 'KeyO' | 'KeyX'> = { case: 'KeyC', word: 'KeyO', regex: 'KeyX' };

export interface KeyLike {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** `KeyboardEvent.getModifierState`: `AltGraph` é a tecla Alt da direita dos teclados com AltGr (ABNT2, ISO). */
  getModifierState?: (key: string) => boolean;
}

/**
 * Qual opção o atalho aciona, ou `null`. Usa a TECLA FÍSICA (`code`), não o caractere: com Alt no macOS o caractere vira "ç", "ø"…
 *
 * AltGr (ABNT2/ISO) chega como Ctrl+Alt no Windows e `AltGraph` no Linux: é a tecla que DIGITA caracteres ("¢" em AltGr+C), então nunca é
 * atalho. Só o Alt da esquerda aciona. No macOS o atalho é ⌘+Alt, porque Alt sozinho também digita caracteres.
 */
export function toggleForKey(e: KeyLike, mac: boolean): SearchToggle | null {
  if (!e.altKey || e.shiftKey) return null;
  if (e.getModifierState?.('AltGraph')) return null;
  if (mac ? !e.metaKey || e.ctrlKey : e.metaKey || e.ctrlKey) return null;
  for (const [toggle, code] of Object.entries(TOGGLE_KEYS) as Array<[SearchToggle, string]>) if (e.code === code) return toggle;
  return null;
}

/** O valor de `aria-keyshortcuts` da opção: "Alt+C" ou "Meta+Alt+C". */
export function ariaShortcut(toggle: SearchToggle, mac: boolean): string {
  return `${mac ? 'Meta+Alt' : 'Alt'}+${TOGGLE_KEYS[toggle].slice(3)}`;
}

/** O atalho como aparece na dica: "Alt+C" (Windows e Linux) ou "⌘⌥C" (macOS). */
export function shortcutLabel(toggle: SearchToggle, mac: boolean): string {
  const letter = TOGGLE_KEYS[toggle].slice(3);
  return mac ? `⌘⌥${letter}` : `Alt+${letter}`;
}

/** A dica de uma opção: o nome e o atalho ("Diferenciar maiúsculas (Alt+C)"). */
export function toggleTip(name: string, toggle: SearchToggle, mac: boolean): string {
  return `${name} (${shortcutLabel(toggle, mac)})`;
}

/** `null` se a expressão regular é válida (a mesma que o motor de busca do editor compila); senão a mensagem do motor. */
export function regexProblem(pattern: string): string | null {
  if (!pattern) return null;
  try {
    new RegExp(pattern, 'gmu');
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.replace(/^Invalid regular expression:\s*/i, '') : String(e);
  }
}

/** Texto com quebra de linha: a busca de várias linhas liga sozinha. */
export const isMultiline = (text: string): boolean => /[\r\n]/.test(text);

/** Linhas visíveis do campo: cresce com as linhas do texto (no máximo 4), para a busca de várias linhas não ficar escondida. */
export const fieldRows = (text: string): number => Math.min(4, text.split(/\r\n|\r|\n/).length);

export const HISTORY_MAX = 50;

/** Guarda a busca no histórico: sem vazios, sem repetir (a repetida sobe para o fim) e com o limite de `HISTORY_MAX`. */
export function pushHistory(history: readonly string[], value: string, max = HISTORY_MAX): string[] {
  if (!value.trim()) return [...history];
  const rest = history.filter((h) => h !== value);
  return [...rest, value].slice(-max);
}

export interface HistoryCursor {
  /** Posição no histórico: `-1` é o que se estava digitando (o rascunho). */
  index: number;
  /** Texto digitado antes de navegar, para as setas poderem voltar a ele. */
  draft: string;
}

/**
 * Seta para cima (`dir = -1`: mais antigo) ou para baixo (`dir = 1`: mais novo). Devolve o novo cursor e o texto do campo, ou `null` se não há
 * para onde ir (o histórico acabou ou está vazio): quem chama deixa a seta fazer o que faria.
 */
export function stepHistory(history: readonly string[], cur: HistoryCursor, current: string, dir: -1 | 1): { cursor: HistoryCursor; value: string } | null {
  if (!history.length) return null;
  const draft = cur.index === -1 ? current : cur.draft;
  const from = cur.index === -1 ? history.length : cur.index;
  const next = from + dir;
  if (next < 0) return null;
  if (next >= history.length) return cur.index === -1 ? null : { cursor: { index: -1, draft }, value: draft };
  return { cursor: { index: next, draft }, value: history[next]! };
}
