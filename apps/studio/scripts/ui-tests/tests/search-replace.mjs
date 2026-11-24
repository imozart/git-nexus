// Substituir em vários arquivos (Ctrl+Shift+H, fase 6): a prévia na lista (depois de cada ocorrência), a exclusão por ocorrência / arquivo / pasta, o aplicar com
// confirmação (recalculado do disco; o arquivo que mudou depois da busca é recusado), CRLF e Windows-1252 preservados, o desfazer (cópia de segurança; só o que não
// mudou depois), as recusas (fim de linha misto, escopo stage e revisão) e nunca criar commit. Git de verdade; tudo é conferido no disco e no `git`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.removeItem('gitnexus.searchWindow'); localStorage.removeItem('gitnexus.searchHistory')`);

const root = tmpRoot('gn-sr-');
const repo = mkRepo(root, 'replrepo', { files: { 'a.txt': 'um\n' } });
const put = (f, data) => {
  mkdirSync(join(repo, f, '..'), { recursive: true });
  writeFileSync(join(repo, f), data);
};
const raw = (f) => readFileSync(join(repo, f));
const ORIG = {
  'src/a.ts': 'const oldName = 1;\nuse(oldName);\nconst x = Oldname;\n',
  'src/b.ts': 'oldName here\n',
  'docs/c.md': 'about oldName\n',
  'crlf.txt': 'oldName one\r\noldName two\r\n',
  'latin.txt': Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6f, 0x6c, 0x64, 0x4e, 0x61, 0x6d, 0x65, 0x0a]), // "café oldName\n" em windows-1252
  'mixed.txt': 'oldName a\r\nb\n',
  'bin.dat': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('oldName'), Buffer.from([0])]),
};
for (const [f, d] of Object.entries(ORIG)) put(f, d);
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'feat: base');
const commits = () => git(repo, 'rev-list', '--count', 'HEAD').trim();
const same = (f) => raw(f).equals(Buffer.isBuffer(ORIG[f]) ? ORIG[f] : Buffer.from(ORIG[f]));

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'replrepo')`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'replrepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);

const W = '[data-testid="search-window"]';
const q = (id) => `${W} [data-testid="${id}"]`;
const F = `${W} [data-testid="sf-input"]`;
const R = `${q('sw-replace-row')} [data-testid="sf-input"]`;
const shot = async (n) => {
  await t.ev(`(() => { if (!document.getElementById('gn-nopath')) { const s = document.createElement('style'); s.id = 'gn-nopath'; s.textContent = '.rv__path { visibility: hidden !important; }'; document.head.appendChild(s); } })()`);
  await t.shot(n);
};
const typeInto = async (sel, text) => {
  await t.ev(`(() => { const e = document.querySelector(${lit(sel)}); e.focus(); e.select(); })()`);
  await t.send('Input.insertText', { text });
  await sleep(120);
};
// o diálogo de confirmação é um diálogo dentro do diálogo: fica fora do .sw
const clickG = (id) => t.ev(`document.querySelector('[data-testid="${id}"]').click()`);
const untilG = (id, ms = 5000) => t.until(`document.querySelector('[data-testid="${id}"]')`, ms);
const click = (id) => t.ev(`document.querySelector(${lit(q(id))}).click()`);
const count = () => t.ev(`document.querySelector('[data-testid="sw-count"]')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
const summary = () => t.text('[data-testid="sw-rsummary"]');
const waitCount = async (re, ms = 15000) => {
  await sleep(450);
  return t.until(`new RegExp(${lit(re)}).test(document.querySelector('[data-testid="sw-count"]')?.textContent ?? '')`, ms);
};
const waitSummary = (re, ms = 15000) => t.until(`new RegExp(${lit(re)}).test(document.querySelector('[data-testid="sw-rsummary"]')?.textContent.replace(/\\s+/g, ' ') ?? '')`, ms);
const newRows = () => t.ev(`[...document.querySelectorAll('[data-testid="sw-new-row"]')].map((r) => (r.querySelector('.sw__ln').textContent + ' ' + r.querySelector('.sw__text').textContent).replace(/\\s+/g, ' ').trim())`);
/** O id da n-ésima ocorrência do arquivo (as linhas "depois" não contam). */
const hitId = (file, nth = 0) =>
  t.ev(`(() => { const rows = [...document.querySelectorAll('[data-testid="sw-file-row"], [data-testid="sw-row"]')]; let on = false; let k = 0; for (const r of rows) { if (r.dataset.testid === 'sw-file-row') { on = r.textContent.includes(${lit(file)}); k = 0; } else if (on && k++ === ${nth}) return r.id; } return null; })()`);
