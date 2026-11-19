// Diálogo de configurações (abas Geral e Aparência; idioma e tema em ComboBox): abre por Ctrl+, pela paleta e pela engrenagem; é um GnDialog (aria-modal com nome, foco preso, #app inerte, Esc,
// clique no fundo, foco devolvido); as fontes e as ligaduras mudam o app e a pré-visualização na hora, ficam guardadas e "Restaurar padrões" volta ao início.
// Idioma, atualização automática, busca automática e tema usam os MESMOS estados dos controles de antes: mudar no diálogo muda o controle de origem e vice-versa.
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

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
const goTab = async (name) => {
  await t.ev(`[...document.querySelectorAll('.sd [role="tab"]')].find((x) => x.textContent.trim() === ${lit(name)}).click()`);
  await sleep(250);
};
const tabState = () => t.ev(`(() => { const a = document.activeElement; const sel = document.querySelector('.sd [role="tab"][aria-selected="true"]'); return { selected: sel?.textContent.trim(), focused: a?.getAttribute('role') === 'tab' ? a.textContent.trim() : null }; })()`);
/** ComboBox do diálogo: abre a lista (no body), escolhe no mousedown (é onde o ComboBox confirma) e devolve como a lista se apresentou. */
const pickCombo = async (label, option) => {
  await t.ev(`${fieldOf(label)}.querySelector('.cbx__btn').click()`);
  await t.until(`document.querySelector('.cbx__list')`, 3000);
  const look = await t.ev(`(() => { const l = document.querySelector('.cbx__list'); const r = l.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + 12); return { radius: parseFloat(getComputedStyle(l).borderRadius), above: !!at && l.contains(at), items: [...l.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()) }; })()`);
  await t.ev(`[...document.querySelectorAll('.cbx__list [role="option"]')].find((o) => o.textContent.trim().startsWith(${lit(option)}))?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
  await sleep(300);
  return look;
};
const comboValue = (label) => t.ev(`${fieldOf(label)}.querySelector('.cbx__value').textContent.trim()`);
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
const gear = await t.ev(`(() => { const g = document.querySelector('[data-testid="settings-open"]'); const c = document.querySelector('.core__cmd').getBoundingClientRect(); const r = g.getBoundingClientRect(); return { label: g.getAttribute('aria-label'), title: g.title, after: r.left >= c.right - 1, inside: r.right <= window.innerWidth, h: Math.round(r.height) === Math.round(c.height), w: Math.round(r.width), top: Math.round(r.top) === Math.round(c.top), border: getComputedStyle(g).borderTopWidth, margin: window.innerWidth - r.right }; })()`);
t.check('a engrenagem tem o nome "Configurações" e o atalho no tooltip', gear.label === 'Configurações' && /Ctrl\+,/.test(gear.title), gear);
t.check('a engrenagem fica depois do botão Comandos e dentro da janela, com respiro até a borda', gear.after && gear.inside && gear.margin >= 8, gear);
t.check('a engrenagem tem a mesma altura e o mesmo alinhamento do botão Comandos, com borda (não fica esmagada)', gear.h && gear.top && gear.w >= 28 && gear.border === '1px', gear);

// 2. Ctrl+, abre; é um diálogo modal com nome acessível; foco dentro; o fundo fica inerte
await t.key(',', 2);
await t.until(`document.querySelector('[role="dialog"][aria-modal="true"]')`, 5000);
await sleep(300);
t.check('Ctrl+, abre o diálogo de configurações', await isOpen());
t.check('o diálogo tem nome acessível pelo título "Configurações"', (await dlg(`document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim()`)) === 'Configurações');
t.check('o foco foi para dentro do diálogo (a aba ativa, Geral)', (await dlg(`d.contains(document.activeElement)`)) && (await tabState()).focused === 'Geral', await tabState());
t.check('o fundo (#app) está inerte', await t.ev(`document.getElementById('app').hasAttribute('inert')`));
t.check('há duas abas (Geral e Aparência) e a Geral abre selecionada', (await t.ev(`[...document.querySelectorAll('.sd [role="tab"]')].map((x) => x.textContent.trim()).join('|')`)) === 'Geral|Aparência' && (await tabState()).selected === 'Geral');
t.check('aba Geral: idioma (ComboBox, não o select nativo), atualização e busca automáticas; nada de fonte aqui', await dlg(`['Idioma', 'Verificar atualizações automaticamente', 'Buscar automaticamente'].every((x) => d.textContent.includes(x)) && !!d.querySelector('.cbx') && !d.querySelector('select') && !d.textContent.includes('Fonte da interface')`));
await t.key('ArrowRight');
t.check('seta direita troca para a aba Aparência e leva o foco', JSON.stringify(await tabState()) === JSON.stringify({ selected: 'Aparência', focused: 'Aparência' }), await tabState());
await t.key('ArrowLeft');
t.check('seta esquerda volta para a Geral', (await tabState()).selected === 'Geral');
await t.key('End');
t.check('End vai para a última aba', (await tabState()).selected === 'Aparência');
t.check('aba Aparência: tema (ComboBox), as duas fontes, as ligaduras e a pré-visualização', await dlg(`['Tema', 'Fonte da interface', 'Fonte do código', 'Ligaduras de código', 'Pré-visualização'].every((x) => d.textContent.includes(x)) && !!d.querySelector('.cbx') && !d.textContent.includes('Verificar atualizações')`));
t.check('o botão Restaurar padrões só aparece na aba Aparência', await dlg(`[...d.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Restaurar padrões')`));

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
await t.ev(`document.querySelector('[data-testid="settings-ligatures"]').click()`);
await sleep(400);
t.check('ligar as ligaduras: corpo e pré-visualização em "normal"', (await attrs()).endsWith('|on') && (await css('body', 'fontVariantLigatures')) === 'normal' && (await css('.sd__code', 'fontVariantLigatures')) === 'normal');
t.check('a caixa de seleção fica marcada', await t.ev(`document.querySelector('[data-testid="settings-ligatures"]').checked`));
t.check('as escolhas ficam guardadas (só o que foge do padrão)', (await t.ev(`['gitnexus.fontUi', 'gitnexus.fontCode', 'gitnexus.ligatures'].map((k) => localStorage.getItem(k)).join('|')`)) === 'system|system|on');

// 6. reabrir depois de recarregar: guardado
await escape();
await reload();
t.check('depois de recarregar as escolhas continuam aplicadas', (await attrs()) === 'system|system|on', await attrs());
await openGear();
await goTab('Aparência');
t.check('e o diálogo as mostra (Sistema, Sistema, ligaduras marcadas)', (await checked('Fonte da interface')) === 'Sistema' && (await checked('Fonte do código')) === 'Sistema' && !!(await t.ev(`document.querySelector('[data-testid="settings-ligatures"]').checked`)));

// 7. restaurar padrões
await t.ev(`[...document.querySelectorAll('.sd button')].find((b) => b.textContent.trim() === 'Restaurar padrões')?.click()`);
await sleep(400);
t.check('"Restaurar padrões" volta a JetBrains Mono, JetBrains Mono e ligaduras desligadas', (await attrs()) === 'jetbrains|jetbrains|off', await attrs());
t.check('e apaga o que estava guardado', (await t.ev(`['gitnexus.fontUi', 'gitnexus.fontCode', 'gitnexus.ligatures'].map((k) => localStorage.getItem(k)).join('|')`)) === '||');
t.check('o diálogo segue aberto e mostra os padrões', (await isOpen()) && (await checked('Fonte da interface')) === 'JetBrains Mono' && !(await t.ev(`document.querySelector('[data-testid="settings-ligatures"]').checked`)));

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

// 10b. seção Geral e Tema: cada campo reflete o controle de origem e o altera na hora, nos dois sentidos
const root = tmpRoot('gn-settings-');
const repo = mkRepo(root, 'settingsrepo');
await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await reload();
const ls = (k) => t.ev(`localStorage.getItem(${lit(k)})`);
const chk = (id) => `document.querySelector('[data-testid="${id}"]')`;
const paletteRun = async (query, title) => {
  await t.key('k', 2);
  await t.until(`document.querySelector('.cp__input')`, 5000);
  await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = ${lit(query)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(300);
  const ok = await t.ev(`(() => { const e = [...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((x) => x.textContent.includes(${lit(title)})); e?.click(); return !!e; })()`);
  await sleep(300);
  return ok;
};

// idioma: dialogo -> barra
await openGear();
t.check('aba Geral: o idioma atual (Português) vem no ComboBox', (await comboValue('Idioma')) === 'Português (Brasil)');
const langList = await pickCombo('Idioma', 'English');
t.check('a lista do idioma tem cantos arredondados, fica acima do diálogo e traz Sistema e os dois idiomas pelo nome nativo', langList.radius >= 6 && langList.above && langList.items.length === 3 && langList.items.some((x) => x.startsWith('Sistema')) && langList.items.includes('English'), langList);
await sleep(300);
t.check('Idioma "English" no diálogo troca o app e o próprio diálogo, sem recarregar', (await dlg(`document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim()`)) === 'Settings' && (await ls('gitnexus.locale')) === 'en');
await escape();
t.check('o seletor de idioma da barra mostra EN', (await t.ev(`document.querySelector('.lang__code')?.textContent.trim()`)) === 'EN');
// idioma: paleta -> dialogo
t.check('o comando da paleta volta ao português', await paletteRun('language', 'Language: Português (Brasil)'));
await openGear();
t.check('o diálogo mostra o idioma escolhido na paleta (Português) e está em português', (await comboValue('Idioma')) === 'Português (Brasil)');

// "Sistema": segue o idioma do sistema e deixa de guardar o idioma (o padrão não guarda chave)
await pickCombo('Idioma', 'Sistema');
t.check('escolher "Sistema" apaga o idioma guardado (gitnexus.locale)', (await ls('gitnexus.locale')) === null);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await reload();
await openGear();
t.check('com o idioma guardado de novo, o combo volta a mostrar Português (Brasil)', (await comboValue('Idioma')) === 'Português (Brasil)');

// atualização automática: dialogo -> paleta e paleta -> dialogo
t.check('"Verificar atualizações automaticamente" começa marcada (padrão)', await t.ev(`${chk('settings-auto-update')}.checked`));
await t.ev(`${chk('settings-auto-update')}.click()`);
await sleep(300);
t.check('desmarcar guarda gitnexus.updateCheck=0', (await ls('gitnexus.updateCheck')) === '0');
await escape();
t.check('e o comando da paleta passa a oferecer "Ligar a verificação automática"', await paletteRun('verificacao automatica', 'Ligar a verificação automática'));
await openGear();
t.check('o comando da paleta (ligar) marca a caixa do diálogo de novo', await t.ev(`${chk('settings-auto-update')}.checked`) && (await ls('gitnexus.updateCheck')) === '1');

// busca automática: dialogo -> caixa do seletor de branch e de volta
t.check('"Buscar automaticamente" reflete o estado atual (desligada neste teste)', !(await t.ev(`${chk('settings-auto-fetch')}.checked`)));
await t.ev(`${chk('settings-auto-fetch')}.click()`);
await sleep(300);
t.check('marcar guarda gitnexus.autoFetch=1', (await ls('gitnexus.autoFetch')) === '1');
await escape();
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'settingsrepo')`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'settingsrepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.bp__btn')`, 20000);
await t.ev(`document.querySelector('.bp__btn').click()`);
await t.until(`document.querySelector('[data-testid="auto-fetch"]')`, 5000);
t.check('a caixa "Buscar automaticamente" do seletor de branch ficou marcada', await t.ev(`document.querySelector('[data-testid="auto-fetch"]').checked`));
await t.ev(`document.querySelector('[data-testid="auto-fetch"]').click()`);
await sleep(300);
await escape();
await openGear();
t.check('desmarcar na caixa do seletor de branch desmarca no diálogo', !(await t.ev(`${chk('settings-auto-fetch')}.checked`)) && (await ls('gitnexus.autoFetch')) === '0');

// tema: dialogo -> app e paleta -> dialogo
await goTab('Aparência');
t.check('Tema: o padrão é "Escuro" (o tema que o app sempre teve)', (await comboValue('Tema')) === 'Escuro');
// Esc com a lista aberta fecha só a lista; o diálogo continua
await t.ev(`${fieldOf('Tema')}.querySelector('.cbx__btn').focus(); ${fieldOf('Tema')}.querySelector('.cbx__btn').click()`);
await t.until(`document.querySelector('.cbx__list')`, 3000);
await escape();
t.check('Esc com o ComboBox aberto fecha a lista e NÃO o diálogo', (await t.ev(`!document.querySelector('.cbx__list')`)) && (await isOpen()));
const themeList = await pickCombo('Tema', 'Claro');
t.check('a lista do tema traz Sistema, Escuro e Claro, com cantos arredondados', themeList.items.join('|') === 'Sistema|Escuro|Claro' && themeList.radius >= 6 && themeList.above, themeList);
await sleep(400);
t.check('Tema "Claro" muda o app na hora (data-theme=light) e fica guardado', (await t.ev(`document.documentElement.dataset.theme`)) === 'light' && (await ls('gitnexus.theme')) === 'light');
await escape();
t.check('o comando da paleta oferece o tema Sistema e o aplica', await paletteRun('tema', 'Tema da interface: Sistema'));
await sleep(300);
await openGear();
await goTab('Aparência');
t.check('o diálogo mostra "Sistema" (escolhido na paleta)', (await comboValue('Tema')) === 'Sistema');
await pickCombo('Tema', 'Escuro');
await escape();
await t.ev(`localStorage.removeItem('gitnexus.theme'); localStorage.removeItem('gitnexus.updateCheck')`);

// 11. em inglês
await t.ev(`localStorage.setItem('gitnexus.locale', 'en')`);
await reload();
await t.key(',', 2);
await t.until(`document.querySelector('[role="dialog"][aria-modal="true"]')`, 5000);
await sleep(300);
t.check('em inglês: título "Settings", abas e a aba Geral', (await dlg(`document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim()`)) === 'Settings' && (await t.ev(`[...document.querySelectorAll('.sd [role="tab"]')].map((x) => x.textContent.trim()).join('|')`)) === 'General|Appearance' && (await dlg(`['Language', 'Check for updates automatically', 'Fetch automatically', 'Close'].every((x) => d.textContent.includes(x))`)));
await goTab('Appearance');
t.check('em inglês: aba Appearance com os campos', await dlg(`['Theme', 'Interface font', 'Code font', 'Code ligatures', 'Preview', 'Restore defaults'].every((x) => d.textContent.includes(x))`));
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
await goTab('Aparência');
const box2 = await dlg(`(() => { const r = d.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: window.innerWidth, h: window.innerHeight }; })()`);
t.check('960x600: o diálogo também cabe na aba Aparência (a maior)', box2.l >= 0 && box2.t >= 0 && box2.r <= box2.w && box2.b <= box2.h, box2);
await t.shot('settings-960-aparencia');
await escape();
await t.send('Emulation.clearDeviceMetricsOverride', {});

await clearFonts();
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
