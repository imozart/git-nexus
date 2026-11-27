// Filtros do Grafo (#294), na interface e conferidos contra o Git: o padrão é o branch atual; o popover liga cada filtro e a lista, o contador "N de M" e os chips batem com o
// `git log` direto; autor (com "Só eu"), período, pasta, sem merges, não publicados; chips removíveis e "Limpar tudo"; favoritos; o filtro fica lembrado ao reabrir; teclado (Esc, foco).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.send('Page.bringToFront');
await t.send('Emulation.setFocusEmulationEnabled', { enabled: true });
const theme = process.env.GN_GRAPH_THEME ?? 'dark';
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', ${lit(theme)})`);
for (const k of Object.keys(await t.ev(`Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('gitnexus.graph') || k.startsWith('gitnexus.repoView.')))`))) await t.ev(`localStorage.removeItem(${lit(k)})`);

const root = tmpRoot('gn-gfil-');
const bare = join(root, 'o.git');
git(root, 'init', '-q', '--bare', '-b', 'main', bare);
const R = join(root, 'filtros-repo');
git(root, 'init', '-q', '-b', 'main', R);
for (const [k, v] of [['commit.gpgsign', 'false'], ['core.fsmonitor', 'false'], ['core.autocrlf', 'false'], ['user.name', 'Ana Souza'], ['user.email', 'ana@e.com']]) git(R, 'config', k, v);
git(R, 'remote', 'add', 'origin', bare);
const dias = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
let n = 0;
const commit = (who, email, msg, file, date) => {
  mkdirSync(join(R, file, '..'), { recursive: true });
  writeFileSync(join(R, file), `${++n}\n`);
  git(R, 'add', '.');
  execFileSync('git', ['commit', '-qm', msg], { cwd: R, env: { ...process.env, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
};
commit('Ana Souza', 'ana@e.com', 'a1 raiz', 'src/a.txt', dias(40));
commit('Bruno Lima', 'bruno@e.com', 'b1 docs', 'docs/b.txt', dias(30));
git(R, 'checkout', '-qb', 'lateral');
commit('Carla Dias', 'carla@e.com', 'c1 lateral', 'src/l.txt', dias(20));
git(R, 'checkout', '-q', 'main');
commit('Bruno Lima', 'bruno@e.com', 'b2 main', 'docs/c.txt', dias(15));
execFileSync('git', ['merge', '--no-ff', '-m', 'm1 merge lateral', 'lateral'], { cwd: R, env: { ...process.env, GIT_AUTHOR_NAME: 'Ana Souza', GIT_AUTHOR_EMAIL: 'ana@e.com', GIT_COMMITTER_NAME: 'Ana Souza', GIT_COMMITTER_EMAIL: 'ana@e.com', GIT_AUTHOR_DATE: dias(14), GIT_COMMITTER_DATE: dias(14) } });
git(R, 'push', '-qu', 'origin', 'main');
git(R, 'checkout', '-qb', 'solta');
commit('Dani Rocha', 'dani@e.com', 'd1 so na solta', 'docs/d.txt', dias(5));
git(R, 'checkout', '-q', 'main');
commit('Ana Souza', 'ana@e.com', 'a2 local', 'src/a2.txt', dias(1));

const subj = (...a) => git(R, 'log', '--format=%s', ...a).trim().split('\n').filter(Boolean);
await t.ev(`window.gitNexus.addRepositoryPath(${lit(R)})`);
await t.ev('location.reload()');
await t.until(`document.querySelector('li.repo')`, 20000);
const open = async () => {
  await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
  await t.until(`document.querySelector('[data-testid="repo-views"]')`, 15000);
  await sleep(700);
  await t.ev(`document.querySelector('.core__pane:not([style*="display: none"]) [data-view="graph"]').click()`);
  await t.until(`document.querySelector('[data-testid="gv-row"]')`, 15000);
  await sleep(900);
};
await open();
const Q = (sel) => `document.querySelector(${lit('.core__pane:not([style*="display: none"]) ' + sel)})`;
const subjects = () => t.ev(`[...document.querySelectorAll('.core__pane:not([style*="display: none"]) [data-testid="gv-row"] .row__subject')].map((e) => e.textContent.trim())`);
const settle = () => sleep(1000); // o recarregamento da lista é rápido; esta pausa cobre a leitura do Git
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
/** Espera a lista chegar ao que o Git diz (a recarga depois de mudar o filtro leva um instante): confere até 6 s. */
const sameP = async (want) => {
  for (let i = 0; i < 30; i++) {
    if (same(await subjects(), want)) return true;
    await sleep(200);
  }
  return false;
};
const count = () => t.text('.core__pane:not([style*="display: none"]) [data-testid="gv-count"]');
const openPop = async () => {
  if (!(await t.ev(`getComputedStyle(${Q('[data-testid="gf-pop"]')}).display !== 'none'`))) await t.ev(`${Q('[data-testid="gf-btn"]')}.click()`);
  await sleep(250);
};
const click = (id) => t.ev(`${Q(`[data-testid="${id}"]`)}.click()`);
const setVal = async (id, v) => {
  await t.ev(`(() => { const i = ${Q(`[data-testid="${id}"]`)}; i.focus(); i.value = ${lit(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
};
const scopeBtn = (label) => t.ev(`[...${Q('[data-testid="gf-scope"]')}.querySelectorAll('button')].find((b) => b.textContent.trim() === ${lit(label)}).click()`);

// 1. padrão: só o que o branch atual alcança, e o contador "N de M"
t.check('o padrão é o branch atual: a lista é o `git log HEAD` (sem o commit da branch solta)', (await sameP(subj('HEAD'))) && !(await subjects()).includes('d1 so na solta'), await subjects());
t.check('o contador diz "N de M" com N do filtro e M do repositório inteiro', (await count()).includes(`${subj('HEAD').length} de ${subj('--all').length} commits`), await count());
t.check('sem filtro ligado não há chip nem selo', (await t.count('.core__pane:not([style*="display: none"]) .gf__chip')) === 0 && (await t.count('.core__pane:not([style*="display: none"]) [data-testid="gf-n"]')) === 0);

// 2. todos os branches
await openPop();
await scopeBtn('Todos');
await settle();
t.check('"Todos" mostra o mesmo que `git log --all`', (await sameP(subj('--all'))), await subjects());
t.check('o chip "Branches: Todos" aparece e o selo conta 1', (await t.text('.core__pane:not([style*="display: none"]) .gf__chip[data-chip="scope"]')).includes('Todos') && (await t.text('.core__pane:not([style*="display: none"]) [data-testid="gf-n"]')).trim() === '1');
await t.shot('grafo-filtros-popover');

// 3. autor, "Só eu" e combinação com pasta
await scopeBtn('Atual');
await click('gf-me');
await settle();
t.check('"Só eu" usa o user.email do repositório: só commits da Ana (conferido no git)', (await sameP(subj('HEAD', '--author=ana@e.com'))), await subjects());
await setVal('gf-path', 'src');
await sleep(1000);
t.check('autor + pasta combinam como `git log --author --  src`', (await sameP(subj('HEAD', '--author=ana@e.com', '--', 'src'))), await subjects());
t.check('dois chips (autor e caminho) e selo 2', (await t.count('.core__pane:not([style*="display: none"]) .gf__chip')) === 2 && (await t.text('.core__pane:not([style*="display: none"]) [data-testid="gf-n"]')).trim() === '2');

// 4. remover um chip tira só o dele; Limpar tudo restaura o padrão
await t.ev(`${Q('.gf__chip[data-chip="path"] button')}.click()`);
await settle();
t.check('remover o chip do caminho deixa o autor', (await sameP(subj('HEAD', '--author=ana@e.com'))) && (await t.count('.core__pane:not([style*="display: none"]) .gf__chip')) === 1);
await click('gf-clear');
await settle();
t.check('"Limpar tudo" volta ao padrão', (await sameP(subj('HEAD'))) && (await t.count('.core__pane:not([style*="display: none"]) .gf__chip')) === 0);

// 5. sem merges, não publicados, período
await openPop();
await click('gf-nomerges');
await settle();
t.check('"Ocultar merges" = `git log --no-merges`', (await sameP(subj('HEAD', '--no-merges'))) && !(await subjects()).includes('m1 merge lateral'), await subjects());
await click('gf-nomerges');
await click('gf-unpub');
await settle();
t.check('"Só não publicados" = `git log HEAD --not --remotes`', (await sameP(subj('HEAD', '--not', '--remotes'))) && (await subjects()).length === 1, await subjects());
await click('gf-unpub');
await t.ev(`[...${Q('[data-testid="gf-period"]')}.querySelectorAll('button')].find((b) => b.textContent.trim() === '7 dias').click()`);
await settle();
t.check('período "7 dias" = `git log --since="7 days ago"`', (await sameP(subj('HEAD', '--since=7 days ago'))), await subjects());

// 6. favorito: salvar, limpar, aplicar
await setVal('gf-fav-name', 'Semana');
await click('gf-fav-save');
await sleep(300);
await click('gf-clear');
await settle();
t.check('com tudo limpo a lista é a padrão', (await sameP(subj('HEAD'))));
await t.ev(`${Q('[data-testid="gf-fav"] .cbx__btn')}.click()`);
await t.until(`document.querySelector('.cbx__list')`, 3000);
await t.ev(`[...document.querySelectorAll('.cbx__list .cbx__opt')].find((o) => o.textContent.trim() === 'Semana').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
await settle();
t.check('aplicar o favorito "Semana" refaz o filtro de 7 dias', (await sameP(subj('HEAD', '--since=7 days ago'))), await subjects());

// 7. teclado: Esc fecha o popover e devolve o foco ao botão
await t.key('Escape');
await sleep(250);
t.check('Esc fecha o popover e o foco volta ao botão "Filtrar o grafo"', !(await t.ev(`getComputedStyle(${Q('[data-testid="gf-pop"]')}).display !== 'none'`)) && (await t.ev(`document.activeElement === ${Q('[data-testid="gf-btn"]')}`)));
await t.shot('grafo-filtros-chips');

// 8. o filtro fica lembrado ao reabrir o repositório
await t.ev('location.reload()');
await t.until(`document.querySelector('li.repo')`, 20000);
await open();
t.check('o filtro (7 dias) continua depois de recarregar o app', (await sameP(subj('HEAD', '--since=7 days ago'))) && (await t.count('.core__pane:not([style*="display: none"]) .gf__chip')) === 1, await subjects());
t.check('sem erro de página', t.errors().filter((e) => !/favicon|Failed to fetch/.test(e)).length === 0, t.errors());
t.close();
