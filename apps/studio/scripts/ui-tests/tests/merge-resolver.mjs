// Novo resolvedor de conflitos (issue #231, fases 2 e 3), com git de verdade: o arquivo como vai ficar, a origem de cada linha, a decisão linha a linha,
// desfazer/refazer, navegação e régua, rascunho que sobrevive a fechar o app, ações em massa, reabrir conflito já resolvido, continuar a operação, e o que é
// gravado no disco ao marcar como resolvido. Também confere os rótulos no rebase.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.setItem('gitnexus.newConflictResolver', '1')`);

const FILE = 'src/config.ts';
const doc = (o) =>
  [
    '/** Valores padrão da conexão. */',
    "export type Env = 'dev' | 'prod';",
    '',
    "import { load } from './env';",
    '',
    'export const defaults = {',
    `  retries: ${o.retries},`,
    '  // rede',
    ...o.net,
    '  // depuração',
    `  verbose: ${o.verbose},`,
    '};',
    '',
    'export function pick(env: Env) {',
    `  return ${o.ret};`,
    '}',
    '',
  ].join('\n');
const BASE = { retries: 3, net: ['  timeout: 20_000,', "  backoff: 'linear',"], verbose: 'false', ret: 'load(env) ?? defaults' };
const MINE = { retries: 3, net: ['  timeout: 30_000,', "  backoff: 'exponential',", '  maxDelay: 8_000,'], verbose: 'true', ret: 'load(env) ?? { ...defaults, env }' };
const THEIRS = { retries: 5, net: ['  timeout: 45_000,', "  backoff: 'linear',"], verbose: 'false', ret: 'load(env) ?? Object.freeze(defaults)' };

const root = tmpRoot('gn-mr-');
const repo = mkRepo(root, 'resolver', { files: { [FILE]: doc(BASE) } });
const put = (f, c, m) => {
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, f), c);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', m);
};
git(repo, 'checkout', '-q', '-b', 'feat/timeout');
put(FILE, doc(MINE), 'feat: ajusta o tempo de espera');
git(repo, 'checkout', '-q', 'main');
put(FILE, doc(THEIRS), 'feat: aumenta o timeout padrão');
git(repo, 'checkout', '-q', 'feat/timeout');
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
await t.ev(`[...document.querySelectorAll('.rv__btns button')].find((b) => /Conflitos/.test(b.textContent))?.click()`);
await t.until(`document.querySelector('[data-testid="merge-resolver"]')`, 15000);
await t.until(`document.querySelectorAll('[data-testid="mr-card"]').length >= 2`, 15000);
await sleep(300);

