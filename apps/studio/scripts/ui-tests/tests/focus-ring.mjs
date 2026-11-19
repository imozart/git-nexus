// Foco dos campos de texto: borda de destaque + anel (--gn-ring) ao focar, nada ao sair, nos temas escuro e claro; o campo da paleta de comandos não
// recebe o anel (largura total, sem caixa); botões seguem com o outline de 2px. Os valores esperados são os dos tokens, resolvidos num elemento de teste.
import { connect, lit, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.until(`document.querySelector('.core')`, 15000);
// navegador headless: sem foco de janela o focus() não vira :focus; a emulação de foco do CDP resolve
await t.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await sleep(500);

// um campo comum (a regra é global: input, textarea, select) e um botão, fora do fluxo dos fixos
await t.ev(`(() => {
  const box = document.createElement('div'); box.id = 'gn-probe'; box.style.cssText = 'position:fixed;top:60px;left:60px;z-index:5000';
  box.innerHTML = '<input id="p-in"><textarea id="p-ta"></textarea><select id="p-se"><option>a</option></select><button id="p-bt" class="gn-btn">b</button>';
  document.body.appendChild(box);
})()`);
// token resolvido (cor e sombra) como o navegador as calcula
const resolved = () => t.ev(`(() => {
  const p = document.createElement('span'); document.body.appendChild(p);
  p.style.color = 'var(--gn-accent)'; const accent = getComputedStyle(p).color;
  p.style.color = ''; p.style.boxShadow = 'var(--gn-ring)'; const ring = getComputedStyle(p).boxShadow;
  p.remove(); return { accent, ring };
})()`);
const state = (id) => t.ev(`(() => { const e = document.getElementById(${lit(id)}); const c = getComputedStyle(e); return { shadow: c.boxShadow, border: c.borderTopColor, outline: c.outlineStyle + ' ' + c.outlineWidth }; })()`);

for (const theme of ['dark', 'light']) {
  await t.ev(`document.documentElement.dataset.theme = ${lit(theme)}`);
  await sleep(200);
  const tok = await resolved();
  t.check(`[${theme}] o anel é uma sombra de 3 px na cor de destaque a 30 %`, /0px 0px 0px 3px/.test(tok.ring) && tok.ring !== 'none', tok);
  for (const id of ['p-in', 'p-ta', 'p-se']) {
    await t.ev(`document.getElementById('${id}').blur()`);
    const before = await state(id);
    t.check(`[${theme}] ${id} sem foco: sem anel`, before.shadow === 'none', before);
    await t.ev(`document.getElementById('${id}').focus()`);
    const on = await state(id);
    t.check(`[${theme}] ${id} focado: borda de destaque e anel`, on.border === tok.accent && on.shadow === tok.ring, { on, tok });
    await t.ev(`document.getElementById('${id}').blur()`);
    t.check(`[${theme}] ${id} ao sair do campo o anel some`, (await state(id)).shadow === 'none');
  }
}
// campo desabilitado não muda
await t.ev(`document.getElementById('p-in').disabled = true; document.getElementById('p-in').focus()`);
t.check('campo desabilitado não ganha anel', (await state('p-in')).shadow === 'none');
await t.ev(`document.getElementById('p-in').disabled = false`);
// botão: continua com outline (não com o anel)
await t.ev(`document.documentElement.dataset.theme = 'dark'`);
await t.ev(`document.getElementById('p-bt').focus()`);
const bt = await state('p-bt');
t.check('botão focado não recebe o anel dos campos (segue com o outline do kit)', bt.shadow === 'none', bt);
await t.ev(`document.getElementById('gn-probe').remove()`);

// paleta de comandos: o campo não recebe o anel
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 8000);
await t.ev(`document.querySelector('.cp__input').focus()`);
const cp = await t.ev(`getComputedStyle(document.querySelector('.cp__input')).boxShadow`);
t.check('o campo da paleta de comandos não recebe o anel', cp === 'none', cp);
await t.key('Escape');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
