// Resolvedor de conflitos (issue #231, fase 5), com git de verdade: destaque por palavra, "ignorar espaços" (reclassifica e resolve de uma vez), caracteres
// invisíveis, fim de linha (LF/CRLF) das versões e do resultado com o aviso de fim de linha misto, histórico do trecho e a visão lado a lado
// (minha | resultado | a que chega) sobre o MESMO modelo de escolhas, que se desliga em pouca largura.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.setItem('gitnexus.newConflictResolver', '1')`);
for (const k of ['sideBySide', 'ignoreSpace', 'invisibles']) await t.ev(`localStorage.removeItem('gitnexus.mergeView.${k}')`);

const FILE = 'calc.js';
const file = (a, b, c, eol = '\n') =>
  ['// calculadora', a, 'const ok = true;', 'function f() {', b, '}', 'const done = true;', ...Array.from({ length: 16 }, (_, i) => `// apoio ${i + 1}`), c, 'export { total, names };', ''].join(eol);
const BASE = file('const total = price * qty;', '  return 1;', "const names = ['a', 'b'];");
const MINE = file('const total = cost * qty;', '      return 1;', "const names = ['a', 'b', 'c'];", '\r\n'); // a minha usa CRLF
const THEIRS = file('const total = price * amount;', '\treturn 1;', "const names = ['a', 'b', 'd'];");

const root = tmpRoot('gn-mc-');
const repo = mkRepo(root, 'compare', { files: { [FILE]: BASE } });
const put = (c, m) => {
  writeFileSync(join(repo, FILE), c);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', m);
};
git(repo, 'checkout', '-q', '-b', 'feat/custo');
put(MINE, 'feat: usa o custo na calculadora');
git(repo, 'checkout', '-q', 'main');
put(THEIRS, 'feat: calculadora da origin');
git(repo, 'checkout', '-q', 'feat/custo');
try {
  git(repo, 'merge', 'main');
} catch {
  /* conflito: é o esperado */
}

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="op-banner"]')`, 20000);
await t.ev(`[...document.querySelectorAll('[data-testid="repo-view-tab"]')].find((b) => /Conflitos/.test(b.textContent))?.click()`);
await t.until(`document.querySelector('[data-testid="merge-resolver"]')`, 15000);
await t.until(`document.querySelectorAll('[data-testid="mr-card"]').length === 3`, 15000);
await sleep(400);

const q = (js) => t.ev(`(() => { ${js} })()`);
const view = () => q(`return document.querySelector('[data-testid="merge-resolver"]').dataset.view`);
const states = () => q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => c.dataset.state)`);
const summaries = () => q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => c.querySelector('[data-testid="mr-summary"]')?.textContent.replace(/^· /, '') ?? '')`);
const clickIn = (card, testid) => t.ev(`[...document.querySelectorAll('[data-testid="mr-card"]')][${card}].querySelector('[data-testid="${testid}"]').click()`);
const clickTid = (testid) => t.ev(`document.querySelector('[data-testid="${testid}"]').click()`);
const pressed = (testid) => q(`return document.querySelector('[data-testid="${testid}"]').getAttribute('aria-pressed')`);
const eolButton = (re) => t.ev(`[...document.querySelector('[data-testid="mr-eol-choice"]').querySelectorAll('button')].find((b) => ${re}.test(b.textContent)).click()`);
const marksIn = (card, side) => q(`const c = [...document.querySelectorAll('[data-testid="mr-card"]')][${card}]; return [...c.querySelectorAll('[data-side="${side}"] mark.wd, .side--${side} mark.wd, [data-col="${side}"] mark.wd')].map((m) => m.textContent)`);

