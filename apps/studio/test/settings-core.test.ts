import { describe, expect, it } from 'vitest';
import { SETTINGS_INDEX, SETTINGS_SCHEMA_VERSION, PREF_KEYS, buildExport, canonicalShortcut, captureShortcut, collectPrefs, isReservedShortcut, parseImport, searchSettings, type SettingMeta } from '../src/entrypoints/renderer/settings-core';
import en from '../src/entrypoints/renderer/i18n/en';
import ptBR from '../src/entrypoints/renderer/i18n/pt-BR';

const find = (q: string, dict: Record<string, string>) =>
  searchSettings(q, (m: SettingMeta) => dict[m.label] ?? m.label, (s) => dict[`settings.sec.${s}`] ?? dict[`settings.${s}`] ?? s).map((m) => m.id);

describe('busca nas configurações', () => {
  it('acha por nome e por sinônimo, em pt-BR e en, sem depender de acento ou da ordem das palavras', () => {
    expect(find('assinar', ptBR)).toContain('git-sign');
    expect(find('signing', en)).toContain('git-sign');
    expect(find('e-mail', ptBR)).toContain('git-email');
    expect(find('email', en)).toContain('git-email');
    expect(find('tema escuro', ptBR)).toContain('theme');
    expect(find('dark theme', en)).toContain('theme');
    expect(find('LIGADURAS', ptBR)).toContain('ligatures');
    expect(find('chave assinatura', ptBR)).toEqual(expect.arrayContaining(['git-key', 'git-sign']));
  });
  it('sem resultado para o que não existe, e vazio para busca em branco', () => {
    expect(find('zzzqq', ptBR)).toEqual([]);
    expect(find('   ', ptBR)).toEqual([]);
  });
  it('o nome que começa pela busca vem primeiro', () => {
    expect(find('fonte', ptBR)[0]).toMatch(/^font-/);
  });
  it('todo campo do índice tem texto nos dois idiomas e ids únicos', () => {
    for (const m of SETTINGS_INDEX) {
      expect(ptBR[m.label], m.label).toBeTruthy();
      expect(en[m.label], m.label).toBeTruthy();
    }
    expect(new Set(SETTINGS_INDEX.map((m) => m.id)).size).toBe(SETTINGS_INDEX.length);
  });
});

describe('captura de atalho', () => {
  const ev = (key: string, o: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
  it('monta o atalho no formato dos comandos', () => {
    expect(captureShortcut(ev('k', { ctrlKey: true }))).toEqual({ shortcut: 'Mod+K' });
    expect(captureShortcut(ev('1', { ctrlKey: true, altKey: true }))).toEqual({ shortcut: 'Mod+Alt+1' });
    expect(captureShortcut(ev('P', { metaKey: true, shiftKey: true }))).toEqual({ shortcut: 'Mod+Shift+P' });
    expect(captureShortcut(ev('F5'))).toEqual({ shortcut: 'F5' });
    expect(captureShortcut(ev('ArrowDown', { altKey: true }))).toEqual({ shortcut: 'Alt+Down' });
  });
  it('só um modificador ainda não é atalho; tecla solta é recusada', () => {
    expect(captureShortcut(ev('Control', { ctrlKey: true }))).toBeNull();
    expect(captureShortcut(ev('a'))).toEqual({ error: 'needMod' });
  });
  it('a paleta é reservada (qualquer grafia)', () => {
    expect(isReservedShortcut('Ctrl+K')).toBe(true);
    expect(isReservedShortcut('Mod+Shift+p')).toBe(true);
    expect(isReservedShortcut('Mod+Alt+K')).toBe(false);
  });
  it('compara atalhos pela forma canônica', () => {
    expect(canonicalShortcut('Ctrl+K')).toBe(canonicalShortcut('Mod+k'));
    expect(canonicalShortcut('Shift+Mod+P')).toBe('mod+shift+p');
    expect(canonicalShortcut('Mod+Alt+1')).not.toBe(canonicalShortcut('Mod+1'));
  });
});

describe('exportar e importar as preferências', () => {
  const store = (o: Record<string, string>) => ({ getItem: (k: string) => (k in o ? o[k]! : null) });
  it('exporta só preferências (rascunhos, histórico e a visão de cada repositório ficam de fora)', () => {
    const prefs = collectPrefs(store({ 'gitnexus.theme': 'dark', 'gitnexus.locale': 'en', 'gitnexus.mergeDraft': 'x', 'gitnexus.repoView.abc': 'graph', 'gitnexus.searchHistory': '[]', outra: '1' }));
    expect(prefs).toEqual({ 'gitnexus.theme': 'dark', 'gitnexus.locale': 'en' });
  });
  it('vai e volta; o arquivo traz o aplicativo, a versão e a data', () => {
    const prefs = { 'gitnexus.theme': 'light', 'gitnexus.shortcuts': '{"view.graph":"Mod+Alt+9"}' };
    const out = buildExport(prefs, new Date('2026-11-26T10:00:00Z'));
    expect(out).toMatchObject({ app: 'gitnexus', version: SETTINGS_SCHEMA_VERSION, exportedAt: '2026-11-26T10:00:00.000Z' });
    expect(parseImport(JSON.stringify(out))).toEqual({ ok: true, prefs });
  });
  it('recusa o que não é do GitNexus, JSON quebrado e versão mais nova; descarta chaves de fora da lista e valores que não são texto', () => {
    expect(parseImport('{ não é json')).toEqual({ ok: false, reason: 'json' });
    expect(parseImport('[]')).toEqual({ ok: false, reason: 'format' });
    expect(parseImport(JSON.stringify({ app: 'outro', version: 1, prefs: {} }))).toEqual({ ok: false, reason: 'format' });
    expect(parseImport(JSON.stringify({ app: 'gitnexus', version: 1, prefs: [] }))).toEqual({ ok: false, reason: 'format' });
    expect(parseImport(JSON.stringify({ app: 'gitnexus', version: SETTINGS_SCHEMA_VERSION + 1, prefs: {} }))).toEqual({ ok: false, reason: 'newer' });
    const r = parseImport(JSON.stringify({ app: 'gitnexus', version: 1, prefs: { 'gitnexus.theme': 'dark', 'gitnexus.mergeDraft': 'x', 'gitnexus.locale': 5, evil: 'y' } }));
    expect(r).toEqual({ ok: true, prefs: { 'gitnexus.theme': 'dark' } });
    expect(PREF_KEYS.every((k) => k.startsWith('gitnexus.'))).toBe(true);
  });
});
