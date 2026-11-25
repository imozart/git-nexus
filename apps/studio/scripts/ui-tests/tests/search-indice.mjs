// Índice de busca (fase 10 da #233), com git de verdade: a linha do índice na janela de pesquisa (proposta "Acelerar as buscas neste repositório" com a regra
// baixada para o teste, "Agora não", criar, pronto, busca acelerada com o número de arquivos conferidos), o diálogo (modo Automático/Sempre/Nunca, limite, criar,
// apagar), o resultado idêntico com e sem índice (conferido contra `git grep`), um arquivo sujo que o índice ainda não viu, o índice que sobrevive a recarregar a
// tela, a paleta, e o tema claro em inglês. Rodar com a regra baixada: `GN_INDEX_RULE='{"files":100}'` (a proposta aparece com mais de 100 arquivos).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.theme', 'dark')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
for (const k of ['searchWindow', 'searchHistory']) await t.ev(`localStorage.removeItem('gitnexus.${k}')`);

const root = tmpRoot('gn-si-');
const REPO = mkRepo(root, 'si-main', { files: { 'README.md': 'indice de busca\n' } });
git(REPO, 'config', 'core.fsmonitor', 'false'); // sem o daemon do Git segurando a pasta temporária
const FILES = 150;
for (let i = 0; i < FILES; i++) {
  const f = join(REPO, `pasta${i % 5}`, `arq${i}.ts`);
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, `export const valor${i} = ${i};\n// linha comum de texto numero ${i}\n${i === 77 ? '// AGULHA-UNICA aqui\n' : ''}${i % 10 === 0 ? '// timeout padrao\n' : ''}`);
}
git(REPO, 'add', '-A');
git(REPO, '-c', 'user.name=T', '-c', 'user.email=t@e.com', 'commit', '-q', '-m', 'tudo');
const ruleOn = (process.env.GN_INDEX_RULE ?? '').includes('files');
const gitCount = (pat) => git(REPO, 'grep', '-c', '-F', pat).split('\n').filter(Boolean).length;

