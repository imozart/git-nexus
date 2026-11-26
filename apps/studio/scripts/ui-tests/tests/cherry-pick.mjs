// Cherry-pick e revert pelo grafo: aplicar um commit de outra branch, reverter, e a faixa "em andamento" quando para por conflitos
// (Continuar fica desligado até resolver; Abortar volta ao estado de antes). Git de verdade.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const root = tmpRoot('gn-cp-');
const repo = mkRepo(root, 'cprepo', { files: { 'a.txt': 'base\n' } });
const commit = (f, c, m) => {
  writeFileSync(join(repo, f), c);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', m);
};
git(repo, 'checkout', '-q', '-b', 'feature');
commit('novo.txt', 'novo\n', 'feat: arquivo novo');
commit('a.txt', 'da feature\n', 'feat: muda o a na feature');
git(repo, 'checkout', '-q', 'main');
commit('a.txt', 'da main\n', 'feat: muda o a na main');

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);

const openGraph = async () => {
  await t.ev(`[...document.querySelectorAll('[data-testid="repo-view-tab"]')].find((b) => /Grafo/.test(b.textContent))?.click()`);
  await t.until(`document.querySelector('.gv__detail, .row')`, 15000);
  await sleep(500);
};
const selectCommit = async (subject) => {
  await t.until(`[...document.querySelectorAll('.row')].some((r) => r.textContent.includes(${lit(subject)}))`, 15000);
  await t.ev(`[...document.querySelectorAll('.row')].find((r) => r.textContent.includes(${lit(subject)})).click()`);
  await t.until(`document.querySelector('[data-testid="cherry-pick"]')`, 8000);
};
const confirmDialog = async () => {
  await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
  await t.ev(`[...document.querySelectorAll('.dlg__btns button')].pop().click()`);
  await sleep(900);
};
const headSubject = () => git(repo, 'log', '-1', '--format=%s').trim();

await openGraph();

// --- cherry-pick limpo ------------------------------------------------------------------------------------------------------------------
await selectCommit('feat: arquivo novo');
t.check('o detalhe do commit tem Cherry-pick e Reverter', (await t.count('[data-testid="cherry-pick"], [data-testid="revert"]')) === 2);
await t.ev(`document.querySelector('[data-testid="cherry-pick"]').click()`);
await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
t.check('pede confirmação, com o hash e o assunto', /feat: arquivo novo/.test((await t.text('[role="alertdialog"]')) ?? ''));
await confirmDialog();
await t.until(`document.querySelector('[data-testid="gv-op-notice"]')`, 8000);
t.check('mostra o resultado', /cherry-pick/i.test((await t.text('[data-testid="gv-op-notice"]')) ?? ''), await t.text('[data-testid="gv-op-notice"]'));
t.check('o commit foi aplicado na main (mesmo assunto, arquivo novo presente)', headSubject() === 'feat: arquivo novo' && readFileSync(join(repo, 'novo.txt'), 'utf8') === 'novo\n', headSubject());

// --- revert -------------------------------------------------------------------------------------------------------------------------
await selectCommit('feat: arquivo novo');
await t.ev(`document.querySelector('[data-testid="revert"]').click()`);
await confirmDialog();
await t.until(`/revertido/i.test(document.querySelector('[data-testid="gv-op-notice"]')?.textContent ?? '')`, 8000);
t.check('o revert criou o commit que desfaz', /^Revert "feat: arquivo novo"/.test(headSubject()), headSubject());
t.check('o arquivo voltou a não existir', !(() => { try { readFileSync(join(repo, 'novo.txt')); return true; } catch { return false; } })());

// --- conflito: faixa em andamento ----------------------------------------------------------------------------------------------------
await selectCommit('feat: muda o a na feature');
await t.ev(`document.querySelector('[data-testid="cherry-pick"]').click()`);
await confirmDialog();
await sleep(800);
t.check('parou por conflitos: o git deixou o cherry-pick em andamento', git(repo, 'rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD').trim().length > 0);
// volta para a tela de staging (o app abre a de conflitos sozinho)
await t.ev(`[...document.querySelectorAll('.gn-tab')].find((e) => /Staging/.test(e.textContent))?.click()`);
await t.until(`document.querySelector('[data-testid="op-banner"]')`, 10000);
t.check('a faixa "Cherry-pick em andamento" aparece', /Cherry-pick em andamento/.test((await t.text('[data-testid="op-banner"]')) ?? ''), await t.text('[data-testid="op-banner"]'));
t.check('Continuar fica desligado enquanto há conflitos', (await t.ev(`document.querySelector('[data-testid="op-continue"]').disabled`)) === true);
await t.shot('cherry-pick-em-andamento');

await t.ev(`document.querySelector('[data-testid="op-abort"]').click()`);
await confirmDialog();
await t.until(`!document.querySelector('[data-testid="op-banner"]')`, 10000);
t.check('Abortar tira a faixa', (await t.count('[data-testid="op-banner"]')) === 0);
t.check('o repositório voltou ao estado de antes (sem operação, sem conflito, a.txt como estava)', (() => { try { git(repo, 'rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD'); return false; } catch { return readFileSync(join(repo, 'a.txt'), 'utf8') === 'da main\n'; } })());

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
