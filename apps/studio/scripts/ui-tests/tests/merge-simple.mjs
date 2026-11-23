// Resolvedor de conflitos (issue #231, fase 6), com git de verdade: conflitos "simples" classificados por regras (sugestão por cartão e "resolver os
// simples" com a lista, o motivo e a confirmação), tudo desfazível, e o conflito de verdade nunca decidido sozinho.
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

const FILE = 'pedido.js';
// 1: imports (inserções no mesmo ponto) · 2: reindentação (só espaço) · 3: pontas opostas da mesma linha · 4: linhas vizinhas · 5: conflito de verdade
const file = ({ imp, body, total, label, mode, limit }) =>
  [
    "import { a } from './a';",
    ...imp,
    "import { z } from './z';",
    '',
    'function calcula() {',
    ...body,
    '}',
    '',
    total,
    'const base = 1;',
    label,
    mode,
    'const fim = 2;',
    limit,
    'export { calcula };',
    '',
  ].join('\n');
const BASE = file({ imp: [], body: ['return x;'], total: 'const total = price * qty + tax;', label: "const label = 'a';", mode: "const mode = 'x';", limit: 'const limit = 10;' });
const MINE = file({ imp: ["import { b } from './b';"], body: ['    return x;'], total: 'const total = cost * qty + tax;', label: "const label = 'b';", mode: "const mode = 'x';", limit: 'const limit = 20;' });
const THEIRS = file({ imp: ["import { c } from './c';"], body: ['\treturn x;'], total: 'const total = price * qty + fee;', label: "const label = 'a';", mode: "const mode = 'y';", limit: 'const limit = 30;' });
// o que sai com os quatro simples aplicados e o de verdade com a minha
const EXPECTED = file({
  imp: ["import { b } from './b';", "import { c } from './c';"],
  body: ['    return x;'],
  total: 'const total = cost * qty + fee;',
  label: "const label = 'b';",
  mode: "const mode = 'y';",
  limit: 'const limit = 20;',
});

const root = tmpRoot('gn-ms-');
const repo = mkRepo(root, 'simples', { files: { [FILE]: BASE } });
const put = (c, m) => {
  writeFileSync(join(repo, FILE), c);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', m);
};
git(repo, 'checkout', '-q', '-b', 'feat/pedido');
put(MINE, 'feat: ajustes no pedido');
git(repo, 'checkout', '-q', 'main');
put(THEIRS, 'feat: ajustes da origin no pedido');
git(repo, 'checkout', '-q', 'feat/pedido');
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
await t.ev(`[...document.querySelectorAll('.rv__btns button')].find((b) => /Conflitos/.test(b.textContent))?.click()`);
await t.until(`document.querySelector('[data-testid="merge-resolver"]')`, 15000);
await t.until(`document.querySelectorAll('[data-testid="mr-card"]').length === 5`, 15000);
await sleep(500);

const q = (js) => t.ev(`(() => { ${js} })()`);
const states = () => q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => c.dataset.state)`);
const kinds = () => q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => c.querySelector('[data-testid="mr-simple"]')?.dataset.kind ?? '')`);
const clickTid = (testid) => t.ev(`document.querySelector('[data-testid="${testid}"]').click()`);
const preview = () => q(`return [...document.querySelectorAll('[data-testid="mr-scroll"] .ml__code')].map((l) => l.textContent).join('\\n')`);
const bulkItem = (re) => t.ev(`[...document.querySelectorAll('[role="menuitem"]')].find((b) => ${re}.test(b.textContent))?.click()`);

