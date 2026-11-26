// Substituir no arquivo (Ctrl+H no editor): o campo "Substituir por" (GnSearchField variant="replace"), Substituir / Substituir e ir para a próxima /
// Substituir todas (com a contagem anunciada), manter a caixa, grupos ($1) e escapes (\n) no texto novo, a prévia da ocorrência atual, UM Ctrl+Z
// para desfazer "todas", selecionar todas as ocorrências (vários cursores), Ctrl+D (a próxima, um passo de cada vez), histórico do campo, somente
// leitura (só busca), só teclado, os dois temas e os dois idiomas. Git de verdade, arquivo em conflito aberto no editor do resolvedor.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.removeItem('gitnexus.find')`);

// ---- arquivo pequeno em conflito (as 5 primeiras linhas são o que a busca troca; o conflito fica depois) ---------------------------------------
const body = (mid) =>
  [
    'const foo = 1; // foo',
    'Foo e FOO e fOo',
    'contato: ana@x.com, bia@y.org',
    'linha 4 foo',
    'qux qux qux',
    ...Array.from({ length: 40 }, (_, i) => `x${i} = ${i};`),
    mid,
    '',
  ].join('\n');
const root = tmpRoot('gn-fr-');
const repo = mkRepo(root, 'subst', { files: { 'app.ts': body('alvo = "base";') } });
git(repo, 'checkout', '-q', '-b', 'outro');
writeFileSync(join(repo, 'app.ts'), body('alvo = "outro";'));
git(repo, 'commit', '-qam', 'outro muda');
git(repo, 'checkout', '-q', 'main');
writeFileSync(join(repo, 'app.ts'), body('alvo = "main";'));
git(repo, 'commit', '-qam', 'main muda');
try {
  git(repo, 'merge', 'outro');
} catch {
  /* conflito: é o esperado */
}
await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);

async function openConflicts(label) {
  await t.ev('location.reload()');
  await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
  await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
  await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
  await t.until(`document.querySelector('[data-testid="op-banner"]')`, 20000);
  await t.ev(`[...document.querySelectorAll('[data-testid="repo-view-tab"]')].find((b) => new RegExp(${lit(label)}).test(b.textContent))?.click()`);
  await t.until(`document.querySelectorAll('.mcr__result .cm-content').length === 1 && document.querySelectorAll('.mcr__top .cm-content').length === 3`, 60000);
  await sleep(600);
}
await openConflicts('Conflitos');

const RESULT = '.mcr__result';
const OURS = '.mcr__top .pane:nth-child(1)';
const BAR = (scope = RESULT) => `${scope} [data-testid="find-bar"]`;
const S = (scope = RESULT) => `${BAR(scope)} [data-testid="sf-input"]`; // o primeiro campo da barra é o de pesquisar
const R = (scope = RESULT) => `${BAR(scope)} [data-testid="find-replace-row"] [data-testid="sf-input"]`;
const $ = (scope, id) => `document.querySelector(${lit(`${BAR(scope)} [data-testid="${id}"]`)})`;
const focusEditor = (scope = RESULT) => t.ev(`(() => { const c = document.querySelector(${lit(scope + ' .cm-content')}); c.focus(); return document.activeElement === c; })()`);
const typeText = (s) => t.send('Input.insertText', { text: s });
const setField = async (sel, text) => {
  await t.ev(`(() => { const e = document.querySelector(${lit(sel)}); e.focus(); e.select(); })()`);
  await typeText(text);
  await sleep(220);
};
const doc = () => t.ev(`document.querySelector(${lit(RESULT + ' .cm-content')}).innerText`);
const line = async (n) => ((await doc()).split('\n')[n - 1] ?? '').trim();
const counter = () => t.ev(`${$(RESULT, 'find-count')}?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const waitCounter = (re, ms = 5000) => t.until(`new RegExp(${lit(re)}).test(${$(RESULT, 'find-count')}?.textContent ?? '')`, ms);
const pressed = (id) => t.ev(`${$(RESULT, id)}?.getAttribute('aria-pressed')`);
const active = () => t.ev(`(() => { const a = document.activeElement; return a ? (a.getAttribute('data-testid') || a.className || a.tagName) : null; })()`);
const preview = () => t.ev(`${$(RESULT, 'find-preview')}?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);