const q = (js) => t.ev(`(() => { ${js} })()`);
const cards = () => q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => ({ state: c.dataset.state, region: c.getAttribute('aria-label'), summary: c.querySelector('[data-testid="mr-summary"]')?.textContent ?? '' }))`);
const resolveBtn = () => q(`const b = document.querySelector('[data-testid="mr-resolve"]'); return { disabled: b.disabled, text: b.textContent.trim() }`);
const click = (sel, nth = 0) => t.ev(`document.querySelectorAll(${lit(sel)})[${nth}].click()`);
const previewOf = (card) => q(`return [...[...document.querySelectorAll('[data-testid="mr-card"]')][${card}].querySelectorAll('[data-testid="mr-line"]')].map((l) => ({ origin: l.dataset.origin, text: l.querySelector('.ml__code').textContent.trim() }))`);
const clickIn = (card, testid) => t.ev(`[...document.querySelectorAll('[data-testid="mr-card"]')][${card}].querySelector('[data-testid="${testid}"]').click()`);

// --- estado inicial -----------------------------------------------------------------------------------------------------------------------
let c = await cards();
t.check('a tela nova aparece (preferência ligada) e mostra 2 conflitos pendentes', c.length === 2 && c.every((x) => x.state === 'pending'), c);
t.check('cada conflito é uma região nomeada com as linhas ("Conflito 1 de 2, linhas 9 a 11")', /^Conflito 1 de 2, linhas? \d+/.test(c[0].region) && /^Conflito 2 de 2/.test(c[1].region), c.map((x) => x.region));
const rb = await resolveBtn();
t.check('"Marcar como resolvido" fica desligado e diz quantos faltam', rb.disabled === true && /faltam 2/.test(rb.text), rb);
t.check('o contador mostra "Conflito 1 de 2 · 0 resolvido(s)" (o primeiro pendente já é o atual)', /Conflito 1 de 2 · 0 resolvido/.test((await t.text('[data-testid="mr-progress"]')) ?? ''), await t.text('[data-testid="mr-progress"]'));
const explain = (await t.text('[data-testid="mr-explain"]')) ?? '';
t.check('os lados têm o nome do branch (HEAD = minha, main = que chega)', /HEAD/.test(explain) && /main/.test(explain) && /Minha/.test(explain) && /Que chega/.test(explain), explain);
const origins = await q(`const o = {}; for (const l of document.querySelectorAll('.mr__scroll > .ml [data-testid="mr-line"], .mr__scroll [data-testid="mr-line"]')) o[l.dataset.origin] = (o[l.dataset.origin] ?? 0) + 1; return o`);
t.check('as mudanças sem conflito mostram a origem na margem: a da origin (O) e a minha (M)', origins.theirs >= 1 && origins.mine >= 1 && origins.stable > 5, origins);
t.check('a legenda explica M, O, M+O, ✎ e B', /M\+O/.test((await t.text('[data-testid="mr-legend"]')) ?? '') && /✎/.test((await t.text('[data-testid="mr-legend"]')) ?? ''));
const firstVisible = await q(`const s = document.querySelector('[data-testid="mr-scroll"]'); const card = document.querySelector('[data-pending="true"]'); const a = s.getBoundingClientRect(), b = card.getBoundingClientRect(); return b.top >= a.top - 1 && b.top < a.bottom`);
t.check('ao abrir, a tela já mostra o primeiro conflito pendente', firstVisible === true);
await t.shot('resolvedor-pendente');

// --- navegação: próximo/anterior, F7, régua e ajuda de atalhos -----------------------------------------------------------------------------------
const activeSeg = () => q(`return document.querySelector('.card--active')?.dataset.seg ?? null`);
const segs = await q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => c.dataset.seg)`);
t.check('o conflito atual começa no primeiro pendente', (await activeSeg()) === segs[0], { segs, atual: await activeSeg() });
await t.ev(`document.querySelector('[data-testid="mr-next"]').click()`);
await sleep(300);
t.check('"Próximo conflito" vai para o segundo e o contador acompanha', (await activeSeg()) === segs[1] && /Conflito 2 de 2/.test((await t.text('[data-testid="mr-progress"]')) ?? ''), await t.text('[data-testid="mr-progress"]'));
await t.ev(`document.querySelector('[data-testid="mr-prev"]').click()`);
await sleep(300);
t.check('"Conflito anterior" volta ao primeiro', (await activeSeg()) === segs[0]);
await t.key('F7');
await sleep(300);
t.check('o atalho F7 também vai ao próximo conflito', (await activeSeg()) === segs[1], await activeSeg());
await t.key('F7', 8);
await sleep(300);
t.check('Shift+F7 volta ao anterior', (await activeSeg()) === segs[0], await activeSeg());
const ruler = await q(`const r = {}; for (const m of document.querySelectorAll('[data-testid="mr-ruler"] [data-mark]')) r[m.dataset.mark] = (r[m.dataset.mark] ?? 0) + 1; return r`);
t.check('a régua lateral marca os 2 conflitos pendentes e as mudanças aplicadas', ruler.pending === 2 && ruler.change >= 2, ruler);
await t.ev(`document.querySelector('[data-testid="mr-ruler"] [data-mark="pending"][data-idx="${segs[1]}"]').click()`);
await sleep(300);
t.check('clicar numa marca da régua leva ao conflito', (await activeSeg()) === segs[1], await activeSeg());
await t.ev(`document.querySelector('[data-testid="mr-help-toggle"]').click()`);
await sleep(200);
const help = (await t.text('[data-testid="mr-help"]')) ?? '';
t.check('a ajuda da tela lista os atalhos (F7, Alt+1, Ctrl+Z)', /F7/.test(help) && /Alt\+1/.test(help) && /Ctrl\+Z/.test(help), help);
await t.ev(`document.querySelector('[data-testid="mr-help-toggle"]').click()`);
// os atalhos aparecem na paleta de comandos (Ctrl+K)
await t.key('k', 2);
await sleep(400);
await t.ev(`(() => { const i = document.querySelector('[role="dialog"] input, .palette input'); if (i) { i.value = 'conflito'; i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
await sleep(400);
const palette = (await t.ev(`document.body.innerText`)) ?? '';
t.check('a paleta (Ctrl+K) lista os comandos de conflito', /Próximo conflito/.test(palette) && /Conflito atual: usar a minha/.test(palette));
await t.key('Escape');
await sleep(300);

// --- decidir linha a linha no conflito 1: 2 minhas + 1 da origin, e trocar a ordem --------------------------------------------------------------
// o cartão 1 tem 3 linhas minhas (timeout 30_000, backoff, maxDelay) e 2 da origin (timeout 45_000, backoff linear)
const cardBoxes = (card) => q(`return [...document.querySelectorAll('[data-testid="mr-card"]')][${card}].querySelectorAll('[data-testid="mr-pick"] input').length`);
t.check('o cartão do conflito 1 tem uma caixa por linha (3 minhas + 2 da origin)', (await cardBoxes(0)) === 5, await cardBoxes(0));
const clickBox = (card, nth) => t.ev(`[...document.querySelectorAll('[data-testid="mr-card"]')][${card}].querySelectorAll('[data-testid="mr-pick"] input')[${nth}].click()`);
await clickBox(0, 1); // backoff exponential (minha)
await clickBox(0, 2); // maxDelay (minha)
await clickBox(0, 3); // timeout 45_000 (da origin)
await sleep(200);
c = await cards();
t.check('escolher linhas resolve o conflito e resume "2 de mim + 1 da origin"', c[0].state === 'resolved' && /2 de mim \+ 1 da origin/.test(c[0].summary), c[0]);
let pv = await previewOf(0);
t.check('a prévia mostra minhas primeiro, depois a da origin, cada linha com a sua origem', pv.length === 3 && pv[0].origin === 'mine' && pv[1].origin === 'mine' && pv[2].origin === 'theirs' && /backoff: 'exponential'/.test(pv[0].text) && /timeout: 45_000/.test(pv[2].text), pv);
await clickIn(0, 'mr-swap');
await sleep(200);
pv = await previewOf(0);
t.check('"Trocar a ordem" põe a linha da origin antes das minhas', pv.length === 3 && pv[0].origin === 'theirs' && /timeout: 45_000/.test(pv[0].text) && pv[1].origin === 'mine', pv);
t.check('a escolha é anunciada numa região viva para leitor de tela', /Conflito 1 resolvido: 2 de mim \+ 1 da origin/.test((await t.text('[data-testid="mr-live"]')) ?? ''), await t.text('[data-testid="mr-live"]'));
await t.shot('resolvedor-linha-a-linha');

// --- conflito 2 por atalho, e desfazer só uma mudança sem conflito ---------------------------------------------------------------------------------
await clickIn(1, 'mr-use-theirs');
await sleep(200);
c = await cards();
t.check('"Usar a que chega" resolve o conflito 2', c[1].state === 'resolved' && /1 da origin/.test(c[1].summary), c[1]);
const rb2 = await resolveBtn();
t.check('com tudo decidido o botão liga e perde o "faltam"', rb2.disabled === false && !/faltam/.test(rb2.text), rb2);
// desfazer a mudança da origin (retries 3 -> 5): o arquivo final volta a ter retries: 3
const changes = await q(`return [...document.querySelectorAll('[data-testid="mr-change"]')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim())`);
t.check('as mudanças sem conflito aparecem como "Mudança aplicada" com o lado de origem', changes.length >= 2 && changes.every((x) => /Mudança aplicada/.test(x)) && changes.some((x) => /só da origin/.test(x)) && changes.some((x) => /só sua/.test(x)), changes);
const retriesIdx = changes.findIndex((x) => /só da origin/.test(x));
await click('[data-testid="mr-toggle-change"]', retriesIdx);
await sleep(200);
const reverted = await q(`return [...document.querySelectorAll('[data-testid="mr-change"]')].map((n) => n.dataset.reverted)`);
t.check('"Desfazer só esta" marca a mudança como não aplicada (e o texto vira "Aplicar")', reverted[retriesIdx] === 'true' && /Mudança não aplicada/.test((await q(`return document.querySelectorAll('[data-testid="mr-change"]')[${retriesIdx}].textContent`)) ?? ''), reverted);

// --- desfazer e refazer por teclado ---------------------------------------------------------------------------------------------------------------
await t.key('z', 2);
await sleep(250);
const afterUndo = await q(`return [...document.querySelectorAll('[data-testid="mr-change"]')].map((n) => n.dataset.reverted)`);
t.check('Ctrl+Z desfaz a última escolha (a mudança da origin volta a ser aplicada)', afterUndo[retriesIdx] === 'false', afterUndo);
await t.key('y', 2);
await sleep(250);
const afterRedo = await q(`return [...document.querySelectorAll('[data-testid="mr-change"]')].map((n) => n.dataset.reverted)`);
t.check('Ctrl+Y refaz', afterRedo[retriesIdx] === 'true', afterRedo);
await clickIn(0, 'mr-reopen'); // "Voltar a pendente" do conflito 1
await sleep(250);
t.check('"Voltar a pendente" reabre o conflito 1', (await cards())[0].state === 'pending');
await t.ev(`document.querySelector('[data-testid="mr-undo"]').click()`);
await sleep(250);
c = await cards();
t.check('"Desfazer" (botão) devolve a decisão do conflito 1, inclusive a ordem das linhas', c[0].state === 'resolved' && /2 de mim \+ 1 da origin/.test(c[0].summary), c[0]);
t.check('e a prévia continua com a linha da origin primeiro', (await previewOf(0))[0]?.origin === 'theirs');

// --- rascunho: fechar a tela (recarregar o app) e voltar --------------------------------------------------------------------------------------------
const openConflicts = async (name, minCards) => {
  await t.ev('location.reload()');
  await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
  await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
  await t.ev(`[...document.querySelectorAll('li.repo')].find((r) => r.querySelector('strong')?.textContent.trim() === ${lit(name)}).querySelector('.repo__btns button').click()`);
  await t.until(`[...document.querySelectorAll('.rv__btns button')].some((b) => /Conflitos/.test(b.textContent))`, 20000);
  await t.ev(`[...document.querySelectorAll('.rv__btns button')].find((b) => /Conflitos/.test(b.textContent))?.click()`);
  await t.until(`document.querySelectorAll('[data-testid="mr-card"]').length >= ${minCards}`, 15000);
  await sleep(500);
};
const draftKeys = () => t.ev(`Object.keys(localStorage).filter((k) => k.startsWith('gitnexus.mergeDraft:')).length`);
t.check('as escolhas foram guardadas como rascunho (uma chave por arquivo)', (await draftKeys()) === 1, await draftKeys());
await openConflicts('resolver', 2);
c = await cards();
t.check('depois de recarregar o app o rascunho volta: os dois conflitos continuam decididos', c.length === 2 && c.every((x) => x.state === 'resolved') && /2 de mim \+ 1 da origin/.test(c[0].summary), c);
t.check('a tela avisa que o rascunho foi recuperado', /Rascunho recuperado/.test((await t.text('[data-testid="mr-notice"]')) ?? ''), await t.text('[data-testid="mr-notice"]'));
const revertedBack = await q(`return [...document.querySelectorAll('[data-testid="mr-change"]')].map((n) => n.dataset.reverted)`);
t.check('inclusive a mudança desfeita e a ordem das linhas', revertedBack[retriesIdx] === 'true' && (await previewOf(0))[0]?.origin === 'theirs', revertedBack);
const fileSum = (await t.text('[data-testid="mv-file-summary"]')) ?? '';
t.check('a lista de arquivos mostra "2 conflito(s) · 2 resolvido(s)"', /2 conflito\(s\) · 2 resolvido\(s\)/.test(fileSum), fileSum);
await t.shot('resolvedor-rascunho');
await t.shot('resolvedor-tudo-decidido');

// --- tema claro e volta ao escuro (pelo seletor do app, como o usuário), só para a captura ----------------------------------------------------
const pickTheme = async (label) => {
  await t.ev(`(() => { const b = document.querySelector('[data-testid="theme-picker"] .cbx__btn') ?? document.querySelector('.theme .cbx__btn'); b.focus(); b.click(); })()`);
  await sleep(400);
  await t.ev(`[...document.querySelectorAll('.cbx__opt')].find((e) => e.textContent.trim() === ${lit(label)}).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
  await sleep(500);
};
await pickTheme('Claro');
t.check('no tema claro a tela usa os tokens claros (fundo claro)', (await t.ev(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(244, 245, 247)');
await t.shot('resolvedor-tema-claro');
await pickTheme('Escuro');

// --- gravar: o resultado exato, sem marcador, e o arquivo vai para o índice ---------------------------------------------------------------------
await click('[data-testid="mr-resolve"]', 0);
await t.until(`!document.querySelector('[data-testid="mr-card"]') && !document.querySelector('[data-testid="merge-resolver"]')`, 15000);
const disk = readFileSync(join(repo, FILE), 'utf8').replace(/\r\n/g, '\n');
const expected = doc({
  retries: 3, // a mudança da origin foi desfeita
  net: ["  timeout: 45_000,", "  backoff: 'exponential',", '  maxDelay: 8_000,'], // a origin primeiro (ordem trocada), depois as 2 minhas
  verbose: 'true', // a minha mudança sem conflito entrou
  ret: 'load(env) ?? Object.freeze(defaults)', // "usar a que chega"
});
t.check('o arquivo gravado é exatamente o que a tela mostrava', disk === expected, disk);
t.check('nenhum marcador de conflito no arquivo', !/^(<{7}|={7}|>{7})/m.test(disk));
t.check('o git considera o arquivo resolvido (sem estágios de conflito)', git(repo, 'ls-files', '-u').trim() === '');
t.check('o rascunho foi apagado depois de gravar', (await draftKeys()) === 0, await draftKeys());

// --- passo seguinte da operação, reabrir o conflito e ação em massa ------------------------------------------------------------------------------
await t.until(`document.querySelector('[data-testid="mv-done"]')`, 10000);
const done = (await t.text('[data-testid="mv-done"]')) ?? '';
t.check('sem arquivo pendente a tela mostra o passo seguinte (Continuar ou Abortar)', /Todos os arquivos estão resolvidos/.test(done) && (await t.count('[data-testid="mv-done"] [data-testid="op-continue"]')) === 1, done);
t.check('o arquivo resolvido continua na lista, marcado, com "Reabrir conflito"', (await t.count('[data-testid="mv-resolved-file"]')) === 1 && /Reabrir conflito/.test((await t.text('[data-testid="mv-resolved-file"]')) ?? ''));
await t.ev(`document.activeElement?.blur?.()`);
await t.shot('resolvedor-reabrir');
await t.ev(`document.querySelector('[data-testid="mv-reopen"]').click()`);
await t.until(`document.querySelectorAll('[data-testid="mr-card"]').length >= 2`, 15000);
await sleep(400);
t.check('"Reabrir conflito" recria o conflito original: o git volta a listar o arquivo e o disco tem marcadores', git(repo, 'ls-files', '-u').trim() !== '' && /^<{7}/m.test(readFileSync(join(repo, FILE), 'utf8')));
c = await cards();
t.check('a tela mostra os dois conflitos de novo, pendentes (a resolução anterior não vale)', c.length === 2 && c.every((x) => x.state === 'pending'), c);
t.check('sem nomes de branch nos marcadores (git checkout -m), a explicação é a genérica', /o branch em que você está/.test((await t.text('[data-testid="mr-explain"]')) ?? ''), await t.text('[data-testid="mr-explain"]'));

// ação em massa: aceitar tudo da origin, com confirmação que diz quantos
await t.ev(`document.querySelector('[data-testid="mr-bulk"]').click()`);
await sleep(300);
const items = await q(`return [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim())`);
t.check('o menu "Em massa" oferece aceitar tudo meu / da origin (com a contagem) e aplicar as mudanças sem conflito', items.some((x) => /Aceitar tudo da origin \(2 pendentes\)/.test(x)) && items.some((x) => /Aplicar todas as mudanças sem conflito/.test(x)), items);
await t.shot('resolvedor-em-massa');
await t.ev(`[...document.querySelectorAll('[role="menuitem"]')].find((b) => /Aceitar tudo da origin/.test(b.textContent)).click()`);
await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
const ask = (await t.text('[role="alertdialog"]')) ?? '';
t.check('a confirmação diz quantos conflitos serão decididos e que dá para desfazer', /2 conflito\(s\) pendente\(s\)/.test(ask) && /desfazer/.test(ask), ask);
await t.shot('resolvedor-em-massa-confirmar');
await t.ev(`[...document.querySelectorAll('.dlg__btns button')].pop().click()`);
await sleep(400);
c = await cards();
t.check('depois de confirmar, os dois conflitos estão decididos com a origin', c.every((x) => x.state === 'resolved' && /da origin/.test(x.summary) && !/de mim/.test(x.summary)), c);
t.check('e o anúncio da região viva diz quantos foram decididos', /2 conflito\(s\) decidido\(s\) de uma vez/.test((await t.text('[data-testid="mr-live"]')) ?? ''), await t.text('[data-testid="mr-live"]'));
await t.key('z', 2);
await sleep(250);
t.check('Ctrl+Z desfaz a ação em massa inteira (volta a 2 pendentes)', (await cards()).every((x) => x.state === 'pending'));
await t.key('y', 2);
await sleep(250);
await click('[data-testid="mr-resolve"]', 0);
await t.until(`document.querySelector('[data-testid="mv-done"]')`, 15000);
const disk2 = readFileSync(join(repo, FILE), 'utf8').replace(/\r\n/g, '\n');
t.check('o arquivo gravado é a versão que chega, com as mudanças sem conflito aplicadas', disk2 === doc({ retries: 5, net: THEIRS.net, verbose: 'true', ret: THEIRS.ret }), disk2);
await t.ev(`document.querySelector('[data-testid="mv-done"] [data-testid="op-continue"]').click()`);
await t.until(`!document.querySelector('[data-testid="op-banner"]')`, 15000);
t.check('Continuar concluiu o merge (commit com 2 pais) com o arquivo resolvido', git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length === 3 && git(repo, 'show', 'HEAD:' + FILE).replace(/\r\n/g, '\n') === disk2);

// --- rebase: o commit reaplicado é a "minha", o branch de destino é a "que chega" -----------------------------------------------------------
const root2 = tmpRoot('gn-mr2-');
const repo2 = mkRepo(root2, 'rebase', { files: { 'a.txt': 'base\n' } });
const put2 = (c2, m) => {
  writeFileSync(join(repo2, 'a.txt'), c2);
  git(repo2, 'add', '.');
  git(repo2, 'commit', '-qm', m);
};
git(repo2, 'checkout', '-q', '-b', 'topico');
put2('do topico\n', 'feat: muda no topico');
git(repo2, 'checkout', '-q', 'main');
put2('da main\n', 'feat: muda na main');
git(repo2, 'checkout', '-q', 'topico');
try {
  git(repo2, 'rebase', 'main');
} catch {
  /* conflito: é o esperado */
}
await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo2)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 2`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((r) => r.querySelector('strong')?.textContent.trim() === 'rebase').querySelector('.repo__btns button').click()`);
await t.until(`[...document.querySelectorAll('.rv__btns button')].some((b) => /Conflitos/.test(b.textContent))`, 20000);
await t.ev(`[...document.querySelectorAll('.rv__btns button')].find((b) => /Conflitos/.test(b.textContent))?.click()`);
await t.until(`document.querySelector('[data-testid="mr-explain"]')`, 15000);
const rebaseText = (await t.text('[data-testid="mr-explain"]')) ?? '';
t.check('no rebase a "minha" é o commit reaplicado (hash e assunto) e a "que chega" é o branch de destino', /Minha · [0-9a-f]{7,} \(feat: muda no topico\)/.test(rebaseText) && /Que chega · HEAD/.test(rebaseText), rebaseText);
t.check('e a tela explica a inversão: "Você está reaplicando ... sobre ..."', /Você está reaplicando [0-9a-f]{7,} \(feat: muda no topico\) sobre HEAD/.test(rebaseText), rebaseText);
const sideText = await q(`return [...document.querySelectorAll('[data-testid="mr-card"] [data-side]')].map((s) => s.dataset.side + ':' + [...s.querySelectorAll('.pl__code')].map((x) => x.textContent.trim()).join('|'))`);
t.check('no rebase, "minha" mostra o conteúdo do commit do usuário e "que chega" o da main', sideText.includes('mine:do topico') && sideText.includes('theirs:da main'), sideText);
await t.shot('resolvedor-rebase');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
