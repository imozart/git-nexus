// Editar com segurança na janela de pesquisa (Ctrl+F): editar o arquivo de baixo e salvar (Ctrl+S) mantendo codificação e fim de linha, caractere que a
// codificação não tem (nada é gravado e a janela diz por quê), arquivo que mudou por fora (recarrega sozinho se está limpo; com alterações pergunta:
// recarregar / sobrescrever / ficar), alterações não salvas (Salvar / Descartar / Ficar ao trocar de arquivo e ao fechar), só leitura (fim de linha misto
// e arquivo grande), divisória arrastável e lembrada, e a lista que se reajusta depois de salvar. Git de verdade; os arquivos são conferidos no disco.
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

const root = tmpRoot('gn-sw-');
const repo = mkRepo(root, 'editrepo', { files: { 'a.txt': 'um\n' } });
const put = (f, data) => writeFileSync(join(repo, f), data);
put('app.ts', 'const foo = 1;\nconst bar = 2;\n');
put('win.txt', 'linha foo um\r\nlinha dois\r\nlinha foo três\r\n');
put('latin.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x66, 0x6f, 0x6f, 0x0a, 0x66, 0x69, 0x6d, 0x0a])); // "café foo\nfim\n" em windows-1252
put('mixed.txt', 'misto foo\r\noutra\nterceira\r\n');
put('ext.txt', 'alvo um\nalvo dois\n');
put('other.txt', 'alvo outro\n');
put('grande.txt', 'foo no começo\n' + 'x'.repeat(80) + '\n'.repeat(1) + ('preenchimento de linha comprida para passar de dois megabytes\n').repeat(34000));
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'feat: base');
const raw = (f) => readFileSync(join(repo, f));

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'editrepo')`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'editrepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);

const W = '[data-testid="search-window"]';
const F = `${W} [data-testid="sf-input"]`;
const EDITOR = `${W} .cm-content`;
const typeInto = async (sel, text) => {
  await t.ev(`(() => { const e = document.querySelector(${lit(sel)}); e.focus(); e.select(); })()`);
  await t.send('Input.insertText', { text });
  await sleep(120);
};
const count = () => t.ev(`document.querySelector('[data-testid="sw-count"]')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
const waitCount = (re, ms = 15000) => t.until(`new RegExp(${lit(re)}).test(document.querySelector('[data-testid="sw-count"]')?.textContent ?? '')`, ms);
const path = () => t.text('[data-testid="sw-path"]');
const doc = () => t.ev(`document.querySelector(${lit(EDITOR)})?.innerText ?? null`);
const dirty = () => t.count('[data-testid="sw-dirty"]');
const hitOf = (file) => t.ev(`(() => { const rows = [...document.querySelectorAll('[data-testid="sw-file-row"], [data-testid="sw-row"]')]; let on = false; for (const r of rows) { if (r.dataset.testid === 'sw-file-row') on = r.textContent.includes(${lit(file)}); else if (on) return r.id; } return null; })()`);
const openFile = async (file) => {
  let id = null;
  for (let i = 0; i < 40 && !id; i++) {
    id = await hitOf(file);
    if (!id) await sleep(250);
  }
  if (!id) {
    // diagnóstico: o que a lista mostrava quando a linha não apareceu
    const seen = await t.ev(`(() => { const l = document.querySelector('[data-testid="sw-list"]'); return { count: document.querySelector('[data-testid="sw-count"]')?.textContent.trim(), list: l ? { top: l.scrollTop, h: l.clientHeight, sh: l.scrollHeight } : null, rows: [...document.querySelectorAll('[data-testid="sw-file-row"], [data-testid="sw-row"]')].map((r) => r.dataset.testid + '#' + r.id + ' ' + r.textContent.trim().slice(0, 60)) }; })()`);
    throw new Error(`sem linha para ${file}: ${JSON.stringify(seen)}`);
  }
  await t.ev(`document.getElementById(${lit(id)}).click()`);
  await t.until(`document.querySelector('[data-testid="sw-path"]')?.textContent.trim() === ${lit(file)} && document.querySelector(${lit(EDITOR)})`, 10000);
  await sleep(250);
};
const focusEditor = () => t.ev(`document.querySelector(${lit(EDITOR)}).focus()`);
// Enter no campo leva o foco ao editor COM a ocorrência selecionada (como a pessoa faz). `.focus()` direto no conteúdo, no Chrome do Linux, volta o cursor ao começo e perde a seleção.
const focusEditorOnMatch = async () => {
  await t.ev(`document.querySelector(${lit(F)}).focus()`);
  await t.key('Enter');
  await sleep(350);
};
const notice = () => t.text('[data-testid="sw-notice"]');