// ---- Ctrl+H abre a barra com o campo "Substituir por" ----------------------------------------------------------------------------------------
await focusEditor();
await t.key('h', 2);
await t.until(`document.querySelector(${lit(R())})`, 4000);
t.check('Ctrl+H abre a barra já com a linha de substituição', (await t.count(`${BAR()} [data-testid="find-replace-row"]`)) === 1);
t.check('o campo "Substituir por" é um searchbox com nome', (await t.ev(`(() => { const e = document.querySelector(${lit(R())}); return e.getAttribute('role') === 'searchbox' && e.getAttribute('aria-label') === 'Substituir por'; })()`)) === true);
t.check('o campo de substituir só tem o ✕ (sem Aa, ab, .*): os três botões são só do campo de pesquisar', (await t.count(`${BAR()} [data-testid="sf-case"]`)) === 1 && (await t.count(`${BAR()} [data-testid="find-replace-row"] [data-testid="sf-case"]`)) === 0);
t.check('com a palavra sob o cursor já preenchida, o foco vai para o campo de substituir', (await active()) === 'sf-input' && (await t.ev(`document.activeElement === document.querySelector(${lit(R())})`)) === true);
t.check('o botão de alternar a substituição anuncia aria-expanded=true', (await t.ev(`${$(RESULT, 'find-toggle-replace')}.getAttribute('aria-expanded')`)) === 'true');
t.check('Substituir e Todas ligam quando há ocorrências (a palavra sob o cursor já é a pesquisa)', (await t.ev(`${$(RESULT, 'find-replace-one')}.disabled`)) === false);
t.check('Todas tem nome acessível "Substituir todas"', (await t.ev(`${$(RESULT, 'find-replace-all')}.getAttribute('aria-label')`)) === 'Substituir todas');

// ---- uma, e uma e a próxima ---------------------------------------------------------------------------------------------------------------------
await setField(S(), 'foo');
await waitCounter('^1 de 6$');
t.check('pesquisa "foo" (sem diferenciar caixa): 6 ocorrências, a primeira selecionada', (await counter()) === '1 de 6', await counter());
await setField(R(), 'bar');
t.check('a prévia mostra o trecho achado e como ficará', /Prévia: foo → bar/.test((await preview()) ?? ''), await preview());
await t.ev(`${$(RESULT, 'find-replace-one')}.click()`);
await waitCounter('^1 de 5$');
t.check('Substituir troca a ocorrência atual e vai para a próxima (restam 5)', (await line(1)) === 'const bar = 1; // foo' && (await counter()) === '1 de 5', [await line(1), await counter()]);
await t.ev(`document.querySelector(${lit(R())}).focus()`);
await t.key('Enter');
await waitCounter('^1 de 4$');
t.check('Enter no campo de substituir troca e vai para a próxima (restam 4)', (await line(1)) === 'const bar = 1; // bar' && (await counter()) === '1 de 4', [await line(1), await counter()]);

// ---- pular: Enter no campo de pesquisar só anda -------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector(${lit(S())}).focus()`);
await t.key('Enter');
await waitCounter('^2 de 4$');
t.check('pular = Enter no campo de pesquisar: anda sem trocar (a linha 2 continua igual)', (await counter()) === '2 de 4' && (await line(2)) === 'Foo e FOO e fOo', [await counter(), await line(2)]);

// ---- todas, manter a caixa, contagem anunciada e UM Ctrl+Z ----------------------------------------------------------------------------------------
await sleep(800); // fora da janela de agrupamento do histórico: o Ctrl+Z abaixo desfaz só o "todas"
await t.ev(`${$(RESULT, 'find-preserve-case')}.click()`);
await sleep(200);
t.check('Manter caixa liga (aria-pressed)', (await pressed('find-preserve-case')) === 'true');
await t.ev(`${$(RESULT, 'find-replace-all')}.click()`);
await sleep(400);
t.check('Todas troca as 4 restantes mantendo a caixa (Foo→Bar, FOO→BAR, fOo→bar, foo→bar)', (await line(2)) === 'Bar e BAR e bar' && (await line(4)) === 'linha 4 bar', [await line(2), await line(4)]);
t.check('a contagem é anunciada na região de status ("4 ocorrências substituídas")', /4 ocorrências substituídas/.test((await counter()) ?? ''), await counter());
t.check('a região do contador é role=status e aria-live=polite', (await t.ev(`(() => { const e = ${$(RESULT, 'find-count')}; return e.getAttribute('role') === 'status' && e.getAttribute('aria-live') === 'polite'; })()`)) === true);
await focusEditor();
await t.key('z', 2);
await sleep(300);
t.check('UM Ctrl+Z desfaz o "todas" inteiro', (await line(2)) === 'Foo e FOO e fOo' && (await line(4)) === 'linha 4 foo' && (await line(1)) === 'const bar = 1; // bar', [await line(1), await line(2), await line(4)]);

