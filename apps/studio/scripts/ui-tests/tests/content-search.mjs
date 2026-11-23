// Pesquisar no repositório (Ctrl+F): a janela abre por Ctrl+F, Ctrl+Shift+F e pela paleta; resultados agrupados por arquivo com o trecho destacado,
// opções (maiúsculas, palavra inteira, regex), máscara de arquivos, erro de expressão inválida, ocorrência aberta no editor de baixo (com todas as
// ocorrências destacadas), recolher um arquivo, teclado (↓/↑, Enter, F3, Ctrl+Alt+↓), janela que lembra o texto, e nenhum erro no console.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.removeItem('gitnexus.searchWindow')`);

const root = tmpRoot('gn-grep-');
const repo = mkRepo(root, 'greprepo', { files: { 'a.txt': 'um\n' } });
mkdirSync(join(repo, 'src'));
writeFileSync(join(repo, 'src', 'app.ts'), 'export function saudacao() {}\n// TODO: revisar saudacao\nconst SAUDACAO = 1;\n');
writeFileSync(join(repo, 'src', 'util.ts'), 'export const x = 1;\nexport const saudacaoPadrao = "oi";\n');
writeFileSync(join(repo, 'leia.md'), 'A função saudacao diz olá.\n');
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'feat: base');

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'greprepo')`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'greprepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);

const W = '[data-testid="search-window"]';
const F = `${W} [data-testid="sf-input"]`;
const typeInto = async (sel, text) => {
  await t.ev(`(() => { const e = document.querySelector(${lit(sel)}); e.focus(); e.select(); })()`);
  await t.send('Input.insertText', { text });
  await sleep(120);
};
const count = () => t.ev(`document.querySelector('[data-testid="sw-count"]')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
const waitCount = (re, ms = 15000) => t.until(`new RegExp(${lit(re)}).test(document.querySelector('[data-testid="sw-count"]')?.textContent ?? '')`, ms);
const files = () => t.ev(`[...document.querySelectorAll('[data-testid="sw-file-row"] .sw__fname')].map((e) => e.textContent.trim())`);
const hits = () => t.count('[data-testid="sw-row"]');
const click = (testid) => t.ev(`document.querySelector('[data-testid="${testid}"]').click()`);

// ---- abrir: pela paleta, por Ctrl+F e por Ctrl+Shift+F ---------------------------------------------------------------------------------------
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 5000);
await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = 'pesquisar no repositorio'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
const entry = await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => e.textContent.includes('Pesquisar no repositório'))?.textContent ?? null`);
t.check('a paleta tem "Pesquisar no repositório" com o atalho Ctrl+F', /Pesquisar no repositório/.test(entry ?? '') && /Ctrl\+F/.test(entry ?? ''), entry);
await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => e.textContent.includes('Pesquisar no repositório'))?.click()`);
t.check('a janela abre pela paleta', !!(await t.until(`document.querySelector(${lit(W)})`, 10000)));
t.check('o campo de pesquisa já vem com o foco', (await t.ev(`document.activeElement === document.querySelector(${lit(F)})`)) === true);
t.check('a janela é um diálogo nomeado', (await t.ev(`(() => { const d = document.querySelector('[role="dialog"]'); return d?.getAttribute('aria-label') === 'Pesquisar no repositório'; })()`)) === true);
t.check('sem texto, a janela explica o que vale na pesquisa', /Digite para pesquisar/.test((await t.text('[data-testid="sw-hint"]')) ?? ''));
await t.key('Escape');
await sleep(300);
t.check('Esc fecha a janela', (await t.count(W)) === 0);
await t.key('f', 2);
t.check('Ctrl+F abre a janela', !!(await t.until(`document.querySelector(${lit(W)})`, 5000)));
await t.key('Escape');
await sleep(300);
await t.key('f', 6);
t.check('Ctrl+Shift+F abre a mesma janela', !!(await t.until(`document.querySelector(${lit(W)})`, 5000)));
t.check('a barra de Ferramentas não tem mais a aba "Buscar no código"', (await t.ev(`!/Buscar no código/.test(document.body.innerText)`)) === true);

