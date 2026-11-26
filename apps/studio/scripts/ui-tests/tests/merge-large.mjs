// Resolvedor de conflitos (issue #231, fase 7), com git de verdade: arquivo grande (20 mil linhas, 200 conflitos) com a tela por janela (só o que está perto
// da área visível é desenhado). Metas de projeto: abrir e aceitar a primeira decisão em ~2 s (a leitura do Git pelo app já leva ~1 s no Windows) e cada escolha
// atualizar a tela em ~100 ms; medido numa máquina comum: abrir 1,6 a 2,4 s, escolha 50 a 100 ms. As verificações abaixo são a TRAVA contra regressão (o dobro da
// meta, porque o harness roda num navegador com a máquina ocupada); o motor puro tem a meta estrita em `merge-perf.test.ts`. Os tempos entram no relatório.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
/** Os tempos medidos (não são verificações): vão para `merge-large-metrics.json` junto das capturas. */
const metrics = {};
process.on('exit', () => {
  writeFileSync(join(OUT, 'merge-large-metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.setItem('gitnexus.newConflictResolver', '1')`);

const LINES = 20000;
const CONFLICTS = 200;
const STEP = LINES / CONFLICTS;
const FILE = 'grande.js';
const make = (tag) => {
  const out = [];
  for (let i = 0; i < LINES; i++) out.push(i % STEP === 50 && tag ? `const linha${i} = ${i}; // ${tag}` : `const linha${i} = ${i}; // trecho ${i % 97}`);
  return out.join('\n') + '\n';
};

const root = tmpRoot('gn-lg-');
const repo = mkRepo(root, 'grande', { files: { [FILE]: make('') } });
const put = (c, m) => {
  writeFileSync(join(repo, FILE), c);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', m);
};
git(repo, 'checkout', '-q', '-b', 'feat/grande');
put(make('minha'), 'feat: minha versão');
git(repo, 'checkout', '-q', 'main');
put(make('da origin'), 'feat: versão da origin');
git(repo, 'checkout', '-q', 'feat/grande');
try {
  git(repo, 'merge', 'main');
} catch {
  /* conflito: é o esperado */
}

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="op-banner"]')`, 20000);

const q = (js) => t.ev(`(() => { ${js} })()`);

// a leitura dos três lados no processo principal (git), à parte da tela
metrics.leituraGitMs = await t.ev(`(async () => { const t0 = performance.now(); await window.gitNexus.getMergeConflicts(${lit(repo)}); return Math.round(performance.now() - t0); })()`);

// --- abrir: do clique em "Conflitos" até a tela mostrar o primeiro conflito pronto ------------------------------------------------------------------
await q(`window.__t0 = performance.now(); [...document.querySelectorAll('[data-testid="repo-view-tab"]')].find((b) => /Conflitos/.test(b.textContent))?.click()`);
await t.until(`document.querySelector('[data-testid="mr-card"]')`, 60000);
const openMs = await q(`return Math.round(performance.now() - window.__t0)`);
metrics.abrirMs = openMs;
const cards = await q(`return document.querySelectorAll('[data-testid="mr-card"]').length`);
const marks = await q(`return document.querySelectorAll('[data-testid="mr-ruler"] .mark').length`);
metrics.cartoesDesenhados = cards;
const dom = await q(`return document.querySelectorAll('*').length`);
metrics.elementosNoDom = dom;
t.check('só os conflitos perto da tela são desenhados, e a régua mostra os 200', cards > 0 && cards < 40 && marks === CONFLICTS, { cards, marks });
const lastName = await q(`return document.querySelector('[data-testid="mr-ph"][data-seg="${CONFLICTS * 2 - 1}"]')?.getAttribute('aria-label') ?? ''`);
t.check('o resto do arquivo é espaço reservado, com as regiões dos conflitos nomeadas', /Conflito 200 de 200/.test(lastName), lastName);
await t.shot('grande-janela');

// --- decidir o que está na tela: a primeira decisão e as seguintes --------------------------------------------------------------------------------------
const frame = `return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))`;
const choosePending = async () => {
  await q(`window.__t1 = performance.now(); document.querySelector('[data-testid="mr-card"][data-state="pending"] [data-testid="mr-use-mine"]').click()`);
  await q(frame);
  return q(`return Math.round(performance.now() - window.__t1)`);
};
const first = await choosePending();
metrics.primeiraDecisaoMs = first;
const times = [];
for (let i = 1; i <= 5; i++) times.push(await choosePending());
// as seguintes ficam longe da tela: "próximo pendente" leva até elas (o trecho é desenhado ao chegar)
for (let i = 0; i < 10; i++) {
  await q(`document.querySelector('[data-testid="mr-next-pending"]').click()`);
  await q(frame);
  await sleep(120);
  times.push(await choosePending());
}
times.sort((a, b) => a - b);
metrics.escolhaMedianaMs = times[Math.floor(times.length / 2)];
metrics.escolhaMaxMs = times[times.length - 1];
t.check('abrir (com a leitura do Git) e aceitar a primeira decisão levam até 5 s (meta ~2 s)', openMs + first <= 5000, { openMs, first });
t.check('cada escolha atualiza a tela em até 150 ms (mediana; meta ~100 ms)', metrics.escolhaMedianaMs <= 150, times);
t.check('as 16 escolhas foram aplicadas', (await q(`return document.querySelectorAll('[data-testid="mr-ruler"] .mark--resolved').length`)) === 16);

// --- ir ao último conflito pela régua: o trecho é desenhado e fica com o foco ----------------------------------------------------------------------
await q(`document.querySelector('[data-testid="mr-ruler"] .mark[data-idx="${CONFLICTS * 2 - 1}"]').click()`);
await t.until(`document.querySelector('[data-testid="mr-card"][data-seg="${CONFLICTS * 2 - 1}"]')`, 5000);
await sleep(200);
t.check('a régua leva ao último conflito (desenhado, ativo e com o foco)', (await q(`return document.activeElement?.dataset?.seg === '${CONFLICTS * 2 - 1}'`)) === true);

// --- decidir o resto de uma vez (inclui os que nunca foram desenhados) e gravar --------------------------------------------------------------------------
await q(`document.querySelector('[data-testid="mr-bulk"]').click()`);
await sleep(250);
await q(`[...document.querySelectorAll('[role="menuitem"]')].find((b) => /Aceitar tudo da origin/.test(b.textContent)).click()`);
await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
await sleep(400);
await q(`[...document.querySelectorAll('.dlg__btns button')].pop().click()`);
await sleep(600);
t.check('"Aceitar tudo da origin" decide os 184 que faltavam e libera o "Marcar como resolvido"', (await q(`return document.querySelectorAll('[data-testid="mr-ruler"] .mark--pending').length`)) === 0 && (await q(`return document.querySelector('[data-testid="mr-resolve"]').disabled`)) === false);
await q(`document.querySelector('[data-testid="mr-resolve"]').click()`);
await sleep(2500);
const onDisk = readFileSync(join(repo, FILE), 'utf8');
t.check('o arquivo gravado não tem marcador: 16 com a minha e 184 com a da origin', !/<<<<<<<|>>>>>>>/.test(onDisk) && (onDisk.match(/ \/\/ minha/g) ?? []).length === 16 && (onDisk.match(/ \/\/ da origin/g) ?? []).length === 184, { minha: (onDisk.match(/ \/\/ minha/g) ?? []).length });
t.check('o índice não tem mais conflito', git(repo, 'ls-files', '--unmerged').trim() === '');
await sleep(200);
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|A listener indicated an asynchronous response/.test(String(e)));
t.check('sem erro no console', appErrors.length === 0, appErrors);
t.close();
