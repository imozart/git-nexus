// Pesquisar em vários repositórios (Ctrl+F, fase 8 da #233), com git de verdade: o seletor dos repositórios do catálogo (Todos, Abertos nas abas, Só este, conjuntos salvos),
// os resultados agrupados por repositório e depois por arquivo (o mesmo caminho em dois repositórios não se mistura), o estado de cada repositório (concluído, pasta sumida,
// cortado no limite), o contador "N ocorrências em M arquivos de K repositórios", editar e salvar NO repositório dono (que não é o da aba), substituir em vários repositórios
// (desligado por padrão, confirmação e desfazer por repositório) e a recusa de caminho fora do catálogo. Tudo é conferido no disco.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
for (const k of ['searchWindow', 'searchHistory', 'searchRepoSets']) await t.ev(`localStorage.removeItem('gitnexus.${k}')`);

const root = tmpRoot('gn-mr-');
const mk = (name, files) => {
  const p = mkRepo(root, name, { files: { 'README.md': 'x\n' } });
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(p, f, '..'), { recursive: true });
    writeFileSync(join(p, f), c);
  }
  git(p, 'add', '.');
  git(p, 'commit', '-qm', 'feat: base');
  return p;
};
const ALFA = mk('mr-alfa', { 'src/app.ts': 'const alvo = 1;\nuse(alvo);\n// alvo\n', 'lib.txt': 'nada\n' });
const BETA = mk('mr-beta', { 'src/app.ts': 'alvo b1\nalvo b2\n', 'notes.md': 'um alvo\n' });
const GAMA = mk('mr-gama', { 'x.txt': 'alvo\n' });
const GRANDE = mk('mr-grande', { 'big.txt': Array.from({ length: 1200 }, (_, i) => `alvo linha ${i}`).join('\n') + '\n' });
const raw = (repo, f) => readFileSync(join(repo, f), 'utf8');
const ORIG = { alfa: raw(ALFA, 'src/app.ts'), beta: raw(BETA, 'src/app.ts') };

for (const p of [ALFA, BETA, GAMA, GRANDE]) await t.ev(`window.gitNexus.addRepositoryPath(${lit(p)})`);
rmSync(GAMA, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); // catalogado e depois sumido: a pasta indisponível
await t.ev('location.reload()');
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'mr-alfa')`, 25000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'mr-alfa').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);

const W = '[data-testid="search-window"]';
const q = (id) => `${W} [data-testid="${id}"]`;
const F = `${W} [data-testid="sf-input"]`;
const R = `${q('sw-replace-row')} [data-testid="sf-input"]`;
const shot = async (n) => {
  await t.ev(`(() => { if (!document.getElementById('gn-nopath')) { const s = document.createElement('style'); s.id = 'gn-nopath'; s.textContent = '.rv__path, .sr__path { visibility: hidden !important; }'; document.head.appendChild(s); } })()`);
  await t.shot(n);
};
const typeInto = async (sel, text) => {
  await t.ev(`(() => { const e = document.querySelector(${lit(sel)}); e.focus(); e.select(); })()`);
  await t.send('Input.insertText', { text });
  await sleep(120);
};
const click = (id) => t.ev(`document.querySelector(${lit(q(id))}).click()`);
const clickG = (id) => t.ev(`document.querySelector('[data-testid="${id}"]').click()`);
const untilG = (id, ms = 5000) => t.until(`document.querySelector('[data-testid="${id}"]')`, ms);
const count = () => t.ev(`document.querySelector('[data-testid="sw-count"]')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
const waitCount = async (re, ms = 20000) => {
  await sleep(450);
  return t.until(`new RegExp(${lit(re)}).test(document.querySelector('[data-testid="sw-count"]')?.textContent.replace(/\\s+/g, ' ') ?? '')`, ms);
};
const waitSummary = (re, ms = 20000) => t.until(`new RegExp(${lit(re)}).test(document.querySelector('[data-testid="sw-rsummary"]')?.textContent.replace(/\\s+/g, ' ') ?? '')`, ms);
const summary = () => t.text('[data-testid="sw-rsummary"]');
/** Abre (ou fecha) o painel dos repositórios, só se ainda não estiver assim. */
const ensureRepos = async (open) => {
  if (((await t.count(q('sw-repos'))) > 0) !== open) await click('sw-repos-toggle');
  await sleep(300);
};
/** Os cabeçalhos de repositório, em ordem: nome, ocorrências e estado (data-state). */
const heads = () =>
  t.ev(`[...document.querySelectorAll('[data-testid="sw-repo-row"]')].map((r) => ({ name: r.querySelector('[data-testid="sw-repo-name"]').textContent.trim(), n: Number(r.querySelector('[data-testid="sw-repo-count"]').textContent), state: r.querySelector('[data-testid="sw-repo-state"]').dataset.state, text: r.querySelector('[data-testid="sw-repo-state"]').textContent.trim(), cut: r.querySelector('[data-testid="sw-repo-cut"]')?.textContent.trim() ?? null }))`);