// ---- abrir a janela e pesquisar "foo" ------------------------------------------------------------------------------------------------------------
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 5000);
await typeInto(F, 'foo');
await waitCount('^6 ocorrências em 5 arquivos');
t.check('"foo" aparece em 5 arquivos', /^6 ocorrências em 5 arquivos/.test(await count()), await count());

// ---- editar e salvar um arquivo UTF-8/LF -------------------------------------------------------------------------------------------------------------
await openFile('app.ts');
t.check('abre editável, sem "alterado", com Salvar desligado', (await dirty()) === 0 && (await t.ev(`document.querySelector('[data-testid="sw-save"]').disabled`)) === true);
await focusEditorOnMatch();
await t.send('Input.insertText', { text: 'baz' }); // troca o "foo" selecionado
await sleep(250);
t.check('editar marca "alterado" e liga Salvar', (await dirty()) === 1 && (await t.ev(`document.querySelector('[data-testid="sw-save"]').disabled`)) === false);
t.check('a edição ainda NÃO foi para o disco', raw('app.ts').toString() === 'const foo = 1;\nconst bar = 2;\n');
await t.key('s', 2);
await t.until(`/Salvo/.test(document.querySelector('[data-testid="sw-notice"]')?.textContent ?? '')`, 8000);
t.check('Ctrl+S grava o arquivo (atômico, sem sobras) e diz "Salvo."', raw('app.ts').toString() === 'const baz = 1;\nconst bar = 2;\n' && (await dirty()) === 0, raw('app.ts').toString());
await waitCount('^5 ocorrências em 4 arquivos');
t.check('a lista se reajusta ao que ficou no disco (app.ts não tem mais "foo")', /^5 ocorrências em 4 arquivos/.test(await count()), await count());
// a tela do repositório (que fica por baixo da janela, dentro de #app) recarrega depois de salvar: o arquivo alterado aparece na lista de alterações dela
t.check('depois de salvar, a tela do repositório recarrega (app.ts aparece nas alterações)', !!(await t.until(`document.getElementById('app').innerText.includes('app.ts')`, 10000)));
await t.shot('janela-editar-salvo');

// ---- CRLF preservado -------------------------------------------------------------------------------------------------------------------------------------
await openFile('win.txt');
t.check('mostra CRLF e UTF-8', (await t.text('[data-testid="sw-eol"]')) === 'CRLF' && /UTF-8/.test((await t.text('[data-testid="sw-encoding"]')) ?? ''));
await focusEditorOnMatch();
await t.send('Input.insertText', { text: 'TROCADO' });
await sleep(200);
await t.key('s', 2);
await t.until(`/Salvo/.test(document.querySelector('[data-testid="sw-notice"]')?.textContent ?? '')`, 8000);
const win = raw('win.txt').toString('utf8');
t.check('salvar mantém CRLF em TODAS as linhas (nenhum LF solto)', win === 'linha TROCADO um\r\nlinha dois\r\nlinha foo três\r\n', JSON.stringify(win));
await waitCount('^4 ocorrências em 4 arquivos');

