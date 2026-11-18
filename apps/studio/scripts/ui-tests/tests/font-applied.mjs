// JetBrains Mono no app inteiro: corpo, <kbd>, <code> e <pre> usam a fonte embutida, ligaduras desligadas por padrão, as quatro faces carregam
// e os atributos data-font-ui / data-font-code / data-ligatures do <html> trazem de volta a fonte do sistema ou ligam as ligaduras.
import { connect, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev('location.reload()');
await t.until(`document.querySelector('.core')`, 15000);
await sleep(600);

const css = (sel, prop) => t.ev(`getComputedStyle(document.querySelector('${sel}')).${prop}`);
const root = (attr, value) => t.ev(`document.documentElement.setAttribute('${attr}', '${value}')`);
const unroot = (attr) => t.ev(`document.documentElement.removeAttribute('${attr}')`);

// elementos de prova, criados na página (o que o app não tem à vista, como <pre> e <code>, também precisa herdar a fonte)
await t.ev(`(() => {
  const host = document.createElement('div');
  host.id = 'prova';
  host.innerHTML = '<kbd id="p-kbd">Ctrl</kbd><code id="p-code">!==</code><pre id="p-pre">a !== b => c</pre><samp id="p-samp">x</samp>';
  document.body.appendChild(host);
})()`);

// 1. padrão: JetBrains Mono em tudo, sem ligaduras
const isJb = (v) => /^"?JetBrains Mono"?/.test(v ?? '');
t.check('o corpo usa a JetBrains Mono', isJb(await t.ev(`getComputedStyle(document.body).fontFamily`)), await t.ev(`getComputedStyle(document.body).fontFamily`));
t.check('corpo em 12px com entrelinha 1,5 (18px)', (await t.ev(`getComputedStyle(document.body).fontSize`)) === '12px' && (await t.ev(`getComputedStyle(document.body).lineHeight`)) === '18px');
for (const id of ['p-kbd', 'p-code', 'p-pre', 'p-samp']) t.check(`<${id.slice(2)}> usa a JetBrains Mono`, isJb(await css('#' + id, 'fontFamily')), await css('#' + id, 'fontFamily'));
t.check('ligaduras desligadas por padrão', (await t.ev(`getComputedStyle(document.body).fontVariantLigatures`)) === 'none');
t.check('o <kbd> real do app (barra superior ou paleta) também usa a JetBrains Mono', await (async () => {
  const f = await t.ev(`(() => { const k = document.querySelector('.core kbd'); return k ? getComputedStyle(k).fontFamily : 'sem-kbd'; })()`);
  return f === 'sem-kbd' || isJb(f);
})());
t.check('o apelido --gn-mono vale o da fonte de código', (await t.ev(`getComputedStyle(document.documentElement).getPropertyValue('--gn-mono').trim()`)) === (await t.ev(`getComputedStyle(document.documentElement).getPropertyValue('--gn-font-code').trim()`)));

// 2. as quatro faces carregam
for (const w of [400, 500, 600, 700]) {
  const ok = await t.ev(`document.fonts.load('${w} 12px "JetBrains Mono"').then(() => document.fonts.check('${w} 12px "JetBrains Mono"'))`);
  t.check(`a face ${w} da JetBrains Mono carregou`, ok === true, ok);
}
t.check('a fonte embutida é a que renderiza (largura de 0,6 em por caractere)', await (async () => {
  const w = await t.ev(`(() => { const s = document.createElement('span'); s.style.cssText = 'position:absolute;visibility:hidden;font:400 100px "JetBrains Mono"'; s.textContent = 'iiiiiiiiii'; document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w; })()`);
  return Math.abs(w - 600) < 2; // monoespaçada: 10 caracteres x 0,6 em x 100px = 600px (qualquer fonte proporcional daria bem menos para "i")
})());

// 3. "Sistema" na interface: volta à fonte de antes (13px/1,45)
await root('data-font-ui', 'system');
await sleep(150);
t.check('data-font-ui=system: o corpo volta a Segoe UI 13px', /Segoe UI/.test(await t.ev(`getComputedStyle(document.body).fontFamily`)) && (await t.ev(`getComputedStyle(document.body).fontSize`)) === '13px');
t.check('data-font-ui=system: entrelinha de 1,45 (18.85px)', (await t.ev(`getComputedStyle(document.body).lineHeight`)) === '18.85px', await t.ev(`getComputedStyle(document.body).lineHeight`));
t.check('data-font-ui=system não mexe no código: <pre> continua na JetBrains Mono', isJb(await css('#p-pre', 'fontFamily')));
await unroot('data-font-ui');

// 4. "Sistema" no código
await root('data-font-code', 'system');
await sleep(150);
t.check('data-font-code=system: <pre> e <code> voltam à pilha monoespaçada de antes', /Cascadia Code|Consolas/.test(await css('#p-pre', 'fontFamily')) && /Cascadia Code|Consolas/.test(await css('#p-code', 'fontFamily')), await css('#p-pre', 'fontFamily'));
t.check('data-font-code=system não mexe no corpo', isJb(await t.ev(`getComputedStyle(document.body).fontFamily`)));
await unroot('data-font-code');

// 5. ligaduras
await root('data-ligatures', 'on');
await sleep(150);
t.check('data-ligatures=on: ligaduras ligadas (normal)', (await t.ev(`getComputedStyle(document.body).fontVariantLigatures`)) === 'normal', await t.ev(`getComputedStyle(document.body).fontVariantLigatures`));
t.check('data-ligatures=on: o <pre> herda', (await css('#p-pre', 'fontVariantLigatures')) === 'normal');
await unroot('data-ligatures');
t.check('sem o atributo, volta a desligadas', (await t.ev(`getComputedStyle(document.body).fontVariantLigatures`)) === 'none');

// 6. nada de itálico nem negrito inventado
t.check('font-synthesis: none (não inventa negrito nem itálico)', /none/.test(await t.ev(`getComputedStyle(document.body).fontSynthesis`)) || (await t.ev(`getComputedStyle(document.body).fontSynthesisWeight`)) === 'none');

await t.ev(`document.getElementById('prova')?.remove()`);
await t.shot('font-applied');
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
