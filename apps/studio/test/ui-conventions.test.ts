import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripHtmlComments } from './helpers/html';

// Convenções de interface (docs/INTERFACE.md) que o compilador não vê. O objetivo é que botão, seletor e ícone venham do ui-kit (Gn*), e não de
// HTML e CSS refeitos em cada tela. Quem precisa de uma exceção de verdade a registra aqui, com o motivo: a lista só deve encolher.
const renderer = join(__dirname, '..', 'src', 'entrypoints', 'renderer');

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? vueFiles(join(dir, e.name)) : e.name.endsWith('.vue') ? [join(dir, e.name)] : []));
}
const files = vueFiles(renderer).map((f) => ({ rel: relative(renderer, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8').replace(/\r\n/g, '\n') }));
const template = (text: string) => text.slice(0, text.indexOf('<style') < 0 ? text.length : text.indexOf('<style'));

/** `<button>` cru permitido por arquivo (quantidade máxima). Cada um tem um motivo; o resto deve usar GnButton/GnIconButton/GnSegmented. */
const RAW_BUTTONS: Record<string, { max: number; why: string }> = {
  'components/BranchPicker.vue': { max: 8, why: 'cabeçalho de seção, 3 ações do topo, merge e rebase da base, linha de branch e item do menu da branch: itens de lista/menu com teclado próprio (setas, Enter), sem aparência de botão' },
  'components/ComboBox.vue': { max: 1, why: 'gatilho do combo: é o próprio componente de seleção' },
  'components/ContextMenu.vue': { max: 1, why: 'item de menu (não é botão de ação com aparência de botão)' },
  'components/GitHubButton.vue': { max: 1, why: 'botão da marca do GitHub: segue o padrão do GitHub, de propósito' },
  'components/ToolStripe.vue': { max: 1, why: 'aba vertical das barras laterais' },
  'components/ChangesTree.vue': { max: 1, why: 'seta de expandir/recolher do grupo (ícone dentro de um alvo de 16px)' },
  'components/CommitForm.vue': { max: 1, why: 'chip de tipo de commit (candidato a GnChip)' },
  'components/GitLogPanel.vue': { max: 3, why: 'alternância do painel e os dois botões em pílula (candidatos a GnButton)' },
  'components/MergeConflictResolver.vue': { max: 1, why: 'atalho de bloco dentro da lista de conflitos' },
  'components/SideBySideDiff.vue': { max: 5, why: 'controles compactos por linha do diff (candidatos a GnIconButton size="xs") e a dobra de linhas' },
  'components/tools/SearchPanel.vue': { max: 5, why: 'três chaves independentes da busca (Aa, palavra inteira, regex: não são exclusivas, então não cabem no GnSegmented) e duas linhas de lista (cabeçalho do arquivo e ocorrência)' },
  'components/tools/StashPanel.vue': { max: 1, why: 'link-botão de "guardar só alguns arquivos"' },
  'CoreInterface.vue': { max: 1, why: 'botão "Comandos" da barra superior (candidato a GnButton)' },
};

describe('botões vêm do ui-kit', () => {
  it('nenhuma tela ganha um <button> cru novo (a lista de exceções só encolhe)', () => {
    for (const f of files) {
      const n = (template(f.text).match(/<button\b/g) ?? []).length;
      const allowed = RAW_BUTTONS[f.rel]?.max ?? 0;
      expect(n, `${f.rel}: ${n} <button> crus, permitido ${allowed}. Use GnButton, GnIconButton ou GnSegmented (docs/INTERFACE.md).`).toBeLessThanOrEqual(allowed);
    }
  });

  it('toda exceção registrada ainda existe (se o botão cru sumiu, tire a linha da lista)', () => {
    for (const [rel, { max }] of Object.entries(RAW_BUTTONS)) {
      const f = files.find((x) => x.rel === rel);
      expect(f, `${rel} não existe mais`).toBeDefined();
      const n = (template(f!.text).match(/<button\b/g) ?? []).length;
      expect(n, `${rel} tem ${n} botões crus, a lista diz ${max}: ajuste para o número real`).toBe(max);
    }
  });

  it('o CSS do seletor segmentado não volta a ser copiado nas telas (é o GnSegmented)', () => {
    for (const f of files) expect(f.text, f.rel).not.toMatch(/^\.seg\s*\{/m);
  });

  it('botão só de ícone usa GnIconButton: nenhum <GnButton> com apenas um glifo de seta como texto', () => {
    for (const f of files) expect(template(f.text), f.rel).not.toMatch(/<GnButton[^>]*>\s*[↑↓←→▲▼×]\s*<\/GnButton>/);
  });
});

describe('ícones', () => {
  it('as telas não usam emoji nem setas de texto como ícone de botão (use GnIcon)', () => {
    for (const f of files) expect(template(f.text), f.rel).not.toMatch(/[⏱👤]/u);
  });
});

describe('cores dos botões (docs/INTERFACE.md)', () => {
  it('"Atualizar" é neutro em todas as telas (mesma ação, mesma aparência)', () => {
    for (const f of files) {
      for (const m of template(f.text).matchAll(/<GnButton([^>]*)>\s*\{\{\s*t\('rv\.refresh'\)\s*\}\}/g)) {
        expect(m[1], `${f.rel}: «Atualizar» com tom/variante`).not.toMatch(/tone="|variant="primary"/);
      }
    }
  });

  it('só uma ação sólida (primary) azul por tela de ferramenta: o resto é contorno (tone) ou neutro', () => {
    // Abrir (linha da lista de repositórios) e Aplicar e remover (linha do stash) repetem N vezes: nunca sólidos.
    const conn = files.find((f) => f.rel === 'views/ConnectionInterface.vue')!;
    expect(template(conn.text)).not.toMatch(/<GnButton[^>]*variant="primary"[^>]*>\s*\{\{\s*t\('home\.open'\)/);
    const stash = files.find((f) => f.rel === 'components/tools/StashPanel.vue')!;
    expect(template(stash.text)).not.toMatch(/<GnButton[^>]*variant="primary"[^>]*>\{\{\s*t\('stash\.applyDrop'\)/);
  });
});

// ---------- tipografia (docs/INTERFACE.md, seção "Tipografia") ----------
// A fonte do app vem de tokens: a próxima tela não escreve 'Segoe UI', Consolas ou monospace à mão, não puxa fonte de CDN e não declara @font-face fora do kit.
const repoRoot = join(__dirname, '..', '..', '..');
const kitSrc = join(repoRoot, 'apps', 'ui-kit', 'src');
function walk(dir: string, exts: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' || e.name === 'fonts' ? [] : walk(join(dir, e.name), exts)) : exts.some((x) => e.name.endsWith(x)) ? [join(dir, e.name)] : []));
}
const typo = [...walk(renderer, ['.vue', '.scss', '.css', '.ts', '.html']), ...walk(kitSrc, ['.vue', '.scss', '.css', '.ts'])].map((f) => ({
  rel: relative(repoRoot, f).replace(/\\/g, '/'),
  text: readFileSync(f, 'utf8').replace(/\r\n/g, '\n'),
}));
/** Arquivos que PODEM nomear famílias, @font-face e ligaduras: são onde os tokens nascem. Só encolhe. */
const TYPOGRAPHY_HOMES: Record<string, string> = {
  'apps/ui-kit/src/styles/tokens.scss': 'define os tokens de fonte (--gn-font-*, --gn-mono, --gn-ligatures) e aplica no body, pre, code, kbd e samp',
  'apps/ui-kit/src/styles/fonts.scss': 'os quatro @font-face da JetBrains Mono embutida',
};
const ALLOWED_FAMILY = ['inherit', 'var(--gn-font-ui)', 'var(--gn-font-code)', 'var(--gn-mono)'];
const outsideHomes = typo.filter((f) => !(f.rel in TYPOGRAPHY_HOMES));
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('tipografia', () => {
  it('toda exceção registrada ainda existe (se o arquivo sumiu, tire a linha da lista)', () => {
    for (const rel of Object.keys(TYPOGRAPHY_HOMES)) expect(typo.some((f) => f.rel === rel), `${rel} não existe mais`).toBe(true);
  });

  it('a família da fonte só vem de token: nenhum font-family literal nas telas e no kit', () => {
    for (const f of outsideHomes) {
      for (const m of stripComments(f.text).matchAll(/font-family\s*:\s*([^;}\n]+)/g)) {
        const v = m[1]!.replace(/!important/, '').trim();
        expect(ALLOWED_FAMILY, `${f.rel}: font-family: ${v}. Use var(--gn-font-ui) para texto, var(--gn-font-code) (ou o apelido var(--gn-mono)) para código, ou inherit (docs/INTERFACE.md, Tipografia).`).toContain(v);
      }
    }
  });

  it('o atalho "font:" também: só inherit ou com a família de um token', () => {
    for (const f of outsideHomes) {
      for (const m of stripComments(f.text).matchAll(/(?<![-\w])font\s*:\s*([^;}\n]+)/g)) {
        const v = m[1]!.replace(/!important/, '').trim();
        if (/^\{|^\w+\s*\{/.test(v)) continue; // chave de texto (ex.: "Fonte: {name}") e não declaração CSS
        expect(v === 'inherit' || /var\(--gn-(font-ui|font-code|mono)\)$/.test(v), `${f.rel}: font: ${v}. A família do atalho tem de ser var(--gn-font-ui), var(--gn-font-code) ou var(--gn-mono).`).toBe(true);
      }
    }
  });

  it('em JavaScript (tema do editor etc.) fontFamily só com var(--gn-*)', () => {
    for (const f of outsideHomes.filter((x) => /\.(ts|vue)$/.test(x.rel))) {
      for (const m of f.text.matchAll(/fontFamily\s*:\s*(['"`])([^'"`]*)\1/g)) {
        expect(m[2], `${f.rel}: fontFamily '${m[2]}'. Use 'var(--gn-mono)' ou 'var(--gn-font-ui)'.`).toMatch(/^var\(--gn-(font-ui|font-code|mono)\)$/);
      }
    }
  });

  it('nada de fonte de fora: sem Google Fonts, CDN, @import de URL nem <link> de folha de estilo remota', () => {
    for (const f of typo) {
      expect(f.text, `${f.rel}: fonte de fora. A fonte é embutida (apps/ui-kit/src/styles/fonts.scss); o app funciona offline.`).not.toMatch(/fonts\.googleapis|fonts\.gstatic|\bcdn\.|@import\s+url\(\s*['"]?https?:|<link[^>]+rel=["']stylesheet["'][^>]*href=["']https?:/i);
    }
  });

  it('@font-face só em apps/ui-kit/src/styles/fonts.scss, com woff2, URL relativa e sem data:', () => {
    for (const f of typo.filter((x) => x.rel !== 'apps/ui-kit/src/styles/fonts.scss')) expect(stripComments(f.text), `${f.rel}: @font-face fora de fonts.scss`).not.toMatch(/@font-face/);
    const css = stripComments(typo.find((x) => x.rel === 'apps/ui-kit/src/styles/fonts.scss')!.text);
    const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const b of blocks) {
      expect(b).toMatch(/format\('woff2'\)/);
      expect(b).not.toMatch(/data:|https?:/);
      for (const u of b.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) expect(u[1], 'URL do @font-face precisa ser relativa').toMatch(/^\.{1,2}\/|^[\w-]+\//);
    }
  });

  it('ligaduras só pelo token: font-variant-ligatures e font-feature-settings literais só no tokens.scss', () => {
    for (const f of outsideHomes) {
      for (const m of stripComments(f.text).matchAll(/(font-variant-ligatures|font-feature-settings)\s*:\s*([^;}\n]+)/g)) {
        expect(m[2]!.trim(), `${f.rel}: ${m[1]}. Ligaduras só pelo token --gn-ligatures (tokens.scss).`).toMatch(/^var\(--gn-ligatures\)$/);
      }
    }
  });

  it('a regra funciona: um font-family literal, um @font-face fora do kit e um <link> de CDN seriam pegos', () => {
    const bad = "p { font-family: 'Segoe UI', sans-serif; }";
    expect([...bad.matchAll(/font-family\s*:\s*([^;}\n]+)/g)].some((m) => !ALLOWED_FAMILY.includes(m[1]!.trim()))).toBe(true);
    expect(/@font-face/.test('@font-face { font-family: x }')).toBe(true);
    expect(/fonts\.googleapis|\bcdn\./i.test('<link href="https://fonts.googleapis.com/css2?family=Inter">')).toBe(true);
  });
});

describe('listas vêm do ComboBox', () => {
  const noComments = stripHtmlComments; // tira TODOS os comentários, inclusive os aninhados (`<!<!---->-->`); um replace de passada só deixa `<!--` para trás
  it('nenhuma tela usa <select> nem <datalist> nativos (a lista aberta é do sistema, de cantos quadrados): use o ComboBox', () => {
    for (const f of files.filter((x) => x.rel !== 'components/ComboBox.vue')) {
      // (o próprio ComboBox cita <select> e <datalist> nos comentários: é o componente que os substitui)
      expect(noComments(template(f.text)), `${f.rel}: <select> nativo. Use o ComboBox (components/ComboBox.vue): lista flutuante no padrão do app.`).not.toMatch(/<select[\s>]/);
      expect(noComments(template(f.text)), `${f.rel}: <datalist> nativo. Use o ComboBox em modo searchable.`).not.toMatch(/<datalist[\s>]|\slist="/);
    }
  });
});

// ---------- movimento (docs/INTERFACE.md, seção "Movimento") ----------
// Toda duração de transição/animação vem dos tokens (--gn-motion-*, --gn-enter), que valem ~0 com movimento reduzido (opção do app ou do sistema).
describe('movimento', () => {
  const kit = join(__dirname, '..', '..', 'ui-kit', 'src');
  const walkCss = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' ? [] : e.isDirectory() ? walkCss(join(dir, e.name)) : /\.(vue|scss)$/.test(e.name) ? [join(dir, e.name)] : []));
  const all = [...walkCss(renderer), ...walkCss(kit)].map((f) => ({ rel: relative(join(__dirname, '..', '..', '..'), f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8').replace(/\r\n/g, '\n') }));
  const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const FIXED = /(^|[\s,:])\d*\.?\d+m?s\b/;

  it('transition e animation não têm duração fixa: só var(--gn-motion-*) ou var(--gn-enter)', () => {
    for (const f of all) {
      for (const m of noComments(f.text).matchAll(/(?<![\w-])(transition|animation)(-duration)?\s*:\s*([^;}\n]+)/g)) {
        const v = m[3]!;
        expect(FIXED.test(v), `${f.rel}: ${m[1]}${m[2] ?? ''}: ${v}. Use var(--gn-motion-fast|base|slow|loop) ou var(--gn-enter) (docs/INTERFACE.md, Movimento).`).toBe(false);
      }
    }
  });

  it('só o tokens.scss escreve prefers-reduced-motion (os componentes só usam os tokens) e não há rolagem suave fixa', () => {
    for (const f of all.filter((x) => !x.rel.endsWith('styles/tokens.scss'))) {
      expect(noComments(f.text), `${f.rel}: prefers-reduced-motion fora do tokens.scss. Use os tokens de duração.`).not.toMatch(/prefers-reduced-motion/);
      expect(noComments(f.text), `${f.rel}: rolagem suave fixa`).not.toMatch(/scroll-behavior\s*:\s*smooth|behavior:\s*'smooth'/);
    }
  });

  it('a regra funciona: uma transição de 0.2s seria pega', () => {
    expect(FIXED.test('transform 0.2s')).toBe(true);
    expect(FIXED.test('transform var(--gn-motion-base) ease-out')).toBe(false);
    expect(FIXED.test('opacity 120ms')).toBe(true);
  });
});

// ---------- testes de interface: valores no código da página (docs/DESENVOLVIMENTO.md) ----------
// Os scripts de apps/studio/scripts/ui-tests montam código JavaScript como texto para a página. Valor embutido com JSON.stringify é o padrão que o CodeQL
// reprova (js/bad-code-sanitization: U+2028/U+2029 e afins não são escapados); o helper lit() (lib.mjs) leva o valor em base64 e nunca vira código.
describe('testes de interface: valores entram na página por lit()', () => {
  const dir = join(__dirname, '..', 'scripts', 'ui-tests', 'tests');
  const files = readdirSync(dir).filter((n) => n.endsWith('.mjs'));
  const EMBED = /\$\{\s*JSON\.stringify\(/;

  it('nenhum teste embute ${JSON.stringify(...)} em código montado como texto', () => {
    expect(files.length).toBeGreaterThan(10);
    for (const n of files) {
      const text = readFileSync(join(dir, n), 'utf8');
      expect(EMBED.test(text), `${n}: use ${'$'}{lit(valor)} (de ../lib.mjs) no lugar de ${'$'}{JSON.stringify(valor)}`).toBe(false);
    }
  });

  it('a regra funciona: o padrão antigo seria pego e o novo não', () => {
    expect(EMBED.test('t.ev(`x.value = ${JSON.stringify(v)}`)')).toBe(true);
    expect(EMBED.test('t.ev(`x.value = ${lit(v)}`)')).toBe(false);
    expect(EMBED.test('console.log(JSON.stringify(report, null, 2))')).toBe(false); // fora de template: é só saída
  });
});

// ---------- elevação, camadas e foco (docs/INTERFACE.md, seção "Elevação, camadas e foco") ----------
// Sombra de overlay, fundo de overlay e camadas vêm dos tokens do ui-kit (tokens.scss); um valor literal copiado numa tela volta a espalhar o que o marco
// "Refinamento visual (layout)" organizou. Exceção de verdade entra nos mapas abaixo, com o motivo: cada uma só vale enquanto existir.
describe('elevação, camadas e foco', () => {
  const kitComponents = join(__dirname, '..', '..', 'ui-kit', 'src', 'components');
  const tokensFile = join(__dirname, '..', '..', 'ui-kit', 'src', 'styles', 'tokens.scss');
  const readLf = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const sources = [
    ...files.map((f) => ({ rel: `renderer/${f.rel}`, text: f.text })),
    ...vueFiles(kitComponents).map((f) => ({ rel: `ui-kit/${relative(kitComponents, f).replace(/\\/g, '/')}`, text: readLf(f) })),
  ];
  const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([;{}\s])\/\/[^\n]*/g, '$1');
  const styleOf = (text: string) => (text.indexOf('<style') < 0 ? '' : noComments(text.slice(text.indexOf('<style'))));

  /** Divide `a, b` só nas vírgulas de fora dos parênteses (`rgba(0, 0, 0, .5)` fica inteiro). */
  const splitTop = (v: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const c of v) {
      if (c === '(') depth++;
      if (c === ')') depth--;
      if (c === ',' && depth === 0) {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };
  /** Uma camada de sombra é "de elevação" se tem desfoque (3º comprimento > 0) e não é inset nem token. */
  const isElevation = (layer: string): boolean => {
    if (/^var\(--gn-(shadow-(sm|md|lg)|ring)\)$/.test(layer) || /^none$/.test(layer) || /^inset\b/.test(layer)) return false;
    const bare = layer.replace(/(rgba?|hsla?|color-mix|var)\((?:[^()]|\([^()]*\))*\)/g, ' ').replace(/#[0-9a-f]{3,8}\b/gi, ' ');
    const lengths = bare.match(/-?\d*\.?\d+(?:px|em|rem)?/g) ?? [];
    const blur = lengths[2];
    return blur !== undefined && parseFloat(blur) > 0;
  };

  /** Exceções por arquivo (caminho a partir de `apps/studio/src/entrypoints/renderer` ou `ui-kit/components`), com o motivo. Hoje não há nenhuma. */
  const SHADOW_EXCEPTIONS: Record<string, string> = {};
  const BACKDROP_EXCEPTIONS: Record<string, string> = {};

  it('sombra de elevação só por token: box-shadow com desfoque usa var(--gn-shadow-sm|md|lg) (inset, anel e deslocamento sem desfoque são livres)', () => {
    for (const f of sources) {
      if (f.rel in SHADOW_EXCEPTIONS) continue;
      for (const m of styleOf(f.text).matchAll(/box-shadow\s*:\s*([^;}\n]+)/g)) {
        for (const layer of splitTop(m[1]!)) {
          expect(isElevation(layer), `${f.rel}: box-shadow: ${layer}. Use var(--gn-shadow-sm|md|lg) (docs/INTERFACE.md, Elevação).`).toBe(false);
        }
      }
    }
  });

  it('camadas por token: nenhum z-index de 3 dígitos ou mais literal (use var(--gn-z-*) ou calc(var(--gn-z-*) + N))', () => {
    for (const f of sources) {
      for (const m of styleOf(f.text).matchAll(/z-index\s*:\s*(\d{3,})/g)) {
        expect.fail(`${f.rel}: z-index: ${m[1]}. Use var(--gn-z-popover|dialog|palette|tooltip|confetti) ou calc(var(--gn-z-*) + N) (docs/INTERFACE.md, Camadas).`);
      }
    }
  });

  it('fundo de overlay por token: nenhum background rgba(0, 0, 0, …) literal (use var(--gn-backdrop))', () => {
    for (const f of sources) {
      if (f.rel in BACKDROP_EXCEPTIONS) continue;
      for (const m of styleOf(f.text).matchAll(/background(?:-color)?\s*:\s*(rgba?\(\s*0\s*,\s*0\s*,\s*0\b[^)]*\))/g)) {
        expect.fail(`${f.rel}: background: ${m[1]}. Use var(--gn-backdrop) (docs/INTERFACE.md, Elevação).`);
      }
    }
  });

  it('só o GnDialog declara z-index: var(--gn-z-dialog): nenhuma tela refaz o overlay modal (use o GnDialog)', () => {
    for (const f of sources.filter((x) => x.rel !== 'ui-kit/GnDialog.vue')) {
      expect(styleOf(f.text), `${f.rel}: overlay modal copiado. Use o GnDialog (apps/ui-kit/src/components/GnDialog.vue).`).not.toMatch(/z-index\s*:\s*var\(--gn-z-dialog\)/);
    }
  });

  it('as exceções registradas ainda existem (se a sombra ou o fundo literal sumiu, tire a linha)', () => {
    for (const rel of [...Object.keys(SHADOW_EXCEPTIONS), ...Object.keys(BACKDROP_EXCEPTIONS)]) {
      expect(
        sources.some((x) => x.rel === rel),
        `${rel} não existe mais: tire a exceção`,
      ).toBe(true);
    }
  });

  it('dois temas: cada --gn-shadow-* e --gn-backdrop do tema escuro também é definido no tema claro', () => {
    const css = noComments(readLf(tokensFile));
    const light = css.indexOf(":root[data-theme='light']");
    expect(light, 'bloco :root[data-theme="light"] não encontrado em tokens.scss').toBeGreaterThan(0);
    const dark = css.slice(0, light);
    const lightBlock = css.slice(light, css.indexOf('\n}', light));
    const names = [...dark.matchAll(/(--gn-(?:shadow-[a-z]+|backdrop))\s*:/g)].map((m) => m[1]!);
    expect(names.length, 'nenhum token de sombra no escuro?').toBeGreaterThanOrEqual(4);
    for (const n of names) expect(lightBlock, `${n} existe no tema escuro e falta no claro`).toContain(`${n}:`);
  });

  it('a regra funciona: o padrão antigo seria pego e os tokens e as formas livres não', () => {
    expect(isElevation('0 16px 48px rgba(0, 0, 0, 0.6)')).toBe(true);
    expect(isElevation('0 8px 28px rgba(0,0,0,.4)')).toBe(true);
    expect(isElevation('var(--gn-shadow-lg)')).toBe(false);
    expect(isElevation('var(--gn-ring)')).toBe(false);
    expect(isElevation('inset 0 2px 0 var(--gn-accent)')).toBe(false);
    expect(isElevation('0 0 0 2px rgba(0, 0, 0, 0.3)')).toBe(false);
    expect(isElevation('0 -2px 0 var(--gn-accent)')).toBe(false);
    expect(splitTop('0 0 0 1px red, 0 8px 20px rgba(0, 0, 0, 0.5)')).toHaveLength(2);
  });
});

// ---------- dicas (tooltip): GnTooltip no lugar do title nativo (docs/INTERFACE.md, seção "Dicas") ----------
// O `title` nativo não tem o estilo do app, demora para aparecer e não aparece no foco do teclado. A dica é o GnTooltip, filho do elemento descrito.
describe('dicas vêm do GnTooltip', () => {
  /** Componentes em que `title` NÃO é a dica nativa: prop com outro sentido (título do diálogo) ou que já mostra o GnTooltip por dentro. */
  const TITLE_IS_A_PROP = new Set(['ConfirmDialog', 'GnDialog', 'GnIconButton', 'ComboBox', 'GnSegmented']);
  /** `title` nativo permitido por arquivo (quantidade), com o motivo: a lista só encolhe. */
  const NATIVE_TITLE: Record<string, { max: number; why: string }> = {
    'components/ChangesTree.vue': { max: 1, why: '<input type="checkbox"> do grupo: elemento sem filhos, o GnTooltip não cabe dentro' },
    'components/ComboBox.vue': { max: 1, why: '<input> do modo searchable: elemento sem filhos (o gatilho em botão já usa o GnTooltip)' },
    'components/OperationBanner.vue': { max: 1, why: '"Continuar" desabilitado com a razão no title: o botão desabilitado não recebe o mouse, então o GnTooltip não abriria' },
    'components/tools/OperationsPanel.vue': { max: 1, why: '"Desfazer" desabilitado com a razão no title: o botão desabilitado não recebe o mouse, então o GnTooltip não abriria' },
  };

  /** Quantos `title=` / `:title=` o template tem em elementos nativos e componentes em que ele é a dica nativa. */
  const nativeTitles = (text: string): string[] => {
    const out: string[] = [];
    for (const m of stripHtmlComments(template(text)).matchAll(/<([A-Za-z][\w-]*)((?:"[^"]*"|'[^']*'|`[^`]*`|[^>"'`])*)>/g)) {
      if (TITLE_IS_A_PROP.has(m[1]!)) continue;
      if (/(^|\s):?title=/.test(m[2]!)) out.push(m[1]!);
    }
    return out;
  };

  it('nenhuma tela ganha um title= nativo novo (use <GnTooltip :text="…" /> dentro do elemento); a lista de exceções só encolhe', () => {
    for (const f of files) {
      const n = nativeTitles(f.text).length;
      const allowed = NATIVE_TITLE[f.rel]?.max ?? 0;
      expect(n, `${f.rel}: ${n} title= nativos, permitido ${allowed}. Use <GnTooltip :text="…" /> como filho do elemento (docs/INTERFACE.md, Dicas).`).toBeLessThanOrEqual(allowed);
    }
  });

  it('toda exceção registrada ainda existe (se o title sumiu, tire a linha da lista)', () => {
    for (const [rel, { max }] of Object.entries(NATIVE_TITLE)) {
      const f = files.find((x) => x.rel === rel);
      expect(f, `${rel} não existe mais`).toBeDefined();
      expect(nativeTitles(f!.text).length, `${rel}: a lista diz ${max}; ajuste para o número real`).toBe(max);
    }
  });

  it('a regra funciona: title em button, span e GnButton seria pego; prop de ConfirmDialog e GnIconButton não', () => {
    expect(nativeTitles('<template><button :title="t(\'a\')">x</button></template>')).toEqual(['button']);
    expect(nativeTitles('<template><span title="x">y</span><GnButton :title="a ? b : c" @click="() => 1">z</GnButton></template>')).toEqual(['span', 'GnButton']);
    expect(nativeTitles('<template><ConfirmDialog :title="a" /><GnIconButton icon="x" :title="b" label="c" /></template>')).toEqual([]);
  });
});