// 1. pesquisa comum (sem diferenciar maiúsculas): acha nos três arquivos
await typeInto(F, 'saudacao');
await waitCount('^5 ocorrências em 3 arquivos');
t.check('acha em 3 arquivos, sem diferenciar maiúsculas', JSON.stringify(await files()) === JSON.stringify(['leia.md', 'src/app.ts', 'src/util.ts']), await files());
t.check('o contador conta ocorrências, arquivos e o tempo', /^5 ocorrências em 3 arquivos · \d+,\d s$/.test(await count()), await count());
t.check('o trecho achado vem destacado na lista', (await t.count('[data-testid="sw-row"] mark')) >= 5);
t.check('a lista é um listbox com opções', (await t.ev(`(() => { const l = document.querySelector('[data-testid="sw-list"]'); return l.getAttribute('role') === 'listbox' && !!l.getAttribute('aria-label') && l.querySelector('[role="option"]'); })()`)) !== false);
await t.shot('pesquisa-resultados');

// 2. diferenciar maiúsculas
await click('sf-case');
await waitCount('^4 ocorrências');
t.check('com "Aa" não acha mais SAUDACAO', /^4 ocorrências/.test(await count()), await count());
await typeInto(F, 'SAUDACAO');
await waitCount('^1 ocorrência em 1 arquivo');
t.check('"SAUDACAO" com Aa acha só a constante', /^1 ocorrência em 1 arquivo/.test(await count()), await count());
await click('sf-case');

// 3. palavra inteira
await typeInto(F, 'saudacao');
await waitCount('^5 ocorrências');
await click('sf-word');
await waitCount('^4 ocorrências');
t.check('palavra inteira não casa "saudacaoPadrao"', !(await files()).includes('src/util.ts'), await files());
await click('sf-word');

// 4. regex e expressão inválida
await click('sf-regex');
await typeInto(F, 'export (function|const)');
await waitCount('^3 ocorrências em 2 arquivos');
t.check('modo regex acha os "export"', /^3 ocorrências em 2 arquivos/.test(await count()), await count());
await typeInto(F, 'a(');
await t.until(`document.querySelector('[data-testid="sf-error"]')`, 5000);
t.check('expressão inválida: mensagem no campo e nenhum resultado', /inválida/i.test((await t.text('[data-testid="sf-error"]')) ?? '') && (await t.count('[data-testid="sw-file-row"]')) === 0, await t.text('[data-testid="sf-error"]'));
await click('sf-regex');

// 5. máscara de arquivos
await typeInto(F, 'saudacao');
await waitCount('^5 ocorrências');
await typeInto(`${W} [data-testid="sw-masks"]`, '*.md');
await waitCount('^1 ocorrência em 1 arquivo');
t.check('a máscara "*.md" deixa só o leia.md', JSON.stringify(await files()) === JSON.stringify(['leia.md']), await files());
await typeInto(`${W} [data-testid="sw-masks"]`, '*.ts, !util.ts');
await waitCount('^3 ocorrências em 1 arquivo');
t.check('máscara com exclusão ("*.ts, !util.ts")', JSON.stringify(await files()) === JSON.stringify(['src/app.ts']), await files());
await typeInto(`${W} [data-testid="sw-masks"]`, '');

// 6. sem resultado
await typeInto(F, 'texto-que-nao-existe-xyz');
await t.until(`document.querySelector('[data-testid="sw-empty"]')`, 15000);
t.check('sem ocorrências: "Nada encontrado."', /Nada encontrado/.test((await t.text('[data-testid="sw-empty"]')) ?? ''));

