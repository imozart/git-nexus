// Rebase interativo: a linha arrastada fica com opacidade reduzida e sombra pequena (row--dragging), o destino segue com row--over, e cancelar ou soltar
// fora de qualquer linha (dragend) não deixa nada marcado. O layout não muda durante o arraste (mesma altura e posição).
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0')`);

const root = tmpRoot('gn-rbd-');
const repo = mkRepo(root, 'rbdrepo', { files: { 'README.md': '# r\n' } });
const commit = (file, msg) => {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), msg + '\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', msg);
};
commit('a.txt', 'feat: primeiro');
commit('b.txt', 'fix: segundo');
commit('c.txt', 'docs: terceiro');
commit('d.txt', 'chore: quarto');

await t.until(`document.querySelector('.conn__bar')`, 20000);
await t.openRepo(repo, 'rbdrepo');
await t.until(`document.querySelector('[data-testid="sync-main"], .rv__path')`, 20000);
await sleep(600);

// Rebase interativo pela paleta (o que a pessoa faz com Ctrl+K)
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 5000);
await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = ${lit('rebase interativo')}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(400);
await t.key('Enter');
await t.until(`document.querySelector('.rb')`, 10000);
await t.ev(`(() => { const i = document.querySelector('.rb input[type=number]'); if (i) { i.value = '4'; i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
await t.ev(`[...document.querySelectorAll('.rb button')].find((b) => b.textContent.trim().startsWith('Carregar commits'))?.click()`);
await t.until(`document.querySelectorAll('.rb li.row').length >= 4`, 15000);
await sleep(500);

const rows = (cls) => t.ev(`[...document.querySelectorAll('.rb li.row')].map((r, i) => r.classList.contains(${lit(cls)}) ? i : -1).filter((i) => i >= 0)`);
const rect = (i) => t.ev(`(() => { const r = document.querySelectorAll('.rb li.row')[${i}].getBoundingClientRect(); return { top: Math.round(r.top), height: Math.round(r.height), left: Math.round(r.left), width: Math.round(r.width) }; })()`);
const fire = (i, type) => t.ev(`(() => { const r = document.querySelectorAll('.rb li.row')[${i}]; r.dispatchEvent(new DragEvent(${lit(type)}, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() })); })()`);
const shadowOf = (i) => t.ev(`getComputedStyle(document.querySelectorAll('.rb li.row')[${i}]).boxShadow`);
const sm = await t.ev(`(() => { const p = document.createElement('span'); document.body.appendChild(p); p.style.boxShadow = 'var(--gn-shadow-sm)'; const c = getComputedStyle(p).boxShadow; p.remove(); return c; })()`);

t.check('há 4 linhas e nenhuma começa marcada', (await t.count('.rb li.row')) === 4 && (await rows('row--dragging')).length === 0 && (await rows('row--over')).length === 0);
const before = await rect(1);

await fire(1, 'dragstart');
await sleep(200);
t.check('ao iniciar o arraste, só a linha de origem tem row--dragging', JSON.stringify(await rows('row--dragging')) === '[1]', await rows('row--dragging'));
t.check('a linha arrastada tem opacidade reduzida e a sombra pequena do token (--gn-shadow-sm)', (await t.ev(`getComputedStyle(document.querySelectorAll('.rb li.row')[1]).opacity`)) === '0.55' && (await shadowOf(1)) === sm, { op: await t.ev(`getComputedStyle(document.querySelectorAll('.rb li.row')[1]).opacity`), shadow: await shadowOf(1), sm });
const during = await rect(1);
t.check('o layout não muda durante o arraste (mesma altura, posição e largura)', JSON.stringify(before) === JSON.stringify(during), { before, during });

await fire(2, 'dragover');
await sleep(150);
t.check('o destino continua com row--over e a origem com row--dragging', JSON.stringify(await rows('row--over')) === '[2]' && JSON.stringify(await rows('row--dragging')) === '[1]', { over: await rows('row--over'), drag: await rows('row--dragging') });

await fire(1, 'dragend');
await sleep(200);
t.check('cancelar (dragend, sem soltar numa linha) não deixa nenhuma linha marcada', (await rows('row--dragging')).length === 0 && (await rows('row--over')).length === 0, { drag: await rows('row--dragging'), over: await rows('row--over') });
t.check('a sombra e a opacidade da linha voltam ao normal', (await shadowOf(1)) === 'none' && (await t.ev(`getComputedStyle(document.querySelectorAll('.rb li.row')[1]).opacity`)) === '1');

// soltar numa linha também limpa tudo (o drop já resetava; confere que a nova classe acompanha)
await fire(0, 'dragstart');
await fire(3, 'dragover');
await t.ev(`document.querySelectorAll('.rb li.row')[3].dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))`);
await sleep(300);
t.check('soltar numa linha limpa a origem e o destino', (await rows('row--dragging')).length === 0 && (await rows('row--over')).length === 0);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
