// Paleta de comandos (Ctrl+K): fundo do overlay, sombra e raio da caixa pelos tokens (--gn-backdrop, --gn-shadow-lg, --gn-radius-lg), camada de paleta e
// entrada animada; a largura, o fundo da caixa e a linha ativa não mudam. Os valores esperados são os dos tokens, resolvidos num elemento de teste.
import { connect, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.until(`document.querySelector('.core')`, 20000);
await sleep(600);

const tok = await t.ev(`(() => { const p = document.createElement('span'); document.body.appendChild(p); p.style.boxShadow = 'var(--gn-shadow-lg)'; p.style.backgroundColor = 'var(--gn-backdrop)'; p.style.borderRadius = 'var(--gn-radius-lg)'; const c = getComputedStyle(p); const r = { shadow: c.boxShadow, backdrop: c.backgroundColor, radius: c.borderTopLeftRadius, z: Number(getComputedStyle(document.documentElement).getPropertyValue('--gn-z-palette')) }; p.remove(); return r; })()`);
t.check('os tokens existem (sombra grande, fundo do overlay, raio 10 px, camada de paleta 2000)', tok.shadow !== 'none' && tok.backdrop !== 'rgba(0, 0, 0, 0)' && tok.radius === '10px' && tok.z === 2000, tok);

await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 8000);
await sleep(300);
const box = await t.ev(`(() => { const b = document.querySelector('.cp__box'); const o = b.parentElement; const cb = getComputedStyle(b), co = getComputedStyle(o); return { shadow: cb.boxShadow, radius: cb.borderTopLeftRadius, anim: cb.animationName, bg: cb.backgroundColor, width: Math.round(b.getBoundingClientRect().width), backdrop: co.backgroundColor, z: co.zIndex, oanim: co.animationName }; })()`);
t.check('a sombra e o raio da caixa são os dos tokens (--gn-shadow-lg, --gn-radius-lg) e ela entra com gn-pop-in', box.shadow === tok.shadow && box.radius === tok.radius && box.anim === 'gn-pop-in', { box, tok });
t.check('o fundo do overlay é o --gn-backdrop, entra em fade e fica na camada de paleta', box.backdrop === tok.backdrop && box.oanim === 'gn-fade-in' && Number(box.z) === tok.z, { box, tok });
t.check('o que não muda: largura da caixa (640 px na janela do teste, no máximo) e fundo --gn-surface', box.width <= 640 && box.bg === (await t.ev(`(() => { const p = document.createElement('span'); document.body.appendChild(p); p.style.backgroundColor = 'var(--gn-surface)'; const c = getComputedStyle(p).backgroundColor; p.remove(); return c; })()`)), box);
t.check('a linha ativa segue com o destaque azul de antes (cor, não mexer)', await t.ev(`(() => { const on = document.querySelector('.cp__item--on'); return !!on && getComputedStyle(on).backgroundColor === 'rgba(79, 134, 247, 0.22)'; })()`));

await t.key('Escape');
await sleep(300);
t.check('Esc fecha a paleta', (await t.count('.cp__input')) === 0);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
