import { describe, expect, it } from 'vitest';
import { fuzzyScore, matches, norm, parseShortcut, shortcutLabel } from '../src/entrypoints/renderer/stores/commands';

const ev = (o: Partial<KeyboardEvent> & { key: string }) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

describe('norm', () => {
  it('ignora acentos e maiúsculas', () => {
    expect(norm('Operações DO Histórico')).toBe('operacoes do historico');
  });
});

describe('fuzzyScore', () => {
  it('sem busca, todos casam (pontuação 0)', () => {
    expect(fuzzyScore('', 'qualquer coisa')).toBe(0);
  });

  it('acha sem acento e sem diferenciar maiúsculas', () => {
    expect(fuzzyScore('operacoes', 'Ferramentas: histórico de operações')).not.toBeNull();
    expect(fuzzyScore('STASH', 'Ferramentas: stash')).not.toBeNull();
  });

  it('começo de palavra vale mais que o meio, e trecho contínuo mais que letras salteadas', () => {
    const inicio = fuzzyScore('stash', 'stash de arquivos')!;
    const meio = fuzzyScore('stash', 'guardar no stash')!; // começa em outra palavra, mas é início de palavra
    const dentro = fuzzyScore('ash', 'guardar no stash')!;
    const salteado = fuzzyScore('gnh', 'guardar no stash')!;
    expect(inicio).toBeGreaterThan(dentro);
    expect(meio).toBeGreaterThan(dentro);
    expect(dentro).toBeGreaterThan(salteado);
  });

  it('várias palavras em qualquer ordem', () => {
    expect(fuzzyScore('blame arquivo', 'Anotar (blame) o arquivo aberto')).not.toBeNull();
    expect(fuzzyScore('arquivo blame', 'Anotar (blame) o arquivo aberto')).not.toBeNull();
  });

  it('não casa quando faltam letras', () => {
    expect(fuzzyScore('xyz', 'Abrir Staging')).toBeNull();
    expect(fuzzyScore('stagingg', 'Abrir Staging')).toBeNull();
  });

  it('ordena do mais ao menos relevante', () => {
    const titles = ['Ferramentas: stash', 'Abrir Staging', 'Buscar (fetch) de todos os repositórios', 'Diff: lado a lado'];
    const ranked = titles
      .map((t) => ({ t, s: fuzzyScore('sta', t) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => b.s! - a.s!)
      .map((x) => x.t);
    expect(ranked).toEqual(['Abrir Staging', 'Ferramentas: stash']);
  });
});

describe('atalhos', () => {
  it('interpreta combinações', () => {
    expect(parseShortcut('Mod+Shift+A')).toEqual({ mod: true, alt: false, shift: true, key: 'a' });
    expect(parseShortcut('Alt+ArrowRight')).toEqual({ mod: false, alt: true, shift: false, key: 'arrowright' });
    expect(parseShortcut('F7')).toEqual({ mod: false, alt: false, shift: false, key: 'f7' });
  });

  it('Mod vale para Ctrl e para ⌘, e os modificadores têm de ser exatos', () => {
    const sc = parseShortcut('Mod+Shift+A');
    expect(matches(ev({ key: 'A', ctrlKey: true, shiftKey: true }), sc)).toBe(true);
    expect(matches(ev({ key: 'a', metaKey: true, shiftKey: true }), sc)).toBe(true);
    expect(matches(ev({ key: 'a', ctrlKey: true }), sc)).toBe(false); // falta Shift
    expect(matches(ev({ key: 'a', ctrlKey: true, shiftKey: true, altKey: true }), sc)).toBe(false); // Alt a mais
    expect(matches(ev({ key: 'a', shiftKey: true }), sc)).toBe(false); // falta Mod
  });

  it('F7 e Shift+F7 são distintos', () => {
    expect(matches(ev({ key: 'F7' }), parseShortcut('F7'))).toBe(true);
    expect(matches(ev({ key: 'F7', shiftKey: true }), parseShortcut('F7'))).toBe(false);
    expect(matches(ev({ key: 'F7', shiftKey: true }), parseShortcut('Shift+F7'))).toBe(true);
  });

  it('rótulo legível', () => {
    expect(shortcutLabel('Mod+Shift+A')).toMatch(/Ctrl\+Shift\+A|⌘Shift A?/);
    expect(shortcutLabel('Mod+PageDown')).toContain('PgDn');
  });
});

describe('atalho alternativo (alias)', () => {
  it('Ctrl+F e Ctrl+Shift+F disparam o mesmo comando, e o rótulo mostra só o principal', async () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const { createPinia, setActivePinia } = await import('pinia');
    const { useCommandsStore } = await import('../src/entrypoints/renderer/stores/commands');
    setActivePinia(createPinia());
    const cmds = useCommandsStore();
    cmds.register(() => [{ id: 'search.window', title: 'Pesquisar', group: 'g', shortcut: 'Mod+F', alias: 'Mod+Shift+F', run: () => undefined }]);
    const key = (o: Partial<KeyboardEvent>) => ({ key: 'f', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...o }) as KeyboardEvent;
    expect(cmds.byShortcut(key({}))?.id).toBe('search.window');
    expect(cmds.byShortcut(key({ shiftKey: true }))?.id).toBe('search.window');
    expect(cmds.byShortcut(key({ altKey: true }))).toBeUndefined();
    expect(cmds.byShortcut(key({ ctrlKey: false }))).toBeUndefined();
  });
});
