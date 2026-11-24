// Pesquisar no repositório (issue #233, fase 7), com git de verdade: acessibilidade e fluxo SÓ com o teclado, com teclas de verdade.
// Diálogo modal nomeado, foco preso (Tab e Shift+Tab não saem) e devolvido ao fechar, campo `searchbox`, lista `listbox` com `aria-activedescendant`
// apontando para uma opção existente e marcada, região viva com o total, todo controle com nome acessível, nada só por cor, contador "3 de 12" da barra
// do arquivo anunciado, e o ciclo pesquisar → escolher → editar → salvar → fechar sem tocar no mouse. No fim: tema claro e inglês.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.removeItem('gitnexus.searchWindow')`);
await t.ev(`localStorage.removeItem('gitnexus.searchHistory')`);

const root = tmpRoot('gn-swk-');
const repo = mkRepo(root, 'tecladorepo', { files: { 'a.txt': 'um\n' } });
const put = (f, data) => writeFileSync(join(repo, f), data);
put('um.ts', 'const alvo = 1;\nconst alvo2 = alvo + 1;\n');
put('dois.ts', 'export const alvo = "x"; // alvo alvo\n');
put('tres.txt', 'alvo no texto alvo\nsem nada\nalvo de novo\n');
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'feat: base');
const raw = (f) => readFileSync(join(repo, f), 'utf8');

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'tecladorepo')`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'tecladorepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);

const W = '[data-testid="search-window"]';
const F = `${W} [data-testid="sf-input"]`;
const EDITOR = `${W} .cm-content`;
const q = (js) => t.ev(`(() => { ${js} })()`);
const count = () => t.ev(`document.querySelector('[data-testid="sw-count"]')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
const waitCount = (re, ms = 15000) => t.until(`new RegExp(${lit(re)}).test(document.querySelector('[data-testid="sw-count"]')?.textContent ?? '')`, ms);
const active = () => q(`const a = document.activeElement; return a ? (a.dataset.testid || a.getAttribute('aria-label') || a.className || a.tagName) : null`);
/** O foco está dentro do diálogo (e não no fundo, nem no body)? */
const focusInside = () => q(`const a = document.activeElement; return !!a && !!a.closest('[role="dialog"]')`);
/** Digita com o teclado de verdade (nada de definir `value`): cada caractere vira um evento de teclado + texto. */
const typeKeys = async (text) => {
  for (const ch of text) {
    await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
    await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  }
  await sleep(150);
};

// ---- abrir por Ctrl+F; o foco volta para onde estava ao fechar -----------------------------------------------------------------------------------
await q(`const b = document.querySelector('.rv__btns button'); b.focus(); window.__opener = b.textContent.trim(); return true`);
await t.key('f', 2);
t.check('Ctrl+F abre a janela de pesquisa', !!(await t.until(`document.querySelector(${lit(W)})`, 8000)));
await sleep(300);
// fechar logo de cara devolve o foco ao botão que o tinha (depois de salvar a tela de trás se recarrega e o botão antigo deixa de existir)
await t.key('Escape');
await sleep(500);
t.check('Esc fecha a janela e o foco volta para o controle que tinha antes de abrir', (await t.count(W)) === 0 && (await q(`return document.activeElement?.textContent.trim() === window.__opener`)) === true, await q(`return document.activeElement?.textContent.trim().slice(0, 40) + ' / ' + window.__opener`));
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 8000);
await sleep(300);
const dlg = await q(`const d = document.querySelector('[role="dialog"]'); return { role: d?.getAttribute('role'), modal: d?.getAttribute('aria-modal'), name: d?.getAttribute('aria-label') }`);
t.check('é um diálogo modal com nome (role=dialog, aria-modal=true, aria-label)', dlg.role === 'dialog' && dlg.modal === 'true' && dlg.name === 'Pesquisar no repositório', dlg);
t.check('o foco já está no campo de pesquisa', (await active()) === 'sf-input', await active());
const field = await q(`const f = document.querySelector(${lit(F)}); return { role: f.getAttribute('role'), name: f.getAttribute('aria-label'), invalid: f.getAttribute('aria-invalid') }`);
t.check('o campo é um searchbox com nome acessível', field.role === 'searchbox' && !!field.name && field.invalid === null, field);