// ---- codificação preservada e caractere que ela não tem ----------------------------------------------------------------------------------------------
await openFile('latin.txt');
t.check('detecta uma codificação de byte único (não UTF-8)', !/UTF-8/.test((await t.text('[data-testid="sw-encoding"]')) ?? '') && /\w/.test((await t.text('[data-testid="sw-encoding"]')) ?? ''), await t.text('[data-testid="sw-encoding"]'));
t.check('lê o "é" certo', /café foo/.test((await doc()) ?? ''), await doc());
await focusEditor();
await t.send('Input.insertText', { text: '😀' });
await sleep(200);
await t.key('s', 2);
await t.until(`document.querySelector('[data-testid="sw-notice"]')`, 8000);
t.check('emoji que a codificação não tem: NADA é gravado e a janela diz o caractere e a codificação', /não existe na codificação/.test((await notice()) ?? '') && /😀/.test((await notice()) ?? '') && raw('latin.txt').equals(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x66, 0x6f, 0x6f, 0x0a, 0x66, 0x69, 0x6d, 0x0a])), await notice());
t.check('o aviso é um alerta e o arquivo continua "alterado" (nada se perde)', (await t.ev(`document.querySelector('[data-testid="sw-notice"]').getAttribute('role')`)) === 'alert' && (await dirty()) === 1);
await t.shot('janela-codificacao');
await focusEditor();
await t.key('z', 2); // desfaz o emoji
await sleep(200);
await t.send('Input.insertText', { text: 'ç' });
await sleep(200);
await t.key('s', 2);
await t.until(`/Salvo/.test(document.querySelector('[data-testid="sw-notice"]')?.textContent ?? '')`, 8000);
t.check('com um caractere que existe (ç) grava na mesma codificação: o "é" continua o byte E9 e o arquivo continua LF', raw('latin.txt').includes(0xe9) && raw('latin.txt').includes(0xe7) && !raw('latin.txt').includes(0xc3) && !raw('latin.txt').includes(0x0d), [...raw('latin.txt')]);

// ---- pesquisar "alvo" para os próximos passos (ext.txt tem 2 ocorrências; other.txt, 1) --------------------------------------------------------------
await typeInto(F, 'alvo');
await waitCount('^3 ocorrências em 2 arquivos');

// ---- mudou por fora, arquivo LIMPO: recarrega sozinho --------------------------------------------------------------------------------------------------
await openFile('ext.txt');
put('ext.txt', 'alvo um\nalvo dois\nalvo NOVO por fora\n');
await t.ev(`window.dispatchEvent(new Event('focus'))`);
await t.until(`/recarregado/.test(document.querySelector('[data-testid="sw-notice"]')?.textContent ?? '')`, 8000);
t.check('arquivo limpo que mudou por fora recarrega sozinho e avisa', /NOVO por fora/.test((await doc()) ?? '') && (await dirty()) === 0 && /mudou no disco e foi recarregado/.test((await notice()) ?? ''), [await notice()]);
await waitCount('^4 ocorrências em 2 arquivos');
t.check('e a lista se reajusta (agora são 4 ocorrências)', /^4 ocorrências em 2 arquivos/.test(await count()), await count());

// ---- mudou por fora, arquivo ALTERADO: pergunta (recarregar / sobrescrever / ficar) -------------------------------------------------------------------
await focusEditor();
await t.send('Input.insertText', { text: 'MINHA' });
await sleep(250);
put('ext.txt', 'alvo um\nalvo dois\nalvo OUTRO por fora\n');
await t.ev(`window.dispatchEvent(new Event('focus'))`);
await t.until(`document.querySelector('[data-testid="sw-external"]')`, 8000);
t.check('com alterações não salvas, NÃO sobrescreve nem recarrega: mostra o aviso com as três saídas', /mudou no disco/.test((await t.text('[data-testid="sw-external"]')) ?? '') && (await t.count('[data-testid="sw-reload"]')) === 1 && (await t.count('[data-testid="sw-overwrite"]')) === 1 && (await t.count('[data-testid="sw-keep"]')) === 1);
t.check('o aviso é um alerta e o arquivo do disco não foi tocado', (await t.ev(`document.querySelector('[data-testid="sw-external"]').getAttribute('role')`)) === 'alert' && raw('ext.txt').toString() === 'alvo um\nalvo dois\nalvo OUTRO por fora\n');
await t.shot('janela-mudou-por-fora');
await t.key('s', 2);
await sleep(500);
t.check('Ctrl+S com o arquivo mudado por fora também NÃO grava (recusa e mantém o aviso)', raw('ext.txt').toString() === 'alvo um\nalvo dois\nalvo OUTRO por fora\n' && (await t.count('[data-testid="sw-external"]')) === 1);
await t.ev(`document.querySelector('[data-testid="sw-overwrite"]').click()`);
await t.until(`/Salvo/.test(document.querySelector('[data-testid="sw-notice"]')?.textContent ?? '')`, 8000);
t.check('Sobrescrever grava a minha versão e o aviso some', /MINHA/.test(raw('ext.txt').toString()) && !/OUTRO por fora/.test(raw('ext.txt').toString()) && (await t.count('[data-testid="sw-external"]')) === 0, raw('ext.txt').toString());