// --- visão padrão: as três opções, destaque por palavra e fim de linha --------------------------------------------------------------------------
t.check('abre na visão padrão e as três opções de comparação estão desligadas', (await view()) === 'stacked' && (await pressed('mr-view-split')) === 'false' && (await pressed('mr-ignore-space')) === 'false' && (await pressed('mr-invisibles')) === 'false');
const mineMarks = await marksIn(0, 'mine');
const theirsMarks = await marksIn(0, 'theirs');
t.check('destaque por palavra: na minha, "cost" e "qty"', mineMarks.includes('cost') && mineMarks.includes('qty'), mineMarks);
t.check('destaque por palavra: na que chega, "price" e "amount" (e o resto da linha não é marcado)', theirsMarks.includes('price') && theirsMarks.includes('amount') && !theirsMarks.some((x) => /const|total/.test(x)), theirsMarks);
t.check('a legenda explica o destaque dentro da linha', /diferença dentro da linha/.test((await t.text('[data-testid="mr-legend"]')) ?? ''));
const eolBox = (await t.text('[data-testid="mr-eol"]')) ?? '';
t.check('as versões usam fim de linha diferente: o aviso diz qual (minha CRLF, que chega LF) e oferece as 4 escolhas', /minha: CRLF/.test(eolBox) && /que chega: LF/.test(eolBox) && /Tudo LF/.test(eolBox) && /Tudo CRLF/.test(eolBox) && /Como na minha \(CRLF\)/.test(eolBox), eolBox);
t.check('sem decisão ainda, o fim de linha misto não é acusado', (await q(`return !!document.querySelector('[data-testid="mr-eol-mixed"]')`)) === false);
await t.shot('comparar-padrao');

// --- histórico do trecho --------------------------------------------------------------------------------------------------------------------------
await clickIn(0, 'mr-history');
await t.until(`document.querySelector('[data-testid="mr-history-result"][data-side="mine"]:not([data-state="loading"])')`, 8000);
const hm = (await t.text('[data-testid="mr-history-result"][data-side="mine"]')) ?? '';
t.check('"Quem mexeu?" na minha mostra o commit (curto), quem, quando e o assunto', /^[0-9a-f]{7} · T · .*feat: usa o custo na calculadora/.test(hm), hm);
await t.ev(`document.querySelector('[data-testid="mr-card"] [data-testid="mr-history"][data-side="theirs"]').click()`);
await t.until(`document.querySelector('[data-testid="mr-history-result"][data-side="theirs"]:not([data-state="loading"])')`, 8000);
const ht = (await t.text('[data-testid="mr-history-result"][data-side="theirs"]')) ?? '';
t.check('e na que chega, o commit do outro lado', /feat: calculadora da origin/.test(ht), ht);
await t.shot('comparar-historico');

