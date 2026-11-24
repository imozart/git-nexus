// Filtros, escopos, histórico e mensagens da janela de pesquisa (fase 5): onde procurar (repositório, versionados, alterados, stage, branch/tag/commit), máscara com
// exclusão, pasta, ignorados, novos, submódulos, linhas de contexto, agrupar, ocultar da lista, "carregar mais", histórico por repositório (que sobrevive a recarregar),
// "nada encontrado" com sugestões, regex inválida com a posição e o que ficou de fora. Git de verdade; os resultados são conferidos pelo que está no repositório.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.removeItem('gitnexus.searchWindow'); localStorage.removeItem('gitnexus.searchHistory')`);

const root = tmpRoot('gn-sf-');
const repo = mkRepo(root, 'filtrorepo', { files: { 'a.txt': 'um\n' } });
const mk = (f, data) => {
  mkdirSync(join(repo, f, '..'), { recursive: true });
  writeFileSync(join(repo, f), data);
};
mk('src/app.ts', 'const needle = 1;\nconst other = 2;\nfunction go() {\n  return needle;\n}\n');
mk('src/util.test.ts', 'needle in test\n');
mk('dist/out.js', 'needle built\n');
mk('docs/leia.md', 'Needle docs\n');
mk('bin.dat', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('needle'), Buffer.from([0])]));
mk('.gitignore', 'ignored.log\n');
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'feat: base');
git(repo, 'checkout', '-qb', 'feat');
mk('so-na-feat.txt', 'needle so na feat\n');
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'feat: ramo');
git(repo, 'checkout', '-q', 'main');
mk('src/app.ts', 'const needle = 1;\nconst other = 2;\nfunction go() {\n  return needle;\n}\n// needle alterado\n'); // alterado (não commitado)
mk('novo.txt', 'needle novo\n'); // não versionado
mk('ignored.log', 'needle ignorado\n'); // ignorado
mk('stage.txt', 'needle so no stage\n');
git(repo, 'add', 'stage.txt');
mk('stage.txt', 'agora so no disco\n'); // o stage guarda a primeira versão

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'filtrorepo')`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'filtrorepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);

const W = '[data-testid="search-window"]';
const q = (id) => `${W} [data-testid="${id}"]`;
const F = q('sf-input');
const click = (id) => t.ev(`document.querySelector(${lit(q(id))}).click()`);
const typeInto = async (sel, text) => {
  await t.ev(`(() => { const e = document.querySelector(${lit(sel)}); e.focus(); e.select(); })()`);
  await t.send('Input.insertText', { text });
  await sleep(120);
};
const val = (id) => t.ev(`document.querySelector(${lit(q(id))})?.value ?? null`);
const count = () => t.ev(`document.querySelector('[data-testid="sw-count"]')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
/** Depois de mudar um filtro: espera a pesquisa nova começar (o contador antigo ainda está na tela por 250 ms) e termina. */
const waitCount = async (re, ms = 15000) => {
  await sleep(450);
  return t.until(`new RegExp(${lit(re)}).test(document.querySelector('[data-testid="sw-count"]')?.textContent ?? '')`, ms);
};
const labels = () => t.ev(`[...document.querySelectorAll('${W} [role="option"]')].map((r) => r.getAttribute('aria-label'))`);
const files = () => t.ev(`[...document.querySelectorAll('[data-testid="sw-file-row"]')].map((r) => r.getAttribute('aria-label').split(',')[0])`);
const fileSet = async () => (await files()).sort();
const notes = () => t.text('[data-testid="sw-notes"]');
const openFilters = async () => {
  if ((await t.count(q('sw-filters'))) === 0) await click('sw-filters-toggle');
  await t.until(`document.querySelector(${lit(q('sw-filters'))})`, 3000);
};
const pick = async (id, label) => {
  await t.ev(`document.querySelector(${lit(q(id) + ' .cbx__btn')}).click()`);
  await t.until(`document.querySelector('.cbx__list')`, 3000);
  await t.ev(`[...document.querySelectorAll('.cbx__list .cbx__opt')].find((o) => o.textContent.trim().startsWith(${lit(label)})).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
  await sleep(150);
};
const setInput = async (id, text) => typeInto(q(id), text);
const setBox = async (id, on) => {
  if ((await t.ev(`document.querySelector(${lit(q(id))}).checked`)) !== on) await click(id);
};
const seg = (id, label) => t.ev(`[...document.querySelectorAll(${lit(q(id) + ' [role="radio"]')})].find((b) => b.textContent.trim() === ${lit(label)}).click()`);

// ---- padrão: filtros recolhidos, o que a pesquisa comum acha -------------------------------------------------------------------------------------------
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 5000);
await typeInto(F, 'needle');
await waitCount('^7 ocorrências em 5 arquivos');
t.check('padrão: 7 ocorrências em 5 arquivos (alterado e novo entram; ignorado, binário e stage-só-no-índice não)', /^7 ocorrências em 5 arquivos/.test(await count()), await count());
t.check('os arquivos achados', JSON.stringify(await fileSet()) === JSON.stringify(['dist/out.js', 'docs/leia.md', 'novo.txt', 'src/app.ts', 'src/util.test.ts']), await fileSet());
t.check('"ignorados um binário": o que ficou de fora é dito', /Ignorados: um binário/.test((await notes()) ?? ''), await notes());
t.check('os filtros começam recolhidos, sem resumo', (await t.count(q('sw-filters'))) === 0 && (await t.count(q('sw-chips'))) === 0 && (await t.ev(`document.querySelector(${lit(q('sw-filters-toggle'))}).getAttribute('aria-expanded')`)) === 'false');

// ---- abrir e fechar os filtros -----------------------------------------------------------------------------------------------------------------------------
await click('sw-filters-toggle');
await t.until(`document.querySelector(${lit(q('sw-filters'))})`, 3000);
t.check('o botão Filtros abre o painel (aria-expanded) com onde, pasta, novos, ignorados, submódulos, contexto e agrupar', (await t.ev(`document.querySelector(${lit(q('sw-filters-toggle'))}).getAttribute('aria-expanded')`)) === 'true' && (await t.count(q('sw-scope'))) === 1 && (await t.count(q('sw-folder'))) === 1 && (await t.count(q('sw-untracked'))) === 1 && (await t.count(q('sw-ignored'))) === 1 && (await t.count(q('sw-submodules'))) === 1 && (await t.count(q('sw-context'))) === 1 && (await t.count(q('sw-group'))) === 1);
t.check('o painel é um grupo com nome acessível', (await t.ev(`document.querySelector(${lit(q('sw-filters'))}).getAttribute('role') + '|' + document.querySelector(${lit(q('sw-filters'))}).getAttribute('aria-label')`)) === 'group|Filtros da pesquisa');
await t.ev(`document.querySelector(${lit(q('sw-folder'))}).focus()`);
await t.key('Escape');
await sleep(300);
t.check('Esc fecha só o painel (a janela continua) e o foco volta ao botão Filtros', (await t.count(q('sw-filters'))) === 0 && (await t.count(W)) === 1 && (await t.ev(`document.activeElement?.getAttribute('data-testid')`)) === 'sw-filters-toggle', await t.ev(`document.activeElement?.getAttribute('data-testid')`));

// ---- onde procurar -----------------------------------------------------------------------------------------------------------------------------------------------
await openFilters();
await pick('sw-scope', 'Alterados');
await waitCount('^4 ocorrências em 2 arquivos');
t.check('Alterados: só o que mudou (arquivo alterado e arquivo novo)', /^4 ocorrências em 2 arquivos/.test(await count()) && JSON.stringify(await fileSet()) === JSON.stringify(['novo.txt', 'src/app.ts']), [await count(), await fileSet()]);
await t.shot('filtros-alterados');

await pick('sw-scope', 'Stage');
await waitCount('^6 ocorrências em 5 arquivos');
t.check('Stage: o conteúdo do índice (o stage.txt tem o "needle" que não está mais no disco; o novo e o ignorado não)', JSON.stringify(await fileSet()) === JSON.stringify(['dist/out.js', 'docs/leia.md', 'src/app.ts', 'src/util.test.ts', 'stage.txt']), await fileSet());

await pick('sw-scope', 'Só versionados');
await waitCount('^6 ocorrências em 4 arquivos');
t.check('Só versionados: sem o arquivo novo e sem o que só está no stage', JSON.stringify(await fileSet()) === JSON.stringify(['dist/out.js', 'docs/leia.md', 'src/app.ts', 'src/util.test.ts']), await fileSet());

await pick('sw-scope', 'Branch, tag ou commit');
await sleep(600);
t.check('Branch, tag ou commit sem nome: pede a revisão e não pesquisa', (await t.count(q('sw-revision'))) === 1 && /Escolha o branch/.test((await t.text('[data-testid="sw-hint"]')) ?? '') && (await t.count('[role="option"]')) === 0, await t.text('[data-testid="sw-hint"]'));
await t.ev(`(() => { const e = document.querySelector(${lit(q('sw-revision') + ' input')}); e.focus(); e.select(); })()`);
await t.send('Input.insertText', { text: 'feat' });
await sleep(200);
await waitCount('^6 ocorrências em 5 arquivos');
t.check('revisão "feat": o conteúdo do commit (inclui o arquivo que só existe nesse ramo)', (await fileSet()).includes('so-na-feat.txt') && !(await fileSet()).includes('novo.txt') && !(await fileSet()).includes('stage.txt'), await fileSet());
await t.ev(`(() => { const e = document.querySelector(${lit(q('sw-revision') + ' input')}); e.focus(); e.select(); })()`);
await t.send('Input.insertText', { text: 'nao-existe' });
await sleep(700);
await t.until(`document.querySelector('[data-testid="sw-error"]')`, 8000);
t.check('revisão que não existe: a mensagem diz qual', /nao-existe/.test((await t.text('[data-testid="sw-error"]')) ?? ''), await t.text('[data-testid="sw-error"]'));

await pick('sw-scope', 'Repositório todo');
await waitCount('^7 ocorrências em 5 arquivos');
t.check('voltar ao repositório todo refaz a pesquisa', /^7 ocorrências em 5 arquivos/.test(await count()), await count());

// ---- máscara com exclusão e pasta ----------------------------------------------------------------------------------------------------------------------------
await typeInto(q('sw-masks'), '!dist/, !*.test.ts');
await waitCount('^5 ocorrências em 3 arquivos');
t.check('máscara com exclusão: sem dist/ e sem os testes', JSON.stringify(await fileSet()) === JSON.stringify(['docs/leia.md', 'novo.txt', 'src/app.ts']), await fileSet());
await typeInto(q('sw-masks'), '');
await openFilters();
await setInput('sw-folder', 'src');
await waitCount('^4 ocorrências em 2 arquivos');
t.check('pasta "src": só dentro dela', JSON.stringify(await fileSet()) === JSON.stringify(['src/app.ts', 'src/util.test.ts']), await fileSet());
await typeInto(q('sw-masks'), '!*.test.ts');
await waitCount('^3 ocorrências em 1 arquivo');
t.check('pasta e máscara juntas: a máscara vale dentro da pasta', JSON.stringify(await fileSet()) === JSON.stringify(['src/app.ts']), await fileSet());
await typeInto(q('sw-masks'), '');
await waitCount('^4 ocorrências em 2 arquivos');

// ---- linhas de contexto ----------------------------------------------------------------------------------------------------------------------------------------
await seg('sw-context', '2');
await t.until(`document.querySelectorAll('[data-testid="sw-ctx-row"]').length > 0`, 8000);
const ctx = await t.ev(`[...document.querySelectorAll('[data-testid="sw-ctx-row"]')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())`);
t.check('contexto 2: as linhas em volta aparecem (sem repetir as que já são ocorrência) e são só texto', ctx.length === 3 && /const other = 2;/.test(ctx[0]) && (await t.ev(`document.querySelectorAll('[data-testid="sw-ctx-row"] mark').length`)) === 0, ctx);
t.check('o contexto não vira ocorrência (o contador não muda)', /^4 ocorrências em 2 arquivos/.test(await count()), await count());
await t.shot('filtros-contexto');
await seg('sw-context', '0');
await t.until(`document.querySelectorAll('[data-testid="sw-ctx-row"]').length === 0`, 8000);
t.check('contexto 0: sem linhas de contexto', (await t.count('[data-testid="sw-ctx-row"]')) === 0);

// ---- agrupar -------------------------------------------------------------------------------------------------------------------------------------------------------------
await setInput('sw-folder', '');
await waitCount('^7 ocorrências em 5 arquivos');
await seg('sw-group', 'Pasta');
await t.until(`document.querySelectorAll('[data-testid="sw-dir-row"]').length > 0`, 5000);
const dirs = await t.ev(`[...document.querySelectorAll('[data-testid="sw-dir-row"]')].map((r) => r.getAttribute('aria-label').split(',')[0])`);
t.check('agrupar por pasta: uma linha por pasta (e a raiz do repositório), depois os arquivos', JSON.stringify([...dirs].sort()) === JSON.stringify(['(raiz do repositório)', 'dist', 'docs', 'src']), dirs);
await t.shot('filtros-agrupar-pasta');
await t.ev(`document.querySelector('[data-testid="sw-dir-row"]').click()`);
await sleep(200);
t.check('clicar na pasta recolhe os arquivos dela', (await t.count('[data-testid="sw-file-row"]')) < 5);
await seg('sw-group', 'Plano');
await sleep(300);
t.check('plano: só as ocorrências, cada uma com o arquivo na linha', (await t.count('[data-testid="sw-file-row"]')) === 0 && (await t.count('[data-testid="sw-dir-row"]')) === 0 && (await t.count('.sw__fp')) >= 5, await labels());
await seg('sw-group', 'Arquivo');
await sleep(300);
t.check('agrupar por arquivo volta ao padrão', (await t.count('[data-testid="sw-file-row"]')) === 5);

// ---- novos, ignorados e submódulos -----------------------------------------------------------------------------------------------------------------------
await setBox('sw-untracked', false);
await waitCount('^6 ocorrências em 4 arquivos');
t.check('sem os arquivos novos: o novo.txt sai', !(await fileSet()).includes('novo.txt'), await fileSet());
await setBox('sw-untracked', true);
await waitCount('^7 ocorrências em 5 arquivos');
await setBox('sw-ignored', true);
await waitCount('^8 ocorrências em 6 arquivos');
t.check('com os ignorados: o ignored.log entra', (await fileSet()).includes('ignored.log'), await fileSet());
await setBox('sw-ignored', false);
await waitCount('^7 ocorrências em 5 arquivos');
await setBox('sw-submodules', true);
await sleep(500);
await click('sw-filters-toggle');
await sleep(200);
const chips = await t.ev(`[...document.querySelectorAll('[data-testid^="sw-chip-"]')].map((b) => b.textContent.trim())`);
t.check('recolhido, o painel resume o que está fora do padrão em botões (e o botão Filtros mostra quantos)', JSON.stringify(chips) === JSON.stringify(['Submódulos: sim']) && (await t.text('[data-testid="sw-filters-n"]')) === '1', [chips, await t.text('[data-testid="sw-filters-n"]')]);
await click('sw-chip-submodules');
await t.until(`document.querySelector(${lit(q('sw-filters'))})`, 3000);
await setBox('sw-submodules', false);
await click('sw-filters-toggle');
await sleep(200);

// ---- ocultar da lista ------------------------------------------------------------------------------------------------------------------------------------------------
await t.ev(`(() => { const r = document.querySelector('[data-testid="sw-row"]'); r.click(); })()`);
await sleep(500);
await t.ev(`document.querySelector('[data-testid="sw-list"]').focus()`);
await t.key('Delete');
await sleep(300);
t.check('Delete oculta a ocorrência selecionada (a única do arquivo: o arquivo sai): o contador acompanha e a lista diz quantas estão ocultas', /^6 ocorrências em 4 arquivos/.test(await count()) && /uma ocultada/.test((await t.text('[data-testid="sw-hidden"]')) ?? ''), [await count(), await t.text('[data-testid="sw-hidden"]')]);
await t.key('Delete', 8);
await sleep(300);
t.check('Shift+Delete oculta o arquivo da selecionada', /^5 ocorrências em 3 arquivos/.test(await count()), await count());
await click('sw-unhide');
await sleep(300);
t.check('Mostrar tudo devolve o que foi ocultado (a busca não foi refeita)', /^7 ocorrências em 5 arquivos/.test(await count()) && (await t.count('[data-testid="sw-hidden"]')) === 0, await count());

// ---- nada encontrado, com sugestões -------------------------------------------------------------------------------------------------------------------------
await click('sf-case');
await typeInto(F, 'NEEDLE');
await waitCount('^Nada encontrado');
const sg = await t.ev(`[...document.querySelectorAll('[data-testid^="sw-sg-"]')].map((b) => b.getAttribute('data-testid'))`);
t.check('nada encontrado: diz o que tentar (só o que aperta a busca: Aa e os ignorados)', (await t.count('[data-testid="sw-empty"]')) === 1 && JSON.stringify(sg) === JSON.stringify(['sw-sg-case', 'sw-sg-ignored']), sg);
await t.shot('filtros-nada-encontrado');
await click('sw-sg-case');
await waitCount('^7 ocorrências em 5 arquivos');
t.check('a sugestão desfaz a opção e refaz a pesquisa', /^7 ocorrências em 5 arquivos/.test(await count()) && (await t.count('[data-testid="sw-empty"]')) === 0, await count());

// ---- regex inválida com a posição --------------------------------------------------------------------------------------------------------------------------------
await click('sf-regex');
await typeInto(F, 'ab(cd');
await t.until(`document.querySelector('[data-testid="sf-error"]')`, 5000);
t.check('regex inválida: a mensagem diz a posição', /posição 3/.test((await t.text('[data-testid="sf-error"]')) ?? ''), await t.text('[data-testid="sf-error"]'));
await t.shot('filtros-regex-posicao');
await click('sf-regex');
await typeInto(F, 'needle');
await waitCount('^7 ocorrências em 5 arquivos');

// ---- histórico de pesquisas ---------------------------------------------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector(${lit(F)}).focus()`);
await t.key('Enter'); // Enter no campo guarda a pesquisa no histórico (e leva o foco ao arquivo)
await sleep(400);
await typeInto(F, 'alfa');
await t.key('Enter');
await sleep(500);
await typeInto(F, 'beta');
await t.key('Enter');
await sleep(500);
await typeInto(F, '');
await sleep(300);
await t.key('ArrowDown');
await t.until(`document.querySelector(${lit(q('sw-past'))})`, 3000);
const past = async () => t.ev(`[...document.querySelectorAll('[data-testid="sw-past-item"] .sw__pastpat')].map((e) => e.textContent.trim())`);
t.check('↓ com o campo vazio abre o histórico, a mais recente primeiro', JSON.stringify(await past()) === JSON.stringify(['beta', 'alfa', 'needle']), await past());
t.check('o histórico é uma lista com nome e o botão mostra que está aberto', (await t.ev(`document.querySelector('#sw-past-list').getAttribute('role')`)) === 'listbox' && (await t.ev(`document.querySelector(${lit(q('sw-past-toggle'))}).getAttribute('aria-expanded')`)) === 'true');
await t.shot('filtros-historico');
await t.key('ArrowDown');
await t.key('ArrowDown');
await t.key('Enter');
await waitCount('^7 ocorrências em 5 arquivos');
t.check('↓↓ e Enter aplicam a pesquisa escolhida: o texto volta ao campo e os resultados vêm', (await val('sf-input')) === 'needle' && (await t.count(q('sw-past'))) === 0, await val('sf-input'));
await typeInto(F, 'al');
await t.key('ArrowDown', 1);
await t.until(`document.querySelector(${lit(q('sw-past'))})`, 3000);
t.check('Alt+↓ abre o histórico filtrado pelo que foi digitado', JSON.stringify(await past()) === JSON.stringify(['alfa']), await past());
await t.key('Escape');
await sleep(300);
t.check('Esc fecha só o histórico (a janela continua)', (await t.count(q('sw-past'))) === 0 && (await t.count(W)) === 1);
const stored = await t.ev(`JSON.parse(localStorage.getItem('gitnexus.searchHistory') ?? '{}')`);
const keyOf = Object.keys(stored)[0];
t.check('o histórico é por repositório e fica guardado (sobrevive a fechar o app)', Object.keys(stored).length === 1 && stored[keyOf].map((e) => e.pattern).join() === 'needle,beta,alfa', stored);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/loading|carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 5000);
await typeInto(F, ''); // o campo lembra o texto digitado antes de recarregar
await t.key('ArrowDown', 1);
await t.until(`document.querySelector(${lit(q('sw-past'))})`, 3000);
t.check('depois de recarregar o app, o histórico continua lá', JSON.stringify(await past()) === JSON.stringify(['needle', 'beta', 'alfa']), await past());
await t.key('ArrowDown');
await t.key('Delete', 8);
await sleep(200);
t.check('Shift+Delete tira a entrada do histórico', JSON.stringify(await past()) === JSON.stringify(['needle', 'alfa']), await past());
await click('sw-past-clear');
await sleep(300);
t.check('Limpar o histórico esvazia e guarda', (await t.ev(`localStorage.getItem('gitnexus.searchHistory')`)) === '{}' && (await t.count(q('sw-past'))) === 0, await t.ev(`localStorage.getItem('gitnexus.searchHistory')`));

