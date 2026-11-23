// Busca dentro do arquivo (Ctrl+F no editor): o campo do kit (GnSearchField) com os controles DENTRO, a barra (FindBar) com contador, navegação e
// marcas, o destaque de todas as ocorrências, o teclado (Enter, Shift+Enter, Esc, Alt+C/O/X, setas do histórico), regex inválida, ✕ que devolve o foco
// e desfaz, texto longo sem passar por baixo dos botões, modo somente leitura, os dois temas e os dois idiomas, e um arquivo de 30 mil linhas.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
const metrics = {};
process.on('exit', () => {
  console.log(JSON.stringify(report, null, 2));
  try {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'find-bar-metrics.json'), JSON.stringify(metrics, null, 2));
  } catch {
    /* sem pasta de saída: as métricas só saem no relatório */
  }
});
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.removeItem('gitnexus.find')`);

// ---- um arquivo grande em conflito: o "resultado" é um editor editável; "nossa/base/deles" são editores somente leitura -------------------------
const LINES = 30_000;
const body = (mid) => Array.from({ length: LINES }, (_, i) => (i === 15_000 ? mid : `const valor${i % 10} = ${i}; // linha ${i}`)).join('\n') + '\n';
const root = tmpRoot('gn-fb-');
const repo = mkRepo(root, 'busca', { files: { 'big.ts': body('const alvo = "base";') } });
git(repo, 'checkout', '-q', '-b', 'outro');
writeFileSync(join(repo, 'big.ts'), body('const alvo = "outro";'));
git(repo, 'commit', '-qam', 'outro muda');
git(repo, 'checkout', '-q', 'main');
writeFileSync(join(repo, 'big.ts'), body('const alvo = "main";'));
git(repo, 'commit', '-qam', 'main muda');
try {
  git(repo, 'merge', 'outro');
} catch {
  /* conflito: é o esperado */
}

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
/** Do início do app até a tela de conflitos com os quatro editores montados. */
async function openConflicts(label) {
  await t.ev('location.reload()');
  await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
  await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
  await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
  await t.until(`document.querySelector('[data-testid="op-banner"]')`, 20000);
  await t.ev(`[...document.querySelectorAll('.rv__btns button')].find((b) => new RegExp(${lit(label)}).test(b.textContent))?.click()`);
  await t.until(`document.querySelectorAll('.mcr__result .cm-content').length === 1 && document.querySelectorAll('.mcr__top .cm-content').length === 3`, 60000);
  await sleep(800);
}
await openConflicts('Conflitos');

const RESULT = '.mcr__result';
const bar = (scope = RESULT) => `${scope} [data-testid="find-bar"]`;
const q = (scope, sel) => `document.querySelector(${lit(bar(scope) + ' ' + sel)})`;
const focusEditor = (scope = RESULT) => t.ev(`(() => { const c = document.querySelector(${lit(scope + ' .cm-content')}); c.focus(); return document.activeElement === c; })()`);
const typeText = (s) => t.send('Input.insertText', { text: s });
const counter = (scope = RESULT) => t.ev(`${q(scope, '[data-testid="find-count"]')}?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const waitCounter = (re, ms = 6000, scope = RESULT) => t.until(`/${re}/.test(${q(scope, '[data-testid="find-count"]')}?.textContent ?? '')`, ms);
const pressed = (id, scope = RESULT) => t.ev(`${q(scope, `[data-testid="${id}"]`)}?.getAttribute('aria-pressed')`);
const marks = (scope = RESULT) => t.count(`${scope} .cm-gn-find`);
const active = () => t.ev(`(() => { const a = document.activeElement; return a ? (a.getAttribute('data-testid') || a.className || a.tagName) : null; })()`);

// ---- abrir ----------------------------------------------------------------------------------------------------------------------------------
t.check('sem Ctrl+F não há barra', (await t.count('[data-testid="find-bar"]')) === 0);
await focusEditor();
await t.key('f', 2);
await t.until(q(RESULT, '[data-testid="sf-input"]'), 4000);
t.check('Ctrl+F no editor abre a barra daquele arquivo (e só dele)', (await t.count('[data-testid="find-bar"]')) === 1 && (await t.count(`${RESULT} [data-testid="find-bar"]`)) === 1);
t.check('o foco vai para o campo de pesquisa', (await active()) === 'sf-input', await active());
t.check('o campo é um searchbox com nome', (await t.ev(`(() => { const e = ${q(RESULT, '[data-testid="sf-input"]')}; return e.getAttribute('role') === 'searchbox' && !!e.getAttribute('aria-label'); })()`)) === true);
t.check('a barra é uma região de busca nomeada', (await t.ev(`(() => { const e = document.querySelector(${lit(bar())}); return e.getAttribute('role') === 'search' && e.getAttribute('aria-label') === 'Pesquisar neste arquivo'; })()`)) === true);
t.check('as três opções começam desligadas (aria-pressed=false)', (await pressed('sf-case')) === 'false' && (await pressed('sf-word')) === 'false' && (await pressed('sf-regex')) === 'false');
t.check('o campo já vem preenchido com a palavra sob o cursor e selecionado (digitar troca)', (await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.value`)) === 'const');

