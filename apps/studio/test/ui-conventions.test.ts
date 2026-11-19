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