// --- ignorar espaços: reclassifica e resolve de uma vez -------------------------------------------------------------------------------------------
t.check('sem "ignorar espaços" nenhum conflito é marcado como só espaço', (await q(`return document.querySelectorAll('[data-testid="mr-space-only"]').length`)) === 0);
await clickTid('mr-ignore-space');
await sleep(300);
const tags = await q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => !!c.querySelector('[data-testid="mr-space-only"]'))`);
t.check('com "ignorar espaços" só o conflito de reindentação ganha a etiqueta "só espaço"', JSON.stringify(tags) === '[false,true,false]', tags);
t.check('e o destaque por palavra do primeiro conflito continua (as palavras mudaram de verdade)', (await marksIn(0, 'mine')).includes('cost'));
t.check('na reindentação não há destaque por palavra (só diferem em espaço)', (await marksIn(1, 'mine')).length === 0 && (await marksIn(1, 'theirs')).length === 0);
await clickTid('mr-bulk');
await sleep(250);
const items = await q(`return [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim())`);
t.check('o menu "Em massa" oferece resolver os que só diferem em espaço, com a contagem', items.some((x) => /só diferem em espaço, com a minha \(1\)/.test(x)), items);
await t.shot('comparar-espaco');
await t.ev(`[...document.querySelectorAll('[role="menuitem"]')].find((b) => /só diferem em espaço/.test(b.textContent)).click()`);
await sleep(400);
t.check('resolver os de espaço decide só esse conflito (com a minha)', JSON.stringify(await states()) === '["pending","resolved","pending"]' && /de mim/.test((await summaries())[1]), { s: await states(), m: await summaries() });
await clickTid('mr-undo');
await sleep(300);
t.check('Desfazer devolve o conflito ao estado pendente', JSON.stringify(await states()) === '["pending","pending","pending"]', await states());
await clickTid('mr-ignore-space');
await sleep(200);
t.check('desligar a opção tira a etiqueta (e o item do menu)', (await q(`return document.querySelectorAll('[data-testid="mr-space-only"]').length`)) === 0);

// --- caracteres invisíveis ----------------------------------------------------------------------------------------------------------------------
await clickTid('mr-invisibles');
await sleep(300);
const inv = await q(`const c = document.querySelectorAll('[data-testid="mr-card"]')[1]; return { sp: c.querySelectorAll('.inv--sp').length, tab: c.querySelectorAll('.inv--tab').length, crlf: document.querySelectorAll('.inv--crlf').length, lf: document.querySelectorAll('.inv--lf').length }`);
t.check('"Mostrar invisíveis" desenha os espaços (minha: 6) e o tab (que chega) do conflito de reindentação', inv.sp >= 6 && inv.tab >= 1, inv);
t.check('e o fim de linha de cada linha: CRLF nas minhas, LF nas que chegam', inv.crlf >= 3 && inv.lf >= 1, inv);
t.check('o texto das linhas não muda ao mostrar invisíveis (só as marcas por cima)', (await q(`return document.querySelectorAll('[data-testid="mr-card"]')[1].querySelector('.side--mine .pl__code').textContent.replace(/\\s/g, ' ')`)) === '      return 1;', await q(`return JSON.stringify(document.querySelectorAll('[data-testid="mr-card"]')[1].querySelector('.side--mine .pl__code').textContent)`));
await t.shot('comparar-invisiveis');
await clickTid('mr-invisibles');

// --- lado a lado: as mesmas escolhas -----------------------------------------------------------------------------------------------------------------
await clickTid('mr-view-split');
await sleep(500);
t.check('"Lado a lado" liga a visão de três colunas e lembra a preferência', (await view()) === 'split' && (await pressed('mr-view-split')) === 'true' && (await q(`return localStorage.getItem('gitnexus.mergeView.sideBySide')`)) === '1');
const cols = await q(`const c = document.querySelectorAll('[data-testid="mr-card"]')[0]; return ['mine', 'result', 'theirs'].map((s) => !!c.querySelector('[data-col="' + s + '"]'))`);
t.check('cada conflito tem as três colunas (minha | resultado | a que chega)', JSON.stringify(cols) === '[true,true,true]', cols);
const conn = await q(`return { n: document.querySelectorAll('[data-testid="mr-conn"]').length, d: !!document.querySelector('[data-testid="mr-card"] [data-testid="mr-conn"] path')?.getAttribute('d') }`);
t.check('há conectores ligando cada lado ao resultado (dois por trecho)', conn.n >= 6 && conn.d === true, conn);
t.check('a mesma contagem de conflitos, todos pendentes (o modelo é um só)', JSON.stringify(await states()) === '["pending","pending","pending"]', await states());
const sameRows = await q(`const c = document.querySelectorAll('[data-testid="mr-card"]')[0]; const h = (s) => c.querySelector('[data-col="' + s + '"]').getBoundingClientRect(); const a = h('mine'), b = h('result'), d = h('theirs'); return { top: Math.abs(a.top - b.top) < 2 && Math.abs(b.top - d.top) < 2, h: Math.abs(a.height - d.height) < 2 }`);
t.check('as colunas começam na mesma linha e a minha e a que chega têm a mesma altura (rolam juntas)', sameRows.top && sameRows.h, sameRows);
const folds = await q(`return [...document.querySelectorAll('[data-testid="mr-fold"]')].map((b) => b.textContent.trim())`);
t.check('o trecho igual e longo entre o 2º e o 3º conflito fica dobrado ("N linhas iguais nas três versões")', folds.length === 1 && /^⋯ 1\d linhas iguais nas três versões/.test(folds[0]), folds);
await t.shot('comparar-lado-a-lado');
await clickTid('mr-fold');
await sleep(300);
t.check('clicar na dobra mostra as linhas (na minha e na que chega; o resultado as repete) e a dobra some', (await q(`return document.querySelectorAll('[data-testid="mr-fold"]').length`)) === 0 && (await q(`return document.querySelectorAll('[data-testid="mr-sp-row"] .spl').length`)) >= 2 * 16);

// decide na visão lado a lado e confere na padrão (e o inverso)
await clickIn(0, 'mr-use-theirs');
await sleep(300);
await t.ev(`document.querySelectorAll('[data-testid="mr-card"]')[2].querySelector('[data-side="mine"][data-testid="mr-pick"] input').click()`);
await sleep(300);
const afterSplit = { s: await states(), m: await summaries() };
t.check('na visão lado a lado: "usar a que chega" decide o 1º e uma caixa de seleção decide o 3º linha a linha', afterSplit.s[0] === 'resolved' && /da origin/.test(afterSplit.m[0]) && afterSplit.s[2] === 'resolved' && /1 de mim/.test(afterSplit.m[2]), afterSplit);
const resCol = await q(`return [...document.querySelectorAll('[data-testid="mr-card"]')[0].querySelectorAll('[data-col="result"] [data-testid="mr-line"]')].map((l) => l.querySelector('.ml__code').textContent)`);
t.check('a coluna do resultado mostra o que foi escolhido', resCol.join('|') === 'const total = price * amount;', resCol);
await t.shot('comparar-lado-a-lado-escolhido');
await clickTid('mr-view-split');
await sleep(400);
const afterStacked = { v: await view(), s: await states(), m: await summaries() };
t.check('voltando à visão padrão as escolhas são as mesmas (mudar numa muda na outra)', afterStacked.v === 'stacked' && JSON.stringify(afterStacked.s) === JSON.stringify(afterSplit.s) && JSON.stringify(afterStacked.m) === JSON.stringify(afterSplit.m), afterStacked);
await clickIn(1, 'mr-use-mine');
await sleep(250);

// --- pouca largura: a visão lado a lado se desliga ------------------------------------------------------------------------------------------------
await clickTid('mr-view-split');
await sleep(400);
t.check('de novo no lado a lado', (await view()) === 'split');
await t.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(700);
t.check('em pouca largura a visão padrão assume e a tela explica por quê (a preferência continua ligada)', (await view()) === 'stacked' && !!(await q(`return document.querySelector('[data-testid="mr-split-narrow"]')`)) && (await pressed('mr-view-split')) === 'true', await view());
await t.shot('comparar-estreito');
await t.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(700);
t.check('ao alargar a janela a visão lado a lado volta sozinha', (await view()) === 'split' && !(await q(`return document.querySelector('[data-testid="mr-split-narrow"]')`)), await view());
await clickTid('mr-view-split');
await sleep(300);

// --- fim de linha do resultado e aviso de fim de linha misto ----------------------------------------------------------------------------------------
t.check('todos decididos', JSON.stringify(await states()) === '["resolved","resolved","resolved"]', await states());
t.check('o resultado mistura CRLF (das minhas) e LF (das que chegam): o aviso aparece', !!(await q(`return document.querySelector('[data-testid="mr-eol-mixed"]')`)));
await clickTid('mr-resolve');
await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
const mixed = (await t.text('[role="alertdialog"]')) ?? '';
t.check('"Marcar como resolvido" pergunta antes e diz como uniformizar', /Fim de linha misto/.test(mixed) && /Tudo LF/.test(mixed) && /Tudo CRLF/.test(mixed), mixed);
await sleep(600); // o diálogo entra com um movimento: a captura espera ele assentar
await t.shot('comparar-eol-misto');
await t.ev(`[...document.querySelectorAll('.dlg__btns button')].find((b) => /cancelar/i.test(b.textContent))?.click()`);
await sleep(300);
t.check('cancelar não grava nada: o arquivo no disco ainda tem os marcadores do Git', /<<<<<<</.test(readFileSync(join(repo, FILE), 'utf8')));
await eolButton(/Tudo CRLF/);
await sleep(300);
t.check('escolher "Tudo CRLF" uniformiza e o aviso some', !(await q(`return document.querySelector('[data-testid="mr-eol-mixed"]')`)));
await clickTid('mr-undo');
await sleep(250);
t.check('escolher o fim de linha também se desfaz (Desfazer volta ao "como na minha")', !!(await q(`return document.querySelector('[data-testid="mr-eol-mixed"]')`)));
await eolButton(/Tudo CRLF/);
await sleep(300);
await clickTid('mr-resolve');
await sleep(1500);
const onDisk = readFileSync(join(repo, FILE), 'utf8');
t.check('gravado sem marcador e com CRLF em todas as linhas', !/<<<<<<<|>>>>>>>/.test(onDisk) && !/[^\r]\n/.test(onDisk) && /price \* amount;\r\n/.test(onDisk) && /'c'\]/.test(onDisk), JSON.stringify(onDisk));
t.check('o índice não tem mais conflito', git(repo, 'ls-files', '--unmerged').trim() === '');
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|A listener indicated an asynchronous response/.test(String(e)));
t.check('sem erro no console', appErrors.length === 0, appErrors);
t.close();
