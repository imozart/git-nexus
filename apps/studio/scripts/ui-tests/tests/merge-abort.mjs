// Merge parado por conflitos: a faixa "Merge em andamento" aparece na tela do repositório e na de conflitos, Continuar só liga depois de resolver,
// e Abortar volta ao estado de antes. Git de verdade.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const root = tmpRoot('gn-ma-');
const repo = mkRepo(root, 'mergerepo', { files: { 'a.txt': 'base\n' } });
const commit = (f, c, m) => {
  writeFileSync(join(repo, f), c);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', m);
};
git(repo, 'checkout', '-q', '-b', 'outro');
commit('a.txt', 'outro\n', 'outro muda');
git(repo, 'checkout', '-q', 'main');
commit('a.txt', 'main\n', 'main muda');
const before = git(repo, 'rev-parse', 'HEAD').trim();
const startMerge = () => {
  try {
    git(repo, 'merge', 'outro');
  } catch {
    /* conflito: é o esperado */
  }
};
startMerge();

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="op-banner"]')`, 20000);

const banner = async () => (await t.text('[data-testid="op-banner"]')) ?? '';
const confirmDialog = async () => {
  await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
  await t.ev(`[...document.querySelectorAll('.dlg__btns button')].pop().click()`);
  await sleep(900);
};
const mergeInProgress = () => {
  try {
    git(repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD');
    return true;
  } catch {
    return false;
  }
};

t.check('a faixa "Merge em andamento" aparece na tela do repositório', /Merge em andamento/.test(await banner()), await banner());
t.check('diz quantos arquivos estão em conflito', /1 arquivo/.test(await banner()), await banner());
t.check('Continuar fica desligado enquanto há conflito', (await t.ev(`document.querySelector('[data-testid="op-continue"]').disabled`)) === true);
await t.shot('merge-em-andamento');

// a mesma faixa na tela de conflitos
await t.ev(`[...document.querySelectorAll('[data-testid="repo-view-tab"]')].find((b) => /Conflitos/.test(b.textContent))?.click()`);
await sleep(1200);
t.check('a tela de conflitos também mostra a faixa (dá para abortar de lá)', (await t.count('[data-testid="op-banner"]')) >= 1);

// --- abortar -------------------------------------------------------------------------------------------------------------------------------
await t.ev(`[...document.querySelectorAll('[data-testid="op-abort"]')].find((b) => b.offsetParent !== null).click()`);
await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
t.check('Abortar pede confirmação e fala em abortar o merge', /Abortar o merge/.test((await t.text('[role="alertdialog"]')) ?? ''));
await confirmDialog();
await sleep(1200);
t.check('o merge foi abortado no git (sem MERGE_HEAD)', mergeInProgress() === false);
t.check('o repositório voltou ao estado de antes (HEAD e arquivo)', git(repo, 'rev-parse', 'HEAD').trim() === before && readFileSync(join(repo, 'a.txt'), 'utf8') === 'main\n');
t.check('a faixa sumiu', (await t.count('[data-testid="op-banner"]')) === 0);

// --- resolver e continuar ---------------------------------------------------------------------------------------------------------------
startMerge();
writeFileSync(join(repo, 'a.txt'), 'resolvido\n');
git(repo, 'add', 'a.txt');
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="op-banner"]')`, 20000);
t.check('sem conflitos pendentes, Continuar liga', (await t.ev(`document.querySelector('[data-testid="op-continue"]').disabled`)) === false, await banner());
await t.ev(`document.querySelector('[data-testid="op-continue"]').click()`);
await t.until(`!document.querySelector('[data-testid="op-banner"]')`, 12000);
t.check('Continuar concluiu o merge (commit com 2 pais, sem merge em andamento)', mergeInProgress() === false && git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length === 3);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