const pickHit = async (file, nth = 0) => {
  let id = await hitId(file, nth);
  for (const to of ['scrollHeight', '0']) {
    if (id) break; // a lista é virtualizada: a linha pode estar fora da janela montada
    await t.ev(`document.querySelector(${lit(q('sw-list'))}).scrollTop = ${to === '0' ? '0' : `document.querySelector(${lit(q('sw-list'))}).scrollHeight`}`);
    await sleep(300);
    id = await hitId(file, nth);
  }
  await t.ev(`document.getElementById(${lit(id)}).click()`);
  await sleep(350);
  await t.ev(`document.querySelector(${lit(q('sw-list'))}).focus()`);
};
/** A mesma pesquisa de novo, do zero: o que foi ocultado volta (como ao digitar outra vez). */
const freshSearch = async () => {
  if (await t.count(q('sw-unhide'))) await click('sw-unhide');
  await typeInto(F, 'zzzqq'); // outro texto e de volta: uma pesquisa nova de verdade (o disco foi mexido pelo teste)
  await sleep(700);
  await typeInto(F, 'oldName');
  await waitCount('^9 ocorrências em 6 arquivos');
};
const search = async (text, re) => {
  await typeInto(F, text);
  await waitCount(re);
};

// ---- Ctrl+Shift+H abre a janela com a linha "Substituir por" -------------------------------------------------------------------------------------------------
await t.key('h', 10);
await t.until(`document.querySelector(${lit(q('sw-replace-row'))})`, 5000);
t.check('Ctrl+Shift+H abre a janela de pesquisa já com a linha "Substituir por" (e o botão Substituir marcado)', (await t.count(W)) === 1 && (await t.ev(`document.querySelector(${lit(q('sw-replace-toggle'))}).getAttribute('aria-pressed')`)) === 'true' && (await t.count(R)) === 1);
await search('oldName', '^9 ocorrências em 6 arquivos');
await waitSummary('^8 substituições em 5 arquivos');
await click('sw-apply'); // com o texto novo vazio, apagar as ocorrências é permitido, mas a confirmação avisa em destaque
await untilG('sw-confirm');
t.check('texto novo vazio: a confirmação avisa que as ocorrências serão APAGADAS', (await t.count('[data-testid="sw-confirm-empty"]')) === 1 && Object.keys(ORIG).every(same));
await clickG('sw-confirm-cancel');
await sleep(300);
await typeInto(R, 'newName');
await waitSummary('^8 substituições em 5 arquivos');
await t.until(`[...document.querySelectorAll('[data-testid="sw-new-row"]')].some((r) => /newName/.test(r.textContent))`, 8000); // o texto novo vale 250 ms depois de digitado
await sleep(300);
t.check('o resumo diz quantas substituições em quantos arquivos e o que fica de fora (fim de linha misto)', /^8 substituições em 5 arquivos · um ignorado \(1 fim de linha misto\)/.test(await summary()), await summary());
const rows = await newRows();
t.check('a prévia: depois de cada ocorrência vem a linha como vai ficar, com o trecho novo destacado', rows.length >= 6 && rows.every((r) => /newName/.test(r)) && (await t.count('[data-testid="sw-new-row"] ins')) >= 6, rows);
t.check('"manter a caixa" desligado: Oldname vira newName', rows.includes('+ const x = newName;') || rows.includes('+ const newName = 1;'), rows);
await click('sw-preserve-case');
await waitSummary('^8 substituições');
await sleep(400);
t.check('com "manter a caixa" a prévia acompanha', (await newRows()).includes('+ const x = NewName;'), await newRows());
await click('sw-preserve-case');
await sleep(500);
t.check('o arquivo de fim de linha misto aparece recusado, com o motivo, e sem linhas novas', /fim de linha misto/.test((await t.ev(`[...document.querySelectorAll('[data-testid="sw-file-note"]')].map((n) => n.textContent.trim()).join('|')`)) ?? ''));
t.check('a prévia não grava nada: os arquivos continuam como estavam', Object.keys(ORIG).every(same) && commits() === '2');
await shot('substituir-previa');

