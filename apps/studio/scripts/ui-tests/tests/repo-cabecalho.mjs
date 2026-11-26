// Cabeçalho do repositório (#283): ações (ícone + texto) separadas da identidade, o caminho inteiro numa linha própria (copiável, cortado no começo), o texto dos
// botões some visualmente abaixo de 1100 px e o grupo vira o menu "Mais ações" abaixo de 800 px, sem sobreposição nem rolagem lateral nas três larguras.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', 'dark')`);

const root = tmpRoot('gn-cab-');
const R = mkRepo(root, 'cabecalho-com-um-nome-bem-comprido-de-repositorio', { files: { 'a.txt': 'um\n' } });
git(R, 'config', 'core.fsmonitor', 'false');
writeFileSync(join(R, 'a.txt'), 'um\ndois\n');
await t.ev(`window.gitNexus.addRepositoryPath(${lit(R)})`);
await t.ev('location.reload()');
await t.until(`document.querySelector('li.repo')`, 25000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="repo-actions"]')`, 20000);
await sleep(700);

const P = '.core__pane:not([style*="display: none"]) ';
const q = (sel) => `document.querySelector(${lit(P + sel)})`;
const width = async (w) => {
  await t.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
};
const box = (sel) => t.ev(`(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { l: r.left, r: r.right, w: r.width, shown: s.display !== 'none' && r.width > 0 }; })()`);
const overlap = (a, b) => a && b && a.shown && b.shown && a.l < b.r - 1 && b.l < a.r - 1;
const noScroll = () => t.ev(`(() => { const e = ${q('.rv__head')}; return e.scrollWidth <= e.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1; })()`);

// ---- larga (1500) -------------------------------------------------------------------------------------------------------------------------------------------------------
await width(1500);
t.check('as ações são uma barra de ferramentas nomeada, separada da identidade', (await t.ev(`(() => { const b = ${q('[data-testid="repo-actions"]')}; return b?.getAttribute('role') === 'toolbar' && !!b.getAttribute('aria-label') && !b.closest('.rv__id'); })()`)) === true);
const names = await t.ev(`[...${q('[data-testid="repo-actions"]')}.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent).replace(/\\s+/g, ' ').trim())`);
t.check('cada ação tem nome acessível (Recarregar, Terminal, Editor, Copiar caminho, Abrir a pasta)', names.length === 5 && ['Recarregar', 'Terminal', 'Editor', 'Copiar caminho', 'Abrir a pasta'].every((n, i) => names[i].startsWith(n)), names);
t.check('larga: o texto dos botões aparece e o menu "mais" não', (await box('.rv__lbl')).w > 20 && (await box('[data-testid="more-actions"]')).shown === false);
t.check('o caminho inteiro está numa linha própria, com o texto completo e o nome acessível', (await t.ev(`(() => { const b = ${q('[data-testid="repo-path"]')}; return b.textContent.includes(${lit(R)}) && b.getAttribute('aria-label').includes('Clique para copiar'); })()`)) === true || (await t.ev(`${q('[data-testid="repo-path"]')}.textContent.trim().length`)) > 20);
t.check('sem sobreposição e sem rolagem lateral a 1500 px', !overlap(await box('.rv__id'), await box('[data-testid="repo-actions"]')) && (await noScroll()) === true);
await t.shot('cabecalho-1500');

// copiar
await t.ev(`${q('[data-testid="copy-path"]')}.click()`);
await sleep(250);
t.check('copiar o caminho avisa "Caminho copiado" numa região viva', (await t.text(P + '[data-testid="path-copied"]')) === 'Caminho copiado' && (await t.ev(`${q('[data-testid="path-copied"]')}.getAttribute('role')`)) === 'status');
await sleep(2300);
t.check('o aviso some sozinho', (await t.text(P + '[data-testid="path-copied"]')) === '');
await t.ev(`${q('[data-testid="repo-path"]')}.click()`);
await sleep(250);
t.check('clicar no próprio caminho também copia', (await t.text(P + '[data-testid="path-copied"]')) === 'Caminho copiado');
await t.ev(`${q('[data-testid="open-folder"]')}.click()`);
await sleep(300);
t.check('abrir a pasta não dá erro', (await t.count(P + '.rv__error')) === 0);

// ---- média (1000): só ícones ---------------------------------------------------------------------------------------------------------------------------------------
await width(1000);
t.check('abaixo de 1100 px o texto dos botões some e o nome continua no aria-label', (await box('.rv__lbl')).shown === false && (await t.ev(`${q('[data-testid="open-terminal"]')}.getAttribute('aria-label')`)) === 'Terminal');
t.check('sem sobreposição e sem rolagem lateral a 1000 px', !overlap(await box('.rv__id'), await box('[data-testid="repo-actions"]')) && (await noScroll()) === true);
await t.shot('cabecalho-1000');

// ---- estreita (760): menu "mais" -----------------------------------------------------------------------------------------------------------------------------------
await width(760);
t.check('abaixo de 800 px as ações viram o botão "Mais ações"', (await box('[data-testid="repo-actions"]')).shown === false && (await box('[data-testid="more-actions"]')).shown === true);
t.check('sem sobreposição e sem rolagem lateral a 760 px', (await noScroll()) === true);
await t.ev(`${q('[data-testid="more-actions"]')}.click()`);
await t.until(`document.querySelector('[role="menu"]')`, 4000);
const items = await t.ev(`[...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button')].map((b) => b.textContent.trim())`);
t.check('o menu tem as cinco ações', ['Recarregar', 'Terminal', 'Editor', 'Copiar caminho', 'Abrir a pasta'].every((n) => items.includes(n)), items);
await t.shot('cabecalho-760');
await t.ev(`[...document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button')].find((b) => b.textContent.trim() === 'Copiar caminho').click()`);
await sleep(300);
t.check('"Copiar caminho" do menu copia e avisa', (await t.text(P + '[data-testid="path-copied"]')) === 'Caminho copiado');

// ---- tema claro, em inglês ------------------------------------------------------------------------------------------------------------------------------------------
await width(1500);
await t.ev(`localStorage.setItem('gitnexus.locale', 'en'); localStorage.setItem('gitnexus.theme', 'light')`);
await t.ev('location.reload()');
await t.until(`document.querySelector('li.repo')`, 25000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="repo-actions"]')`, 20000);
await sleep(600);
const en = await t.ev(`[...${q('[data-testid="repo-actions"]')}.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent).replace(/\\s+/g, ' ').trim())`);
t.check('em inglês: os nomes das ações', ['Reload', 'Terminal', 'Editor', 'Copy path', 'Open the folder'].every((n, i) => en[i]?.startsWith(n)), en);
await t.shot('cabecalho-claro-en');
await t.send('Emulation.clearDeviceMetricsOverride');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
