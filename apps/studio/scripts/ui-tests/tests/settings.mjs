// Diálogo de configurações (seção Aparência): abre por Ctrl+, pela paleta e pela engrenagem; é um GnDialog (aria-modal com nome, foco preso, #app inerte, Esc,
// clique no fundo, foco devolvido); as fontes e as ligaduras mudam o app e a pré-visualização na hora, ficam guardadas e "Restaurar padrões" volta ao início.
import { connect, lit, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);

const reload = async () => {
  await t.ev('location.reload()');
  await t.until(`document.querySelector('.core')`, 15000);
  await sleep(600);
};
const clearFonts = () => t.ev(`['gitnexus.fontUi', 'gitnexus.fontCode', 'gitnexus.ligatures'].forEach((k) => localStorage.removeItem(k))`);
const dlg = (expr) => t.ev(`(() => { const d = document.querySelector('[role="dialog"][aria-modal="true"]'); return d ? (${expr}) : null; })()`);
const isOpen = async () => !!(await t.ev(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`));
const attrs = () => t.ev(`(() => { const d = document.documentElement.dataset; return [d.fontUi, d.fontCode, d.ligatures].join('|'); })()`);
const css = (sel, prop) => t.ev(`getComputedStyle(document.querySelector(${lit(sel)})).${prop}`);
const fieldOf = (label) => `[...document.querySelectorAll('.sd__field')].find((f) => f.querySelector(':scope > span')?.textContent.trim() === ${lit(label)})`;
const pick = (label, option) => t.ev(`${fieldOf(label)}?.querySelector('.gn-seg') && [...${fieldOf(label)}.querySelectorAll('.gn-seg__opt')].find((b) => b.textContent.trim() === ${lit(option)})?.click()`);
const checked = (label, option) => t.ev(`[...${fieldOf(label)}.querySelectorAll('.gn-seg__opt')].find((b) => b.getAttribute('aria-checked') === 'true')?.textContent.trim()`);
const openGear = async () => {
  await t.ev(`(() => { const g = document.querySelector('[data-testid="settings-open"]'); g.focus(); g.click(); })()`);
  await t.until(`document.querySelector('[role="dialog"][aria-modal="true"]')`, 5000);
  await sleep(300);
};
const escape = async () => {
  await t.key('Escape');
  await sleep(300);
};

await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0')`);
await clearFonts();
await reload();

// 1. a engrenagem está na barra, com nome acessível e o atalho no tooltip
const gear = await t.ev(`(() => { const g = document.querySelector('[data-testid="settings-open"]'); const c = document.querySelector('.core__cmd').getBoundingClientRect(); const r = g.getBoundingClientRect(); return { label: g.getAttribute('aria-label'), title: g.title, after: r.left >= c.right - 1, inside: r.right <= window.innerWidth }; })()`);
t.check('a engrenagem tem o nome "Configurações" e o atalho no tooltip', gear.label === 'Configurações' && /Ctrl\+,/.test(gear.title), gear);
t.check('a engrenagem fica depois do botão Comandos e dentro da janela', gear.after && gear.inside, gear);

// 2. Ctrl+, abre; é um diálogo modal com nome acessível; foco dentro; o fundo fica inerte
await t.key(',', 2);
await t.until(`document.querySelector('[role="dialog"][aria-modal="true"]')`, 5000);
await sleep(300);
t.check('Ctrl+, abre o diálogo de configurações', await isOpen());
t.check('o diálogo tem nome acessível pelo título "Configurações"', (await dlg(`document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim()`)) === 'Configurações');
t.check('o foco foi para dentro do diálogo (primeiro controle: a fonte da interface)', await dlg(`d.contains(document.activeElement) && document.activeElement.classList.contains('gn-seg__opt')`));
t.check('o fundo (#app) está inerte', await t.ev(`document.getElementById('app').hasAttribute('inert')`));
t.check('mostra a seção Aparência, as duas fontes, as ligaduras e a pré-visualização', await dlg(`['Aparência', 'Fonte da interface', 'Fonte do código', 'Ligaduras de código', 'Pré-visualização'].every((x) => d.textContent.includes(x))`));

// 3. Ctrl+K com o diálogo aberto não abre a paleta (a paleta está dentro do #app, inerte)
await t.key('k', 2);
await sleep(300);
t.check('Ctrl+K com o diálogo aberto não abre a paleta', await t.ev(`!document.querySelector('.cp__input')`));

// 4. foco preso: Tab e Shift+Tab nunca saem do diálogo
let inside = true;
for (let i = 0; i < 9; i++) {
  await t.key('Tab');
  inside = inside && !!(await dlg(`d.contains(document.activeElement)`));
}
for (let i = 0; i < 9; i++) {
  await t.key('Tab', 8);
  inside = inside && !!(await dlg(`d.contains(document.activeElement)`));
}
t.check('Tab e Shift+Tab circulam só dentro do diálogo (18 teclas)', inside);

// 5. valores padrão e troca na hora
t.check('de início: JetBrains Mono nas duas fontes e ligaduras desligadas', (await attrs()) === 'jetbrains|jetbrains|off', await attrs());
t.check('os segmentos mostram JetBrains Mono marcado', (await checked('Fonte da interface')) === 'JetBrains Mono' && (await checked('Fonte do código')) === 'JetBrains Mono');
t.check('a pré-visualização do código usa JetBrains Mono, sem ligaduras', /JetBrains Mono/.test(await css('.sd__code', 'fontFamily')) && (await css('.sd__code', 'fontVariantLigatures')) === 'none');
await pick('Fonte da interface', 'Sistema');
await sleep(400);
t.check('"Sistema" na fonte da interface troca o app inteiro na hora', (await attrs()) === 'system|jetbrains|off' && /Segoe UI/.test(await css('body', 'fontFamily')), await attrs());
t.check('a pré-visualização da interface acompanha (Segoe UI)', /Segoe UI/.test(await css('.sd__ui', 'fontFamily')) && /JetBrains Mono/.test(await css('.sd__code', 'fontFamily')));
await pick('Fonte do código', 'Sistema');
await sleep(400);
t.check('"Sistema" na fonte do código muda a pré-visualização do código', (await attrs()) === 'system|system|off' && !/JetBrains/.test(await css('.sd__code', 'fontFamily')), await css('.sd__code', 'fontFamily'));
await t.ev(`document.querySelector('.sd__chk input').click()`);
await sleep(400);
t.check('ligar as ligaduras: corpo e pré-visualização em "normal"', (await attrs()).endsWith('|on') && (await css('body', 'fontVariantLigatures')) === 'normal' && (await css('.sd__code', 'fontVariantLigatures')) === 'normal');
t.check('a caixa de seleção fica marcada', await t.ev(`document.querySelector('.sd__chk input').checked`));
t.check('as escolhas ficam guardadas (só o que foge do padrão)', (await t.ev(`['gitnexus.fontUi', 'gitnexus.fontCode', 'gitnexus.ligatures'].map((k) => localStorage.getItem(k)).join('|')`)) === 'system|system|on');

// 6. reabrir depois de recarregar: guardado
await escape();
await reload();
t.check('depois de recarregar as escolhas continuam aplicadas', (await attrs()) === 'system|system|on', await attrs());
await openGear();
t.check('e o diálogo as mostra (Sistema, Sistema, ligaduras marcadas)', (await checked('Fonte da interface')) === 'Sistema' && (await checked('Fonte do código')) === 'Sistema' && !!(await t.ev(`document.querySelector('.sd__chk input').checked`)));

// 7. restaurar padrões
await t.ev(`[...document.querySelectorAll('.sd button')].find((b) => b.textContent.trim() === 'Restaurar padrões')?.click()`);
await sleep(400);
t.check('"Restaurar padrões" volta a JetBrains Mono, JetBrains Mono e ligaduras desligadas', (await attrs()) === 'jetbrains|jetbrains|off', await attrs());
t.check('e apaga o que estava guardado', (await t.ev(`['gitnexus.fontUi', 'gitnexus.fontCode', 'gitnexus.ligatures'].map((k) => localStorage.getItem(k)).join('|')`)) === '||');
t.check('o diálogo segue aberto e mostra os padrões', (await isOpen()) && (await checked('Fonte da interface')) === 'JetBrains Mono' && !(await t.ev(`document.querySelector('.sd__chk input').checked`)));

// 8. fechar: Esc devolve o foco à engrenagem; o fundo deixa de ser inerte
await escape();
t.check('Esc fecha o diálogo', !(await isOpen()));
t.check('o fundo deixa de ser inerte', await t.ev(`!document.getElementById('app').hasAttribute('inert')`));
t.check('o foco volta à engrenagem', await t.ev(`document.activeElement?.getAttribute('data-testid') === 'settings-open'`));

// 9. "Fechar" e clique no fundo (só vale com mousedown e mouseup no fundo)
await openGear();
await t.ev(`[...document.querySelectorAll('.sd button')].find((b) => b.textContent.trim() === 'Fechar')?.click()`);
await sleep(300);
t.check('o botão Fechar fecha o diálogo', !(await isOpen()));
await openGear();
await t.ev(`(() => { const o = document.querySelector('.gn-dlg'); const b = document.querySelector('.gn-dlg__box'); b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); o.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);
await sleep(300);
t.check('mousedown dentro da caixa e mouseup no fundo NÃO fecha (seleção de texto)', await isOpen());
await t.ev(`(() => { const o = document.querySelector('.gn-dlg'); o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); o.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);
await sleep(300);
t.check('clique no fundo (mousedown e mouseup nele) fecha', !(await isOpen()));

// 10. pela paleta de comandos
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 5000);
await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = 'configura'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
const found = await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].map((e) => e.textContent.trim())`);
t.check('a busca "configura" acha "Abrir as configurações" com o atalho Ctrl+,', found.some((x) => x.includes('Abrir as configurações') && /Ctrl\+,/.test(x)), found);
await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => e.textContent.includes('Abrir as configurações'))?.click()`);
await t.until(`document.querySelector('[role="dialog"][aria-modal="true"]')`, 5000);
t.check('o comando da paleta abre o diálogo', await isOpen());
await escape();

