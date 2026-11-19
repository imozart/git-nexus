// GnTooltip (dica estilizada, filho do elemento descrito): abre com o mouse após 500 ms e com o teclado na hora; fecha ao sair, clicar, rolar, girar a roda
// e com Esc; uma de cada vez; sem atraso logo depois de fechar uma; o pai mantém data-tooltip (e não tem title nativo) e ganha aria-describedby só
// quando o texto difere do aria-label. Sombra pelo token; legível nos dois temas. O layout do botão não ganha nenhum elemento filho.
import { connect, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.removeItem('gitnexus.theme')`);
await t.ev('location.reload()');
await t.until(`document.querySelector('[data-testid="settings-open"]')`, 20000);
await sleep(800);
// navegador headless: sem foco de janela o focus() não vira :focus-visible; a emulação de foco do CDP resolve
await t.send('Emulation.setFocusEmulationEnabled', { enabled: true });

const GEAR = `document.querySelector('[data-testid="settings-open"]')`;
const tips = () => t.count('.gn-tooltip');
const tipText = () => t.ev(`document.querySelector('.gn-tooltip')?.textContent ?? null`);
const enter = (el = GEAR) => t.ev(`${el}.dispatchEvent(new MouseEvent('mouseenter'))`);
const leave = (el = GEAR) => t.ev(`${el}.dispatchEvent(new MouseEvent('mouseleave'))`);
const sm = await t.ev(`(() => { const p = document.createElement('span'); document.body.appendChild(p); p.style.boxShadow = 'var(--gn-shadow-sm)'; p.style.borderRadius = 'var(--gn-radius-sm)'; const c = getComputedStyle(p); const r = { shadow: c.boxShadow, radius: c.borderTopLeftRadius }; p.remove(); return r; })()`);

// o elemento: sem title nativo, com data-tooltip, e o GnTooltip não cria nenhum filho que ocupe espaço
const el = await t.ev(`(() => { const g = ${GEAR}; return { title: g.hasAttribute('title'), tip: g.dataset.tooltip, label: g.getAttribute('aria-label'), elementChildren: g.children.length, tag: g.tagName }; })()`);
t.check('o botão de ícone não tem title nativo e tem data-tooltip com o texto da dica (rótulo + atalho)', el.title === false && /^Configurações \(.+\)$/.test(el.tip), el);
t.check('o GnTooltip não cria elemento filho no botão (só o ícone)', el.elementChildren === 1 && el.tag === 'BUTTON', el);
t.check('com a dica fechada, não há .gn-tooltip no documento', (await tips()) === 0);

// 1. mouse: só depois do atraso
await enter();
await sleep(200);
t.check('com o mouse, a dica ainda não abriu antes do atraso (500 ms)', (await tips()) === 0);
await sleep(600);
t.check('depois de 500 ms a dica aparece com o texto esperado', (await tipText()) === el.tip, await tipText());
const look = await t.ev(`(() => { const d = document.querySelector('.gn-tooltip'); const c = getComputedStyle(d); const r = d.getBoundingClientRect(); const g = ${GEAR}.getAttribute('aria-describedby'); return { role: d.getAttribute('role'), pe: c.pointerEvents, shadow: c.boxShadow, radius: c.borderTopLeftRadius, z: c.zIndex, inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, id: d.id, describedby: g, pos: c.position }; })()`);
t.check('a dica é role=tooltip, não captura o mouse e usa a sombra e o raio dos tokens', look.role === 'tooltip' && look.pe === 'none' && look.shadow === sm.shadow && look.radius === sm.radius && look.pos === 'fixed', { look, sm });
t.check('fica dentro da janela e acima de diálogos e menus (--gn-z-tooltip)', look.inView === true && Number(look.z) >= 2100, look);
t.check('o texto difere do aria-label, então o botão ganha aria-describedby apontando para a dica', !!look.describedby && look.describedby === look.id, look);

// 2. sair fecha e devolve o botão ao que era
await leave();
await sleep(150);
t.check('mouseleave fecha a dica e tira o aria-describedby', (await tips()) === 0 && (await t.ev(`${GEAR}.hasAttribute('aria-describedby')`)) === false);
t.check('o data-tooltip continua mesmo com a dica fechada', (await t.ev(`${GEAR}.dataset.tooltip`)) === el.tip);

// 3. janela quente: logo depois de fechar uma, a próxima abre sem atraso
await enter();
await sleep(120);
t.check('logo depois de fechar uma dica, a próxima abre sem atraso (janela de 300 ms)', (await tips()) === 1, await tips());
await leave();
await sleep(150);

// 4. depois da janela quente o atraso volta
await sleep(450);
await enter();
await sleep(150);
t.check('passada a janela quente, o atraso de 500 ms volta', (await tips()) === 0, await tips());
await leave();
await sleep(100);

// 5. teclado: abre na hora; perder o foco fecha; Esc fecha
await t.ev(`${GEAR}.focus()`);
await sleep(150);
t.check('foco por teclado (:focus-visible) abre a dica na hora', (await tips()) === 1, await tips());
await t.ev(`${GEAR}.blur()`);
await sleep(150);
t.check('perder o foco fecha a dica', (await tips()) === 0);
await t.ev(`${GEAR}.focus()`);
await sleep(150);
await t.key('Escape');
await sleep(150);
t.check('Esc fecha a dica', (await tips()) === 0);
await t.ev(`${GEAR}.blur()`);

// 6. clique, rolagem e roda fecham
for (const [name, fire] of [
  ['mousedown no botão', `${GEAR}.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`],
  ['rolagem', `window.dispatchEvent(new Event('scroll'))`],
  ['roda do mouse', `window.dispatchEvent(new WheelEvent('wheel'))`],
]) {
  await sleep(450); // fora da janela quente, para a abertura voltar ao atraso normal
  await enter();
  await sleep(650);
  const was = await tips();
  await t.ev(fire);
  await sleep(150);
  t.check(`${name} fecha a dica aberta`, was === 1 && (await tips()) === 0, { was, now: await tips() });
  await leave();
}

// 7. uma de cada vez (se houver dois botões de ícone na tela)
const icons = await t.ev(`[...document.querySelectorAll('.gn-icon-btn')].filter((b) => b.dataset.tooltip).length`);
if (icons >= 2) {
  await sleep(450);
  await t.ev(`(() => { const [a, b] = [...document.querySelectorAll('.gn-icon-btn')].filter((x) => x.dataset.tooltip); window.__a = a; window.__b = b; a.dispatchEvent(new MouseEvent('mouseenter')); })()`);
  await sleep(650);
  await t.ev(`window.__b.dispatchEvent(new MouseEvent('mouseenter'))`);
  await sleep(650);
  t.check('só uma dica fica visível por vez (abrir uma fecha a outra)', (await tips()) === 1, await tips());
  await t.ev(`window.__a.dispatchEvent(new MouseEvent('mouseleave')); window.__b.dispatchEvent(new MouseEvent('mouseleave'))`);
} else {
  console.log(`(só ${icons} botão de ícone com dica na tela inicial: a verificação de uma dica por vez fica para os testes unitários)`);
}

// 8. legível nos dois temas: a cor do texto e o fundo são os tokens
for (const theme of ['dark', 'light']) {
  await t.ev(`document.documentElement.dataset.theme = ${theme === 'dark' ? "'dark'" : "'light'"}`);
  await sleep(200);
  await leave();
  await sleep(450);
  await enter();
  await sleep(650);
  const c = await t.ev(`(() => { const d = document.querySelector('.gn-tooltip'); if (!d) return null; const p = document.createElement('span'); document.body.appendChild(p); p.style.color = 'var(--gn-text)'; p.style.backgroundColor = 'var(--gn-surface-2)'; const e = { color: getComputedStyle(p).color, bg: getComputedStyle(p).backgroundColor }; p.remove(); const s = getComputedStyle(d); return { ok: s.color === e.color && s.backgroundColor === e.bg, got: { color: s.color, bg: s.backgroundColor }, want: e }; })()`);
  t.check(`[${theme}] a dica usa --gn-text sobre --gn-surface-2`, !!c && c.ok === true, c);
  await leave();
}

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