/** O id da n-ésima ocorrência (linha de código) abaixo do cabeçalho do repositório `name`. */
const hitIdIn = (name, nth = 0) =>
  t.ev(`(() => { let on = false; let k = 0; for (const r of document.querySelectorAll('.sw__row')) { if (r.dataset.testid === 'sw-repo-row') { on = r.querySelector('[data-testid="sw-repo-name"]').textContent.trim() === ${lit(name)}; continue; } if (on && r.dataset.testid === 'sw-row') { if (k++ === ${nth}) return r.id; } } return null; })()`);
const pickIn = async (name, nth = 0) => {
  const id = await hitIdIn(name, nth);
  await t.ev(`document.getElementById(${lit(id)}).click()`);
  await sleep(500);
  return id;
};

// ---- abrir a janela e escolher onde procurar -------------------------------------------------------------------------------------------------------------------
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 6000);
t.check('com a janela de sempre, o botão Repositórios existe e ninguém está escolhido além do repositório da aba', (await t.count(q('sw-repos-toggle'))) === 1 && (await t.count(q('sw-repos-n'))) === 0);
await click('sw-repos-toggle');
await t.until(`document.querySelector(${lit(q('sw-repos'))})`, 5000);
await sleep(400);
const items = await t.ev(`[...document.querySelectorAll('[data-testid="sr-item"]')].map((li) => li.querySelector('strong').textContent.trim())`);
t.check('o seletor lista os repositórios do CATÁLOGO do app (os 4), com a marca da aba ativa', items.length === 4 && ['mr-alfa', 'mr-beta', 'mr-gama', 'mr-grande'].every((n) => items.includes(n)) && /aba ativa/.test((await t.text(q('sr-list'))) ?? ''), items);
t.check('começa só com o repositório da aba (1 de 4 escolhidos)', /^1 de 4 escolhidos/.test((await t.text(q('sr-count'))) ?? ''), await t.text(q('sr-count')));
await t.ev(`(() => { const i = document.querySelector(${lit(q('sr-filter'))}); i.focus(); })()`);
await t.send('Input.insertText', { text: 'GRAN' });
await sleep(200);
t.check('o filtro do seletor acha por nome sem diferenciar caixa', (await t.count(q('sr-item'))) === 1);
await t.ev(`(() => { const i = document.querySelector(${lit(q('sr-filter'))}); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(200);
await t.ev(`document.querySelector(${lit(q('sr-chk-mr-beta'))}).click()`);
await t.ev(`document.querySelector(${lit(q('sr-chk-mr-gama'))}).click()`);
await sleep(300);
t.check('marcar beta e gama: 3 repositórios, com o chip e o selo no botão', /^3 de 4 escolhidos/.test((await t.text(q('sr-count'))) ?? '') && (await t.text(q('sw-repos-n'))) === '3');
await shot('multi-seletor');

// ---- pesquisar ------------------------------------------------------------------------------------------------------------------------------------------------------
await typeInto(F, 'alvo');
await waitCount('^6 ocorrências em 3 arquivos de 2 repositórios');
t.check('o contador diz "6 ocorrências em 3 arquivos de 2 repositórios"', /^6 ocorrências em 3 arquivos de 2 repositórios/.test(await count()), await count());
const h = await heads();
t.check('um cabeçalho por repositório, o da aba ativa primeiro, cada um com a sua contagem', h.length === 3 && h[0].name === 'mr-alfa' && h[0].n === 3 && h[1].name === 'mr-beta' && h[1].n === 3 && h[2].name === 'mr-gama', h);
t.check('alfa e beta concluíram; gama (pasta sumida) aparece como indisponível, sem derrubar os outros', h[0].state === 'done' && h[1].state === 'done' && h[2].state === 'unavailable' && /indispon/.test(h[2].text), h);
const files = await t.ev(`[...document.querySelectorAll('[data-testid="sw-repo-row"], [data-testid="sw-file-row"]')].map((r) => r.dataset.testid === 'sw-repo-row' ? '[' + r.querySelector('[data-testid="sw-repo-name"]').textContent.trim() + ']' : r.querySelector('.sw__fname').textContent.trim())`);
t.check('o mesmo caminho (src/app.ts) existe nos dois repositórios e aparece uma vez em cada, sem o prefixo interno', JSON.stringify(files) === JSON.stringify(['[mr-alfa]', 'src/app.ts', '[mr-beta]', 'notes.md', 'src/app.ts', '[mr-gama]']), files);
t.check('a lista é uma listbox e cada cabeçalho de repositório tem nome acessível com o estado', (await t.ev(`(() => { const r = document.querySelector('[data-testid="sw-repo-row"]'); return r.getAttribute('role') === 'option' && /Repositório mr-alfa, 3 ocorrências, concluído/.test(r.getAttribute('aria-label')); })()`)) === true);
await shot('multi-resultados');

// ---- editar e salvar no repositório DONO (beta não é o da aba) ----------------------------------------------------------------------------------------------
await pickIn('mr-beta', 0); // primeira ocorrência de beta (notes.md)
t.check('abre embaixo o arquivo de beta, com o selo do repositório dono e o caminho sem prefixo', (await t.text(q('sw-owner'))) === 'mr-beta' && (await t.text(q('sw-path'))) === 'notes.md');
await pickIn('mr-beta', 1); // src/app.ts de beta
t.check('a segunda ocorrência de beta é o src/app.ts DELE (não o de alfa)', (await t.text(q('sw-path'))) === 'src/app.ts' && (await t.text(q('sw-owner'))) === 'mr-beta' && /alvo b1/.test((await t.ev(`document.querySelector(${lit(W + ' .cm-content')})?.innerText ?? ''`)) ?? ''));
await t.ev(`document.querySelector(${lit(F)}).focus()`);
await t.key('Enter'); // leva o foco ao editor com a ocorrência selecionada
await sleep(450);
await t.send('Input.insertText', { text: 'TROCADO' });
await sleep(250);
await t.key('s', 2);
await t.until(`/Salvo/.test(document.querySelector('[data-testid="sw-notice"]')?.textContent ?? '')`, 8000);
t.check('Ctrl+S grava no repositório DONO: o src/app.ts de beta mudou e o de alfa ficou como estava', raw(BETA, 'src/app.ts') !== ORIG.beta && /TROCADO/.test(raw(BETA, 'src/app.ts')) && raw(ALFA, 'src/app.ts') === ORIG.alfa, [raw(BETA, 'src/app.ts'), raw(ALFA, 'src/app.ts')]);
await waitCount('^5 ocorrências em 3 arquivos de 2 repositórios');
git(BETA, 'checkout', '--', '.'); // volta o arquivo ao commit para os próximos passos
await typeInto(F, 'alvo ');
await typeInto(F, 'alvo');
await waitCount('^6 ocorrências em 3 arquivos de 2 repositórios');

// ---- limite por repositório e Todos ------------------------------------------------------------------------------------------------------------------------------
await ensureRepos(true);
await click('sr-all');
await sleep(300);
t.check('o atalho Todos escolhe os 4', /^4 de 4 escolhidos/.test((await t.text(q('sr-count'))) ?? ''));
await waitCount('^1\\.006 ocorrências em 4 arquivos de 3 repositórios');
const h2 = await heads();
const big = h2.find((x) => x.name === 'mr-grande');
t.check('o repositório com 1200 ocorrências é cortado no limite por repositório (1000) e o cabeçalho diz', big?.n === 1000 && /limite do repositório/.test(big?.cut ?? ''), h2);
t.check('o corte dele não escondeu os outros: alfa e beta seguem com tudo', h2.find((x) => x.name === 'mr-alfa')?.n === 3 && h2.find((x) => x.name === 'mr-beta')?.n === 3, h2);
t.check('o aviso da janela diz quem foi cortado', /Cortado em: mr-grande/.test((await t.text(q('sw-notes'))) ?? ''), await t.text(q('sw-notes')));
// recolher um repositório esconde o que tem dentro
await t.ev(`[...document.querySelectorAll('[data-testid="sw-repo-row"]')].find((r) => r.textContent.includes('mr-grande')).click()`);
await sleep(300);
t.check('clicar no cabeçalho recolhe o repositório (a contagem continua)', (await heads()).find((x) => x.name === 'mr-grande')?.n === 1000 && (await t.count('[data-testid="sw-row"]')) < 20);
await t.ev(`[...document.querySelectorAll('[data-testid="sw-repo-row"]')].find((r) => r.textContent.includes('mr-grande')).click()`);
// volta para 3 repositórios (alfa, beta, gama)
await ensureRepos(true);
await t.ev(`document.querySelector(${lit(q('sr-chk-mr-grande'))}).click()`);
await sleep(300);
await waitCount('^6 ocorrências em 3 arquivos de 2 repositórios');

// ---- conjuntos salvos e a última seleção lembrada --------------------------------------------------------------------------------------------------------------
await typeInto(q('sr-set-name'), 'Back');
await click('sr-set-save');
await sleep(300);
t.check('salvar um conjunto: ele aparece com o nome e quantos repositórios tem', /Back · 3/.test((await t.text(q('sr-sets'))) ?? ''), await t.text(q('sr-sets')));
await click('sr-this');
await sleep(300);
await waitCount('^3 ocorrências em 1 arquivo');
t.check('"Só este" volta à busca de um repositório só (sem chip, sem cabeçalhos de repositório)', (await t.count(q('sw-repos-n'))) === 0 && (await t.count('[data-testid="sw-repo-row"]')) === 0, await count());
await click('sr-set');
await waitCount('^6 ocorrências em 3 arquivos de 2 repositórios');
t.check('escolher o conjunto "Back" traz os 3 repositórios de volta', (await heads()).length === 3 && (await t.text(q('sw-repos-n'))) === '3');
t.check('o conjunto fica guardado nas preferências (sobrevive a fechar a janela)', (await t.ev(`JSON.parse(localStorage.getItem('gitnexus.searchRepoSets') ?? '[]').map((s) => s.name + ':' + s.ids.length).join()`)) === 'Back:3');

// ---- substituir em vários repositórios: desligado por padrão, confirmação e desfazer POR REPOSITÓRIO ---------------------------------------------------------------
await ensureRepos(false);
await click('sw-replace-toggle');
await t.until(`document.querySelector(${lit(q('sw-replace-row'))})`, 5000);
await typeInto(R, 'NOVO');
await sleep(500);
t.check('em vários repositórios a substituição nasce DESLIGADA: o resumo diz e o botão Substituir tudo fica desabilitado', /desligado/.test((await summary()) ?? '') && (await t.ev(`document.querySelector(${lit(q('sw-apply'))}).disabled`)) === true && (await t.ev(`document.querySelector(${lit(q('sw-allow-multi'))}).checked`)) === false, await summary());
t.check('desligada, nada é lido do disco para a prévia (nenhuma linha "depois")', (await t.count('[data-testid="sw-new-row"]')) === 0);
await click('sw-allow-multi');
await waitSummary('^6 substituições em 3 arquivos');
t.check('ligando, o resumo conta tudo: 6 substituições em 3 arquivos', /^6 substituições em 3 arquivos/.test(await summary()), await summary());
await shot('multi-substituir');
await click('sw-apply');
await untilG('sw-confirm');
const asks = await t.ev(`[...document.querySelectorAll('[data-testid="sw-confirm-repos"] li')].map((li) => li.querySelector('strong').textContent.trim() + ' | ' + li.querySelector('input').checked + ' | ' + li.querySelector('span').textContent.trim())`);
t.check('a confirmação lista cada repositório com o resumo dele, todos marcados', asks.length === 2 && asks[0].startsWith('mr-alfa | true | 3 substituições em 1 arquivo') && asks[1].startsWith('mr-beta | true | 3 substituições em 2 arquivos'), asks);
await t.ev(`document.querySelector('[data-testid="sw-confirm-repo-mr-beta"]').click()`); // beta fica de fora
await sleep(200);
t.check('desmarcar beta atualiza o total da confirmação (3 substituições em 1 arquivo)', /3 substituições em 1 arquivo/.test((await t.text('[data-testid="sw-confirm"] p:last-of-type')) ?? '') || /3 substituições em 1 arquivo/.test((await t.text('[data-testid="sw-confirm"]')) ?? ''), await t.text('[data-testid="sw-confirm"]'));
await shot('multi-confirmar');
await clickG('sw-confirm-apply');
await t.until(`document.querySelector(${lit(q('sw-rresult'))})`, 15000);
t.check('só alfa foi alterado: beta ficou como estava', raw(ALFA, 'src/app.ts').includes('NOVO') && !raw(ALFA, 'src/app.ts').includes('alvo') && raw(BETA, 'src/app.ts') === ORIG.beta && !raw(BETA, 'notes.md').includes('NOVO'), [raw(ALFA, 'src/app.ts'), raw(BETA, 'src/app.ts')]);
t.check('nenhum commit novo (alfa continua com 2)', git(ALFA, 'rev-list', '--count', 'HEAD').trim() === '2');
t.check('o botão de desfazer é do repositório (Desfazer substituição · mr-alfa)', (await t.ev(`[...document.querySelectorAll('[data-testid="sw-undo"]')].map((b) => b.dataset.repo).join()`)) === 'mr-alfa');
await sleep(600);
// agora beta também, e desfazer só o de alfa
await typeInto(F, 'alvo');
await waitCount('^3 ocorrências em 2 arquivos de 1 repositório|^3 ocorrências em 2 arquivos de 1 repositórios');
await sleep(800);
await waitSummary('^3 substituições em 2 arquivos');
await click('sw-apply');
await untilG('sw-confirm');
await clickG('sw-confirm-apply');
await t.until(`/3 substituições em 2 arquivos/.test(document.querySelector('[data-testid="sw-rresult"]')?.textContent ?? '')`, 15000);
t.check('beta foi alterado na segunda rodada (e só ele)', raw(BETA, 'src/app.ts').includes('NOVO') && raw(BETA, 'notes.md').includes('NOVO'));
t.check('agora há um desfazer para cada repositório', (await t.ev(`[...document.querySelectorAll('[data-testid="sw-undo"]')].map((b) => b.dataset.repo).sort().join()`)) === 'mr-alfa,mr-beta');
await t.ev(`document.querySelector('[data-testid="sw-undo"][data-repo="mr-beta"]').click()`);
await t.until(`/desfeita|desfez|restaur/i.test(document.querySelector('[data-testid="sw-rresult"]')?.textContent ?? '')`, 15000);
t.check('desfazer beta devolve os arquivos dele byte a byte e NÃO mexe em alfa', raw(BETA, 'src/app.ts') === ORIG.beta && raw(BETA, 'notes.md') === 'um alvo\n' && raw(ALFA, 'src/app.ts').includes('NOVO'), [raw(BETA, 'src/app.ts'), raw(ALFA, 'src/app.ts')]);
t.check('sobra só o desfazer de alfa', (await t.ev(`[...document.querySelectorAll('[data-testid="sw-undo"]')].map((b) => b.dataset.repo).join()`)) === 'mr-alfa');
await t.ev(`document.querySelector('[data-testid="sw-undo"][data-repo="mr-alfa"]').click()`);
await t.until(`!document.querySelector('[data-testid="sw-undo"]')`, 15000);
t.check('desfazer alfa devolve o arquivo dele', raw(ALFA, 'src/app.ts') === ORIG.alfa);
await sleep(500);

// ---- segurança: só o catálogo ------------------------------------------------------------------------------------------------------------------------------------
const outside = await t.ev(`window.gitNexus.startMultiSearch(['C:\\\\Windows', '/etc', 'nao-existe'], { pattern: 'x' }, 'fora-1')`);
t.check('caminho digitado no lugar do id (ou id fora do catálogo) é recusado e nunca roda', outside.rejected.length === 3 && outside.repos.length === 0, outside);
const idOfAlfa = await t.ev(`window.gitNexus.getKnownRepositories().then((l) => l.find((r) => r.name === 'mr-alfa').id)`);
const escaped = await t.ev(`window.gitNexus.readWorkingFile(${lit(ALFA)}, '../mr-beta/src/app.ts').then(() => 'leu', (e) => String(e.message ?? e))`);
t.check('um caminho que tenta sair do repositório dono é recusado na leitura', escaped !== 'leu', escaped);
const accepted = await t.ev(`window.gitNexus.startMultiSearch([${lit(idOfAlfa)}, 'nao-existe'], { pattern: 'zzz-nada' }, 'fora-2')`);
t.check('o catálogo é a única fonte: o id real corre, o inventado volta em "rejected"', accepted.repos.length === 1 && accepted.rejected.join() === 'nao-existe', accepted);

// ---- lembrar a última seleção -----------------------------------------------------------------------------------------------------------------------------------------
await t.key('Escape');
await sleep(400);
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 6000);
await waitCount('^6 ocorrências em 3 arquivos de 2 repositórios');
t.check('reabrir a janela lembra a seleção: o chip "3 repositórios" e a mesma busca', /3 repositórios/.test((await t.text(q('sw-chip-repos'))) ?? '') && (await heads()).length === 3, await t.text(q('sw-repos-chip')));

// ---- tema claro e inglês ---------------------------------------------------------------------------------------------------------------------------------------------------
await t.key('Escape');
await t.ev(`localStorage.setItem('gitnexus.theme', 'light'); localStorage.setItem('gitnexus.locale', 'en')`);
await t.ev('location.reload()');
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'mr-alfa')`, 25000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'mr-alfa').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 6000);
await waitCount('^6 matches in 3 files in 2 repositories');
const en = await t.ev(`({ theme: document.documentElement.dataset.theme, toggle: document.querySelector('[data-testid="sw-repos-toggle"]').textContent.replace(/\\s+/g, ' ').trim(), count: document.querySelector('[data-testid="sw-count"]').textContent.replace(/\\s+/g, ' ').trim(), states: [...document.querySelectorAll('[data-testid="sw-repo-state"]')].map((e) => e.textContent.trim()), chip: document.querySelector('[data-testid="sw-chip-repos"]')?.textContent.trim() })`);
t.check('tema claro e inglês: botão, contador, estados e chip traduzidos', en.theme === 'light' && /^Repositories/.test(en.toggle) && /in 2 repositories/.test(en.count) && en.states.join() === 'done,done,unavailable' && en.chip === '3 repositories', en);
await shot('multi-claro-en');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