// ---- carregar mais ---------------------------------------------------------------------------------------------------------------------------------------------------
writeFileSync(join(repo, 'many.txt'), Array.from({ length: 5100 }, (_, i) => `manyline ${i + 1}`).join('\n') + '\n');
await typeInto(F, 'manyline');
await t.until(`/Carregar mais/.test(document.querySelector('[data-testid="sw-notes"]')?.textContent ?? '')`, 20000);
t.check('mais que o limite: diz que mostra as primeiras 5.000 e oferece Carregar mais', /primeiras 5\D?000 ocorrências/.test((await notes()) ?? '') && (await t.count(q('sw-more'))) === 1, await notes());
await t.shot('filtros-carregar-mais');
await click('sw-more');
await waitCount('^5\\D?100 ocorrências em 1 arquivo');
t.check('Carregar mais traz o resto e junta ao que já estava na lista (5.100 no total)', /^5\D?100 ocorrências em 1 arquivo/.test(await count()) && (await t.count(q('sw-more'))) === 0, await count());

// ---- pesquisar neste arquivo / nesta pasta (menu de contexto das alterações) ----------------------------------------------------------------------
await t.key('Escape');
await sleep(400);
// a pasta nova (inteira não versionada) aparece como uma linha "pasta/" nas alterações
mk('novadir/um.txt', 'needle um\n');
mk('novadir/dois.txt', 'needle dois\n');
await t.ev('window.dispatchEvent(new Event("focus"))');
await t.until(`document.querySelector('.file[data-path="novadir/"]')`, 10000);
const menuFor = async (path, label) => {
  await t.ev(`[...document.querySelectorAll('.file')].find((x) => x.dataset.path === ${lit(path)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }))`);
  await t.until(`document.querySelector('[role="menu"]')`, 3000);
  return t.ev(`(() => { const i = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find((x) => x.textContent.trim() === ${lit(label)}); i?.click(); return !!i; })()`);
};
const openedFile = await menuFor('novo.txt', 'Pesquisar neste arquivo');
await t.until(`document.querySelector(${lit(W)})`, 5000);
await typeInto(F, 'needle');
await waitCount('^1 ocorrência em 1 arquivo');
t.check('"Pesquisar neste arquivo" (menu do arquivo alterado): a janela abre limitada a ele', openedFile === true && (await val('sw-masks')) === 'novo.txt' && JSON.stringify(await fileSet()) === JSON.stringify(['novo.txt']), [openedFile, await val('sw-masks'), await fileSet()]);
await t.key('Escape');
await sleep(400);
const openedDir = await menuFor('novadir/', 'Pesquisar nesta pasta');
await t.until(`document.querySelector(${lit(W)})`, 5000);
await typeInto(F, 'needle');
await waitCount('^2 ocorrências em 2 arquivos');
t.check('"Pesquisar nesta pasta": a janela abre com a pasta preenchida (nos filtros) e a máscara vazia', openedDir === true && (await val('sw-masks')) === '' && (await t.text('[data-testid="sw-chip-folder"]')) === 'Pasta: novadir' && JSON.stringify(await fileSet()) === JSON.stringify(['novadir/dois.txt', 'novadir/um.txt']), [openedDir, await val('sw-masks'), await t.text('[data-testid="sw-chip-folder"]'), await fileSet()]);

