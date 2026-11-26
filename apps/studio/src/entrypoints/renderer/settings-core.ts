// Parte pura das Configurações (sem Vue nem DOM, para testar): as seções, o índice de busca ("assinar", "e-mail", "tema escuro" acham a opção certa em pt-BR e en),
// a captura de atalhos e o esquema versionado de exportação e importação das preferências.
import type { MessageKey } from './i18n';

// ---- seções e busca ---------------------------------------------------------------------------------------------------------------------------------------------

export const SETTINGS_SECTIONS = ['general', 'appearance', 'git', 'conflicts', 'shortcuts', 'advanced'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface SettingMeta {
  /** Identifica o campo (`data-setting` no DOM): a busca leva até ele e põe o foco. */
  id: string;
  section: SettingsSection;
  label: MessageKey;
  /** Sinônimos em pt-BR e en (texto livre, sem acento obrigatório): é o que faz "assinar" e "signing" acharem a mesma opção. */
  keywords: string;
}

export const SETTINGS_INDEX: readonly SettingMeta[] = [
  { id: 'language', section: 'general', label: 'settings.language', keywords: 'idioma língua linguagem language locale português inglês english' },
  { id: 'auto-update', section: 'general', label: 'settings.autoUpdate', keywords: 'atualização atualizar versão update upgrade release' },
  { id: 'auto-fetch', section: 'general', label: 'settings.autoFetch', keywords: 'buscar fetch automático remoto origin sincronizar sync' },
  { id: 'theme', section: 'appearance', label: 'settings.theme', keywords: 'tema escuro claro dark light sistema cores aparência theme color' },
  { id: 'motion', section: 'appearance', label: 'settings.motion', keywords: 'movimento animação animações reduzido motion animation reduced' },
  { id: 'font-ui', section: 'appearance', label: 'settings.fontUi', keywords: 'fonte letra tipografia interface font typeface' },
  { id: 'font-code', section: 'appearance', label: 'settings.fontCode', keywords: 'fonte letra código monoespaçada font code mono' },
  { id: 'ligatures', section: 'appearance', label: 'settings.ligatures', keywords: 'ligaduras código ligatures' },
  { id: 'git-name', section: 'git', label: 'settings.git.name', keywords: 'nome identidade autor commitador name identity author user.name' },
  { id: 'git-email', section: 'git', label: 'settings.git.email', keywords: 'e-mail email correio identidade autor mail identity author user.email' },
  { id: 'git-sign', section: 'git', label: 'settings.git.sign', keywords: 'assinar assinatura commit gpg ssh chave sign signing signed commit.gpgsign' },
  { id: 'git-format', section: 'git', label: 'settings.git.format', keywords: 'assinar formato assinatura openpgp gpg ssh x509 format signing gpg.format' },
  { id: 'git-key', section: 'git', label: 'settings.git.key', keywords: 'assinar chave assinatura gpg ssh key signing user.signingkey' },
  { id: 'git-pull', section: 'git', label: 'settings.git.pull', keywords: 'pull puxar rebase merge mesclar ao puxar pull.rebase' },
  { id: 'git-branch', section: 'git', label: 'settings.git.defaultBranch', keywords: 'ramo inicial branch padrão main master init default init.defaultbranch' },
  { id: 'git-crlf', section: 'git', label: 'settings.git.crlf', keywords: 'quebra de linha crlf lf autocrlf windows fim de linha line endings core.autocrlf' },
  { id: 'new-resolver', section: 'conflicts', label: 'settings.newResolver', keywords: 'resolvedor conflitos merge novo experimental resolver conflicts' },
  { id: 'rerere', section: 'conflicts', label: 'settings.conflicts.rerere', keywords: 'rerere lembrar resoluções reuse recorded resolution conflitos conflicts' },
  { id: 'conflict-style', section: 'conflicts', label: 'settings.conflicts.style', keywords: 'estilo marcadores conflito diff3 zdiff3 base merge.conflictstyle conflict style markers' },
  { id: 'shortcuts', section: 'shortcuts', label: 'settings.sec.shortcuts', keywords: 'atalhos teclado teclas remapear comandos shortcuts keyboard keys remap hotkeys keybindings' },
  { id: 'data-folder', section: 'advanced', label: 'settings.adv.data', keywords: 'pasta dados armazenamento data folder storage userdata' },
  { id: 'gitlog-max', section: 'advanced', label: 'settings.adv.logMax', keywords: 'log git comandos histórico limite guardados commands history limit console' },
  { id: 'logs', section: 'advanced', label: 'settings.adv.logs', keywords: 'logs registro registros diagnóstico log diagnostics' },
  { id: 'export', section: 'advanced', label: 'settings.adv.export', keywords: 'exportar backup salvar configurações export save settings json' },
  { id: 'import', section: 'advanced', label: 'settings.adv.import', keywords: 'importar restaurar configurações import restore settings json' },
  { id: 'reset', section: 'advanced', label: 'settings.adv.reset', keywords: 'redefinir restaurar padrão limpar reset restore defaults clear' },
];

/** Minúsculas e sem acento: "ligaduras" e "Ligáduras" casam. */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * As opções que casam com a busca: TODAS as palavras digitadas têm de aparecer no nome, na seção ou nos sinônimos (a ordem não importa). Quem tem o nome
 * começando pela busca vem primeiro; empate fica na ordem do índice (a da tela).
 */
export function searchSettings(query: string, label: (m: SettingMeta) => string, sectionLabel: (s: SettingsSection) => string, index: readonly SettingMeta[] = SETTINGS_INDEX): SettingMeta[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const q = words.join(' ');
  return index
    .map((m, i) => {
      const name = normalize(label(m));
      const hay = `${name} ${normalize(sectionLabel(m.section))} ${normalize(m.keywords)}`;
      return words.every((w) => hay.includes(w)) ? { m, i, first: name.startsWith(q) ? 0 : 1 } : null;
    })
    .filter((x): x is { m: SettingMeta; i: number; first: number } => x !== null)
    .sort((a, b) => a.first - b.first || a.i - b.i)
    .map((x) => x.m);
}

// ---- captura de atalho -------------------------------------------------------------------------------------------------------------------------------------------

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']);

/**
 * O atalho (no formato dos comandos: "Mod+Alt+1", "Mod+Shift+P", "F5") que o evento representa, ou `null` se ainda é só um modificador. `error: 'needMod'` quando
 * a combinação não seria aceita pelo app (o app só trata combinações com Ctrl/Cmd, Alt ou tecla de função: o resto é digitação).
 */
export function captureShortcut(ev: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>): { shortcut: string } | { error: 'needMod' } | null {
  if (MODIFIER_KEYS.has(ev.key)) return null;
  const fn = /^F\d{1,2}$/i.test(ev.key);
  if (!(ev.ctrlKey || ev.metaKey || ev.altKey || fn)) return { error: 'needMod' };
  const key = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key === ' ' ? 'Space' : ev.key.replace(/^Arrow/, '');
  const parts = [ev.ctrlKey || ev.metaKey ? 'Mod' : '', ev.altKey ? 'Alt' : '', ev.shiftKey ? 'Shift' : '', key].filter(Boolean);
  return { shortcut: parts.join('+') };
}

/** Combinações que o app trata por fora dos comandos (a paleta): não podem ser remapeadas para outro comando. */
export const RESERVED_SHORTCUTS: readonly string[] = ['Mod+K', 'Mod+Shift+P'];

/** Forma canônica para comparar dois atalhos ("ctrl+k" e "Mod+K" são o mesmo). */
export function canonicalShortcut(s: string): string {
  const parts = s.split('+').map((p) => p.trim().toLowerCase());
  const key = parts.pop() ?? '';
  const mods = new Set(parts.map((p) => (p === 'ctrl' || p === 'meta' || p === 'cmd' ? 'mod' : p)));
  return [...['mod', 'alt', 'shift'].filter((m) => mods.has(m)), key === 'space' ? ' ' : key].join('+');
}

export const isReservedShortcut = (s: string): boolean => RESERVED_SHORTCUTS.some((r) => canonicalShortcut(r) === canonicalShortcut(s));

// ---- exportar e importar as preferências ----------------------------------------------------------------------------------------------------------------------------

export const SETTINGS_SCHEMA_VERSION = 1;
const PREFIX = 'gitnexus.';
/**
 * As chaves do `localStorage` que são PREFERÊNCIAS (lista fechada). Rascunhos, histórico, "última versão vista" e a visão lembrada de cada repositório ficam de fora
 * de propósito: não são configuração e não devem viajar para outra máquina.
 */
export const PREF_KEYS: readonly string[] = [
  'autoFetch', 'collapseUnchanged', 'commitPolicy', 'diffMode', 'diffSource', 'fontCode', 'fontUi', 'gitLogFilter', 'gitLogMask', 'gitLogMax', 'ligatures', 'locale', 'mergeView.ignoreSpace',
  'mergeView.invisibles', 'mergeView.sideBySide', 'motion', 'newConflictResolver', 'notifications', 'shortcuts', 'showCommitPanel', 'showConflictList', 'showFilesPanel',
  'showGitLog', 'theme', 'updateCheck',
].map((k) => PREFIX + k);

export interface SettingsExport {
  app: 'gitnexus';
  version: number;
  exportedAt: string;
  prefs: Record<string, string>;
}

type StorageRead = Pick<Storage, 'getItem'>;

/** As preferências guardadas agora (só as da lista, só as que têm valor). */
export function collectPrefs(storage: StorageRead): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PREF_KEYS) {
    const v = storage.getItem(k);
    if (v !== null) out[k] = v;
  }
  return out;
}

