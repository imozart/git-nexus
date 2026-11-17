// Busca no conteúdo dos arquivos (Ferramentas > Buscar no código): resultados agrupados por arquivo com o trecho destacado, opções (maiúsculas,
// palavra inteira, regex), filtro de caminhos, pré-visualização ao clicar, erro de expressão inválida e abertura pela paleta.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const root = tmpRoot('gn-grep-');
const repo = mkRepo(root, 'greprepo', { files: { 'a.txt': 'um\n' } });
mkdirSync(join(repo, 'src'));
writeFileSync(join(repo, 'src', 'app.ts'), 'export function saudacao() {}\n// TODO: revisar saudacao\nconst SAUDACAO = 1;\n');
writeFileSync(join(repo, 'src', 'util.ts'), 'export const x = 1;\nexport const saudacaoPadrao = "oi";\n');
writeFileSync(join(repo, 'leia.md'), 'A função saudacao diz olá.\n');
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'feat: base');

await t.ev(`window.gitNexus.addRepositoryPath(${JSON.stringify(repo)})`);
await t.ev(`localStorage.setItem('gitnexus.toolsSection', 'search')`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'greprepo')`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'greprepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);

// abre pela paleta (e confere o comando)
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 5000);
await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = 'buscar conteudo'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
const found = await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].some((e) => e.textContent.includes('Buscar no conteúdo dos arquivos'))`);
t.check('a paleta tem "Buscar no conteúdo dos arquivos"', found === true);
await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => e.textContent.includes('Buscar no conteúdo dos arquivos'))?.click()`);
t.check('o painel de busca abre', !!(await t.until(`document.querySelector('[data-testid="search-panel"]')`, 10000)));
t.check('o campo de busca já vem com o foco', (await t.ev(`document.activeElement?.getAttribute('data-testid')`)) === 'search-input');

const type = (testid, v) => t.ev(`(() => { const i = document.querySelector('[data-testid="${testid}"]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const toggle = (testid) => t.ev(`document.querySelector('[data-testid="${testid}"]').click()`);
const summary = () => t.text('[data-testid="search-summary"]');
const fileNames = () => t.ev(`[...document.querySelectorAll('[data-testid="search-file"] .sp__fname')].map((e) => e.textContent.trim())`);
const waitFor = async (expr) => {
  await sleep(500);
  await t.until(expr, 15000);
  await sleep(150);
};

// 1. busca comum (sem diferenciar maiúsculas): acha nos três arquivos
await type('search-input', 'saudacao');
await waitFor(`document.querySelector('[data-testid="search-summary"]')`);
t.check('acha em 3 arquivos, sem diferenciar maiúsculas', JSON.stringify(await fileNames()) === JSON.stringify(['leia.md', 'src/app.ts', 'src/util.ts']), await fileNames());
t.check('o resumo conta ocorrências e arquivos', /^5 ocorrências em 3 arquivos/.test((await summary()) ?? ''), await summary());
t.check('o trecho achado vem destacado', (await t.ev(`document.querySelectorAll('.sp__text mark').length`)) >= 5);
await t.shot('busca-resultados');

// 2. diferenciar maiúsculas
await toggle('search-case');
await waitFor(`document.querySelector('[data-testid="search-summary"]')`);
t.check('com "Aa" não acha mais SAUDACAO', /4 ocorrências/.test((await summary()) ?? ''), await summary());
await type('search-input', 'SAUDACAO');
await waitFor(`/1 ocorrência/.test(document.querySelector('[data-testid="search-summary"]')?.textContent ?? '')`);
t.check('"SAUDACAO" com Aa acha só a constante', /^1 ocorrência em 1 arquivo/.test((await summary()) ?? ''), await summary());
await toggle('search-case');

// 3. palavra inteira
await type('search-input', 'saudacao');
await toggle('search-word');
await waitFor(`!/5 ocorrências/.test(document.querySelector('[data-testid="search-summary"]')?.textContent ?? '5 ocorrências')`);
t.check('palavra inteira não casa "saudacaoPadrao"', !(await fileNames()).includes('src/util.ts'), await fileNames());
await toggle('search-word');

// 4. regex e erro de expressão inválida
await toggle('search-regex');
await type('search-input', 'export (function|const)');
await waitFor(`document.querySelector('[data-testid="search-summary"]')`);
t.check('modo regex acha os "export"', /^3 ocorrências em 2 arquivos/.test((await summary()) ?? ''), await summary());
await type('search-input', 'a(');
await waitFor(`document.querySelector('[data-testid="search-error"]')`);
t.check('expressão inválida mostra o erro e some com os resultados', /inválida/i.test((await t.text('[data-testid="search-error"]')) ?? '') && (await t.count('[data-testid="search-file"]')) === 0, await t.text('[data-testid="search-error"]'));
await toggle('search-regex');

// 5. filtro de caminhos
await type('search-input', 'saudacao');
await type('search-paths', '*.md');
await waitFor(`/1 ocorrência/.test(document.querySelector('[data-testid="search-summary"]')?.textContent ?? '')`);
t.check('o filtro "*.md" deixa só o leia.md', JSON.stringify(await fileNames()) === JSON.stringify(['leia.md']), await fileNames());
await type('search-paths', '');

// 6. sem resultado
await type('search-input', 'texto-que-nao-existe-xyz');
await waitFor(`document.querySelector('[data-testid="search-empty"]')`);
t.check('sem ocorrências: "Nada encontrado."', /Nada encontrado/.test((await t.text('[data-testid="search-empty"]')) ?? ''));

// 7. pré-visualização ao clicar numa ocorrência
await type('search-input', 'revisar');
await waitFor(`document.querySelector('[data-testid="search-match"]')`);
await t.ev(`document.querySelector('[data-testid="search-match"]').click()`);
await t.until(`document.querySelector('[data-testid="search-context"] .sp__code')`, 10000);
const ctx = await t.ev(`[...document.querySelectorAll('[data-testid="search-context"] .sp__cl')].map((e) => e.textContent.trim())`);
t.check('a pré-visualização mostra as linhas ao redor com o número', ctx.length === 3 && ctx[1].startsWith('2') && ctx[1].includes('TODO: revisar saudacao'), ctx);
t.check('a linha da ocorrência fica marcada', (await t.ev(`document.querySelector('[data-testid="search-context"] .sp__cl--hit')?.textContent.includes('TODO')`)) === true);
await t.shot('busca-previa');
await t.ev(`document.querySelector('[data-testid="search-match"]').click()`);
await sleep(300);
t.check('clicar de novo fecha a pré-visualização', (await t.count('[data-testid="search-context"]')) === 0);

// 8. recolher um arquivo
await type('search-input', 'saudacao');
await waitFor(`document.querySelector('[data-testid="search-summary"]')`);
await t.ev(`document.querySelector('[data-testid="search-file"] .sp__fhead').click()`);
await sleep(200);
t.check('clicar no arquivo recolhe as ocorrências dele', (await t.ev(`document.querySelector('[data-testid="search-file"]').querySelectorAll('[data-testid="search-match"]').length`)) === 0);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