// --- a classificação: quatro simples, um de verdade ----------------------------------------------------------------------------------------------
t.check('cinco conflitos, todos pendentes', JSON.stringify(await states()) === '["pending","pending","pending","pending","pending"]', await states());
const k = await kinds();
t.check('quatro têm a etiqueta "Simples" com a classe certa (inserções, só espaço, palavras, vizinhas) e o de verdade fica sem', JSON.stringify(k) === '["insertions","space","words","neighbors",""]', k);
const tag0 = (await t.text('[data-testid="mr-simple"]')) ?? '';
t.check('a etiqueta diz o motivo em português', /Simples: Inserções no mesmo ponto/.test(tag0), tag0);
t.check('só os simples têm o botão "Aplicar sugestão"', (await q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => !!c.querySelector('[data-testid="mr-suggest"]'))`)).join() === 'true,true,true,true,false');
await t.shot('simples-cartoes');

// --- a sugestão de um cartão: aplica só nele, mostra o resultado e se desfaz -----------------------------------------------------------------------
await q(`document.querySelectorAll('[data-testid="mr-card"]')[2].querySelector('[data-testid="mr-suggest"]').click()`);
await sleep(400);
t.check('"Aplicar sugestão" no 3º decide só ele (pontas opostas: combinado à mão por palavra)', JSON.stringify(await states()) === '["pending","pending","edited","pending","pending"]', await states());
t.check('a prévia do trecho tem as duas mudanças na mesma linha (cost e fee)', /const total = cost \* qty \+ fee;/.test(await preview()), await preview());
t.check('e o cartão decidido já não oferece a sugestão', (await q(`return !document.querySelectorAll('[data-testid="mr-card"]')[2].querySelector('[data-testid="mr-suggest"]')`)) === true);
await clickTid('mr-undo');
await sleep(300);
t.check('Desfazer volta o conflito a pendente', JSON.stringify(await states()) === '["pending","pending","pending","pending","pending"]', await states());

// --- resolver os simples: lista, motivo, confirmação -----------------------------------------------------------------------------------------------
await clickTid('mr-bulk');
await sleep(250);
const items = await q(`return [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim())`);
t.check('o menu "Em massa" oferece "Resolver os simples… (4)"', items.some((x) => /Resolver os simples… \(4\)/.test(x)), items);
await bulkItem(/Resolver os simples/);
await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
await sleep(700);
const dlg = (await t.text('[role="alertdialog"]')) ?? '';
t.check('o diálogo lista cada conflito com o motivo e o que será aplicado, antes de qualquer mudança', /Conflito 1 \(.*\): Inserções no mesmo ponto, usa as duas \(a minha primeiro\)/.test(dlg) && /Conflito 2 \(.*\): Só difere em espaço, fica a minha versão/.test(dlg) && /Conflito 3 \(.*\): Pontas opostas da mesma linha, combina por palavra/.test(dlg) && /Conflito 4 \(.*\): Linhas vizinhas, sem sobreposição, junta as duas edições/.test(dlg) && !/Conflito 5/.test(dlg), dlg);
t.check('e avisa que o que já foi decidido não muda e que dá para desfazer', /dá para desfazer/.test(dlg));
await t.shot('simples-confirmacao');
await t.ev(`[...document.querySelectorAll('.dlg__btns button')].find((b) => /cancelar/i.test(b.textContent))?.click()`);
await sleep(300);
t.check('cancelar não decide nada', JSON.stringify(await states()) === '["pending","pending","pending","pending","pending"]', await states());

await clickTid('mr-bulk');
await sleep(250);
await bulkItem(/Resolver os simples/);
await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
await sleep(500);
await t.ev(`[...document.querySelectorAll('.dlg__btns button')].find((b) => /Aplicar em 4/.test(b.textContent))?.click()`);
await sleep(500);
t.check('confirmar decide os quatro simples; o conflito de verdade segue pendente (nunca é decidido sozinho)', JSON.stringify(await states()) === '["resolved","resolved","edited","resolved","pending"]', await states());
const pv = await preview();
t.check('as duas inserções ficam na ordem (b, c), as edições vizinhas se juntam e a reindentação fica com a minha', /import \{ b \}[^\n]*\n[^\n]*import \{ c \}/.test(pv) && /const label = 'b';\nconst mode = 'y';/.test(pv) && /    return x;/.test(pv), pv);
t.check('"Marcar como resolvido" continua bloqueado e diz que falta 1', /Faltam 1|falta 1/i.test((await t.text('[data-testid="mr-resolve"]')) ?? '') && (await q(`return document.querySelector('[data-testid="mr-resolve"]').disabled`)) === true, await t.text('[data-testid="mr-resolve"]'));
t.check('o menu não oferece mais os simples (nenhum pendente)', await (async () => {
  await clickTid('mr-bulk');
  await sleep(250);
  const dis = await q(`return [...document.querySelectorAll('[role="menuitem"]')].filter((b) => /Resolver os simples/.test(b.textContent)).map((b) => b.disabled || b.getAttribute('aria-disabled') === 'true')`);
  await t.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  return dis.length === 1 && dis[0] === true;
})());
await sleep(200);
await t.shot('simples-aplicados');

// --- desfazer tudo de uma vez ------------------------------------------------------------------------------------------------------------------------
await clickTid('mr-undo');
await sleep(300);
t.check('Desfazer volta os quatro de uma vez', JSON.stringify(await states()) === '["pending","pending","pending","pending","pending"]', await states());
await clickTid('mr-redo');
await sleep(300);

// --- terminar: o de verdade com a minha e gravar -------------------------------------------------------------------------------------------------------
await q(`document.querySelectorAll('[data-testid="mr-card"]')[4].querySelector('[data-testid="mr-use-mine"]').click()`);
await sleep(300);
await clickTid('mr-resolve');
await sleep(1500);
const onDisk = readFileSync(join(repo, FILE), 'utf8');
t.check('o arquivo gravado é exatamente o esperado, sem marcador', onDisk === EXPECTED, JSON.stringify(onDisk));
t.check('o índice não tem mais conflito', git(repo, 'ls-files', '--unmerged').trim() === '');
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|A listener indicated an asynchronous response/.test(String(e)));
t.check('sem erro no console', appErrors.length === 0, appErrors);
t.close();
