// Conflitos sob demanda (#284): a visão "Conflitos" só existe enquanto há merge, rebase, cherry-pick ou revert parado (ou arquivo em conflito); a faixa de
// operação aparece em TODAS as visões da aba, com o selo no título; um conflito criado fora do app (terminal) é detectado ao focar a janela; e a visão some
// (voltando à anterior) quando a pendência acaba. Git de verdade: merge e rebase com conflito.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', 'dark')`);

const root = tmpRoot('gn-cso-');
const repo = mkRepo(root, 'sob-demanda', { files: { 'a.txt': 'base\n' } });
git(repo, 'config', 'core.fsmonitor', 'false');
const commit = (f, c, m) => {
  writeFileSync(join(repo, f), c);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', m);
};
git(repo, 'checkout', '-q', '-b', 'outro');
commit('a.txt', 'outro\n', 'outro muda');
git(repo, 'checkout', '-q', 'main');
commit('a.txt', 'main\n', 'main muda');

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelector('li.repo')`, 25000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="repo-views"]')`, 20000);
await sleep(600);

const P = '.core__pane:not([style*="display: none"]) ';
const views = () => t.ev(`[...document.querySelectorAll(${lit(P + '[data-testid="repo-view-tab"]')})].map((b) => b.dataset.view)`);
const goView = (v) => t.ev(`document.querySelector(${lit(P + `[data-testid="repo-view-tab"][data-view="${v}"]`)}).click()`);
const activeView = () => t.ev(`document.querySelector(${lit(P + '[data-testid="repo-view-tab"][aria-selected="true"]')})?.dataset.view`);
const bar = () => t.ev(`document.querySelector(${lit(P + '[data-testid="op-banner"]')})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const tabTitle = () => t.ev(`document.querySelector('.core__tabs [role="tab"][aria-selected="true"]')?.textContent.replace(/\\s+/g, ' ').trim()`);
/** O que o terminal faria por fora: o app só percebe quando a janela ganha o foco de novo. */
const focusWindow = async () => {
  await t.ev(`window.dispatchEvent(new Event('focus'))`);
  await sleep(1200);
};
const sh = (...a) => {
  try {
    return git(repo, ...a);
  } catch {
    return ''; // merge e rebase com conflito terminam com erro: é o esperado
  }
};

// ---- sem operação: a visão não existe -----------------------------------------------------------------------------------------------------------------------------
t.check('sem operação nem conflito, "Conflitos" não está no seletor', JSON.stringify(await views()) === JSON.stringify(['repo', 'graph', 'tools']), await views());
t.check('e não há faixa de operação', (await bar()) === null);

// ---- merge criado FORA do app, detectado ao focar a janela ---------------------------------------------------------------------------------------------------------
sh('merge', 'outro');
await goView('graph'); // a faixa tem de aparecer em QUALQUER visão, não só na de conflitos
await focusWindow();
t.check('um merge com conflito criado no terminal faz "Conflitos" aparecer, com a contagem', JSON.stringify(await views()) === JSON.stringify(['repo', 'graph', 'tools', 'merge']) && /Conflitos \(1\)/.test((await t.text(P + '[data-view="merge"]')) ?? ''), await views());
t.check('a faixa de operação aparece também no Grafo, com o tipo e "Abrir conflitos"', /Merge em andamento/.test((await bar()) ?? '') && (await t.count(P + '[data-testid="op-open"]')) === 1, await bar());
t.check('a faixa é uma região nomeada', (await t.ev(`document.querySelector(${lit(P + '[data-testid="op-bar"]')})?.getAttribute('aria-label')`)) === 'Operação em andamento');
t.check('o título da aba ganha o selo "Conflitos 1"', /Conflitos 1/.test((await tabTitle()) ?? ''), await tabTitle());
await t.shot('conflitos-faixa-no-grafo');

// "Abrir conflitos" leva à visão; abortar por fora faz a visão sumir e voltar ao Grafo
await t.ev(`document.querySelector(${lit(P + '[data-testid="op-open"]')}).click()`);
await sleep(500);
t.check('"Abrir conflitos" abre a visão de conflitos', (await activeView()) === 'merge');
sh('merge', '--abort');
await focusWindow();
t.check('quando a operação acaba, a visão some e o app volta para a visão de antes', (await activeView()) === 'graph' && JSON.stringify(await views()) === JSON.stringify(['repo', 'graph', 'tools']), `${await activeView()} ${await views()}`);
t.check('e a faixa e o selo somem', (await bar()) === null && !/Conflitos 1/.test((await tabTitle()) ?? ''));

// ---- rebase com conflito: progresso, Pular e Abortar ----------------------------------------------------------------------------------------------------------------
git(repo, 'checkout', '-q', 'outro');
sh('rebase', 'main');
await focusWindow();
t.check('rebase com conflito: a faixa mostra o passo e o seletor ganha "Conflitos"', /Rebase em andamento: passo 1 de 1/.test((await bar()) ?? '') && (await views()).includes('merge'), await bar());
t.check('o rebase oferece Pular', (await t.count(P + '[data-testid="op-skip"]')) === 1);
await t.ev(`document.querySelector(${lit(P + '[data-testid="op-skip"]')}).click()`);
await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
await t.ev(`[...document.querySelectorAll('.dlg__btns button')].pop().click()`);
await t.until(`!document.querySelector(${lit(P + '[data-testid="op-banner"]')})`, 15000);
t.check('Pular descarta o commit do passo, termina o rebase e a faixa some', (await bar()) === null && !(await views()).includes('merge') && !sh('status').includes('rebase'));

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
