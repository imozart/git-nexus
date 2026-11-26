// Ferramentas agrupadas (#285): menu lateral com grupos nomeados em ordem fixa, Git LFS e Submódulos recolhidos em "Mais ferramentas" quando o repositório não os usa
// (e em "Integração" quando usa), contadores (stash, submódulos pendentes), teclado, paleta, lembrança por repositório e largura de leitura.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
const theme = process.env.GN_TOOLS_THEME ?? 'dark';
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', ${lit(theme)}); localStorage.removeItem('gitnexus.toolsMore'); localStorage.removeItem('gitnexus.toolsSection')`);
for (const k of Object.keys(await t.ev(`Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('gitnexus.tools') || k.startsWith('gitnexus.repoView.')))`))) await t.ev(`localStorage.removeItem(${lit(k)})`);

const root = tmpRoot('gn-tools-');
const prep = (r) => git(r, 'config', 'core.fsmonitor', 'false');
// A: um repositório comum, com dois stashes
const A = mkRepo(root, 'tl-simples', { files: { 'a.txt': 'um\n' } });
prep(A);
for (const x of ['x', 'y']) {
  writeFileSync(join(A, 'a.txt'), `${x}\n`);
  git(A, 'stash', 'push', '-q', '-m', x);
}
// B: usa LFS (.gitattributes) e tem um submódulo ainda não inicializado (um clone simples)
const sub = mkRepo(root, 'tl-sub-origem', { files: { 's.txt': 's\n' } });
const parent = mkRepo(root, 'tl-pai', { files: { 'a.txt': 'pai\n' } });
git(parent, 'submodule', 'add', '-q', sub, 'lib');
writeFileSync(join(parent, '.gitattributes'), '*.psd filter=lfs diff=lfs merge=lfs -text\n');
git(parent, 'add', '.');
git(parent, 'commit', '-qm', 'feat: lfs e submódulo');
const B = join(root, 'tl-integrado');
git(root, 'clone', '-q', parent, B);
for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.fsmonitor', 'false']]) git(B, 'config', k, v);

for (const r of [A, B]) await t.ev(`window.gitNexus.addRepositoryPath(${lit(r)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 2`, 25000);