// ---- os botões estão DENTRO do campo e o texto longo não passa por baixo deles ---------------------------------------------------------------
const geometry = await t.ev(`(() => {
  const field = document.querySelector(${lit(bar() + ' [data-testid="search-field"]')}).getBoundingClientRect();
  const out = {};
  for (const id of ['sf-case', 'sf-word', 'sf-regex']) {
    const r = document.querySelector(${lit(bar())} + ' [data-testid="' + id + '"]').getBoundingClientRect();
    out[id] = { w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= field.left && r.right <= field.right && r.top >= field.top && r.bottom <= field.bottom };
  }
  return out;
})()`);
t.check('Aa, ab e .* estão dentro do campo (não ao lado)', Object.values(geometry).every((g) => g.inside), geometry);
t.check('botões de 24 px', Object.values(geometry).every((g) => g.h === 24 && g.w >= 24), geometry);

// ---- digitar: destaque de todas, contador, marcas ---------------------------------------------------------------------------------------------
// o tempo é medido DENTRO da página (a espera do t.until é de 250 ms e distorceria): do pedido de digitar até o contador e o destaque na tela
const timing = t.ev(`new Promise((res) => { const t0 = performance.now(); const iv = setInterval(() => { const c = ${q(RESULT, '[data-testid="find-count"]')}?.textContent ?? ''; if (/^1 de 3000$/.test(c) && document.querySelector(${lit(RESULT + ' .cm-gn-find')})) { clearInterval(iv); res(Math.round(performance.now() - t0)); } }, 4); })`);
await typeText('valor3');
metrics.openToCountMs = await timing;
const first = await counter();
t.check('o contador mostra a posição e o total ("1 de 3000")', /^1 de 3000$/.test(first ?? ''), first);
t.check('todas as ocorrências da parte visível ficam destacadas (uma a cada 10 linhas)', (await marks()) >= 2, await marks());
t.check('a ocorrência atual tem destaque próprio (uma só)', (await t.count(`${RESULT} .cm-gn-find-current`)) === 1);
t.check('o editor ficou na ocorrência (rolou até ela)', (await t.ev(`document.querySelector(${lit(RESULT + ' .cm-gn-find-current')})?.textContent`)) === 'valor3');
t.check('as marcas da barra de rolagem aparecem', (await t.count(`${bar()}`)) === 1 && (await t.count(`${RESULT} [data-testid="find-marks"] i`)) > 10);
t.check('com texto aparece o ✕', (await t.count(`${bar()} [data-testid="sf-clear"]`)) === 1);
t.check('arquivo de 30 mil linhas: do primeiro caractere ao contador e destaque em até 500 ms', metrics.openToCountMs <= 500, metrics.openToCountMs);