// ---- exclusão por ocorrência, arquivo e pasta ----------------------------------------------------------------------------------------------------------
await pickHit('src/a.ts', 1);
await t.key('Delete');
await waitSummary('^7 substituições em 5 arquivos');
t.check('Delete tira a ocorrência da substituição (use(oldName)): 7 em 5 arquivos, e a linha "depois" dela some', /^7 substituições em 5 arquivos/.test(await summary()) && !(await newRows()).includes('+ use(newName);'), await summary());
await pickHit('docs/c.md');
await t.key('Delete', 8);
await waitSummary('^6 substituições em 4 arquivos');
t.check('Shift+Delete tira o arquivo (docs/c.md): 6 em 4', /^6 substituições em 4 arquivos/.test(await summary()), await summary());
await pickHit('src/b.ts');
await t.key('Delete', 10);
await waitSummary('^3 substituições em 2 arquivos');
t.check('Ctrl+Shift+Delete tira a pasta (src/): sobram só crlf.txt e latin.txt', /^3 substituições em 2 arquivos/.test(await summary()), await summary());
await click('sw-unhide');
await waitSummary('^8 substituições em 5 arquivos');
t.check('Mostrar tudo devolve tudo à substituição', /^8 substituições em 5 arquivos/.test(await summary()), await summary());

// ---- aplicar: confirmação, o que muda no disco ---------------------------------------------------------------------------------------------------------------
await pickHit('src/a.ts', 1);
await t.key('Delete'); // a linha use(oldName) fica de fora
await waitSummary('^7 substituições em 5 arquivos');
await click('sw-apply');
await untilG('sw-confirm');
t.check('Aplicar pergunta antes (com o total, a cópia de segurança e que nada é commitado) e nada mudou ainda', /7 substituições em 5 arquivos/.test((await t.text('[data-testid="sw-confirm"]')) ?? '') && /Nada é commitado/.test((await t.text('[data-testid="sw-confirm"]')) ?? '') && same('src/b.ts'));
await shot('substituir-confirmar');
await clickG('sw-confirm-cancel');
await sleep(300);
t.check('Cancelar não grava nada', Object.keys(ORIG).every(same));
await click('sw-apply');
await untilG('sw-confirm');
await clickG('sw-confirm-apply');
await t.until(`document.querySelector(${lit(q('sw-rresult'))})`, 15000);
t.check('o resultado diz o que foi feito e o que foi ignorado: "7 substituições em 5 arquivos, um ignorado (1 fim de linha misto)"', /^7 substituições em 5 arquivos, um ignorado \(1 fim de linha misto\)/.test((await t.text('[data-testid="sw-rresult"]')) ?? ''), await t.text('[data-testid="sw-rresult"]'));
t.check('src/a.ts: as linhas escolhidas trocadas e a excluída intacta', raw('src/a.ts').toString() === 'const newName = 1;\nuse(oldName);\nconst x = newName;\n', raw('src/a.ts').toString());
t.check('src/b.ts e docs/c.md trocados', raw('src/b.ts').toString() === 'newName here\n' && raw('docs/c.md').toString() === 'about newName\n');
t.check('CRLF preservado em todas as linhas', raw('crlf.txt').toString() === 'newName one\r\nnewName two\r\n', JSON.stringify(raw('crlf.txt').toString()));
t.check('Windows-1252 preservado byte a byte (o "é" continua 0xE9)', raw('latin.txt').equals(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x6e, 0x65, 0x77, 0x4e, 0x61, 0x6d, 0x65, 0x0a])), raw('latin.txt'));
t.check('fim de linha misto e binário ficam como estavam', same('mixed.txt') && same('bin.dat'));
t.check('nunca cria commit; os arquivos aparecem como alterações a revisar', commits() === '2' && git(repo, 'status', '--porcelain').split('\n').filter(Boolean).length === 5, git(repo, 'status', '--porcelain'));
await waitCount('^\\d+ ocorrências? em \\d+ arquivos?'); // a lista se refaz depois de gravar: o print só depois
await shot('substituir-resultado');

