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
    // a dica é o GnTooltip, filho do botão (não envolvendo-o: o GnButtonGroup depende de :first-child/:last-child); sem `title` nativo
    expect(comp).toContain('<GnTooltip :text="title ?? label"');
    expect(comp).not.toMatch(/:title=/);
  });
  it('é leve por padrão e reaproveita o GnButton (não repete as cores)', () => {
    expect(comp).toContain("variant: 'ghost'");
    expect(comp).toContain("import GnButton");
  });
});

describe('GnTooltip', () => {
  const comp = read('components/GnTooltip.vue');
  const css = comp.slice(comp.indexOf('<style'));
  const markup = comp.slice(comp.indexOf('<template>'), comp.indexOf('</template>'));
  it('o texto é obrigatório (sem "?") e a dica tem role="tooltip", projetada no <body> (Teleport)', () => {
    expect(comp).toMatch(/\btext: string;/);
    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain('<Teleport to="body">');
  });
  it('sem v-html, e sem importar i18n, stores nem api (o texto entra por prop)', () => {
    expect(comp).not.toContain('v-html');
    expect(comp).not.toMatch(/from '(\.\.\/)+(i18n|api|stores)|from '\.\/(i18n|api)|useI18n|pinia/);
  });
  it('só tokens: sem cor literal; sombra, raio, camada e entrada pelos tokens do marco', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    for (const t of ['--gn-shadow-sm', '--gn-radius-sm', '--gn-z-tooltip', '--gn-enter']) expect(css, t).toContain(t);
    expect(css).toContain('pointer-events: none');
  });
  it('a cor do texto e o fundo são o par --gn-text sobre --gn-surface-2, que button-tones.test.ts já exige com contraste AA (4,5:1) nos dois temas', () => {
    expect(css).toContain('color: var(--gn-text);');
    expect(css).toContain('background: var(--gn-surface-2);');
  });
  it('props: text, placement (padrão "top"), delay (padrão 500) e disabled; sem slot e sem eventos', () => {
    expect(comp).toMatch(/placement\?: TipSide/);
    expect(comp).toContain("placement: 'top'");
    expect(comp).toContain('delay: TIP_DELAY_MS');
    expect(comp).toContain('disabled: false');
    expect(markup).not.toContain('<slot');
    expect(comp).not.toContain('defineEmits');
  });
  it('o Esc fecha sem stopPropagation (a tecla continua valendo para o app); rolagem e roda também fecham', () => {
    expect(comp).toContain("e.key === 'Escape'");
    expect(comp).not.toMatch(/\.stopPropagation\(/);
    expect(comp).toContain("window.addEventListener('scroll', close, true)");
    expect(comp).toContain("window.addEventListener('wheel', close, true)");
  });
  it('só abre o foco por teclado (:focus-visible), fecha no mousedown e mantém data-tooltip no pai', () => {
    expect(comp).toContain(":focus-visible");
    expect(comp).toContain("addEventListener('mousedown', close)");
    expect(comp).toContain("setAttribute('data-tooltip'");
    expect(comp).toContain("removeAttribute('data-tooltip')");
  });
  it('aria-describedby só quando o texto difere do aria-label, e a limpeza restaura o que o pai já tinha', () => {
    expect(comp).toContain("getAttribute('aria-label')");
    expect(comp).toContain("setAttribute('aria-describedby', id)");
    expect(comp).toContain('restoreDescribedBy');
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

describe('GnTabs: teclado', () => {
  const tabs = read('components/GnTabs.vue');
  it('só a aba ativa entra na ordem do Tab e as setas, Home, End, Enter e espaço trocam de aba', () => {
    expect(tabs).toContain(':tabindex="t.id === modelValue ? 0 : -1"');
    for (const k of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter']) expect(tabs, k).toContain(k);
    expect(tabs).toContain('focus-visible');
  });
});