export function buildExport(prefs: Record<string, string>, now: Date = new Date()): SettingsExport {
  return { app: 'gitnexus', version: SETTINGS_SCHEMA_VERSION, exportedAt: now.toISOString(), prefs };
}

export type ImportResult = { ok: true; prefs: Record<string, string> } | { ok: false; reason: 'json' | 'format' | 'newer' };

/** Migrações de versões antigas do arquivo para a atual: cada uma recebe o que a anterior produziu. (Hoje só existe a versão 1.) */
const MIGRATIONS: Record<number, (prefs: Record<string, string>) => Record<string, string>> = {};

/**
 * Lê um arquivo exportado. Recusa o que não é do GitNexus, o que é de uma versão MAIS NOVA que esta e valores que não são texto curto; chaves fora da lista de
 * preferências são descartadas em silêncio (o arquivo pode ter vindo de outro lugar); versões antigas passam pelas migrações.
 */
export function parseImport(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json' };
  }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'format' };
  const d = data as Partial<SettingsExport>;
  if (d.app !== 'gitnexus' || typeof d.version !== 'number' || !d.prefs || typeof d.prefs !== 'object' || Array.isArray(d.prefs)) return { ok: false, reason: 'format' };
  if (d.version > SETTINGS_SCHEMA_VERSION) return { ok: false, reason: 'newer' };
  let prefs: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.prefs)) if (PREF_KEYS.includes(k) && typeof v === 'string' && v.length <= 20_000) prefs[k] = v;
  for (let v = Math.max(1, Math.floor(d.version)); v < SETTINGS_SCHEMA_VERSION; v++) prefs = MIGRATIONS[v]?.(prefs) ?? prefs;
  return { ok: true, prefs };
}