// ---- digitar com o teclado e ouvir o resultado ---------------------------------------------------------------------------------------------------------
await typeKeys('alvo');
await waitCount('^\\d+ ocorrências? em \\d+ arquivos?');
const live = await q(`const c = document.querySelector('[data-testid="sw-count"]'); return { role: c.getAttribute('role'), live: c.getAttribute('aria-live'), text: c.textContent.replace(/\\s+/g, ' ').trim() }`);
t.check('o total é anunciado por uma região viva educada ("5 ocorrências em 3 arquivos")', live.role === 'status' && live.live === 'polite' && /^5 ocorrências em 3 arquivos/.test(live.text), live);
const sw = await q(`
  const out = {};
  for (const [k, id] of [['field', 'sf-input'], ['count', 'sw-count']]) out[k] = !!document.querySelector('[data-testid="' + id + '"]');
  const list = document.querySelector('[data-testid="sw-list"]');
  out.list = { role: list.getAttribute('role'), name: list.getAttribute('aria-label'), tab: list.tabIndex };
  out.opts = [...list.querySelectorAll('[role="option"]')].length;
  out.unnamed = [...list.querySelectorAll('[role="option"]')].filter((o) => !(o.getAttribute('aria-label') || '').trim()).length;
  return out;`);
t.check('a lista é um listbox nomeado, alcançável por Tab, e cada opção tem nome (arquivo, linha e texto)', sw.list.role === 'listbox' && !!sw.list.name && sw.list.tab >= 0 && sw.opts > 0 && sw.unnamed === 0, sw);

// ---- andar pelos resultados só com as setas (o foco fica no campo; a lista aponta a opção ativa) ------------------------------------------------
const act = () => q(`const l = document.querySelector('[data-testid="sw-list"]'); const id = l.getAttribute('aria-activedescendant'); const o = id ? document.getElementById(id) : null; return { id, exists: !!o, role: o?.getAttribute('role'), sel: o?.getAttribute('aria-selected'), label: o?.getAttribute('aria-label') ?? '' }`);
await t.key('ArrowDown');
await sleep(400);
const a1 = await act();
t.check('↓ no campo seleciona uma ocorrência: aria-activedescendant aponta uma opção que existe, está selecionada e tem nome', a1.exists && a1.role === 'option' && a1.sel === 'true' && /\d/.test(a1.label), a1);
t.check('o foco continua no campo de pesquisa (quem digita não perde o lugar)', (await active()) === 'sf-input', await active());
await t.key('ArrowDown');
await sleep(300);
const a2 = await act();
t.check('↓ de novo anda para outra opção', a2.exists && a2.id !== a1.id, { a1: a1.id, a2: a2.id });
await t.key('ArrowUp');
await sleep(300);
t.check('↑ volta', (await act()).id === a1.id, await act());
t.check('a opção selecionada abre o arquivo embaixo, com o caminho e o editor', !!(await t.until(`document.querySelector(${lit(EDITOR)}) && document.querySelector('[data-testid="sw-path"]')?.textContent.trim()`, 8000)));

// ---- nada só por cor ------------------------------------------------------------------------------------------------------------------------------------------
const cue = await q(`
  const sel = document.querySelector('.sw__row--sel');
  const s = sel ? getComputedStyle(sel) : null;
  const plain = [...document.querySelectorAll('.sw__row')].find((r) => !r.classList.contains('sw__row--sel') && !r.classList.contains('sw__row--file'));
  const p = plain ? getComputedStyle(plain) : null;
  const mark = document.querySelector('.sw__row mark, .sw__text mark');
  const m = mark ? getComputedStyle(mark) : null;
  return {
    selOutline: s ? s.outlineStyle !== 'none' || s.boxShadow !== 'none' || s.borderLeftWidth !== '0px' : null,
    selWeight: s ? s.fontWeight : null,
    markUnderline: m ? m.textDecorationLine.includes('underline') || m.borderBottomStyle !== 'none' || m.boxShadow !== 'none' : null,
    markBg: m ? m.backgroundColor : null,
    fileHeadsAreNotColorOnly: !![...document.querySelectorAll('[data-testid="sw-file-row"]')].length,
  };`);
t.check('a linha selecionada se distingue por mais do que o tom (contorno, sombra ou barra)', cue.selOutline === true || cue.selWeight >= 600, cue);
t.check('o trecho achado tem fundo e/ou sublinhado, não só a cor do texto', cue.markUnderline === true || (cue.markBg && cue.markBg !== 'rgba(0, 0, 0, 0)'), cue);
const flags = await q(`
  const on = [...document.querySelectorAll('${W} .gn-sf__btn[aria-pressed]')];
  return on.map((b) => ({ name: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), keys: b.getAttribute('aria-keyshortcuts') }));`);
