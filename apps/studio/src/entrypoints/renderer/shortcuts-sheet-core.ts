// Folha de atalhos (#288): a lista dos comandos do app agrupada por área, com o atalho que vale AGORA (o remapeado, se houver) e busca (sem Vue, para testar).
// A fonte é a mesma da paleta e das Configurações > Atalhos (o registro de comandos), então as três nunca divergem.
import { norm, type Command } from './stores/commands';

export interface SheetItem {
  id: string;
  title: string;
  /** Os atalhos como se escrevem na tela ("Ctrl+K", "⌘K"); vazio = o comando não tem atalho. */
  keys: string[];
}
export interface SheetGroup {
  name: string;
  items: SheetItem[];
}

type Cmd = Pick<Command, 'id' | 'title' | 'group' | 'shortcut' | 'alias' | 'keywords'>;

/**
 * Agrupa por área (na ordem em que as áreas aparecem), cada uma com os comandos que têm atalho primeiro e depois os outros, por título. Sem repetir comando.
 * `shortcutOf` é o atalho vigente (remapeado ou padrão); o alias só vale enquanto o atalho não foi remapeado (`isCustom`).
 */
export function buildSheet(
  commands: readonly Cmd[],
  opts: { shortcutOf: (c: Cmd) => string | undefined; isCustom: (id: string) => boolean; label: (shortcut: string) => string; query?: string },
): SheetGroup[] {
  const q = norm(opts.query ?? '').trim();
  const seen = new Set<string>();
  const groups = new Map<string, SheetItem[]>();
  for (const c of commands) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const keys = [opts.shortcutOf(c), opts.isCustom(c.id) ? undefined : c.alias].filter((s): s is string => !!s).map(opts.label);
    if (q && !norm(`${c.title} ${c.group} ${keys.join(' ')} ${c.keywords ?? ''}`).includes(q)) continue;
    (groups.get(c.group) ?? groups.set(c.group, []).get(c.group)!).push({ id: c.id, title: c.title, keys });
  }
  return [...groups].map(([name, items]) => ({
    name,
    items: [...items].sort((a, b) => Number(!a.keys.length) - Number(!b.keys.length) || a.title.localeCompare(b.title)),
  }));
}

/** Quantos comandos a folha mostra (para o contador e para o teste que a compara com a paleta). */
export const sheetCount = (groups: readonly SheetGroup[]): number => groups.reduce((n, g) => n + g.items.length, 0);

/** A tecla "?" (sem Ctrl/Alt) abre a folha, mas só quando a pessoa não está digitando: campo de texto, editor de código ou conteúdo editável a deixam em paz. */
export function questionMarkOpensSheet(ev: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>): boolean {
  if (ev.key !== '?' || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const el = ev.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return true;
  if (el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .cm-editor')) return false;
  return true;
}
