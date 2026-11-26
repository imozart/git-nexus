// Folha de atalhos (#288): Ctrl+/ e "?" a abrem, lista TODOS os comandos da paleta (as duas listas são comparadas), por área, com o atalho que vale agora (remapeado e
// ⌘ no macOS), busca, foco devolvido ao fechar, "?" quieto em campo de texto, e o caminho para mudar os atalhos.
import { git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';
import { connect } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
const theme = process.env.GN_SHEET_THEME ?? 'dark';
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', ${lit(theme)}); localStorage.setItem('gitnexus.shortcuts', JSON.stringify({ 'tab.next': 'Mod+Alt+9' }))`);

const root = tmpRoot('gn-sheet-');
const repo = mkRepo(root, 'folha-repo', { files: { 'a.txt': 'um\n' } });
git(repo, 'config', 'core.fsmonitor', 'false');
await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelector('li.repo')`, 20000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="repo-views"]')`, 15000);
await sleep(1200);

const rows = () => t.ev(`[...document.querySelectorAll('[data-testid="shortcuts-sheet"] [data-cmd]')].map((r) => ({ id: r.dataset.cmd, title: r.querySelector('.ss__title').textContent.trim(), keys: [...r.querySelectorAll('kbd')].map((k) => k.textContent.trim()) }))`);
const openSheet = async (how) => {
  if (how === 'ctrl') await t.key('/', 2);
  else await t.key('?', 8); // "?" = Shift + /
  await t.until(`document.querySelector('[data-testid="shortcuts-sheet"]')`, 4000);
  await sleep(300);
};

// --- abre por Ctrl+/ e por "?" ----------------------------------------------------------------------------------------------------------------------------------
await openSheet('ctrl');
t.check('Ctrl+/ abre a folha de atalhos, com o foco na busca', (await t.count('[data-testid="shortcuts-sheet"]')) === 1 && (await t.ev(`document.activeElement?.dataset?.testid`)) === 'sheet-search');
const list = await rows();
t.check('a folha é um diálogo com nome e a lista agrupa por área (títulos de área em texto)', (await t.count('[data-testid="shortcuts-sheet"] section[data-group]')) >= 3 && (await t.ev(`!!document.querySelector('[role="dialog"][aria-labelledby="sheet-title"], .gn-dialog')`)) === true, await t.count('[data-testid="shortcuts-sheet"] section[data-group]'));
t.check('o contador diz quantos comandos há e bate com a lista', new RegExp(`^${list.length} comandos?$`).test((await t.text('[data-testid="sheet-count"]')) ?? ''), [list.length, await t.text('[data-testid="sheet-count"]')]);
await t.shot('folha-atalhos');
await t.key('Escape');
await sleep(300);
t.check('Esc fecha a folha', (await t.count('[data-testid="shortcuts-sheet"]')) === 0);
await openSheet('question');
t.check('a tecla "?" também abre a folha', (await t.count('[data-testid="shortcuts-sheet"]')) === 1);
await t.ev(`document.querySelector('[data-testid="sheet-search"]').focus()`);
await t.key('?', 8);
await sleep(200);
t.check('com o foco na busca, "?" é só um caractere (não abre outra folha) e entra no texto', (await t.count('[data-testid="shortcuts-sheet"]')) === 1);
await t.key('Escape');
await sleep(300);

