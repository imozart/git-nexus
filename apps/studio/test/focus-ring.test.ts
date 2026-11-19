import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Campos com CSS próprio (issue #154): quem tem `:focus` próprio recebe o mesmo anel da regra global; o campo da paleta e os botões não mudam.
const comp = (n: string) => readFileSync(join(__dirname, '..', 'src', 'entrypoints', 'renderer', 'components', n), 'utf8').replace(/\r\n/g, '\n');

describe('anel de foco nos campos com CSS próprio', () => {
  it('o campo de pesquisa do seletor de branch (foco no contêiner) tem o anel', () => {
    expect(comp('BranchPicker.vue')).toMatch(/\.bp__search \{[^}]*&:focus-within \{[^}]*box-shadow: var\(--gn-ring\);/s);
  });
  it('o campo de pesquisa do menu de codificação tem o anel', () => {
    expect(comp('EncodingMenu.vue')).toContain('&:focus-visible { box-shadow: var(--gn-ring); }');
  });
  it('o campo da paleta de comandos NÃO recebe o anel (largura total, sem caixa: seria cortado)', () => {
    expect(comp('CommandPalette.vue')).not.toContain('--gn-ring');
  });
  it('botões e itens focáveis seguem com o outline de 2px (não unificar com o anel)', () => {
    const tabs = readFileSync(join(__dirname, '..', '..', 'ui-kit', 'src', 'components', 'GnTabs.vue'), 'utf8');
    expect(tabs).toContain('&:focus-visible { outline: 2px solid var(--gn-accent); outline-offset: -2px; }');
    expect(tabs).not.toContain('--gn-ring');
  });
});