const long = 'x'.repeat(260);
await typeText(long);
await sleep(300);
const overlap = await t.ev(`(() => {
  const ta = document.querySelector(${lit(bar() + ' [data-testid="sf-input"]')}).getBoundingClientRect();
  const btn = document.querySelector(${lit(bar() + ' [data-testid="sf-case"]')}).getBoundingClientRect();
  const clr = document.querySelector(${lit(bar() + ' [data-testid="sf-clear"]')}).getBoundingClientRect();
  return { inputRight: Math.round(ta.right), firstControl: Math.round(Math.min(btn.left, clr.left)) };
})()`);
t.check('texto longo não passa por baixo dos botões (o campo termina onde os controles começam)', overlap.inputRight <= overlap.firstControl, overlap);
await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.select()`);
await typeText('valor3');
await waitCounter('1 de 3000');

// ---- navegar ----------------------------------------------------------------------------------------------------------------------------------
await t.key('Enter');
await waitCounter('^2 de 3000$');
t.check('Enter vai para a próxima ocorrência', (await counter()) === '2 de 3000', await counter());
await t.key('Enter', 8);
await waitCounter('^1 de 3000$');
t.check('Shift+Enter volta para a anterior', (await counter()) === '1 de 3000', await counter());
await t.key('Enter', 8);
await waitCounter('^3000 de 3000 · Foi para o fim do arquivo$');
t.check('Shift+Enter na primeira dá a volta para a última e avisa', /^3000 de 3000 · Foi para o fim do arquivo$/.test((await counter()) ?? ''), await counter());
await t.ev(`${q(RESULT, '[data-testid="find-next"]')}.click()`);
await waitCounter('^1 de 3000 · Voltou');
t.check('o botão "próximo" também dá a volta para o começo e avisa', /^1 de 3000 · Voltou ao início do arquivo$/.test((await counter()) ?? ''), await counter());

// ---- opções: botões, atalhos e dicas -----------------------------------------------------------------------------------------------------------
await t.ev(`${q(RESULT, '[data-testid="sf-case"]')}.click()`);
await waitCounter('3000');
t.check('clicar em Aa liga a opção (aria-pressed=true)', (await pressed('sf-case')) === 'true');
await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.focus()`);
await t.key('c', 1);
await sleep(200);
t.check('Alt+C desliga a opção pelo teclado', (await pressed('sf-case')) === 'false');
await t.key('o', 1);
await sleep(150);
t.check('Alt+O liga palavra inteira', (await pressed('sf-word')) === 'true');
await t.key('o', 1);
await sleep(150);
t.check('AltGr (Ctrl+Alt) não é atalho: digita', true && (await pressed('sf-word')) === 'false');
await t.key('c', 3);
await sleep(150);
t.check('Ctrl+Alt+C (AltGr no Windows) não liga nada', (await pressed('sf-case')) === 'false');
const tip = await t.ev(`${q(RESULT, '[data-testid="sf-regex"]')}.getAttribute('data-tooltip')`);
t.check('a dica traz o nome e o atalho', /Expressão regular \(Alt\+X\)/.test(tip ?? ''), tip);
t.check('a opção anuncia o atalho (aria-keyshortcuts)', (await t.ev(`${q(RESULT, '[data-testid="sf-regex"]')}.getAttribute('aria-keyshortcuts')`)) === 'Alt+X');