// 7. abrir a ocorrência no editor de baixo
await typeInto(F, 'revisar');
await waitCount('^1 ocorrência');
await click('sw-row');
await t.until(`document.querySelector('[data-testid="sw-path"]')?.textContent.trim() === 'src/app.ts' && document.querySelector('${W} .cm-content')`, 10000);
t.check('selecionar a ocorrência abre o arquivo no editor de baixo', (await t.text('[data-testid="sw-path"]')) === 'src/app.ts');
t.check('mostra codificação e fim de linha', /UTF-8/.test((await t.text('[data-testid="sw-encoding"]')) ?? '') && (await t.text('[data-testid="sw-eol"]')) === 'LF', [await t.text('[data-testid="sw-encoding"]'), await t.text('[data-testid="sw-eol"]')]);
t.check('o editor traz o arquivo com a ocorrência destacada (colunas do núcleo)', (await t.ev(`document.querySelector(${lit(W + ' .cm-content')}).innerText.includes('TODO: revisar saudacao')`)) === true && (await t.count(`${W} .cm-gn-find`)) === 1);
t.check('o editor abre editável e sem "alterado"', (await t.ev(`document.querySelector(${lit(W + ' .cm-content')}).getAttribute('contenteditable')`)) === 'true' && (await t.count('[data-testid="sw-dirty"]')) === 0);
await t.shot('pesquisa-arquivo');

// 8. recolher um arquivo
await typeInto(F, 'saudacao');
await waitCount('^5 ocorrências');
await click('sw-file-row');
await sleep(300);
t.check('clicar no arquivo recolhe as ocorrências dele', (await hits()) === 5 - 1 || (await hits()) < 5, await hits());
await click('sw-file-row');
await sleep(300);

// 9. teclado: ↓/↑ pelos resultados com o foco no campo, Enter leva ao editor, F3 anda, Ctrl+Alt+↓ vai ao próximo arquivo
await t.ev(`document.querySelector(${lit(F)}).focus()`);
await t.key('ArrowDown');
await sleep(250);
const sel = () => t.ev(`document.querySelector('.sw__row--sel')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const s1 = await sel();
await t.key('ArrowDown');
await sleep(250);
const s2 = await sel();
t.check('↓ com o foco no campo anda pelas ocorrências (pulando cabeçalhos)', !!s1 && !!s2 && s1 !== s2 && !/^leia\.md|^src\//.test(s2), [s1, s2]);
await t.key('ArrowUp');
await sleep(250);
t.check('↑ volta', (await sel()) === s1, [await sel(), s1]);
await t.key('F3');
await sleep(250);
t.check('F3 vai para a próxima ocorrência', (await sel()) === s2, [await sel(), s2]);
await t.key('F3', 8);
await sleep(250);
t.check('Shift+F3 volta', (await sel()) === s1, [await sel(), s1]);
for (let i = 0; i < 3; i++) await t.key('ArrowUp', 3); // Ctrl+Alt+↑ até o primeiro arquivo
await sleep(500);
t.check('Ctrl+Alt+↑ vai ao primeiro resultado do arquivo anterior (até o primeiro arquivo)', (await t.text('[data-testid="sw-path"]')) === 'leia.md', await t.text('[data-testid="sw-path"]'));
await t.key('ArrowDown', 3); // Ctrl+Alt+↓
await sleep(500);
t.check('Ctrl+Alt+↓ pula para o primeiro resultado do arquivo seguinte', (await t.text('[data-testid="sw-path"]')) === 'src/app.ts', await t.text('[data-testid="sw-path"]'));
await t.ev(`document.querySelector(${lit(F)}).focus()`);
await t.key('Enter');
await sleep(300);
t.check('Enter leva o foco ao editor', (await t.ev(`!!document.activeElement.closest('.cm-editor')`)) === true);

// 10. a janela lembra o texto e as opções
await t.key('Escape');
await sleep(300);
t.check('Esc com o foco no editor fecha a janela (a barra do arquivo está fechada)', (await t.count(W)) === 0);
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 5000);
t.check('reabrir mostra o último texto pesquisado', (await t.ev(`document.querySelector(${lit(F)}).value`)) === 'saudacao');
await waitCount('^5 ocorrências em 3 arquivos');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
