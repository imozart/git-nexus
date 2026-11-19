import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Menus e popovers ancorados (issue #157): sombra, raio e camada pelos tokens, entrada em fade. Cores e posicionamento não mudam.
const comp = (n: string) => readFileSync(join(__dirname, '..', 'src', 'entrypoints', 'renderer', 'components', n), 'utf8').replace(/\r\n/g, '\n');

// o trecho do CSS de cada contêiner flutuante (a regra do próprio contêiner, não a dos itens internos)
const CONTAINERS: { file: string; name: string; rule: RegExp; z?: string }[] = [
  { file: 'ContextMenu.vue', name: 'menu de contexto', rule: /\.ctx \{[^}]*\}/s, z: 'var(--gn-z-popover)' },
  { file: 'EncodingMenu.vue', name: 'menu de codificação', rule: /\.enc \{[^}]*\}/s, z: 'var(--gn-z-popover)' },
  { file: 'ComboBox.vue', name: 'lista do combo', rule: /\.cbx__list \{[^}]*\}/s, z: 'calc(var(--gn-z-dialog) + 1)' },
  { file: 'BranchPicker.vue', name: 'painel do seletor de branch', rule: /\.bp__panel,\n\.bp__fly \{[^}]*\}/s },
  { file: 'SyncButton.vue', name: 'painel de sincronização', rule: /\.ss__panel \{[^}]*\}/s },
];

describe.each(CONTAINERS)('$name ($file)', ({ file, rule, z }) => {
  const block = rule.exec(comp(file))?.[0] ?? '';
  it('usa --gn-shadow-md e --gn-radius-lg, sem sombra nem raio literais', () => {
    expect(block).not.toBe('');
    expect(block).toContain('box-shadow: var(--gn-shadow-md)');
    expect(block).toContain('border-radius: var(--gn-radius-lg)');
    expect(block).not.toMatch(/rgba\(/);
  });
  it('entra com fade curto (só opacidade: sem transform, o painel é posicionado por coordenadas)', () => {
    expect(block).toContain('animation: gn-fade-in var(--gn-enter) ease-out');
    expect(block).not.toContain('gn-pop-in');
  });
  if (z) it('a camada vem de token', () => expect(block).toContain(`z-index: ${z}`));
});

describe('camadas de captura de clique e submenu', () => {
  it('as camadas do seletor de branch e da sincronização estão na camada de popover, e o submenu uma acima', () => {
    const bp = comp('BranchPicker.vue');
    expect(bp).toContain('.bp__layer { position: fixed; inset: 0; z-index: var(--gn-z-popover); }');
    expect(bp).toContain('z-index: calc(var(--gn-z-popover) + 1)');
    expect(comp('SyncButton.vue')).toContain('.ss__layer { position: fixed; inset: 0; z-index: var(--gn-z-popover); }');
  });
  it('nenhum dos cinco volta a ter z-index numérico de três ou mais dígitos', () => {
    for (const f of CONTAINERS.map((c) => c.file)) {
      const css = comp(f).slice(comp(f).indexOf('<style'));
      expect(css, f).not.toMatch(/z-index:\s*\d{3,}/);
    }
  });
});