// ---- desfazer ---------------------------------------------------------------------------------------------------------------------------------------------------------
await click('sw-undo');
await t.until(`/Desfeito/.test(document.querySelector('[data-testid="sw-rresult"]')?.textContent ?? '')`, 15000);
t.check('Desfazer substituição devolve os arquivos, byte a byte (inclusive o CRLF e o Windows-1252)', Object.keys(ORIG).every(same) && git(repo, 'status', '--porcelain').trim() === '', git(repo, 'status', '--porcelain'));
t.check('a mensagem diz quantos arquivos voltaram, e o botão Desfazer some', /Desfeito: 5 arquivos restaurados/.test((await t.text('[data-testid="sw-rresult"]')) ?? '') && (await t.count(q('sw-undo'))) === 0, await t.text('[data-testid="sw-rresult"]'));

// ---- desfazer não passa por cima do que a pessoa mexeu depois --------------------------------------------------------------------------------------------------
await click('sw-rresult-close');
await freshSearch();
await waitSummary('^8 substituições em 5 arquivos');
await click('sw-apply');
await untilG('sw-confirm');
await clickG('sw-confirm-apply');
await t.until(`document.querySelector(${lit(q('sw-rresult'))})`, 15000);
await sleep(400);
put('src/b.ts', 'newName here (editei depois)\n');
await click('sw-undo');
await t.until(`/Desfeito/.test(document.querySelector('[data-testid="sw-rresult"]')?.textContent ?? '')`, 15000);
t.check('arquivo mexido depois da substituição NÃO é sobrescrito pelo desfazer, e a mensagem diz', raw('src/b.ts').toString() === 'newName here (editei depois)\n' && same('src/a.ts') && same('crlf.txt') && /um ignorado \(1 mudou depois da substituição\)/.test((await t.text('[data-testid="sw-rresult"]')) ?? ''), [raw('src/b.ts').toString(), await t.text('[data-testid="sw-rresult"]')]);
await shot('substituir-desfeito-parcial');
put('src/b.ts', ORIG['src/b.ts']);
git(repo, 'checkout', '--', '.');

// ---- arquivo que mudou depois da busca é recusado --------------------------------------------------------------------------------------------------------------
await click('sw-rresult-close');
await freshSearch();
await waitSummary('^8 substituições em 5 arquivos');
put('docs/c.md', 'about oldName e mais uma mudança por fora\n'); // mudou DEPOIS da busca e da prévia
await click('sw-apply');
await untilG('sw-confirm');
await clickG('sw-confirm-apply');
await t.until(`document.querySelector(${lit(q('sw-rresult'))})`, 15000);
const res = (await t.text('[data-testid="sw-rresult"]')) ?? '';
t.check('o arquivo que mudou depois da busca é recusado (e dito) e os outros são trocados', /^7 substituições em 4 arquivos/.test(res) && /1 mudou depois da busca/.test(res) && raw('docs/c.md').toString() === 'about oldName e mais uma mudança por fora\n' && raw('src/b.ts').toString() === 'newName here\n', [res, raw('docs/c.md').toString()]);
t.check('a lista do resultado nomeia o arquivo recusado', /docs\/c\.md/.test((await t.text('[data-testid="sw-rresult-files"]')) ?? ''), await t.text('[data-testid="sw-rresult-files"]'));
await waitCount('^\\d+ ocorrências? em \\d+ arquivos?');
await shot('substituir-recusado');
await click('sw-undo');
await t.until(`/Desfeito/.test(document.querySelector('[data-testid="sw-rresult"]')?.textContent ?? '')`, 15000);
put('docs/c.md', ORIG['docs/c.md']);
git(repo, 'checkout', '--', '.');

