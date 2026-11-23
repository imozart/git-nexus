import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export interface Command {
  id: string;
  title: string;
  /** Agrupa na paleta (ex.: "Navegação", "Diff"). */
  group: string;
  /** Ex.: "Mod+Shift+A" (Mod = Ctrl no Windows/Linux e ⌘ no macOS). Só vale com Mod ou Alt, para não atrapalhar a digitação. */
  shortcut?: string;
  /** Um segundo atalho que dispara o mesmo comando (a paleta mostra só o `shortcut`). */
  alias?: string;
  /** Palavras extras para a busca. */
  keywords?: string;
  /** Quando devolve false o comando some da paleta e o atalho não dispara (ex.: só na aba ativa). */
  when?: () => boolean;
  run: () => unknown;
}

const RECENT_KEY = 'gitnexus.recentCommands';

/** Minúsculas e sem acentos: "operacoes" encontra "Operações". */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Pontuação de uma busca difusa: maior é melhor, `null` não casa.
 * Prioriza começo de palavra e trechos contínuos; aceita letras salteadas ("gh" → "Grafo / Histórico").
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = norm(query).replace(/\s+/g, ' ').trim();
  if (!q) return 0;
  const t = norm(text);
  const at = t.indexOf(q);
  if (at >= 0) return 1000 - at - (t.length - q.length) * 0.1 + (at === 0 || t[at - 1] === ' ' ? 200 : 0);
  // todas as palavras da busca presentes (em qualquer ordem)
  const words = q.split(' ');
  if (words.length > 1 && words.every((w) => t.includes(w))) return 600 - t.length * 0.1;
  // letras em sequência (subsequência)
  let pos = -1;
  let gaps = 0;
  for (const ch of q.replace(/ /g, '')) {
    const next = t.indexOf(ch, pos + 1);
    if (next < 0) return null;
    gaps += next - pos - 1;
    pos = next;
  }
  return 300 - gaps - t.length * 0.1;
}

export interface ParsedShortcut {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

export function parseShortcut(s: string): ParsedShortcut {
  const parts = s.split('+').map((p) => p.trim());
  const key = parts.pop()!.toLowerCase();
  const lower = parts.map((p) => p.toLowerCase());
  return { mod: lower.includes('mod') || lower.includes('ctrl'), alt: lower.includes('alt'), shift: lower.includes('shift'), key };
}

export function matches(ev: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>, sc: ParsedShortcut): boolean {
  const mod = ev.ctrlKey || ev.metaKey;
  return mod === sc.mod && ev.altKey === sc.alt && ev.shiftKey === sc.shift && ev.key.toLowerCase() === sc.key;
}

/** Texto do atalho para exibir (⌘ no macOS). */
export function shortcutLabel(s: string): string {
  const mac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  return s
    .split('+')
    .map((p) => {
      const l = p.trim().toLowerCase();
      if (l === 'mod') return mac ? '⌘' : 'Ctrl';
      if (l === 'pageup') return 'PgUp';
      if (l === 'pagedown') return 'PgDn';
      return p.trim().length === 1 ? p.trim().toUpperCase() : p.trim();
    })
    .join(mac ? '' : '+');
}

export const useCommandsStore = defineStore('commands', () => {
  const sources = ref<Array<() => Command[]>>([]);
  const isOpen = ref(false);
  const recent = ref<string[]>(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'));

  /** Registra uma fonte de comandos (função: é reavaliada a cada abertura, então pode ser dinâmica). Devolve o cancelamento. */
  function register(source: () => Command[]): () => void {
    sources.value.push(source);
    return () => {
      sources.value = sources.value.filter((s) => s !== source);
    };
  }

  const all = (): Command[] => sources.value.flatMap((s) => s());
  const available = (): Command[] => all().filter((c) => !c.when || c.when());

  /** Comandos que casam com a busca, com os usados recentemente primeiro quando não há busca. */
  function search(query: string): Command[] {
    const list = available();
    if (!query.trim()) {
      const rank = (id: string) => {
        const i = recent.value.indexOf(id);
        return i < 0 ? 999 : i;
      };
      return [...list].sort((a, b) => rank(a.id) - rank(b.id) || a.group.localeCompare(b.group) || a.title.localeCompare(b.title));
    }
    return list
      .map((c) => {
        const s = fuzzyScore(query, `${c.title} ${c.group} ${c.keywords ?? ''}`);
        return s === null ? null : { c, s: s + (recent.value.includes(c.id) ? 30 : 0) };
      })
      .filter((x): x is { c: Command; s: number } => x !== null)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }

  async function run(c: Command): Promise<void> {
    recent.value = [c.id, ...recent.value.filter((id) => id !== c.id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value));
    isOpen.value = false;
    await c.run();
  }

  /** Procura um comando disponível cujo atalho corresponde ao evento. */
  function byShortcut(ev: KeyboardEvent): Command | undefined {
    const safe = ev.ctrlKey || ev.metaKey || ev.altKey || /^f\d{1,2}$/i.test(ev.key);
    if (!safe) return undefined;
    return available().find((c) => (c.shortcut && matches(ev, parseShortcut(c.shortcut))) || (c.alias && matches(ev, parseShortcut(c.alias))));
  }

  const open = () => (isOpen.value = true);
  const close = () => (isOpen.value = false);
  const toggle = () => (isOpen.value = !isOpen.value);
  const count = computed(() => available().length);

  return { isOpen, recent, register, search, run, byShortcut, open, close, toggle, count };
});
