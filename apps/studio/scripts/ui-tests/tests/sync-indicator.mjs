// Indicador de sincronização no botão do seletor de branch: ↓N (atrás), ↑N (à frente), divergida, sem upstream e remota apagada, sempre com o
// significado em texto (tooltip e nome acessível). Usa git de verdade, com um remoto local (bare) e um segundo clone que simula outra pessoa.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);

const root = tmpRoot('gn-sync-');
const remote = join(root, 'remote.git');
git(root, 'init', '--bare', '-b', 'main', remote);
const repo = mkRepo(root, 'syncrepo');
git(repo, 'remote', 'add', 'origin', remote);
git(repo, 'push', '-q', '-u', 'origin', 'main');

const other = join(root, 'other');
git(root, 'clone', '-q', remote, other);
for (const [k, v] of [['user.name', 'O'], ['user.email', 'o@e.com'], ['commit.gpgsign', 'false']]) git(other, 'config', k, v);
const commitIn = (dir, file, msg) => {
  writeFileSync(join(dir, file), `${msg}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', msg);
};

await t.until(`document.querySelector('.conn__bar')`, 15000);
await t.openRepo(repo, 'syncrepo');
await t.until(`document.querySelector('.bp__btn .bp__name')?.textContent.trim() === 'main'`, 15000);

const refresh = async () => {
  await t.ev(`document.querySelector('.rv__btns button').click()`);
  await sleep(600);
};
const chips = () => t.ev(`[...document.querySelectorAll('.bp__btn .sync .gn-badge')].map((b) => b.textContent.trim()).join(' ')`);
const state = () => t.ev(`document.querySelector('.bp__btn .sync')?.dataset.sync ?? ''`);
const tip = () => t.ev(`document.querySelector('.bp__btn').title`);
const aria = () => t.ev(`document.querySelector('.bp__btn').getAttribute('aria-label')`);

// --- em dia: nada de indicador, mas o estado está no tooltip e no nome acessível -------------------------------------------------
await t.until(`document.querySelector('.bp__btn').title.includes('Em dia')`, 10000);
t.check('em dia: sem indicador no botão', (await t.count('.bp__btn .sync')) === 0);
t.check('em dia: o tooltip diz "Em dia com origin/main"', /Em dia com origin\/main/.test(await tip()), await tip());
t.check('o nome acessível leva o nome da branch e o estado', (await aria()) === 'main. Em dia com origin/main', await aria());
t.check('o botão continua só com ícone, nome e seta (sem SVG a mais)', (await t.count('.bp__btn svg.gn-icon')) === 2);

// --- atrás: outra pessoa enviou um commit e o clone buscou -----------------------------------------------------------------------------
commitIn(other, 'o1.txt', 'da outra pessoa');
git(other, 'push', '-q', 'origin', 'main');
git(repo, 'fetch', '-q', 'origin');
await refresh();
await t.until(`document.querySelector('.bp__btn .sync')`, 10000);
t.check('atrás: mostra ↓1', (await chips()) === '↓1', await chips());
t.check('atrás: o estado é "behind"', (await state()) === 'behind', await state());
t.check('atrás: o tooltip diz quantos commits e de qual remota', /1 commit atrás de origin\/main/.test(await tip()), await tip());
t.check('a seta ↓ é âmbar (warn)', (await t.count('.bp__btn .sync__behind.gn-badge--warn')) === 1);
await t.shot('sync-atras');

// --- divergida: commit local também ----------------------------------------------------------------------------------------------------
commitIn(repo, 'l1.txt', 'local');
commitIn(repo, 'l2.txt', 'local 2');
await refresh();
await t.until(`document.querySelector('.bp__btn .sync')?.dataset.sync === 'diverged'`, 10000);
t.check('divergida: mostra ↓1 ↑2 e o alerta', (await chips()) === '↓1 ↑2 !', await chips());
t.check('divergida: o tooltip descreve os dois lados', /Divergida de origin\/main: 2 à frente e 1 atrás/.test(await tip()), await tip());
t.check('a seta ↑ é verde (success)', (await t.count('.bp__btn .sync__ahead.gn-badge--success')) === 1);
await t.shot('sync-divergida');

// --- à frente: traz o que faltava (merge) e fica só com os commits locais ----------------------------------------------------------------
git(repo, 'merge', '-q', '--no-edit', 'origin/main');
await refresh();
await t.until(`document.querySelector('.bp__btn .sync')?.dataset.sync === 'ahead'`, 10000);
t.check('à frente: mostra só ↑3 (2 locais + o merge)', (await chips()) === '↑3', await chips());
t.check('à frente: o tooltip no plural', /3 commits à frente de origin\/main/.test(await tip()), await tip());

// --- sem upstream ----------------------------------------------------------------------------------------------------------------------
git(repo, 'checkout', '-q', '-b', 'solta');
await refresh();
await t.until(`document.querySelector('.bp__btn .bp__name')?.textContent.trim() === 'solta' && document.querySelector('.bp__btn .sync')?.dataset.sync === 'no-upstream'`, 10000);
t.check('sem upstream: um ∅ neutro', (await chips()) === '∅', await chips());
t.check('sem upstream: o tooltip explica', /Sem upstream/.test(await tip()), await tip());

// --- remota apagada --------------------------------------------------------------------------------------------------------------------
git(repo, 'push', '-q', '-u', 'origin', 'solta');
git(other, 'fetch', '-q', 'origin');
git(other, 'push', '-q', 'origin', '--delete', 'solta');
git(repo, 'fetch', '-q', '--prune', 'origin');
await refresh();
await t.until(`document.querySelector('.bp__btn .sync')?.dataset.sync === 'gone'`, 10000);
t.check('remota apagada: um ! vermelho', (await chips()) === '!' && (await t.count('.bp__btn .sync__alert.gn-badge--danger')) === 1, await chips());
t.check('remota apagada: o tooltip diz qual', /A branch remota origin\/solta foi apagada/.test(await tip()), await tip());

// --- em inglês --------------------------------------------------------------------------------------------------------------------------
await t.ev(`localStorage.setItem('gitnexus.locale', 'en')`);
await t.ev(`location.reload()`);
await t.until(`document.querySelector('.conn__bar')`, 15000);
await t.openRepo(repo, 'syncrepo');
await t.until(`document.querySelector('.bp__btn .sync')`, 15000);
t.check('em inglês o tooltip também descreve o estado', /The remote branch origin\/solta was deleted/.test(await tip()), await tip());

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