const P = '.core__pane:not([style*="display: none"]) ';
const q = (sel) => `document.querySelector(${lit(P + sel)})`;
const goHome = async () => {
  await t.ev(`[...document.querySelectorAll('.gn-tab')].find((x) => /Repositórios/.test(x.textContent))?.click()`);
  await sleep(300);
};
const openTools = async (name) => {
  await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)}).querySelector('.repo__btns button').click()`);
  await t.until(`document.querySelector('[data-testid="repo-views"]')`, 20000);
  await sleep(400);
  await t.ev(`${q('[data-view="tools"]')}.click()`);
  await t.until(`${q('[data-testid="tools-nav"]')}`, 10000);
  await sleep(600);
};
const tabs = () => t.ev(`[...document.querySelectorAll(${lit(P + '[data-testid="tools-nav"] [role="tab"]')})].filter((b) => b.offsetParent).map((b) => b.dataset.tool).join(',')`);
const groupsOf = () => t.ev(`[...document.querySelectorAll(${lit(P + '[data-testid="tools-nav"] [role="group"]')})].map((g) => g.getAttribute('aria-label')).join('|')`);
const current = () => t.ev(`${q('[data-testid="tools-nav"] [role="tab"][aria-selected="true"]')}?.dataset.tool ?? ''`);
const panelLabel = () => t.ev(`${q('[role="tabpanel"]#tools-panel')}?.getAttribute('aria-label')`);

// --- A: repositório comum ----------------------------------------------------------------------------------------------------------------------------------
await openTools('tl-simples');
t.check('o menu é um tablist vertical com nome', (await t.ev(`(() => { const l = ${q('[data-testid="tools-nav"]')}; return l.getAttribute('role') === 'tablist' && l.getAttribute('aria-orientation') === 'vertical' && !!l.getAttribute('aria-label'); })()`)) === true);
t.check('os grupos aparecem com nome e na ordem fixa (e "Mais ferramentas" por último)', (await groupsOf()) === 'Desfazer e recuperar|Inspecionar|Reescrever a história|Integração|Publicar|Mais ferramentas', await groupsOf());
t.check('sem LFS nem submódulos, as ferramentas de cada grupo são as de sempre, na ordem do grupo', (await tabs()) === 'ops,stash,file,rebase,tags,hosting,version', await tabs());
t.check('"Mais ferramentas" começa recolhido, com aria-expanded=false, e esconde LFS e Submódulos', (await t.ev(`${q('[data-testid="tools-more-toggle"]')}.getAttribute('aria-expanded')`)) === 'false' && !(await tabs()).includes('lfs'));
await t.until(`!!${q('[data-count="stash"]')}`, 10000);
t.check('o stash mostra o contador (2) com tooltip por extenso', (await t.text(P + '[data-count="stash"]')) === '2' && /2 stashes guardados/.test(await t.ev(`${q('[data-count="stash"]')}.querySelector('[data-tooltip]')?.dataset.tooltip ?? ${q('[data-count="stash"]')}.dataset.tooltip ?? ''`)), await t.text(P + '[data-count="stash"]'));
t.check('começa na primeira ferramenta (Operações) e o painel tem o nome dela', (await current()) === 'ops' && (await panelLabel()) === 'Operações', [await current(), await panelLabel()]);
t.check('só a ferramenta ativa entra na ordem do Tab', (await t.ev(`document.querySelectorAll(${lit(P + '[data-testid="tools-nav"] [role="tab"][tabindex="0"]')}).length`)) === 1);
const wide = await t.ev(`${q('.tools__panel')}.getBoundingClientRect().width`);
t.check('o painel respeita a largura de leitura (até 1280 px) em tela larga', wide <= 1281 && wide > 600, wide);
await t.shot('ferramentas-simples');
await t.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);
const w1100 = await t.ev(`({ page: [document.documentElement.scrollWidth, document.documentElement.clientWidth], cut: [...document.querySelectorAll(${lit(P + '[data-testid="tools-nav"] .tools__name')})].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent) })`);
t.check('em 1100 px o menu e o painel cabem sem rolagem lateral e os nomes não se cortam', w1100.page[0] <= w1100.page[1] + 1 && w1100.cut.length === 0, w1100);
await t.shot('ferramentas-1100');
await t.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);

// teclado: as setas percorrem e trocam a ferramenta; Home e End vão às pontas
await t.ev(`${q('[role="tab"][data-tool="ops"]')}.focus()`);
await t.key('ArrowDown');
await sleep(500);
t.check('seta para baixo vai para a ferramenta seguinte, troca o painel e leva o foco', (await current()) === 'stash' && (await t.ev(`document.activeElement?.dataset?.tool`)) === 'stash' && (await panelLabel()) === 'Stash');
await t.key('End');
await sleep(300);
t.check('End vai ao fim: o botão "Mais ferramentas"', (await t.ev(`document.activeElement?.dataset?.testid`)) === 'tools-more-toggle');
await t.key('Home');
await sleep(500);
t.check('Home volta à primeira ferramenta', (await current()) === 'ops' && (await t.ev(`document.activeElement?.dataset?.tool`)) === 'ops');

// "Mais ferramentas": abre, mostra LFS e Submódulos, fica lembrado
await t.ev(`${q('[data-testid="tools-more-toggle"]')}.click()`);
await sleep(300);
t.check('abrir "Mais ferramentas" mostra Submódulos e Git LFS', (await tabs()).endsWith('version,submodules,lfs') && (await t.ev(`${q('[data-testid="tools-more-toggle"]')}.getAttribute('aria-expanded')`)) === 'true', await tabs());
await t.ev(`${q('[role="tab"][data-tool="lfs"]')}.click()`);
await t.until(`document.querySelector('[data-testid="lfs-off"]')`, 8000);
t.check('Git LFS continua acessível lá dentro e diz que o repositório não o usa', (await current()) === 'lfs' && /não usa Git LFS/.test((await t.text('[data-testid="lfs-off"]')) ?? ''));
await t.shot('ferramentas-mais-aberto');

// todas as ferramentas continuam acessíveis pelo menu, e cada uma troca o painel
const all = (await tabs()).split(',');
const bad = [];
for (const id of all) {
  await t.ev(`${q(`[role="tab"][data-tool="${id}"]`)}.click()`);
  await sleep(350);
  if ((await current()) !== id || !(await panelLabel())) bad.push(id);
}
t.check('as nove ferramentas continuam acessíveis pelo menu (cada uma troca o painel)', all.length === 9 && bad.length === 0, [all, bad]);

// paleta: "Ferramentas: stash" ainda funciona
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 5000);
await t.ev(`(() => { const i = document.querySelector('.cp__input, .cp input'); if (i) { i.value = 'Ferramentas: stash'; i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
await sleep(400);
await t.key('Enter');
await sleep(700);
t.check('a paleta ("Ferramentas: stash") continua levando à ferramenta', (await current()) === 'stash', await current());

// lembrado por repositório
await t.ev(`${q('[role="tab"][data-tool="tags"]')}.click()`);
await sleep(400);
await goHome();
await openTools('tl-integrado');
t.check('outro repositório começa em Operações: a escolha é por repositório', (await current()) === 'ops', await current());

// --- B: usa LFS e submódulos ------------------------------------------------------------------------------------------------------------------------
await t.until(`!!${q('[data-group="integration"] [data-tool="lfs"]')}`, 15000); // o que o repositório usa chega logo depois de abrir
t.check('com LFS e submódulos, eles aparecem em "Integração" e não há "Mais ferramentas"', (await tabs()) === 'ops,stash,file,rebase,tags,hosting,submodules,lfs,version' && !(await groupsOf()).includes('Mais ferramentas'), [await tabs(), await groupsOf()]);
t.check('"Integração" tem PRs / MRs, Submódulos e Git LFS, nessa ordem', (await t.ev(`[...${q('[data-group="integration"]')}.querySelectorAll('[role="tab"]')].map((b) => b.dataset.tool).join(',')`)) === 'hosting,submodules,lfs');
t.check('o submódulo ainda não inicializado aparece como contador pendente (1)', (await t.text(P + '[data-count="submodules"]')) === '1', await t.text(P + '[data-count="submodules"]'));
await t.ev(`${q('[role="tab"][data-tool="submodules"]')}.click()`);
await t.until(`document.querySelector('[data-testid="sub-row"]')`, 30000);
t.check('o submódulo pendente aparece na lista do painel, como não inicializado', (await t.count('[data-testid="sub-state-uninitialized"]')) === 1);
await t.shot('ferramentas-integrado');
await goHome();
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 2`, 25000);
await openTools('tl-simples');
t.check('a ferramenta escolhida (Tags) e o "Mais ferramentas" aberto ficam lembrados depois de recarregar', (await current()) === 'tags' && (await t.ev(`${q('[data-testid="tools-more-toggle"]')}.getAttribute('aria-expanded')`)) === 'true', [await current()]);
t.check('sem erro de página', t.errors().filter((e) => !/favicon|Failed to fetch/.test(e)).length === 0, t.errors());
t.close();