// ---- tema claro e inglês ------------------------------------------------------------------------------------------------------------------------------------------------
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
await typeInto(F, 'needle');
await waitCount('^\\d+ occurrences? in \\d+ files?');
await openFilters();
await setInput('sw-folder', ''); // a pasta ficou da etapa anterior ("Pesquisar nesta pasta")
await pick('sw-scope', 'Changed');
await waitCount('^\\d+ occurrences? in \\d+ files?');
await seg('sw-context', '1');
await t.until(`document.querySelectorAll('[data-testid="sw-ctx-row"]').length > 0`, 8000);
await sleep(300);
const en = await t.ev(`(() => ({
  theme: document.documentElement.dataset.theme,
  toggle: document.querySelector(${lit(q('sw-filters-toggle'))})?.textContent.trim(),
  where: [...document.querySelectorAll(${lit(q('sw-filters') + ' .sf__f > span')})].map((s) => s.textContent.trim()),
  group: [...document.querySelectorAll(${lit(q('sw-group') + ' [role="radio"]')})].map((s) => s.textContent.trim()),
  past: document.querySelector(${lit(q('sw-past-toggle'))})?.getAttribute('aria-label'),
}))()`);
t.check('tema claro e inglês: botão Filtros, rótulos, agrupar e o histórico traduzidos', en.theme === 'light' && /^Filters/.test(en.toggle) && en.where.includes('Where to search') && en.where.includes('Context lines') && JSON.stringify(en.group) === JSON.stringify(['File', 'Folder', 'Flat']) && en.past === 'Previous searches', en);
await t.shot('filtros-claro-en');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