t.check('os botões Aa, ab e .* têm nome, aria-pressed e atalho', flags.length === 3 && flags.every((b) => !!b.name && (b.pressed === 'true' || b.pressed === 'false') && !!b.keys), flags);

// ---- todo controle tem nome acessível -------------------------------------------------------------------------------------------------------------------------
const unnamed = await q(`
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.innerText || el.textContent || el.getAttribute('title') || (el.labels?.[0]?.innerText ?? '')).trim();
  const bad = [];
  for (const el of document.querySelectorAll('[role="dialog"] button, [role="dialog"] input, [role="dialog"] textarea, [role="dialog"] [role="searchbox"], [role="dialog"] [role="listbox"]')) {
    if (el.closest('.cm-editor') && !el.matches('button, input')) continue; // o conteúdo do CodeMirror é nomeado pelo editor
    if (el.getClientRects().length === 0) continue;
    if (!name(el)) bad.push((el.dataset.testid || el.className || el.tagName) + '');
  }
  return bad;`);
t.check('todo botão, campo e lista visível dentro da janela tem nome acessível', unnamed.length === 0, unnamed);

// ---- foco preso: Tab e Shift+Tab nunca saem do diálogo -----------------------------------------------------------------------------------------------------
await q(`document.querySelector(${lit(F)}).focus(); return true`);
let outside = 0;
const seen = new Set();
for (let i = 0; i < 40; i++) {
  await t.key('Tab');
  if (!(await focusInside())) outside++;
  seen.add(await active());
}
t.check('40 Tab seguidos: o foco nunca sai do diálogo (nem para a tela de trás)', outside === 0, { outside });
t.check('o Tab passa por vários controles (campo, histórico, máscara, filtros, lista, editor…)', seen.size >= 6, [...seen]);
outside = 0;
for (let i = 0; i < 12; i++) {
  await t.key('Tab', 8);
  if (!(await focusInside())) outside++;
}
t.check('Shift+Tab também fica dentro', outside === 0, { outside });
t.check('a tela de trás não é alcançável: os controles de fora ficam inertes ou fora da ordem de foco (aria-modal)', (await q(`return document.querySelector('[role="dialog"]').getAttribute('aria-modal')`)) === 'true');

// ---- editar e salvar só com o teclado --------------------------------------------------------------------------------------------------------------------------
await q(`document.querySelector(${lit(F)}).focus(); return true`);
await t.key('ArrowDown'); // próxima ocorrência
await sleep(300);
await t.key('Enter'); // leva o foco ao editor, com a ocorrência selecionada
await sleep(500);
t.check('Enter leva o foco para o editor do arquivo', (await q(`return !!document.activeElement.closest('.cm-editor')`)) === true, await active());
await t.send('Input.insertText', { text: 'trocado' });
await sleep(300);
t.check('o arquivo fica "alterado" e o anúncio de estado existe', (await t.count('[data-testid="sw-dirty"]')) === 1);
await t.key('s', 2);
await t.until(`/Salvo/.test(document.querySelector('[data-testid="sw-notice"]')?.textContent ?? '')`, 8000);
t.check('Ctrl+S grava no disco (o fluxo pesquisar → escolher → editar → salvar não pediu mouse)', /trocado/.test(['um.ts', 'dois.ts', 'tres.txt'].map(raw).join('')), ['um.ts', 'dois.ts', 'tres.txt'].map(raw));
const notice = await q(`const n = document.querySelector('[data-testid="sw-notice"]'); return { role: n?.getAttribute('role'), text: n?.textContent.trim() }`);
t.check('o aviso "Salvo." é anunciado (role status ou alert)', notice.role === 'status' || notice.role === 'alert', notice);