// ---- escopos que não são o arquivo do disco ---------------------------------------------------------------------------------------------------------------------------
await click('sw-rresult-close');
await t.ev(`localStorage.setItem('gitnexus.searchWindow', JSON.stringify({ ...JSON.parse(localStorage.getItem('gitnexus.searchWindow') ?? '{}'), scope: 'staged' }))`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/loading|carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);
await t.key('h', 10);
await t.until(`document.querySelector(${lit(q('sw-replace-row'))})`, 5000);
await waitCount('^\\d+ ocorrências em \\d+ arquivos');
await sleep(400);
t.check('no escopo Stage a substituição é recusada, com a razão na tela, e Aplicar fica desligado', /não são o arquivo do disco/.test((await t.text('[data-testid="sw-rscope"]')) ?? '') && (await t.ev(`document.querySelector(${lit(q('sw-apply'))}).disabled`)) === true && (await t.count('[data-testid="sw-new-row"]')) === 0, await t.text('[data-testid="sw-rscope"]'));
await shot('substituir-escopo-recusado');
await t.ev(`localStorage.setItem('gitnexus.searchWindow', JSON.stringify({ ...JSON.parse(localStorage.getItem('gitnexus.searchWindow') ?? '{}'), scope: 'revision', revision: 'HEAD' }))`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/loading|carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);
await t.key('h', 10);
await t.until(`document.querySelector(${lit(q('sw-replace-row'))})`, 5000);
await sleep(1200);
t.check('no escopo "branch, tag ou commit" também', (await t.count(q('sw-rscope'))) === 1 && (await t.ev(`document.querySelector(${lit(q('sw-apply'))}).disabled`)) === true);

// ---- tema claro e inglês ---------------------------------------------------------------------------------------------------------------------------------------------------
await t.ev(`localStorage.setItem('gitnexus.theme', 'light'); localStorage.setItem('gitnexus.locale', 'en'); localStorage.setItem('gitnexus.searchWindow', JSON.stringify({ pattern: 'oldName', replaceText: 'newName', scope: 'worktree' }))`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/loading|carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);
await t.key('h', 10);
await t.until(`document.querySelector(${lit(q('sw-replace-row'))})`, 5000);
await waitSummary('^8 replacements in 5 files');
await t.until(`document.querySelectorAll('[data-testid="sw-new-row"]').length >= 8`, 8000);
const en = await t.ev(`(() => ({
  theme: document.documentElement.dataset.theme,
  toggle: document.querySelector(${lit(q('sw-replace-toggle'))})?.textContent.trim(),
  apply: document.querySelector(${lit(q('sw-apply'))})?.textContent.trim(),
  summary: document.querySelector(${lit(q('sw-rsummary'))})?.textContent.replace(/\\s+/g, ' ').trim(),
  field: document.querySelector(${lit(R)})?.getAttribute('aria-label'),
  note: document.querySelector('[data-testid="sw-file-note"]')?.textContent.trim(),
}))()`);
t.check('tema claro e inglês: botão, Aplicar, resumo, campo e o motivo da recusa traduzidos', en.theme === 'light' && en.toggle === 'Replace' && en.apply === 'Apply' && /^8 replacements in 5 files · one skipped \(1 mixed line endings\)/.test(en.summary) && /Replace/i.test(en.field) && en.note === 'mixed line endings', en);
await shot('substituir-claro-en');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