await focusEditor();
await t.send('Input.insertText', { text: 'SEGUNDA' });
await sleep(250);
put('ext.txt', 'alvo um\nVERSAO EXTERNA\nalvo tres\n');
await t.ev(`window.dispatchEvent(new Event('focus'))`);
await t.until(`document.querySelector('[data-testid="sw-external"]')`, 8000);
await t.ev(`document.querySelector('[data-testid="sw-reload"]').click()`);
await sleep(600);
t.check('Recarregar descarta o que foi digitado e mostra o que está no disco', /VERSAO EXTERNA/.test((await doc()) ?? '') && !/SEGUNDA/.test((await doc()) ?? '') && (await dirty()) === 0 && (await t.count('[data-testid="sw-external"]')) === 0);

put('ext.txt', 'alvo um\nalvo dois\n');
await t.ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(500);
await focusEditor();
await t.send('Input.insertText', { text: 'FICA' });
await sleep(200);
put('ext.txt', 'alvo um\nalvo dois\nmais uma\n');
await t.ev(`window.dispatchEvent(new Event('focus'))`);
await t.until(`document.querySelector('[data-testid="sw-external"]')`, 8000);
await t.ev(`document.querySelector('[data-testid="sw-keep"]').click()`);
await sleep(300);
t.check('Ficar fecha o aviso e mantém as minhas alterações', (await t.count('[data-testid="sw-external"]')) === 0 && (await dirty()) === 1 && /FICA/.test((await doc()) ?? ''));

// ---- alterações não salvas ao trocar de arquivo -----------------------------------------------------------------------------------------------------------
await typeInto(F, 'alvo');
await waitCount('^\\d+ ocorrências? em 2 arquivos');
await sleep(400);
const otherId = await hitOf('other.txt');
await t.ev(`document.getElementById(${lit(otherId)}).click()`);
await t.until(`document.querySelector('[data-testid="sw-unsaved"]')`, 5000);
t.check('trocar de arquivo com alterações pergunta (diálogo de alerta com o nome do arquivo)', /ext\.txt/.test((await t.text('[data-testid="sw-unsaved"]')) ?? '') && (await t.ev(`document.querySelector('[data-testid="sw-unsaved"]').closest('[role="alertdialog"]') !== null`)) === true);
t.check('o foco vai para "Salvar" (a saída segura)', (await t.ev(`document.activeElement?.getAttribute('data-testid')`)) === 'sw-unsaved-save');
await t.ev(`document.querySelector('[data-testid="sw-unsaved-stay"]').click()`);
await sleep(400);
t.check('Ficar continua no mesmo arquivo, ainda alterado', (await path()) === 'ext.txt' && (await dirty()) === 1 && (await t.count('[data-testid="sw-unsaved"]')) === 0);
await t.ev(`document.getElementById(${lit(otherId)}).click()`);
await t.until(`document.querySelector('[data-testid="sw-unsaved"]')`, 5000);
await t.ev(`document.querySelector('[data-testid="sw-unsaved-discard"]').click()`);
await t.until(`document.querySelector('[data-testid="sw-path"]')?.textContent.trim() === 'other.txt'`, 8000);
t.check('Descartar troca de arquivo sem gravar nada', (await path()) === 'other.txt' && raw('ext.txt').toString() === 'alvo um\nalvo dois\nmais uma\n', raw('ext.txt').toString());

await sleep(300);
await focusEditor();
await t.send('Input.insertText', { text: 'GRAVAR' });
await sleep(250);
const extId = await hitOf('ext.txt');
await t.ev(`document.getElementById(${lit(extId)}).click()`);
await t.until(`document.querySelector('[data-testid="sw-unsaved"]')`, 5000);
await t.ev(`document.querySelector('[data-testid="sw-unsaved-save"]').click()`);
await t.until(`document.querySelector('[data-testid="sw-path"]')?.textContent.trim() === 'ext.txt'`, 8000);
t.check('Salvar grava o arquivo que estava aberto e troca para o novo', /GRAVAR/.test(raw('other.txt').toString()) && (await path()) === 'ext.txt', raw('other.txt').toString());