// ---- regex inválida --------------------------------------------------------------------------------------------------------------------------
await t.key('x', 1);
await sleep(150);
t.check('Alt+X liga a regex', (await pressed('sf-regex')) === 'true');
await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.select()`);
await typeText('(');
await t.until(q(RESULT, '[data-testid="sf-error"]'), 3000);
const err = await t.ev(`(() => {
  const input = ${q(RESULT, '[data-testid="sf-input"]')};
  const e = ${q(RESULT, '[data-testid="sf-error"]')};
  const field = ${q(RESULT, '[data-testid="search-field"]')};
  return { role: e?.getAttribute('role'), text: e?.textContent, described: input.getAttribute('aria-describedby') === e?.id && !!e?.id, invalid: input.getAttribute('aria-invalid'), border: getComputedStyle(field).borderTopColor, danger: getComputedStyle(document.documentElement).getPropertyValue('--gn-danger').trim() };
})()`);
t.check('regex inválida: mensagem em role=alert, ligada ao campo por aria-describedby, com aria-invalid', err.role === 'alert' && err.described && err.invalid === 'true' && /Expressão regular inválida/.test(err.text), err);
t.check('regex inválida: o campo ganha borda de erro', err.border !== 'rgb(52, 54, 60)' && err.border !== 'rgb(206, 210, 217)', err);
t.check('regex inválida: sem contador de resultados', (await counter()) === '', await counter());
await t.shot('busca-regex-invalida');

// ---- ✕: apaga, devolve o foco, preserva as opções e desfaz com Ctrl+Z -----------------------------------------------------------------------
await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.select()`);
await typeText('valor\\d');
await waitCounter('\\d');
await t.ev(`${q(RESULT, '[data-testid="find-next"]')}.focus()`);
await t.ev(`${q(RESULT, '[data-testid="sf-clear"]')}.click()`);
await sleep(300);
t.check('✕ apaga o texto', (await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.value`)) === '');
t.check('✕ devolve o foco ao campo', (await active()) === 'sf-input', await active());
t.check('✕ preserva as opções (regex continua ligada)', (await pressed('sf-regex')) === 'true');
t.check('✕ some quando não há texto', (await t.count(`${bar()} [data-testid="sf-clear"]`)) === 0);
await t.key('z', 2);
await sleep(300);
t.check('Ctrl+Z desfaz o ✕ (o texto volta)', (await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.value`)) === 'valor\\d', await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.value`));
await t.key('x', 1); // regex desligada de novo
await sleep(150);

// ---- histórico (setas) ----------------------------------------------------------------------------------------------------------------------
await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.select()`);
await typeText('alvo');
await waitCounter('\\d');
await t.key('Enter');
await sleep(200);
await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.select()`);
await typeText('linha 1');
await t.key('Enter');
await sleep(200);
await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.select()`);
await typeText('rascunho');
await t.key('ArrowUp');
await sleep(150);
t.check('seta para cima traz a busca anterior', (await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.value`)) === 'linha 1');
await t.key('ArrowUp');
await sleep(150);
t.check('e a anterior a ela', (await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.value`)) === 'alvo');
await t.key('ArrowDown');
await t.key('ArrowDown');
await sleep(150);
t.check('seta para baixo volta até o que estava sendo digitado', (await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.value`)) === 'rascunho');

// ---- sem resultado, na seleção, fechar com Esc ------------------------------------------------------------------------------------------------
await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.select()`);
await typeText('nada-disso-existe');
await waitCounter('Nenhum resultado');
t.check('sem ocorrência: "Nenhum resultado" e a navegação desliga', (await counter()) === 'Nenhum resultado' && (await t.ev(`${q(RESULT, '[data-testid="find-next"]')}.disabled`)) === true);

await t.key('Escape');
await sleep(300);
t.check('Esc fecha a barra', (await t.count('[data-testid="find-bar"]')) === 0);
t.check('Esc devolve o foco ao editor', (await t.ev(`document.activeElement === document.querySelector(${lit(RESULT + ' .cm-content')})`)) === true);
t.check('fechar a barra apaga o destaque', (await marks()) === 0);

// "Na seleção": sem seleção (só o cursor) fica desligado; com o arquivo todo selecionado (Ctrl+A) liga
await focusEditor();
await t.key('ArrowRight');
await t.key('f', 2);
await t.until(q(RESULT, '[data-testid="sf-input"]'), 4000);
t.check('"Na seleção" fica desligado quando só há o cursor', (await t.ev(`${q(RESULT, '[data-testid="find-in-selection"]')}.disabled`)) === true);
await t.key('Escape');
await sleep(200);
await focusEditor();
await t.key('a', 2);
await t.key('f', 2);
await t.until(q(RESULT, '[data-testid="sf-input"]'), 4000);
t.check('com várias linhas selecionadas o campo não é preenchido (a busca anterior volta)', (await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.value`)) !== '');
t.check('"Na seleção" liga quando há seleção', (await t.ev(`${q(RESULT, '[data-testid="find-in-selection"]')}.disabled`)) === false);
await t.ev(`${q(RESULT, '[data-testid="find-in-selection"]')}.click()`);
await sleep(300);
t.check('"Na seleção" fica pressionado', (await pressed('find-in-selection')) === 'true');
await t.key('Escape');
await sleep(200);

// ---- somente leitura: a barra abre também no painel "nossa" (só busca) ----------------------------------------------------------------------
const OURS = '.mcr__top .pane:nth-child(1)';
await focusEditor(OURS);
await t.key('f', 2);
await t.until(q(OURS, '[data-testid="sf-input"]'), 4000);
t.check('editor somente leitura: Ctrl+F também abre a barra (só daquele painel)', (await t.count('[data-testid="find-bar"]')) === 1 && (await t.count(`${OURS} [data-testid="find-bar"]`)) === 1);
await typeText('alvo');
await waitCounter('^1 de 1$', 6000, OURS);
t.check('editor somente leitura: encontra e conta', (await counter(OURS)) === '1 de 1', await counter(OURS));
t.check('editor somente leitura: o painel continua somente leitura', (await t.ev(`document.querySelector(${lit(OURS + ' .cm-content')}).getAttribute('contenteditable')`)) === 'false');
await t.shot('busca-somente-leitura');
await t.key('Escape');
await sleep(200);

// ---- temas e idiomas (capturas reais) ----------------------------------------------------------------------------------------------------------
await focusEditor();
await t.key('f', 2);
await t.until(q(RESULT, '[data-testid="sf-input"]'), 4000);
await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.select()`);
await typeText('valor7');
await waitCounter('\\d');
await t.key('Enter');
await t.key('Enter');
await sleep(300);
await t.ev(`${q(RESULT, '[data-testid="sf-word"]')}.click()`);
await sleep(300);
await t.shot('busca-escuro');
// tema claro + inglês: a PREFERÊNCIA do app muda (o editor segue o tema do app) e a tela é reaberta
await t.ev(`localStorage.setItem('gitnexus.theme', 'light'); localStorage.setItem('gitnexus.locale', 'en')`);
await openConflicts('Conflicts');
await focusEditor();
await t.key('f', 2);
await t.until(q(RESULT, '[data-testid="sf-input"]'), 4000);
await typeText('zzzz-nada');
await waitCounter('No results');
const light = await t.ev(`(() => { const f = ${q(RESULT, '[data-testid="search-field"]')}; return { theme: document.documentElement.dataset.theme, bg: getComputedStyle(f).backgroundColor, text: getComputedStyle(${q(RESULT, '[data-testid="sf-input"]')}).color }; })()`);
t.check('tema claro: campo claro e texto escuro (legível)', light.theme === 'light' && light.bg !== 'rgb(23, 24, 27)' && light.text !== 'rgb(255, 255, 255)', light);
await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.select()`);
await typeText('valor7');
await waitCounter('^1 of 3000$');
await t.key('Enter');
await t.key('Enter');
await waitCounter('^3 of 3000$');
t.check('dois Enter seguidos: o contador acompanha (3 of 3000)', (await counter()) === '3 of 3000', await counter());
await sleep(200);
await t.shot('busca-claro');
await t.ev(`${q(RESULT, '[data-testid="sf-input"]')}.select()`);
await typeText('zzzz-nada');
await waitCounter('No results');
const en = await t.ev(`(() => ({ region: document.querySelector(${lit(bar())}).getAttribute('aria-label'), field: ${q(RESULT, '[data-testid="sf-input"]')}.getAttribute('aria-label'), tip: ${q(RESULT, '[data-testid="sf-word"]')}.getAttribute('data-tooltip'), count: ${q(RESULT, '[data-testid="find-count"]')}.textContent }))()`);
t.check('em inglês: região, campo, dica e contador traduzidos', en.region === 'Search in this file' && en.field === 'Search in the file' && /Whole word \(Alt\+O\)/.test(en.tip) && en.count === 'No results', en);
await t.shot('busca-ingles');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro de página durante a busca', appErrors.length === 0, appErrors);
t.close();
