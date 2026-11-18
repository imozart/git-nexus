// Preferências de fonte: guardadas no localStorage, aplicadas ao abrir (atributos data-font-* do <html>), valores inválidos caem no padrão, mudança pela
// paleta de comandos vale na hora e fica guardada, e o comando das ligaduras alterna.
import { connect, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const reload = async () => {
  await t.ev('location.reload()');
  await t.until(`document.querySelector('.core')`, 15000);
  await sleep(600);
};
const attrs = () => t.ev(`(() => { const d = document.documentElement.dataset; return [d.fontUi, d.fontCode, d.ligatures].join('|'); })()`);
const stored = () => t.ev(`['gitnexus.fontUi', 'gitnexus.fontCode', 'gitnexus.ligatures'].map((k) => localStorage.getItem(k)).join('|')`);
const bodyFont = () => t.ev(`getComputedStyle(document.body).fontFamily`);
const bodyLig = () => t.ev(`getComputedStyle(document.body).fontVariantLigatures`);
const setAll = (ui, code, lig) => t.ev(`(() => { const s = localStorage; for (const [k, v] of [['gitnexus.fontUi', ${ui}], ['gitnexus.fontCode', ${code}], ['gitnexus.ligatures', ${lig}]]) v === null ? s.removeItem(k) : s.setItem(k, v); })()`);
const q = (s) => `'${s}'`;

// 1. nada guardado: os padrões
await setAll('null', 'null', 'null');
await reload();
t.check('sem nada guardado: JetBrains Mono em tudo e ligaduras desligadas', (await attrs()) === 'jetbrains|jetbrains|off', await attrs());
t.check('o corpo está em JetBrains Mono, sem ligaduras', /JetBrains Mono/.test(await bodyFont()) && (await bodyLig()) === 'none');

// 2. guardados: aplicados ao abrir
await setAll(q('system'), q('system'), q('on'));
await reload();
t.check('guardado system/system/on: os atributos vêm aplicados na abertura', (await attrs()) === 'system|system|on', await attrs());
t.check('o corpo voltou a Segoe UI 13px e as ligaduras estão ligadas', /Segoe UI/.test(await bodyFont()) && (await t.ev(`getComputedStyle(document.body).fontSize`)) === '13px' && (await bodyLig()) === 'normal');

// 3. valores inválidos caem no padrão, sem erro, e a chave inválida some
for (const bad of ["'comic'", "'1'", "''"]) {
  await setAll(bad, bad, bad);
  await reload();
  t.check(`valor guardado inválido (${bad}) cai nos padrões`, (await attrs()) === 'jetbrains|jetbrains|off', await attrs());
  t.check(`valor inválido (${bad}) é limpo do localStorage`, (await stored()) === '||', await stored());
}

// 4. pela paleta: busca "fonte", mostra só o que difere do atual, executa e vale na hora
const openPalette = async (text) => {
  await t.key('k', 2);
  await t.until(`document.querySelector('.cp__input')`, 5000);
  await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = ${text}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(300);
  return t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].map((e) => e.textContent.trim())`);
};
const run = (title) => t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => e.textContent.includes(${title}))?.click()`);

await setAll('null', 'null', 'null');
await reload();
let list = await openPalette(q('fonte'));
t.check('a busca "fonte" acha os comandos de fonte da interface e do código (só "Sistema", o atual é JetBrains Mono)',
  list.some((x) => x.includes('Fonte da interface: Sistema')) && list.some((x) => x.includes('Fonte do código: Sistema')) && !list.some((x) => x.includes('Fonte da interface: JetBrains Mono')), list);
t.check('a busca "fonte" também acha o comando das ligaduras', list.some((x) => x.includes('Ligaduras de código: ligar')), list);
await run(q('Fonte da interface: Sistema'));
await sleep(500);
t.check('o comando troca a fonte da interface na hora (sem recarregar)', (await attrs()) === 'system|jetbrains|off' && /Segoe UI/.test(await bodyFont()), await attrs());
t.check('e a escolha fica guardada (só o que foge do padrão)', (await stored()) === 'system||', await stored());
list = await openPalette(q('fonte'));
t.check('agora a paleta oferece voltar para JetBrains Mono', list.some((x) => x.includes('Fonte da interface: JetBrains Mono')) && !list.some((x) => x.includes('Fonte da interface: Sistema')), list);
await run(q('Fonte do código: Sistema'));
await sleep(500);
t.check('o comando troca a fonte do código na hora', (await attrs()) === 'system|system|off', await attrs());
await reload();
t.check('depois de recarregar as duas escolhas continuam', (await attrs()) === 'system|system|off', await attrs());

// 5. ligaduras alternam
list = await openPalette(q('ligaduras'));
t.check('a busca "ligaduras" acha o comando', list.some((x) => x.includes('Ligaduras de código: ligar')), list);
await run(q('Ligaduras de código: ligar'));
await sleep(500);
t.check('ligar: o corpo passa a ligaduras normais', (await attrs()).endsWith('|on') && (await bodyLig()) === 'normal', await bodyLig());
list = await openPalette(q('ligaduras'));
t.check('o título do comando muda para "desligar"', list.some((x) => x.includes('Ligaduras de código: desligar')) && !list.some((x) => x.includes('Ligaduras de código: ligar')), list);
await run(q('Ligaduras de código: desligar'));
await sleep(500);
t.check('desligar: voltam a none', (await attrs()).endsWith('|off') && (await bodyLig()) === 'none', await bodyLig());

// 6. nos dois idiomas
await t.ev(`localStorage.setItem('gitnexus.locale', 'en')`);
await reload();
list = await openPalette(q('font'));
t.check('em inglês: "Interface font: JetBrains Mono" e "Code font: JetBrains Mono" (o atual do código é Sistema, o da interface também)',
  list.some((x) => x.includes('Interface font: JetBrains Mono')) && list.some((x) => x.includes('Code font: JetBrains Mono')), list);
await t.key('Escape'); // fecha a paleta (Ctrl+K de novo a fecharia em vez de abrir)
await sleep(300);
list = await openPalette(q('ligatures'));
t.check('em inglês: "Code ligatures: turn on"', list.some((x) => x.includes('Code ligatures: turn on')), list);
await t.key('Escape');

// 7. "limpa": reset pelo módulo apaga as chaves e volta aos padrões
await setAll(q('system'), q('system'), q('on'));
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await reload();
await t.ev(`['gitnexus.fontUi', 'gitnexus.fontCode', 'gitnexus.ligatures'].forEach((k) => localStorage.removeItem(k))`);
await reload();
t.check('sem as chaves, de volta aos padrões', (await attrs()) === 'jetbrains|jetbrains|off', await attrs());

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