// ---- regex: grupos, prévia e escapes -------------------------------------------------------------------------------------------------------------
await t.ev(`${$(RESULT, 'find-preserve-case')}.click()`); // caixa de volta ao normal
await t.ev(`document.querySelector(${lit(S())}).focus()`);
await t.key('x', 1);
await sleep(150);
t.check('Alt+X liga a regex', (await pressed('sf-regex')) === 'true');
await setField(S(), '(\\w+)@(\\w+)');
await waitCounter('^1 de 2$');
await setField(R(), '$2:$1');
t.check('a prévia aplica os grupos ($2:$1): ana@x → x:ana', /ana@x → x:ana/.test((await preview()) ?? ''), await preview());
await t.shot('substituir-escuro');
await sleep(700);
await t.ev(`${$(RESULT, 'find-replace-all')}.click()`);
await sleep(400);
t.check('Todas com grupos: contato: x:ana.com, y:bia.org', (await line(3)) === 'contato: x:ana.com, y:bia.org', await line(3));
await focusEditor();
await t.key('z', 2);
await sleep(300);
t.check('Ctrl+Z restaura o contato', (await line(3)) === 'contato: ana@x.com, bia@y.org', await line(3));
await setField(S(), ', ');
await waitCounter('^1 de 1$');
await setField(R(), '\\n');
await sleep(700);
await t.ev(`${$(RESULT, 'find-replace-all')}.click()`);
await sleep(400);
t.check('escape \\n no texto novo (regex) quebra a linha', (await line(3)) === 'contato: ana@x.com' && (await line(4)) === 'bia@y.org', [await line(3), await line(4)]);
await focusEditor();
await t.key('z', 2);
await sleep(300);
t.check('Ctrl+Z desfaz a quebra', (await line(3)) === 'contato: ana@x.com, bia@y.org', await line(3));

// ---- histórico do campo de substituir ------------------------------------------------------------------------------------------------------------
await t.ev(`${$(RESULT, 'sf-regex')}.click()`); // regex desligada de novo
await t.ev(`(() => { const e = document.querySelector(${lit(R())}); e.focus(); e.select(); })()`);
await typeText('rascunho');
await t.key('ArrowUp');
await sleep(150);
t.check('↑ no campo de substituir traz o texto usado antes', (await t.ev(`document.querySelector(${lit(R())}).value`)) === '\\n', await t.ev(`document.querySelector(${lit(R())}).value`));
await t.key('ArrowDown');
await sleep(150);
t.check('↓ volta ao que estava sendo digitado', (await t.ev(`document.querySelector(${lit(R())}).value`)) === 'rascunho');

// ---- selecionar todas as ocorrências (vários cursores) ---------------------------------------------------------------------------------------------
await setField(S(), 'foo');
await waitCounter('^1 de 4$');
await t.ev(`document.querySelector(${lit(S())}).focus()`);
await t.key('Enter', 1);
await sleep(300);
t.check('Alt+Enter seleciona todas as ocorrências e avisa', /4 ocorrências selecionadas/.test((await counter()) ?? ''), await counter());
t.check('o foco vai para o editor (digitar troca todas)', (await t.ev(`document.activeElement === document.querySelector(${lit(RESULT + ' .cm-content')})`)) === true);
await sleep(700);
await typeText('Z');
await sleep(300);
t.check('digitar com todas selecionadas troca as 4 de uma vez', (await line(1)) === 'const bar = 1; // bar' && (await line(2)) === 'Z e Z e Z' && (await line(4)) === 'linha 4 Z', [await line(2), await line(4)]);
await t.key('z', 2);
await sleep(300);
t.check('e um Ctrl+Z desfaz', (await line(2)) === 'Foo e FOO e fOo' && (await line(4)) === 'linha 4 foo', [await line(2), await line(4)]);

// só teclado: Ctrl+Alt+Enter troca todas sem tocar no mouse
await t.ev(`document.querySelector(${lit(S())}).focus()`);
await t.key('Enter', 3);
await sleep(400);
t.check('só teclado: Ctrl+Alt+Enter substitui todas', (await line(2)) === 'rascunho e rascunho e rascunho', await line(2));
await focusEditor();
await t.key('z', 2);
await sleep(300);