// ---- a barra do arquivo: Ctrl+F no editor, contador "N de M" anunciado, F3 anda ---------------------------------------------------------------------
await q(`document.querySelector(${lit(EDITOR)}).focus(); return true`);
await t.key('f', 2);
t.check('Ctrl+F dentro do editor abre a barra daquele arquivo (role=search)', !!(await t.until(`document.querySelector('${W} [data-testid="find-bar"][role="search"]')`, 5000)));
await t.send('Input.insertText', { text: 'alvo' });
await t.until(`document.querySelector('[data-testid="find-count"]')?.textContent.trim()`, 5000);
const fc = await q(`const c = document.querySelector('[data-testid="find-count"]'); return { role: c.getAttribute('role'), live: c.getAttribute('aria-live'), text: c.textContent.replace(/\\s+/g, ' ').trim() }`);
t.check('o contador da barra é uma região viva e diz "N ocorrências" ou "i de N"', fc.role === 'status' && fc.live === 'polite' && /\d/.test(fc.text), fc);
await t.key('Enter');
await sleep(300);
const c1 = await t.text('[data-testid="find-count"]');
await t.key('Enter');
await sleep(300);
const c2 = await t.text('[data-testid="find-count"]');
t.check('Enter anda e o contador anuncia a posição ("1 de 2" → "2 de 2")', /^\d+ de \d+/.test(c1 ?? '') && /^\d+ de \d+/.test(c2 ?? '') && c1 !== c2, { c1, c2 });
await t.key('Escape');
await sleep(300);
t.check('Esc fecha só a barra do arquivo (a janela continua) e o foco volta ao editor', (await t.count('[data-testid="find-bar"]')) === 0 && (await t.count(W)) === 1 && (await q(`return !!document.activeElement.closest('.cm-editor')`)) === true);

// ---- opções e histórico só com o teclado -------------------------------------------------------------------------------------------------------------------
await q(`document.querySelector(${lit(F)}).focus(); return true`);
await t.key('c', 1); // Alt+C = diferenciar maiúsculas (atalho do GnSearchField)
await sleep(300);
const pressed = await q(`return [...document.querySelectorAll('${W} .gn-sf__btn[aria-pressed]')].map((b) => b.getAttribute('aria-pressed'))`);
t.check('Alt+C liga "diferenciar maiúsculas" (aria-pressed muda) sem mouse', pressed[0] === 'true', pressed);
await t.key('c', 1);
await sleep(200);
await t.key('ArrowDown', 1); // Alt+↓ abre o histórico
await sleep(300);
t.check('Alt+↓ abre o histórico de pesquisas, que é um listbox nomeado', (await q(`const l = document.querySelector('#sw-past-list'); return l?.getAttribute('role') === 'listbox' && !!l.getAttribute('aria-label')`)) === true);
t.check('o botão do histórico anuncia que está expandido (aria-expanded=true)', (await q(`return document.querySelector('[data-testid="sw-past-toggle"]').getAttribute('aria-expanded')`)) === 'true');
await t.key('Escape');
await sleep(300);
t.check('o primeiro Esc fecha só o histórico', (await t.count('[data-testid="sw-past"]')) === 0 && (await t.count(W)) === 1);

// ---- fechar por Esc devolve o foco -----------------------------------------------------------------------------------------------------------------------------
await q(`document.querySelector(${lit(F)}).focus(); return true`);
await t.key('Escape');
await sleep(500);
t.check('Esc fecha a janela', (await t.count(W)) === 0);

// ---- tema claro e inglês: os nomes acessíveis também são traduzidos -----------------------------------------------------------------------------------------
await t.ev(`localStorage.setItem('gitnexus.locale', 'en'); localStorage.setItem('gitnexus.theme', 'light')`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/loading|carregando/i.test(r.textContent))`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'tecladorepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(600);
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 8000);
await q(`document.querySelector(${lit(F)}).focus(); return true`);
await typeKeys('alvo');
await waitCount('^\\d+ occurrences? in \\d+ files?');
const en = await q(`const d = document.querySelector('[role="dialog"]'); return { dialog: d.getAttribute('aria-label'), count: document.querySelector('[data-testid="sw-count"]').textContent.replace(/\\s+/g, ' ').trim(), list: document.querySelector('[data-testid="sw-list"]').getAttribute('aria-label'), field: document.querySelector(${lit(F)}).getAttribute('aria-label'), buttons: [...document.querySelectorAll('${W} .gn-sf__btn')].map((b) => b.getAttribute('aria-label')) }`);
t.check('em inglês: diálogo, campo, lista e botões ganham nomes em inglês, sem sobra de português', !/[ãçõé]|Pesquis|Limpar|maiúsc|ocorr/i.test(JSON.stringify(en)), en);
await t.key('ArrowDown');
await sleep(500);
t.check('o tema claro está aplicado', (await q(`return document.documentElement.dataset.theme`)) === 'light');
// a captura vai para a documentação: o caminho do repositório (que mostra a pasta do usuário) não aparece nela
await t.ev(`(() => { const s = document.createElement('style'); s.textContent = '.rv__path { visibility: hidden !important; }'; document.head.appendChild(s); })()`);
await t.shot('pesquisa-teclado-claro-en');
await t.key('Escape');
await sleep(300);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