await t.ev(`window.gitNexus.addRepositoryPath(${lit(REPO)})`);
await t.ev('location.reload()');
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'si-main')`, 25000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'si-main').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(700);

const W = '[data-testid="search-window"]';
const wq = (id) => `${W} [data-testid="${id}"]`;
const D = '[data-testid="sid"]';
const dq = (id) => `${D} [data-testid="${id}"]`;
const typeInto = async (sel, text) => {
  await t.ev(`(() => { const e = document.querySelector(${lit(sel)}); e.focus(); e.select(); })()`);
  await t.send('Input.insertText', { text });
  await sleep(150);
};
const clickW = (id) => t.ev(`document.querySelector(${lit(wq(id))}).click()`);
const clickD = (id) => t.ev(`document.querySelector(${lit(dq(id))}).click()`);
const lineText = () => t.ev(`document.querySelector(${lit(wq('six-line'))})?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
const countText = () => t.ev(`document.querySelector(${lit(wq('sw-count'))})?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
const settled = async (ms = 20000) => {
  await sleep(350);
  return t.until(`!document.querySelector(${lit(wq('sw-stop'))}) && !/Buscando|Searching/.test(document.querySelector(${lit(wq('sw-count'))})?.textContent ?? '')`, ms);
};
/** Pesquisa e espera acabar; devolve { n, txt, badge }. O texto tem de ser DIFERENTE do anterior (o mesmo texto não refaz a busca): por isso cada chamada usa um pedaço menor de AGULHA-UNICA. */
const search = async (text) => {
  await typeInto(`${W} [data-testid="sf-input"]`, text);
  await sleep(700);
  await settled();
  const txt = await countText();
  const badge = (await t.count(wq('six-accelerated'))) ? await t.text(wq('six-accelerated')) : null;
  return { n: Number((/^(\d+)/.exec(txt) ?? [])[1] ?? 0), txt, badge };
};
const waitState = (word, ms = 40000) => t.until(`document.querySelector(${lit(wq('six-state'))})?.textContent.trim() === ${lit(word)}`, ms);
const shot = async (n) => {
  await t.ev(`(() => { if (!document.getElementById('gn-nopath')) { const s = document.createElement('style'); s.id = 'gn-nopath'; s.textContent = '.rv__path, .sr__path { visibility: hidden !important; }'; document.head.appendChild(s); } })()`);
  await t.shot(n);
};

// ---- a linha do índice, sem índice ---------------------------------------------------------------------------------------------------------------------------------
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 6000);
t.check('a janela tem a linha do índice de busca, com nome', (await t.count(wq('six'))) === 1 && (await t.ev(`document.querySelector(${lit(wq('six'))}).getAttribute('aria-label')`)) === 'Índice de busca');
if (ruleOn) {
  await t.until(`document.querySelector(${lit(wq('six-accelerate'))})`, 20000);
  const proposal = await lineText();
  t.check('repositório grande (pela regra baixada): propõe "Acelerar as buscas neste repositório?" com o motivo', /muitos arquivos \(15\d\)/.test(proposal) && /Acelerar as buscas neste repositório\?/.test(proposal), proposal);
  t.check('a proposta tem "Acelerar" e "Agora não"', (await t.count(wq('six-accelerate'))) === 1 && (await t.count(wq('six-dismiss'))) === 1);
  await shot('indice-proposta');
  await clickW('six-dismiss');
  await t.until(`!document.querySelector(${lit(wq('six-accelerate'))})`, 5000);
  t.check('"Agora não" some com a proposta e a linha volta ao normal', /desligado/.test(await lineText()), await lineText());
}

// ---- sem índice a busca acha, sem selo -------------------------------------------------------------------------------------------------------------------------------
const s0 = await search('AGULHA-UNICA');
t.check('sem índice: acha a ocorrência e não mostra o selo de busca acelerada', s0.n === 1 && s0.badge === null, s0);

// ---- o diálogo: criar o índice ---------------------------------------------------------------------------------------------------------------------------------------
await clickW('six-manage');
await t.until(`document.querySelector(${lit(D)})`, 5000);
t.check('o diálogo abre com o foco dentro dele e o título certo', (await t.ev(`document.querySelector(${lit(D)}).closest('[role="dialog"]')?.contains(document.activeElement)`)) === true && /Índice de busca deste repositório/.test((await t.text(D)) ?? ''));
t.check('modo Automático escolhido e o estado "Sem índice"', (await t.ev(`document.querySelector(${lit(dq('sid-mode') + ' [aria-checked="true"]')})?.textContent.trim()`)) === 'Automático' && (await t.text(dq('sid-state'))) === 'Sem índice');
await shot('indice-dialogo-sem');
await clickD('sid-build');
await t.until(`document.querySelector(${lit(dq('sid-state'))})?.textContent.startsWith('Pronto')`, 60000);
const files = Number(await t.text(dq('sid-files')));
t.check('o índice fica pronto com todos os arquivos do Git', files === FILES + 1, files);
t.check('o diálogo mostra tamanho, atualização e quanto é sempre conferido', /KB|B|MB/.test((await t.text(dq('sid-size'))) ?? '') && !!(await t.text(dq('sid-updated'))) && (await t.text(dq('sid-always'))) === '0');
await shot('indice-dialogo-pronto');
await t.key('Escape');
await t.until(`!document.querySelector(${lit(D)})`, 4000);
t.check('Esc fecha só o diálogo (a janela de pesquisa segue aberta)', (await t.count(W)) === 1);
t.check('a linha diz que o índice está pronto, com a idade e o tamanho', /Índice pronto · atualizado .+ · 151 arquivos/.test(await lineText()), await lineText());

// ---- a busca acelerada dá o mesmo resultado --------------------------------------------------------------------------------------------------------------------------
const s1 = await search('GULHA-UNICA');
t.check('com índice: o mesmo resultado, com o selo "Busca acelerada" e poucos arquivos conferidos', s1.n === 1 && /^Busca acelerada · [1-3] arquivos? conferidos?$/.test(s1.badge ?? ''), s1);
await shot('indice-busca-acelerada');
const s2 = await search('timeout');
t.check('várias ocorrências: a mesma quantidade que o git grep direto', s2.n === gitCount('timeout') && s2.badge !== null, [s2, gitCount('timeout')]);
const s3 = await search('valor12');
t.check('texto que aparece em vários arquivos bate com o git grep', s3.n === git(REPO, 'grep', '-c', '-i', '-F', 'valor12').split('\n').filter(Boolean).length && s3.badge !== null, [s3, git(REPO, 'grep', '-c', '-i', '-F', 'valor12')]);

// ---- um arquivo sujo, que o índice ainda não viu ----------------------------------------------------------------------------------------------------------------------
writeFileSync(join(REPO, 'pasta1', 'arq1.ts'), 'export const novo = 1;\n// NOVIDADE-SUJA\n');
writeFileSync(join(REPO, 'solto.txt'), 'NOVIDADE-SUJA no arquivo novo\n');
const s4 = await search('NOVIDADE-SUJA');
t.check('o que está sujo ou é novo (fora do índice) aparece na busca acelerada', s4.n === 2 && s4.badge !== null, s4);

// ---- modo Nunca -----------------------------------------------------------------------------------------------------------------------------------------------------------
await clickW('six-manage');
await t.until(`document.querySelector(${lit(D)})`, 5000);
await t.ev(`[...document.querySelectorAll(${lit(dq('sid-mode') + ' [role="radio"]')})].find((b) => b.textContent.trim() === 'Nunca').click()`);
await t.until(`/não usa nem atualiza/i.test(document.querySelector(${lit(dq('sid-hint'))})?.textContent ?? '')`, 5000);
await t.key('Escape');
await t.until(`!document.querySelector(${lit(D)})`, 4000);
t.check('modo "Nunca": a linha diz que o índice está desativado e a busca roda sem ele', /desativado/.test(await lineText()), await lineText());
const s5 = await search('ULHA-UNICA');
t.check('em modo "Nunca" o resultado é o mesmo e o selo some', s5.n === 1 && s5.badge === null, s5);
await clickW('six-manage');
await t.until(`document.querySelector(${lit(D)})`, 5000);
await t.ev(`[...document.querySelectorAll(${lit(dq('sid-mode') + ' [role="radio"]')})].find((b) => b.textContent.trim() === 'Automático').click()`);
await sleep(500);
await t.key('Escape');
await t.until(`!document.querySelector(${lit(D)})`, 4000);
const s6 = await search('LHA-UNICA');
t.check('de volta ao Automático o índice (que continuou no disco) volta a ser usado', s6.n === 1 && s6.badge !== null, s6);

// ---- o índice sobrevive a recarregar a tela ---------------------------------------------------------------------------------------------------------------------------
await t.key('Escape');
await t.until(`!document.querySelector(${lit(W)})`, 5000);
await t.ev('location.reload()');
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'si-main')`, 25000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'si-main').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(700);
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 6000);
await waitState('Pronto', 20000);
t.check('depois de recarregar a tela o índice continua pronto', /Índice pronto/.test(await lineText()), await lineText());

