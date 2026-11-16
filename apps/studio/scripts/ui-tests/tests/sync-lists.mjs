// O MESMO indicador de sincronização em todas as telas: lista de repositórios (em dia, atrás, divergida, remota apagada) e linhas do seletor de
// branch, mais o filtro "Só desatualizadas". Git de verdade, com remotos locais.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.removeItem('gitnexus.branchPicker.expanded')`);

const root = tmpRoot('gn-sl-');
const commitIn = (dir, file, msg) => {
  writeFileSync(join(dir, file), `${msg}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', msg);
};
/** Remoto (bare) + clone `repo` com upstream + segundo clone `other` (outra pessoa). */
function scenario(name) {
  const remote = join(root, `${name}.git`);
  git(root, 'init', '--bare', '-b', 'main', remote);
  const repo = mkRepo(root, name);
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(repo, 'remote', 'set-head', 'origin', 'main');
  const other = join(root, `${name}-other`);
  git(root, 'clone', '-q', remote, other);
  for (const [k, v] of [['user.name', 'O'], ['user.email', 'o@e.com'], ['commit.gpgsign', 'false']]) git(other, 'config', k, v);
  return { remote, repo, other };
}
const pushOther = (s, file, msg, branch = 'main') => {
  git(s.other, 'checkout', '-q', branch);
  commitIn(s.other, file, msg);
  git(s.other, 'push', '-q', 'origin', branch);
  git(s.repo, 'fetch', '-q', 'origin');
};

// repositórios: um em cada estado
const behind = scenario('listbehind');
pushOther(behind, 'o.txt', 'remoto');

const diverged = scenario('listdiv');
pushOther(diverged, 'o.txt', 'remoto');
commitIn(diverged.repo, 'l.txt', 'local');

const ok = scenario('listok');

const gone = scenario('listgone'); // o repositório do seletor: main atrás, feat/ok em dia, feat/local sem upstream, feat/gone (atual) com a remota apagada
git(gone.repo, 'branch', 'feat/ok');
git(gone.repo, 'push', '-q', '-u', 'origin', 'feat/ok');
git(gone.repo, 'branch', 'feat/local');
git(gone.repo, 'checkout', '-q', '-b', 'feat/gone');
git(gone.repo, 'push', '-q', '-u', 'origin', 'feat/gone');
git(gone.other, 'fetch', '-q', 'origin');
git(gone.other, 'push', '-q', 'origin', '--delete', 'feat/gone');
pushOther(gone, 'o.txt', 'remoto na main', 'main');
git(gone.repo, 'fetch', '-q', '--prune', 'origin');

for (const s of [behind, diverged, ok, gone]) await t.ev(`window.gitNexus.addRepositoryPath(${JSON.stringify(s.repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 4`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);

const row = (name) => `[...document.querySelectorAll('li.repo')].find((r) => r.querySelector('strong')?.textContent.trim() === ${JSON.stringify(name)})`;
const rowChips = (name) => t.ev(`[...${row(name)}.querySelectorAll('.sync .gn-badge')].map((b) => b.textContent.trim()).join(' ')`);
const rowState = (name) => t.ev(`${row(name)}.querySelector('.sync')?.dataset.sync ?? ''`);
const rowHasOk = (name) => t.ev(`/em dia/.test(${row(name)}.querySelector('.repo__state').textContent)`);

// --- lista de repositórios -------------------------------------------------------------------------------------------------------------------
t.check('atrás: ↓1 e nada de "em dia"', (await rowChips('listbehind')) === '↓1' && (await rowState('listbehind')) === 'behind' && !(await rowHasOk('listbehind')), [await rowChips('listbehind'), await rowState('listbehind'), await t.ev(`${row('listbehind')}.querySelector('.repo__state').textContent`)]);
t.check('divergida: ↓1 ↑1 e o alerta', (await rowChips('listdiv')) === '↓1 ↑1 !' && (await rowState('listdiv')) === 'diverged', [await rowChips('listdiv'), await rowState('listdiv')]);
t.check('divergida: o tooltip diz por extenso', /Divergida de origin\/main: 1 à frente e 1 atrás/.test(await t.ev(`${row('listdiv')}.querySelector('.sync').title`)), await t.ev(`${row('listdiv')}.querySelector('.sync').title`));
t.check('em dia: só a etiqueta "em dia", sem indicador', (await rowState('listok')) === '' && (await rowHasOk('listok')) === true);
t.check('remota apagada: o ! vermelho e NÃO diz "em dia" (antes dizia)', (await rowState('listgone')) === 'gone' && (await rowChips('listgone')) === '!' && !(await rowHasOk('listgone')), [await rowChips('listgone'), await rowState('listgone')]);
t.check('as setas vêm do mesmo componente: ↓ âmbar e ↑ verde', (await t.ev(`!!${row('listdiv')}.querySelector('.sync__behind.gn-badge--warn') && !!${row('listdiv')}.querySelector('.sync__ahead.gn-badge--success')`)) === true);
t.check('o indicador é um img com o texto por extenso (leitor de tela)', (await t.ev(`${row('listdiv')}.querySelector('.sync').getAttribute('role')`)) === 'img' && /Divergida/.test(await t.ev(`${row('listdiv')}.querySelector('.sync').getAttribute('aria-label')`)));
await t.shot('sync-lista');

// "Só com pendências" não esconde a branch cuja remota foi apagada
await t.ev(`[...document.querySelectorAll('input[type=checkbox]')].find((i) => /pend/i.test(i.closest('label')?.textContent ?? ''))?.click()`);
await sleep(300);
const shown = await t.ev(`[...document.querySelectorAll('li.repo strong')].map((s) => s.textContent.trim()).sort().join(',')`);
t.check('"Só com pendências" mostra atrás, divergida e remota apagada, e esconde o que está em dia', shown === 'listbehind,listdiv,listgone', shown);

// --- seletor de branch ------------------------------------------------------------------------------------------------------------------------
await t.openRepo(gone.repo, 'listgone');
await t.until(`document.querySelector('.bp__btn .bp__name')?.textContent.trim() === 'feat/gone'`, 20000);
await t.ev(`document.querySelector('.bp__btn').click()`);
await t.until(`document.querySelector('.bp__row')`, 8000);
const rowOf = (n) => `document.querySelector('.bp__row[data-branch="local:${n}"]')`;
const rowSyncState = (n) => t.ev(`${rowOf(n)}?.querySelector('.sync')?.dataset.sync ?? ''`);
t.check('linha da main: atrás', (await rowSyncState('main')) === 'behind', await rowSyncState('main'));
t.check('linha da branch com a remota apagada: gone', (await rowSyncState('feat/gone')) === 'gone');
t.check('linha em dia: sem indicador', (await rowSyncState('feat/ok')) === '');
t.check('linha sem upstream: sem ∅ (nas listas seria ruído)', (await rowSyncState('feat/local')) === '');
t.check('as linhas usam o mesmo componente (mesmas cores)', (await t.ev(`!!${rowOf('main')}.querySelector('.sync__behind.gn-badge--warn')`)) === true);
// a main também aparece em "Recentes": conta cada branch uma vez
const rowNames = () => t.ev(`[...new Set([...document.querySelectorAll('.bp__row')].map((r) => r.dataset.branch))].join(',')`);

// --- filtro "Só desatualizadas" -----------------------------------------------------------------------------------------------------------------
t.check('o filtro existe e começa desligado', (await t.ev(`document.querySelector('[data-testid="stale-filter"]').checked`)) === false);
await t.ev(`document.querySelector('[data-testid="stale-filter"]').click()`);
await sleep(300);
const stale = await rowNames();
t.check('ligado: só a main (atrás) e a feat/gone (remota apagada); remotas somem', stale.split(',').sort().join(',') === 'local:feat/gone,local:main', stale);
t.check('ligado: as seções ficam abertas', (await t.ev(`[...document.querySelectorAll('.bp__sec')].every((b) => b.getAttribute('aria-expanded') === 'true')`)) === true);
await t.ev(`(() => { const i = document.querySelector('.bp__search input'); i.value = 'gone'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
t.check('junto da pesquisa: só a que combina com "gone"', (await rowNames()) === 'local:feat/gone', await rowNames());
await t.ev(`(() => { const i = document.querySelector('.bp__search input'); i.value = 'feat/ok'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
t.check('uma em dia some com o filtro ligado', (await t.count('.bp__row')) === 0);
await t.ev(`document.querySelector('[data-testid="stale-filter"]').click()`);
await sleep(300);
t.check('desligado: a feat/ok volta (a local e a remota que combinam com a pesquisa)', (await rowNames()) === 'local:feat/ok,remote:origin/feat/ok', await rowNames());
await t.shot('sync-seletor-filtro');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