// ---- alterações não salvas ao fechar -------------------------------------------------------------------------------------------------------------------------
await sleep(300);
await focusEditor();
await t.send('Input.insertText', { text: 'SAIR' });
await sleep(250);
await t.key('Escape');
await t.until(`document.querySelector('[data-testid="sw-unsaved"]')`, 5000);
t.check('Esc com alterações pergunta antes de fechar (a janela continua aberta)', (await t.count(W)) === 1 && (await t.count('[data-testid="sw-unsaved"]')) === 1);
await t.ev(`document.querySelector('[data-testid="sw-unsaved-stay"]').click()`);
await sleep(300);
t.check('Ficar mantém a janela aberta', (await t.count(W)) === 1 && (await dirty()) === 1);
await t.ev(`document.querySelector('[data-testid="sw-close"]').click()`);
await t.until(`document.querySelector('[data-testid="sw-unsaved"]')`, 5000);
await t.ev(`document.querySelector('[data-testid="sw-unsaved-discard"]').click()`);
await sleep(500);
t.check('Descartar fecha a janela e não grava', (await t.count(W)) === 0 && !/SAIR/.test(raw('ext.txt').toString()));

// ---- só leitura -----------------------------------------------------------------------------------------------------------------------------------------------
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 5000);
await typeInto(F, 'foo');
await waitCount('^\\d+ ocorrências? em 4 arquivos');
await openFile('mixed.txt');
t.check('fim de linha misto abre SÓ LEITURA, com o motivo', /Fim de linha misto/.test((await t.text('[data-testid="sw-readonly"]')) ?? '') && (await t.ev(`document.querySelector(${lit(EDITOR)}).getAttribute('contenteditable')`)) === 'false' && (await t.ev(`document.querySelector('[data-testid="sw-save"]').disabled`)) === true);
await openFile('grande.txt');
t.check('arquivo grande (acima de 2 MB) abre SÓ LEITURA, com o motivo', /Arquivo grande/.test((await t.text('[data-testid="sw-readonly"]')) ?? ''), await t.text('[data-testid="sw-readonly"]'));

// ---- divisória -------------------------------------------------------------------------------------------------------------------------------------------------
const split = () => t.ev(`document.querySelector('[data-testid="sw-split"]').getAttribute('aria-valuenow')`);
const before = Number(await split());
await t.ev(`document.querySelector('[data-testid="sw-split"]').focus()`);
await t.key('ArrowDown');
await sleep(200);
t.check('a divisória responde ao teclado (↓ aumenta a lista)', Number(await split()) > before, [before, await split()]);
const box = await t.ev(`(() => { const r = document.querySelector('[data-testid="sw-split"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const afterKey = Number(await split());
await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y - 150, button: 'left' });
await t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y - 150, button: 'left', clickCount: 1 });
await sleep(300);
t.check('arrastar a divisória para cima diminui a lista', Number(await split()) < afterKey, [afterKey, await split()]);
const kept = await split();
await t.key('Escape');
await sleep(300);
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 5000);
t.check('a divisória é lembrada ao reabrir a janela', (await split()) === kept, [kept, await split()]);

// ---- tema claro e inglês ------------------------------------------------------------------------------------------------------------------------------------
await t.key('Escape');
await sleep(300);
await t.ev(`localStorage.setItem('gitnexus.theme', 'light'); localStorage.setItem('gitnexus.locale', 'en')`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/loading|carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 5000);
await waitCount('^\\d+ occurrences? in 4 files');
await openFile('mixed.txt');
const en = await t.ev(`(() => ({
  theme: document.documentElement.dataset.theme,
  label: document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
  save: document.querySelector('[data-testid="sw-save"]')?.textContent.trim(),
  revert: document.querySelector('[data-testid="sw-revert"]')?.textContent.trim(),
  ro: document.querySelector('[data-testid="sw-readonly"]')?.textContent.trim(),
  field: document.querySelector(${lit(F)})?.getAttribute('aria-label'),
}))()`);
t.check('em inglês e tema claro: título, campo, botões e o motivo do só leitura traduzidos', en.theme === 'light' && en.label === 'Search the repository' && en.save === 'Save' && en.revert === 'Undo changes' && /Mixed line endings/.test(en.ro) && en.field === 'Search the repository', en);
await t.shot('janela-claro-en');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
