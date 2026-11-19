// Faixas laterais com nome: recolher/abrir a lista de arquivos e o painel de commit.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.removeItem('gitnexus.showFilesPanel'); localStorage.removeItem('gitnexus.showCommitPanel')`);
const root = tmpRoot('gn-strip-');
const repo = mkRepo(root, 'striprepo');
writeFileSync(join(repo, 'a.txt'), 'um\ndois\n');
writeFileSync(join(repo, 'b.txt'), 'novo\n');
await t.openRepo(repo, 'striprepo');
await t.until(`document.querySelector('.stripe')`, 15000);
const width = (sel) => t.ev(`Math.round(document.querySelector(${lit(sel)}).getBoundingClientRect().width)`);

t.check('duas faixas (esquerda e direita)', (await t.count('.rv__main .stripe')) === 2);
t.check('faixa esquerda chama Alterações', (await t.text('.stripe--left .stripe__label')) === 'Alterações');
t.check('faixa direita chama Commit', (await t.text('.stripe--right .stripe__label')) === 'Commit');
t.check('contador de arquivos', (await t.text('.stripe--left .stripe__badge')) === '2', await t.text('.stripe--left .stripe__badge'));
t.check('texto na vertical', (await t.ev(`getComputedStyle(document.querySelector('.stripe__btn')).writingMode`)).startsWith('vertical'));
t.check('painéis começam abertos', (await width('.rv__files')) === 300 && (await width('.rv__commit')) === 360, [await width('.rv__files'), await width('.rv__commit')]);
t.check('botão marcado quando aberto', (await t.ev(`document.querySelector('.stripe--left .stripe__btn').getAttribute('aria-pressed')`)) === 'true');
await t.shot('paineis-abertos');
const diffAberto = await width('.rv__diff');

await t.ev(`document.querySelector('.stripe--left .stripe__btn').click()`);
await sleep(400);
t.check('recolhe a lista de arquivos', (await t.ev(`getComputedStyle(document.querySelector('.rv__files')).display`)) === 'none');
t.check('diff ganha o espaço', (await width('.rv__diff')) >= diffAberto + 290, [diffAberto, await width('.rv__diff')]);
t.check('painel de commit continua', (await width('.rv__commit')) === 360);
t.check('botão desmarcado', (await t.ev(`document.querySelector('.stripe--left .stripe__btn').getAttribute('aria-pressed')`)) === 'false');
t.check('lembra o estado', (await t.ev(`localStorage.getItem('gitnexus.showFilesPanel')`)) === '0');

await t.ev(`document.querySelector('.stripe--right .stripe__btn').click()`);
await sleep(400);
t.check('recolhe o commit', (await t.ev(`getComputedStyle(document.querySelector('.rv__commit')).display`)) === 'none');
t.check('diff ocupa quase tudo', (await width('.rv__diff')) > 1400 - 80, await width('.rv__diff'));
t.check('sem o botão antigo "Ocultar commit" na barra', !(await t.ev(`[...document.querySelectorAll('.rv__toolbar button')].some(b => /ocultar commit|◂ commit/i.test(b.textContent))`)));
await t.shot('paineis-recolhidos');

await t.ev(`document.querySelector('.stripe--left .stripe__btn').click(); document.querySelector('.stripe--right .stripe__btn').click()`);
await sleep(400);
t.check('reabre os dois', (await width('.rv__files')) === 300 && (await width('.rv__commit')) === 360);

// atalho Ctrl+Shift+E (lista de arquivos)
await t.ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true, bubbles: true }))`);
await sleep(400);
t.check('Ctrl+Shift+E recolhe a lista', (await t.ev(`getComputedStyle(document.querySelector('.rv__files')).display`)) === 'none');

// inglês
await t.ev(`localStorage.setItem('gitnexus.locale','en'); localStorage.setItem('gitnexus.showFilesPanel','1')`);
await t.ev('location.reload()');
await sleep(2500);
await t.openRepo(repo, 'striprepo');
await t.until(`document.querySelector('.stripe')`, 15000);
t.check('rótulos em inglês', (await t.text('.stripe--left .stripe__label')) === 'Changes' && (await t.text('.stripe--right .stripe__label')) === 'Commit');
t.close();
