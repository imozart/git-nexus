// Abrir o repositório no terminal e no editor: botões no cabeçalho e comandos na paleta. No navegador o processo principal é simulado (o harness
// só responde qual programa abriria), então aqui se confere a interface; o lançamento de verdade tem testes unitários em external-tools.test.ts.
import { connect, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const root = tmpRoot('gn-ot-');
const repo = mkRepo(root, 'otrepo');
await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="open-terminal"]')`, 20000);
await sleep(500);

t.check('o cabeçalho tem Terminal e Editor', (await t.count('[data-testid="open-terminal"], [data-testid="open-editor"]')) === 2);
t.check('os botões têm dica', /terminal/i.test(await t.ev(`document.querySelector('[data-testid="open-terminal"]').title`)) && /VS Code/.test(await t.ev(`document.querySelector('[data-testid="open-editor"]').title`)));

await t.ev(`document.querySelector('[data-testid="open-terminal"]').click()`);
await t.until(`/Terminal aberto/.test(document.querySelector('.rv__notice')?.textContent ?? '')`, 8000);
t.check('Terminal: o aviso diz qual programa abriu', /Terminal aberto \(Terminal \(simulado\)\)/.test((await t.text('.rv__notice')) ?? ''), await t.text('.rv__notice'));

await t.ev(`document.querySelector('[data-testid="open-editor"]').click()`);
await t.until(`/editor/.test(document.querySelector('.rv__notice')?.textContent ?? '')`, 8000);
t.check('Editor: o aviso diz qual programa abriu', /Pasta aberta no editor \(VS Code \(simulado\)\)/.test((await t.text('.rv__notice')) ?? ''), await t.text('.rv__notice'));

// pela paleta
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 5000);
await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = 'terminal'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
const titles = await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].map((e) => e.textContent.trim())`);
t.check('a paleta acha "Abrir o repositório no terminal"', titles.some((x) => /Abrir o repositório no terminal/.test(x)), titles);
await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => /Abrir o repositório no terminal/.test(e.textContent))?.click()`);
await t.until(`/Terminal aberto/.test(document.querySelector('.rv__notice')?.textContent ?? '')`, 8000);
t.check('o comando da paleta abre o terminal', /Terminal aberto/.test((await t.text('.rv__notice')) ?? ''));

await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 5000);
await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = 'vscode'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
const titles2 = await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].map((e) => e.textContent.trim())`);
t.check('a busca por "vscode" acha o comando do editor', titles2.some((x) => /no editor/.test(x)), titles2);
await t.key('Escape');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