// 11. em inglês
await t.ev(`localStorage.setItem('gitnexus.locale', 'en')`);
await reload();
await t.key(',', 2);
await t.until(`document.querySelector('[role="dialog"][aria-modal="true"]')`, 5000);
await sleep(300);
t.check('em inglês: título "Settings" e os campos', (await dlg(`document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim()`)) === 'Settings' && (await dlg(`['Appearance', 'Interface font', 'Code font', 'Code ligatures', 'Preview', 'Restore defaults', 'Close'].every((x) => d.textContent.includes(x))`)));
await escape();

// 12. janela mínima 960x600: o diálogo cabe e a engrenagem não esconde nada da barra
await t.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false });
await reload();
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await reload();
const bar = await t.ev(`(() => { const top = document.querySelector('.core__top'); const g = document.querySelector('[data-testid="settings-open"]').getBoundingClientRect(); const kids = [...top.children].map((c) => c.getBoundingClientRect()); const over = kids.filter((r) => r !== null).some((r, i) => kids.some((q, j) => j > i && Math.min(r.right, q.right) - Math.max(r.left, q.left) > 2 && Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top) > 2)); return { right: g.right, w: window.innerWidth, over, scroll: document.documentElement.scrollWidth }; })()`);
t.check('960px: a engrenagem cabe na barra, sem sobreposição e sem rolagem horizontal da página', bar.right <= bar.w && !bar.over && bar.scroll <= bar.w, bar);
await t.key(',', 2);
await t.until(`document.querySelector('[role="dialog"][aria-modal="true"]')`, 5000);
await sleep(400);
const box = await dlg(`(() => { const r = d.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: window.innerWidth, h: window.innerHeight }; })()`);
t.check('960x600: o diálogo cabe inteiro na janela', box.l >= 0 && box.t >= 0 && box.r <= box.w && box.b <= box.h, box);
await t.shot('settings-960');
await escape();
await t.send('Emulation.clearDeviceMetricsOverride', {});

await clearFonts();
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
