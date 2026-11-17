// Tema da interface: escuro por padrão, claro pela escolha, "Sistema" acompanhando o sistema ao vivo, seletor ao lado do idioma, comandos na
// paleta e a escolha lembrada entre as aberturas. Confere as cores de verdade (estilo calculado) e tira capturas do tema claro.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.removeItem('gitnexus.theme')`);

const reload = async () => {
  await t.ev('location.reload()');
  await t.until(`document.querySelector('.core')`, 15000);
  await sleep(600);
};
const bodyBg = () => t.ev(`getComputedStyle(document.body).backgroundColor`);
const dataTheme = () => t.ev(`document.documentElement.dataset.theme`);
const media = (scheme) => t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });

// 1. padrão: escuro, como sempre foi
await reload();
t.check('sem escolha guardada, o tema é o escuro', (await dataTheme()) === 'dark', await dataTheme());
t.check('fundo escuro (#17181b)', (await bodyBg()) === 'rgb(23, 24, 27)', await bodyBg());
t.check('o seletor de tema existe ao lado do de idioma', (await t.count('[data-testid="theme-picker"]')) === 1);
await t.shot('theme-escuro');

// 2. escolher "Claro" no seletor
const openList = () => t.ev(`(() => { const b = document.querySelector('[data-testid="theme-picker"] .cbx__btn') ?? document.querySelector('.theme .cbx__btn'); b.focus(); b.click(); })()`);
await openList();
await sleep(400);
const labels = await t.ev(`[...document.querySelectorAll('.cbx__opt')].map((e) => e.textContent.trim())`);
t.check('a lista tem Sistema, Escuro e Claro', JSON.stringify(labels) === JSON.stringify(['Sistema', 'Escuro', 'Claro']), labels);
// o ComboBox escolhe a opção no mousedown
await t.ev(`[...document.querySelectorAll('.cbx__opt')].find((e) => e.textContent.trim() === 'Claro').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
await sleep(500);
t.check('escolher Claro aplica data-theme=light na hora', (await dataTheme()) === 'light', await dataTheme());
t.check('fundo claro (#f4f5f7)', (await bodyBg()) === 'rgb(244, 245, 247)', await bodyBg());
t.check('o texto escurece (#1f2328)', (await t.ev(`getComputedStyle(document.body).color`)) === 'rgb(31, 35, 40)');
t.check('os campos e barras nativas passam para o esquema claro', (await t.ev(`getComputedStyle(document.documentElement).colorScheme`)) === 'light');
t.check('a escolha fica guardada', (await t.ev(`localStorage.getItem('gitnexus.theme')`)) === 'light');
t.check('o botão do seletor mostra Claro', ((await t.text('[data-testid="theme-picker"] .cbx__btn')) ?? '').includes('Claro'));
await t.shot('theme-claro-inicio');

// 3. lembrada entre as aberturas
await reload();
t.check('depois de recarregar continua claro', (await dataTheme()) === 'light' && (await bodyBg()) === 'rgb(244, 245, 247)');

// 4. paleta: comandos para os outros temas (não o atual)
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 5000);
await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = 'tema'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
const cmds = await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].map((e) => e.textContent.trim())`);
t.check('a paleta oferece Sistema e Escuro (e não o tema atual)', cmds.some((x) => x.includes('Tema da interface: Escuro')) && cmds.some((x) => x.includes('Tema da interface: Sistema')) && !cmds.some((x) => x.includes('Tema da interface: Claro')), cmds);
await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => e.textContent.includes('Tema da interface: Escuro'))?.click()`);
await sleep(500);
t.check('o comando troca para o escuro', (await dataTheme()) === 'dark' && (await bodyBg()) === 'rgb(23, 24, 27)');

// 5. "Sistema" acompanha o sistema ao vivo
await t.ev(`localStorage.setItem('gitnexus.theme', 'system')`);
await media('light');
await reload();
t.check('Sistema com o sistema claro: claro', (await dataTheme()) === 'light', await dataTheme());
await media('dark');
await sleep(500);
t.check('o sistema muda para escuro: a interface acompanha sem recarregar', (await dataTheme()) === 'dark' && (await bodyBg()) === 'rgb(23, 24, 27)', await dataTheme());
await media('light');
await sleep(500);
t.check('e de volta para claro', (await dataTheme()) === 'light');

// 6. um repositório aberto no claro: capturas e cores que dependiam de valor fixo
const root = tmpRoot('gn-theme-');
const repo = mkRepo(root, 'themerepo', { files: { 'a.txt': 'um\ndois\ntres\n' } });
writeFileSync(join(repo, 'a.txt'), 'um\nDOIS\ntres\nquatro\n');
writeFileSync(join(repo, 'novo.txt'), 'arquivo novo\n');
await t.ev(`localStorage.setItem('gitnexus.theme', 'light')`);
await t.ev(`window.gitNexus.addRepositoryPath(${JSON.stringify(repo)})`);
await reload();
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.shot('theme-claro-lista');
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'themerepo')`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'themerepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await t.until(`document.querySelector('.changes, .tree, [data-testid="changes"]') || document.querySelector('.rv')`, 15000);
await sleep(1500);
// abre o diff do arquivo alterado
await t.ev(`[...document.querySelectorAll('.row, .file, li')].find((e) => e.textContent.includes('a.txt'))?.click()`);
await sleep(1500);
await t.shot('theme-claro-repositorio');
const lowContrast = await t.ev(`(() => {
  // o estilo calculado pode vir como color(srgb ...) (color-mix): o canvas converte qualquer cor em pixel RGBA
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); return [...cx.getImageData(0, 0, 1, 1).data]; };
  const parse = (c) => rgba(c).slice(0, 3);
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (rgba(c)[3] > 250) return parse(c); } return parse(getComputedStyle(document.body).backgroundColor); };
  const bad = [];
  for (const el of document.querySelectorAll('button, .repo strong, .rv__btns *, label, small, span')) {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest('svg') || getComputedStyle(el).visibility === 'hidden') continue;
    const fg = parse(getComputedStyle(el).color), bg = bgOf(el);
    if (fg.length === 3 && ratio(fg, bg) < 3) bad.push((el.className || el.tagName) + ' ' + el.textContent.trim().slice(0, 20) + ' ' + ratio(fg, bg).toFixed(2));
  }
  return bad.slice(0, 15);
})()`);
t.check('no tema claro nenhum texto visível fica abaixo de 3:1 de contraste', Array.isArray(lowContrast) && lowContrast.length === 0, lowContrast);

await t.ev(`localStorage.removeItem('gitnexus.theme')`);
await t.send('Emulation.setEmulatedMedia', { features: [] });
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();

