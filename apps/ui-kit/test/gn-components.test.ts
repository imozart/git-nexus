import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICONS } from '../src/components/icons';

// Regras do ui-kit que o compilador não vê: tudo o que o app usa sai do index, ícone é dado (não HTML), botão só de ícone tem rótulo.
const src = join(__dirname, '..', 'src');
const read = (rel: string) => readFileSync(join(src, rel), 'utf8').replace(/\r\n/g, '\n');
const index = read('index.ts');
const components = readdirSync(join(src, 'components')).filter((f) => f.endsWith('.vue'));

describe('ui-kit: componentes exportados', () => {
  it('todo componente .vue da pasta sai pelo index (o app importa só de @git-nexus/ui-kit)', () => {
    expect(components.length).toBeGreaterThanOrEqual(7);
    for (const c of components) expect(index, c).toContain(`./components/${c}`);
  });

  it('todo componente começa com Gn (o prefixo é o que separa o kit dos componentes do app)', () => {
    for (const c of components) expect(c, c).toMatch(/^Gn[A-Z]/);
  });
});

describe('GnIcon', () => {
  it('cada ícone é uma lista não vazia de caminhos SVG (só comandos de path, sem HTML)', () => {
    const names = Object.keys(ICONS);
    expect(names.length).toBeGreaterThanOrEqual(15);
    for (const [name, paths] of Object.entries(ICONS)) {
      expect(paths.length, name).toBeGreaterThan(0);
      for (const d of paths) expect(d, name).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9 ,.\-]+$/);
    }
  });

  it('o componente não usa v-html (o ícone é desenhado a partir dos dados)', () => {
    expect(read('components/GnIcon.vue')).not.toContain('v-html');
  });
});

describe('GnIconButton', () => {
  const comp = read('components/GnIconButton.vue');
  it('o rótulo é obrigatório (sem texto visível, o aria-label é o nome do botão) e vira o tooltip por padrão', () => {
    expect(comp).toMatch(/\blabel: string;/); // sem "?": obrigatório
    expect(comp).toContain(':aria-label="label"');
    expect(comp).toContain(':title="title ?? label"');
  });
  it('é leve por padrão e reaproveita o GnButton (não repete as cores)', () => {
    expect(comp).toContain("variant: 'ghost'");
    expect(comp).toContain("import GnButton");
  });
});

describe('GnSegmented', () => {
  const comp = read('components/GnSegmented.vue');
  it('é um grupo de rádio acessível: papéis, aria-checked e só a opção ativa entra na ordem do Tab', () => {
    expect(comp).toContain('role="radiogroup"');
    expect(comp).toContain('role="radio"');
    expect(comp).toContain(':aria-checked="o.value === modelValue"');
    expect(comp).toContain(':tabindex="o.value === modelValue ? 0 : -1"');
  });
  it('a opção ativa é azul tingido, nunca o azul sólido do botão principal', () => {
    expect(comp).toContain('color-mix(in srgb, var(--gn-accent) 18%, var(--gn-surface-2))');
    expect(comp).not.toContain('--gn-accent-solid');
  });
});
