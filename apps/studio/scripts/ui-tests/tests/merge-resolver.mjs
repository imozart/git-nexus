// Novo resolvedor de conflitos (issue #231, fase 2), com git de verdade: o arquivo como vai ficar, a origem de cada linha, a decisão linha a linha,
// desfazer só uma mudança sem conflito, a ordem das linhas, e o que é gravado no disco ao marcar como resolvido. Também confere os rótulos no rebase.
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
const previewOf = (card) => q(`return [...[...document.querySelectorAll('[data-testid="mr-card"]')][${card}].querySelectorAll('.preview [data-testid="mr-line"]')].map((l) => ({ origin: l.dataset.origin, text: l.querySelector('.ml__code').textContent.trim() }))`);
const clickIn = (card, testid) => t.ev(`[...document.querySelectorAll('[data-testid="mr-card"]')][${card}].querySelector('[data-testid="${testid}"]').click()`);

// --- estado inicial -----------------------------------------------------------------------------------------------------------------------
let c = await cards();
t.check('a tela nova aparece (preferência ligada) e mostra 2 conflitos pendentes', c.length === 2 && c.every((x) => x.state === 'pending'), c);
t.check('cada conflito é uma região nomeada com as linhas ("Conflito 1 de 2, linhas 9 a 11")', /^Conflito 1 de 2, linhas? \d+/.test(c[0].region) && /^Conflito 2 de 2/.test(c[1].region), c.map((x) => x.region));
const rb = await resolveBtn();
t.check('"Marcar como resolvido" fica desligado e diz quantos faltam', rb.disabled === true && /faltam 2/.test(rb.text), rb);
t.check('o contador mostra 2 conflitos e 0 resolvidos', /2 conflito\(s\) · 0 resolvido/.test((await t.text('[data-testid="mr-progress"]')) ?? ''), await t.text('[data-testid="mr-progress"]'));
const explain = (await t.text('[data-testid="mr-explain"]')) ?? '';
t.check('os lados têm o nome do branch (HEAD = minha, main = que chega)', /HEAD/.test(explain) && /main/.test(explain) && /Minha/.test(explain) && /Que chega/.test(explain), explain);
const origins = await q(`const o = {}; for (const l of document.querySelectorAll('.mr__scroll > .ml [data-testid="mr-line"], .mr__scroll [data-testid="mr-line"]')) o[l.dataset.origin] = (o[l.dataset.origin] ?? 0) + 1; return o`);
t.check('as mudanças sem conflito mostram a origem na margem: a da origin (O) e a minha (M)', origins.theirs >= 1 && origins.mine >= 1 && origins.stable > 5, origins);
t.check('a legenda explica M, O, M+O, ✎ e B', /M\+O/.test((await t.text('[data-testid="mr-legend"]')) ?? '') && /✎/.test((await t.text('[data-testid="mr-legend"]')) ?? ''));
const firstVisible = await q(`const s = document.querySelector('[data-testid="mr-scroll"]'); const card = document.querySelector('[data-pending="true"]'); const a = s.getBoundingClientRect(), b = card.getBoundingClientRect(); return b.top >= a.top - 1 && b.top < a.bottom`);
t.check('ao abrir, a tela já mostra o primeiro conflito pendente', firstVisible === true);
await t.shot('resolvedor-pendente');

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
