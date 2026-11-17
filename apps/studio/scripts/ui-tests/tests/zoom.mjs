// Zoom da interface pela paleta de comandos: os três comandos existem (em português e com a dica do atalho) e cada um pede a ação certa ao
// processo principal (que guarda o fator). O teclado (Ctrl+=) é tratado no processo principal do Electron e não roda neste navegador.
import { connect, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev('location.reload()');
await t.until(`document.querySelector('.core')`, 15000);
await sleep(600);

// registra o que a interface pede (o `api` guarda a referência do objeto e lê `setZoom` na hora da chamada)
await t.ev(`(() => { window.__zoom = []; const o = window.gitNexus.setZoom; window.gitNexus.setZoom = (a) => { window.__zoom.push(a); return o(a); }; return true; })()`);

const runCommand = async (query, titlePart) => {
  await t.key('k', 2);
  await t.until(`document.querySelector('.cp__input')`, 5000);
  await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = ${JSON.stringify(query)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(300);
  const titles = await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].map((e) => e.textContent.trim())`);
  const found = titles.some((x) => x.includes(titlePart));
  // clica no comando certo (a busca por "zoom" põe os três juntos e o primeiro nem sempre é o que se quer)
  await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => e.textContent.includes(${JSON.stringify(titlePart)}))?.click()`);
  await sleep(400);
  return { found, titles };
};

const a = await runCommand('zoom', 'Aumentar o zoom');
t.check('a paleta acha os comandos de zoom', a.found, a.titles);
t.check('o título traz a dica do atalho (Ctrl+=)', a.titles.some((x) => /Ctrl\+=/.test(x)), a.titles);
t.check('"Aumentar" pede a ação in', ((await t.ev('window.__zoom')) ?? []).join() === 'in', await t.ev('window.__zoom'));

const b = await runCommand('diminuir zoom', 'Diminuir o zoom');
t.check('"Diminuir" aparece na busca por "diminuir zoom"', b.found, b.titles);
t.check('"Diminuir" pede a ação out', ((await t.ev('window.__zoom')) ?? []).join() === 'in,out', await t.ev('window.__zoom'));

const c = await runCommand('restaurar zoom', 'Restaurar o zoom');
t.check('"Restaurar" aparece e pede reset', c.found && ((await t.ev('window.__zoom')) ?? []).join() === 'in,out,reset', [c.titles, await t.ev('window.__zoom')]);

const en = await runCommand('bigger', 'Aumentar o zoom'); // palavra-chave em inglês acha o mesmo comando
t.check('palavras-chave em inglês também acham o comando', en.found, en.titles);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