// ---- Ctrl+D: a próxima ocorrência, um passo de cada vez ---------------------------------------------------------------------------------------------
await setField(S(), 'qux');
await waitCounter('^1 de 3$');
await t.key('Escape');
await sleep(300);
t.check('Esc fecha a barra e deixa "qux" selecionado no editor', (await t.count('[data-testid="find-bar"]')) === 0);
await t.key('d', 2);
await sleep(250);
const sel1 = await t.count(`${RESULT} .cm-selectionBackground`);
await t.key('d', 2);
await sleep(250);
const sel2 = await t.count(`${RESULT} .cm-selectionBackground`);
t.check('Ctrl+D adiciona a próxima ocorrência, uma por vez (2 e depois 3 seleções)', sel1 === 2 && sel2 === 3, [sel1, sel2]);
await sleep(700);
await typeText('W');
await sleep(250);
t.check('digitar troca as 3 seleções', (await line(5)) === 'W W W', await line(5));
await t.key('z', 2);
await sleep(250);

// ---- somente leitura: só busca ---------------------------------------------------------------------------------------------------------------------
await focusEditor(OURS);
await t.key('h', 2);
await t.until(`document.querySelector(${lit(BAR(OURS))})`, 4000);
t.check('somente leitura: Ctrl+H abre a barra, mas sem substituir (sem linha, sem botão de alternar)', (await t.count(`${BAR(OURS)} [data-testid="find-replace-row"]`)) === 0 && (await t.count(`${BAR(OURS)} [data-testid="find-toggle-replace"]`)) === 0);
await typeText('foo');
await sleep(300);
t.check('somente leitura: a busca funciona', /de \d+/.test((await t.ev(`${$(OURS, 'find-count')}?.textContent ?? ''`)) ?? ''));
await t.key('Escape');
await sleep(200);

// ---- o botão de alternar abre e fecha a linha -------------------------------------------------------------------------------------------------
await focusEditor();
await t.key('f', 2);
await t.until(`document.querySelector(${lit(S())})`, 4000);
t.check('Ctrl+F abre só a pesquisa (a substituição fica recolhida)', (await t.count(`${BAR()} [data-testid="find-replace-row"]`)) === 0 && (await t.ev(`${$(RESULT, 'find-toggle-replace')}.getAttribute('aria-expanded')`)) === 'false');
await t.ev(`${$(RESULT, 'find-toggle-replace')}.click()`);
await sleep(250);
t.check('o botão abre a linha de substituição', (await t.count(`${BAR()} [data-testid="find-replace-row"]`)) === 1);
await t.ev(`${$(RESULT, 'find-toggle-replace')}.click()`);
await sleep(250);
t.check('e fecha', (await t.count(`${BAR()} [data-testid="find-replace-row"]`)) === 0);
await t.key('Escape');
await sleep(200);

// ---- tema claro e inglês (capturas) -------------------------------------------------------------------------------------------------------------
await t.ev(`localStorage.setItem('gitnexus.theme', 'light'); localStorage.setItem('gitnexus.locale', 'en')`);
await openConflicts('Conflicts');
await focusEditor();
await t.key('h', 2);
await t.until(`document.querySelector(${lit(R())})`, 4000);
await setField(S(), 'foo');
await waitCounter('^1 of 6$');
await setField(R(), 'bar');
await sleep(300);
const en = await t.ev(`(() => ({
  toggle: ${$(RESULT, 'find-toggle-replace')}.getAttribute('aria-label'),
  field: document.querySelector(${lit(R())}).getAttribute('aria-label'),
  one: ${$(RESULT, 'find-replace-one')}.textContent.trim(),
  all: ${$(RESULT, 'find-replace-all')}.getAttribute('aria-label'),
  keep: ${$(RESULT, 'find-preserve-case')}.textContent.trim(),
  preview: ${$(RESULT, 'find-preview')}?.textContent.replace(/\\s+/g, ' ').trim(),
  theme: document.documentElement.dataset.theme,
}))()`);
t.check('em inglês e tema claro: rótulos e prévia traduzidos', en.toggle === 'Toggle replace' && en.field === 'Replace with' && en.one === 'Replace' && en.all === 'Replace all' && en.keep === 'Keep case' && /Preview: foo → bar/.test(en.preview) && en.theme === 'light', en);
await t.ev(`${$(RESULT, 'find-replace-all')}.click()`);
await sleep(500);
t.check('em inglês a contagem é anunciada ("6 occurrences replaced")', /6 occurrences replaced/.test((await counter()) ?? ''), await counter());
await t.shot('substituir-claro');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro de página durante a substituição', appErrors.length === 0, appErrors);
t.close();