// ---- a paleta ---------------------------------------------------------------------------------------------------------------------------------------------------------------
await t.key('Escape');
await t.until(`!document.querySelector(${lit(W)})`, 5000);
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 8000);
await t.send('Input.insertText', { text: 'Índice de busca' });
await sleep(400);
const cmds = await t.ev(`[...document.querySelectorAll('.cp__item')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim())`);
t.check('a paleta tem "Índice de busca…"', cmds.some((c) => /^Índice de busca…/.test(c)), cmds);
await t.key('Enter');
await t.until(`document.querySelector(${lit(D)})`, 8000);
t.check('o comando abre a janela de pesquisa já com o diálogo do índice', (await t.count(W)) === 1 && (await t.count(D)) === 1);

// ---- apagar --------------------------------------------------------------------------------------------------------------------------------------------------------------------
await t.until(`document.querySelector(${lit(dq('sid-delete'))})`, 15000); // o diálogo da paleta abre antes de o estado chegar
await clickD('sid-delete');
await t.until(`document.querySelector(${lit(dq('sid-state'))})?.textContent.trim() === 'Sem índice'`, 15000);
t.check('"Apagar o índice" volta ao estado "Sem índice" e some o que era do índice', (await t.count(dq('sid-files'))) === 0 && (await t.count(dq('sid-delete'))) === 0 && (await t.count(dq('sid-build'))) === 1);
await t.key('Escape');
await t.until(`!document.querySelector(${lit(D)})`, 4000);
const s7 = await search('HA-UNICA');
t.check('sem o índice a busca continua achando, sem selo', s7.n === 1 && s7.badge === null, s7);

// ---- tema claro e inglês ---------------------------------------------------------------------------------------------------------------------------------------------------
await t.key('Escape');
await t.until(`!document.querySelector(${lit(W)})`, 5000);
await t.ev(`localStorage.setItem('gitnexus.locale', 'en'); localStorage.setItem('gitnexus.theme', 'light')`);
await t.ev('location.reload()');
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'si-main')`, 25000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'si-main').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(700);
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 6000);
await clickW('six-manage');
await t.until(`document.querySelector(${lit(D)})`, 5000);
await clickD('sid-build');
await t.until(`/^Ready/.test(document.querySelector(${lit(dq('sid-state'))})?.textContent ?? '')`, 60000);
const enText = (await t.text(D)) ?? '';
t.check('em inglês: título, modos, linhas e botões', /Search index for this repository/.test(enText) && /Automatic/.test(enText) && /Always/.test(enText) && /Never/.test(enText) && /Disk limit/.test(enText) && /Rebuild/.test(enText) && /Delete the index/.test(enText), enText.slice(0, 300));
t.check('em inglês: nenhuma sobra de português no diálogo', !/índice|Índice|Arquivos|Apagar|Reconstruir|Limite/.test(enText), enText.slice(0, 300));
await shot('indice-claro-en');
await t.key('Escape');
await t.until(`!document.querySelector(${lit(D)})`, 4000);
const sEn = await search('A-UNICA');
t.check('em inglês: selo "Accelerated search · N files checked"', /^Accelerated search · [1-3] files? checked$/.test(sEn.badge ?? ''), sEn);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