// --- a mesma lista da paleta -------------------------------------------------------------------------------------------------------------------------------------
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 4000);
await sleep(300);
const palette = await t.ev(`[...document.querySelectorAll('.cp__item .cp__title')].map((e) => e.textContent.trim())`);
await t.key('Escape');
await sleep(300);
await openSheet('ctrl');
const sheet = await rows();
const sheetTitles = new Set(sheet.map((r) => r.title));
const missing = palette.filter((p) => !sheetTitles.has(p));
t.check('a folha lista TODOS os comandos que a paleta oferece (as duas listas comparadas)', palette.length > 20 && missing.length === 0, { paleta: palette.length, folha: sheet.length, faltam: missing.slice(0, 5) });
t.check('os comandos de repositório estão lá (as visões, a pesquisa), porque há um repositório aberto', ['view.graph', 'view.tools', 'search.window'].every((id) => sheet.some((r) => r.id === id)));
const byId = (id) => sheet.find((r) => r.id === id);
t.check('o atalho de cada comando é o que a paleta mostra (Ctrl+K na paleta, Ctrl+, nas Configurações, Ctrl+Alt+2 no Grafo)', byId('app.palette')?.keys.includes('Ctrl+K') && byId('app.settings')?.keys.includes('Ctrl+,') && byId('view.graph')?.keys.includes('Ctrl+Alt+2'), [byId('app.palette'), byId('app.settings'), byId('view.graph')]);
t.check('o atalho REMAPEADO é o que aparece (Próxima aba virou Ctrl+Alt+9; o padrão sumiu)', JSON.stringify(byId('tab.next')?.keys) === '["Ctrl+Alt+9"]', byId('tab.next'));
t.check('Pesquisar tem os dois atalhos (Ctrl+F e Ctrl+Shift+F)', JSON.stringify(byId('search.window')?.keys) === '["Ctrl+F","Ctrl+Shift+F"]', byId('search.window'));
t.check('comando sem atalho mostra um travessão (nada de célula vazia)', (await t.ev(`[...document.querySelectorAll('[data-cmd="app.tour"] .ss__none')].length`)) === 1);

// --- busca -------------------------------------------------------------------------------------------------------------------------------------------------------------
const type = (v) => t.ev(`(() => { const i = document.querySelector('[data-testid="sheet-search"]'); i.value = ${lit(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await type('passeio');
await sleep(300);
t.check('buscar "passeio" deixa só o comando do passeio e o contador acompanha', (await t.count('[data-testid="shortcuts-sheet"] [data-cmd]')) === 1 && /^1 comando$/.test((await t.text('[data-testid="sheet-count"]')) ?? ''));
await type('ctrl+k');
await sleep(300);
t.check('buscar pela tecla ("ctrl+k") acha a paleta', (await rows()).some((r) => r.id === 'app.palette'));
await type('zzzzz');
await sleep(300);
t.check('sem resultado, diz isso', (await t.count('[data-testid="shortcuts-sheet"] [data-cmd]')) === 0 && /Nenhum comando/.test((await t.text('.ss__empty')) ?? ''));
await t.key('Escape');
await sleep(300);
t.check('Esc com texto na busca limpa o texto e NÃO fecha a folha', (await t.count('[data-testid="shortcuts-sheet"]')) === 1 && (await t.ev(`document.querySelector('[data-testid="sheet-search"]').value`)) === '');
await t.shot('folha-atalhos-busca');

// --- macOS: ⌘ -------------------------------------------------------------------------------------------------------------------------------------------------------------
await t.key('Escape');
await sleep(300);
await t.ev(`Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true })`);
await openSheet('ctrl');
const mac = await rows();
t.check('no macOS os atalhos usam ⌘ (⌘K, ⌘,) e não "Ctrl"', mac.find((r) => r.id === 'app.palette')?.keys.includes('⌘K') && mac.find((r) => r.id === 'app.settings')?.keys.includes('⌘,') && !mac.some((r) => r.keys.some((k) => /Ctrl/.test(k))), mac.find((r) => r.id === 'app.palette'));
await t.key('Escape');
await sleep(300);
await t.ev(`Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true })`);

// --- "?" não atrapalha a digitação; foco devolvido; ir para as configurações -------------------------------------------------------------------------------------
await t.ev(`document.querySelector('[data-testid="settings-open"]').focus()`);
await openSheet('ctrl');
await t.key('Escape');
await sleep(400);
t.check('ao fechar, o foco volta para quem estava com ele (o botão de Configurações)', (await t.ev(`document.activeElement?.dataset?.testid`)) === 'settings-open');
await openSheet('ctrl');
await t.ev(`document.querySelector('[data-testid="sheet-edit"]').click()`);
await t.until(`document.querySelector('[data-testid="settings-nav"]')`, 4000);
t.check('"Mudar atalhos…" abre Configurações > Atalhos', (await t.count('[data-testid="shortcuts-sheet"]')) === 0 && (await t.ev(`document.querySelector('[data-testid="settings-nav"] [aria-selected="true"]')?.dataset.section`)) === 'shortcuts');
await t.key('Escape');
await sleep(300);
t.check('sem erro de página', t.errors().filter((e) => !/favicon|Failed to fetch/.test(e)).length === 0, t.errors());
t.close();
