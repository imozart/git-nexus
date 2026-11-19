// Comparação com a branch base (origin/main): uma feature branch SEM upstream (como as que o app cria) mostra "↓N main" no botão e, no painel,
// "Em relação a origin/main: ↑A ↓B" com Merge e Rebase da base. Na própria main não aparece nada. Git de verdade, com remoto local.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`); // o teste controla quando o clone busca

const root = tmpRoot('gn-base-');
const remote = join(root, 'remote.git');
git(root, 'init', '--bare', '-b', 'main', remote);
const repo = mkRepo(root, 'baserepo');
git(repo, 'remote', 'add', 'origin', remote);
git(repo, 'push', '-q', '-u', 'origin', 'main');
git(repo, 'remote', 'set-head', 'origin', 'main');

const other = join(root, 'other');
git(root, 'clone', '-q', remote, other);
for (const [k, v] of [['user.name', 'O'], ['user.email', 'o@e.com'], ['commit.gpgsign', 'false']]) git(other, 'config', k, v);
const commitIn = (dir, file, msg) => {
  writeFileSync(join(dir, file), `${msg}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', msg);
};

// feature branch como o app cria: a partir da origin/main, SEM acompanhar nada; 2 commits locais; a main do remoto anda 3 commits
git(repo, 'checkout', '-q', '-b', 'feat/x', '--no-track', 'origin/main');
commitIn(repo, 'f1.txt', 'feature 1');
commitIn(repo, 'f2.txt', 'feature 2');
for (const n of [1, 2, 3]) commitIn(other, `o${n}.txt`, `main andou ${n}`);
git(other, 'push', '-q', 'origin', 'main');
git(repo, 'fetch', '-q', 'origin');

await t.until(`document.querySelector('.conn__bar')`, 15000);
await t.openRepo(repo, 'baserepo');
await t.until(`document.querySelector('.bp__btn .bp__name')?.textContent.trim() === 'feat/x'`, 15000);
await t.until(`document.querySelector('.bp__basechip')`, 10000);
const chip = () => t.ev(`document.querySelector('.bp__basechip')?.textContent.trim() ?? ''`);
const tip = () => t.ev(`document.querySelector('.bp__btn').title`);
const refresh = async () => {
  await t.ev(`document.querySelector('.rv__btns button').click()`);
  await sleep(600);
};
const openPanel = async () => {
  await t.ev(`document.querySelector('.bp__btn').click()`);
  await t.until(`document.querySelector('.bp__panel [data-testid="auto-fetch"]')`, 8000);
};

// --- no botão: sem upstream, mas com o quanto está atrás da main ---------------------------------------------------------------------
t.check('sem upstream: o ∅ neutro continua lá', (await t.ev(`document.querySelector('.bp__btn .sync')?.dataset.sync`)) === 'no-upstream');
t.check('o chip diz "↓3 main"', (await chip()) === '↓3 main', await chip());
t.check('o tooltip descreve a relação com a base por extenso', /Divergida de origin\/main: 2 à frente e 3 atrás/.test(await tip()), await tip());
t.check('o nome acessível também', /Divergida de origin\/main/.test(await t.ev(`document.querySelector('.bp__btn').getAttribute('aria-label')`)));
t.check('o botão continua só com ícone, nome e seta (sem SVG a mais)', (await t.count('.bp__btn svg.gn-icon')) === 2);
await t.shot('base-chip');

// --- no painel: a linha e as duas ações -----------------------------------------------------------------------------------------------
await openPanel();
t.check('o painel mostra "Em relação a origin/main: ↑2 ↓3"', (await t.text('[data-testid="base-info"]')) === 'Em relação a origin/main: ↑2 ↓3', await t.text('[data-testid="base-info"]'));
t.check('oferece merge e rebase da base', (await t.text('[data-testid="base-merge"]')) === "Merge de 'origin/main' em 'feat/x'" && (await t.text('[data-testid="base-rebase"]')) === "Rebase de 'feat/x' sobre 'origin/main'");
await t.shot('base-painel');

// --- merge da base: traz os 3 commits e o chip some ------------------------------------------------------------------------------------
await t.ev(`document.querySelector('[data-testid="base-merge"]').click()`);
await t.until(`!document.querySelector('.bp__basechip')`, 15000);
t.check('o merge trouxe a base para a branch', git(repo, 'merge-base', '--is-ancestor', 'origin/main', 'HEAD') === '');
t.check('o chip sumiu: não está mais atrás', (await t.count('.bp__basechip')) === 0);
t.check('avisa o merge', /Merge de 'origin\/main' concluído/.test((await t.text('.rv__notice')) ?? ''), await t.text('.rv__notice'));
await openPanel();
t.check('já em dia com a base: a linha continua, sem botões de atualizar', (await t.count('[data-testid="base-info"]')) === 1 && (await t.count('[data-testid="base-merge"]')) === 0);
t.check('a linha agora mostra ↓0', /↓0$/.test((await t.text('[data-testid="base-info"]')) ?? ''), await t.text('[data-testid="base-info"]'));
await t.key('Escape');
await sleep(200);

// --- rebase da base: pede confirmação -----------------------------------------------------------------------------------------------------
git(repo, 'checkout', '-q', '-b', 'feat/r', '--no-track', 'HEAD~1'); // uma branch atrás
commitIn(other, 'o4.txt', 'main andou 4');
git(other, 'push', '-q', 'origin', 'main');
git(repo, 'fetch', '-q', 'origin');
await refresh();
await t.until(`document.querySelector('.bp__btn .bp__name')?.textContent.trim() === 'feat/r' && document.querySelector('.bp__basechip')`, 10000);
await openPanel();
await t.ev(`document.querySelector('[data-testid="base-rebase"]').click()`);
await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
t.check('o rebase pede confirmação (reescreve a história)', /Rebase/.test((await t.text('[role="alertdialog"]')) ?? ''), await t.text('[role="alertdialog"]'));
await t.ev(`[...document.querySelectorAll('.dlg__btns button')].at(-1).click()`);
await t.until(`!document.querySelector('.bp__basechip')`, 15000);
t.check('o rebase reaplicou a branch sobre a origin/main', git(repo, 'merge-base', '--is-ancestor', 'origin/main', 'HEAD') === '');

// --- na própria main não aparece nada ---------------------------------------------------------------------------------------------------------
await sleep(1500); // deixa os refreshes do rebase terminarem antes de mexer no repositório por fora
git(repo, 'checkout', '-q', 'main');
await refresh();
await t.until(`document.querySelector('.bp__btn .bp__name')?.textContent.trim() === 'main' && !document.querySelector('.bp__basechip')`, 15000);
t.check('na main: sem chip da base', (await t.count('.bp__basechip')) === 0, [await chip(), await tip(), git(repo, 'branch', '--show-current')]);
await openPanel();
t.check('na main: sem a linha "Em relação a…"', (await t.count('[data-testid="base-info"]')) === 0);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
