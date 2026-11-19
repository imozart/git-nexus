// GnDialog nos diálogos migrados (aqui, o de Novidades, aberto pelo botão da tela inicial): papel e nome acessível, fundo (#app) inerte, foco preso
// (Tab e Shift+Tab), Esc, clique no fundo (mousedown E mouseup no fundo), foco devolvido a quem abriu, sombra e fundo pelos tokens, e Ctrl+K quieto.
import { connect, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev('location.reload()');
await t.until(`document.querySelector('.conn__actions')`, 20000);
await sleep(1500);
// navegador headless: sem foco de janela o focus() não vira :focus nem activeElement; a emulação de foco do CDP resolve
await t.send('Emulation.setFocusEmulationEnabled', { enabled: true });

const btn = `[...document.querySelectorAll('.conn__actions button')].find((b) => b.textContent.trim() === 'Novidades')`;
const box = `document.querySelector('[role="dialog"][aria-modal="true"]')`;
const open = async () => {
  await t.ev(`(${btn}).focus(); (${btn}).click()`);
  await t.until(`${box} && document.querySelectorAll('.ver').length > 0`, 15000);
  await sleep(300);
};
const inert = () => t.ev(`document.getElementById('app').hasAttribute('inert')`);
const inside = () => t.ev(`${box}.contains(document.activeElement)`);

await open();
t.check('o diálogo é um [role=dialog][aria-modal] e o aria-labelledby aponta para um título com texto', await t.ev(`(() => { const b = ${box}; const id = b.getAttribute('aria-labelledby'); const el = id && document.getElementById(id); return !!el && el.textContent.trim().length > 0; })()`));
t.check('com o diálogo aberto, #app está inerte', (await inert()) === true);
t.check('o foco inicial está dentro da caixa', await inside());

let kept = true;
for (let i = 0; i < 12; i++) { await t.key('Tab'); kept = kept && (await inside()); }
for (let i = 0; i < 12; i++) { await t.key('Tab', 8); kept = kept && (await inside()); } // 8 = Shift
t.check('Tab e Shift+Tab não saem do diálogo', kept);

// os tokens resolvidos num elemento de teste, como o navegador os calcula
const tok = await t.ev(`(() => { const p = document.createElement('span'); document.body.appendChild(p); p.style.boxShadow = 'var(--gn-shadow-lg)'; p.style.backgroundColor = 'var(--gn-backdrop)'; p.style.borderRadius = 'var(--gn-radius-lg)'; const c = getComputedStyle(p); const r = { shadow: c.boxShadow, backdrop: c.backgroundColor, radius: c.borderTopLeftRadius }; p.remove(); return r; })()`);
const real = await t.ev(`(() => { const b = ${box}; const f = b.parentElement; return { shadow: getComputedStyle(b).boxShadow, backdrop: getComputedStyle(f).backgroundColor, radius: getComputedStyle(b).borderTopLeftRadius }; })()`);
t.check('a sombra, o fundo do overlay e o raio da caixa são os dos tokens (--gn-shadow-lg, --gn-backdrop, --gn-radius-lg)', real.shadow === tok.shadow && real.backdrop === tok.backdrop && real.radius === tok.radius, { real, tok });

await t.key('k', 2);
await sleep(400);
t.check('Ctrl+K com o diálogo aberto não abre a paleta', (await t.count('.cp__input')) === 0);

await t.key('Escape');
await sleep(300);
t.check('Esc fecha o diálogo', (await t.count('[role="dialog"]')) === 0);
t.check('ao fechar, #app deixa de estar inerte', (await inert()) === false);
t.check('o foco volta ao botão "Novidades" que abriu', await t.ev(`document.activeElement === (${btn})`));

// clique no fundo: fecha só quando mousedown E mouseup foram no fundo
await open();
await t.ev(`(() => { const b = ${box}; const f = b.parentElement; b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); f.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);
await sleep(300);
t.check('mousedown dentro da caixa e mouseup no fundo não fecha (selecionar texto e soltar fora)', (await t.count('[role="dialog"]')) === 1);
await t.ev(`(() => { const f = ${box}.parentElement; for (const type of ['mousedown', 'mouseup']) f.dispatchEvent(new MouseEvent(type, { bubbles: true })); })()`);
await sleep(300);
t.check('clique no fundo (mousedown e mouseup nele) fecha', (await t.count('[role="dialog"]')) === 0);
t.check('e #app volta a responder', (await inert()) === false);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
