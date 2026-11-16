// Leitura do CHANGELOG.md para exibir dentro do app. Módulo PURO (sem Electron, sem DOM): transforma o Markdown gerado pelo
// pipeline de release em dados que a interface desenha com templates Vue. Nada de `v-html`: o texto nunca vira HTML.
import { UPDATE_REPO } from './update';

/** Onde o changelog completo vive no GitHub (destino do botão "Ver no GitHub"). */
export const CHANGELOG_URL = `https://github.com/${UPDATE_REPO}/blob/main/CHANGELOG.md`;

/** Pedaço de uma linha: texto simples, negrito, código ou link (`code` = o texto do link é um trecho de código, como o hash do commit). */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string; code: boolean };

export interface ChangelogSection {
  /** Ex.: "✨ Novidades". */
  title: string;
  items: Inline[][];
}

export interface ChangelogVersion {
  /** "1.6.0" ou "Unreleased". */
  version: string;
  /** Data da release (AAAA-MM-DD), quando informada. */
  date?: string;
  sections: ChangelogSection[];
}

// **negrito** | `código` | [texto](endereço) — o texto do link pode ser um `código`.
const TOKEN = /\*\*(.+?)\*\*|`([^`]+)`|\[((?:[^\]\\]|\\.)+)\]\(([^)\s]+)\)/g;

/** Quebra uma linha de Markdown nos pedaços que o app sabe desenhar. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'code', text: m[2] });
    else if (m[3] !== undefined && m[4] !== undefined) {
      const code = /^`[^`]+`$/.test(m[3]);
      out.push({ kind: 'link', text: code ? m[3].slice(1, -1) : m[3], href: m[4], code });
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

const VERSION_HEAD = /^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/;
const SECTION_HEAD = /^###\s+(.+?)\s*$/;
const ITEM = /^[-*]\s+(.*)$/;

/**
 * Lê o Markdown do changelog. Tudo antes do primeiro `## [versão]` (título e texto de apresentação) é ignorado.
 * Linhas indentadas após um item continuam o item; o que não for reconhecido é ignorado, nunca lança.
 */
export function parseChangelog(markdown: string): ChangelogVersion[] {
  const versions: ChangelogVersion[] = [];
  let version: ChangelogVersion | null = null;
  let section: ChangelogSection | null = null;
  let item: string | null = null;

  const flushItem = () => {
    if (item !== null && version) {
      if (!section) {
        section = { title: '', items: [] };
        version.sections.push(section);
      }
      section.items.push(parseInline(item));
    }
    item = null;
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const v = VERSION_HEAD.exec(raw);
    if (v?.[1]) {
      flushItem();
      version = { version: v[1], date: v[2], sections: [] };
      versions.push(version);
      section = null;
      continue;
    }
    if (!version) continue;
    const s = SECTION_HEAD.exec(raw);
    if (s?.[1]) {
      flushItem();
      section = { title: s[1], items: [] };
      version.sections.push(section);
      continue;
    }
    const i = ITEM.exec(raw);
    if (i && !/^\s/.test(raw)) {
      flushItem();
      item = i[1] ?? '';
      continue;
    }
    if (item !== null && /^\s+\S/.test(raw)) item += ` ${raw.trim()}`; // continuação do item
    else if (!raw.trim()) flushItem();
  }
  flushItem();
  return versions;
}
