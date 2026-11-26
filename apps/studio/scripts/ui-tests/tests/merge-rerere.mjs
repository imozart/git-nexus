// Resolvedor de conflitos (issue #231, fase 6), com git de verdade: o arquivo que o Git já preencheu com uma resolução gravada (rerere) aparece como
// "Resolvido por uma resolução gravada (de DD/MM)" com a diferença, e dá para aceitar, revisar/editar ou esquecer; e a preferência
// "Lembrar minhas resoluções" grava a decisão do usuário.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.setItem('gitnexus.newConflictResolver', '1')`);

const FILE = 'precos.js';
const file = (x, y) => ['// preços', 'const base = 1;', x, 'const taxa = 2;', 'const frete = 3;', y, 'export { base };', ''].join('\n');
const BASE = file('const x = 1;', 'const y = 1;');
const MINE = file('const x = 2;', 'const y = 2;');
const THEIRS = file('const x = 3;', 'const y = 3;');
const RESOLVED = file('const x = 3;', 'const y = 2 + 3;'); // a 1ª com a que chega, a 2ª digitada

const root = tmpRoot('gn-rr-');
const repo = mkRepo(root, 'precos', { files: { [FILE]: BASE } });
const put = (c, m) => {
  writeFileSync(join(repo, FILE), c);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', m);
};
const tryGit = (...a) => {
  try {
    return git(repo, ...a);
  } catch (e) {
    return String(e.stdout ?? '') + String(e.stderr ?? '');
  }
};
git(repo, 'config', 'rerere.enabled', 'true');
git(repo, 'checkout', '-q', '-b', 'feat/precos');
put(MINE, 'feat: preços da feature');
git(repo, 'checkout', '-q', 'main');
put(THEIRS, 'feat: preços da main');
git(repo, 'checkout', '-q', 'feat/precos');
// 1ª vez: o usuário resolve e o Git grava; recomeça a mesclagem e o Git aplica a resolução gravada
tryGit('merge', 'main');
writeFileSync(join(repo, FILE), RESOLVED);
git(repo, 'add', FILE);
tryGit('rerere');
git(repo, 'merge', '--abort');
git(repo, 'reset', '--hard');
const replay = tryGit('merge', 'main');

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="op-banner"]')`, 20000);
await t.ev(`[...document.querySelectorAll('[data-testid="repo-view-tab"]')].find((b) => /Conflitos/.test(b.textContent))?.click()`);
await t.until(`document.querySelector('[data-testid="merge-resolver"]')`, 15000);
await sleep(600);

const q = (js) => t.ev(`(() => { ${js} })()`);
const states = () => q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => c.dataset.state)`);
const clickTid = (testid) => t.ev(`document.querySelector('[data-testid="${testid}"]').click()`);
const rrState = () => q(`return document.querySelector('[data-testid="mr-rerere"]')?.dataset.state ?? ''`);
const reload = async () => {
  // o botão fica desabilitado enquanto uma leitura está em andamento: espera liberar e clica de novo até a tela mostrar o arquivo
  for (let i = 0; i < 4; i++) {
    await t.until(`[...document.querySelectorAll('.mv__headbtns button')].find((b) => /Recarregar/.test(b.textContent) && !b.disabled)`, 20000);
    await t.ev(`[...document.querySelectorAll('.mv__headbtns button')].find((b) => /Recarregar/.test(b.textContent))?.click()`);
    if (await t.until(`document.querySelector('[data-testid="mr-rerere"]')`, 8000).then(() => true).catch(() => false)) break;
  }
  await sleep(500);
};
const rrCache = join(repo, '.git', 'rr-cache');
const postimages = () => (existsSync(rrCache) ? readdirSync(rrCache).flatMap((d) => readdirSync(join(rrCache, d)).filter((f) => f === 'postimage').map((f) => readFileSync(join(rrCache, d, f), 'utf8'))) : []);

// --- o Git preencheu o arquivo: a tela reconhece e explica -----------------------------------------------------------------------------------------
t.check('o Git aplicou a resolução gravada (o arquivo está sem marcador e o índice ainda em conflito)', /previous resolution/.test(replay) && !/<<<<<<</.test(readFileSync(join(repo, FILE), 'utf8')) && git(repo, 'ls-files', '--unmerged').trim() !== '', replay);
const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const title = (await t.text('[data-testid="mr-rerere"] .rr__head strong')) ?? '';
t.check('o aviso diz "Resolvido por uma resolução gravada (de DD/MM)" com a data da gravação', title === `Resolvido por uma resolução gravada (de ${today})`, title);
t.check('e oferece aceitar, revisar/editar e esquecer', (await q(`return ['mr-rr-accept', 'mr-rr-review', 'mr-rr-forget'].every((id) => !!document.querySelector('[data-testid="' + id + '"]'))`)) === true);
const diff = (await q(`return [...document.querySelectorAll('[data-testid="mr-rr-diff"] .rr__row')].map((r) => r.querySelector('b').textContent + ' ' + r.querySelector('code').textContent).join(' | ')`)) ?? '';
t.check('mostra a diferença para ficar com a minha versão: a linha que saiu e a que entrou, em cada conflito', /− const x = 2;/.test(diff) && /\+ const x = 3;/.test(diff) && /− const y = 2;/.test(diff) && /\+ const y = 2 \+ 3;/.test(diff), diff);
t.check('a preferência "Lembrar minhas resoluções" aparece ligada (o rerere está no config do repositório) e sem o aviso de "ligado fora"', (await q(`return document.querySelector('[data-testid="mv-rerere"]').checked`)) === true && !(await q(`return document.querySelector('[data-testid="mv-rerere-outside"]')`)));
await t.shot('rerere-aviso');

// --- revisar / editar --------------------------------------------------------------------------------------------------------------------------------
await clickTid('mr-rr-review');
await sleep(500);
t.check('"Revisar / editar" abre os conflitos já decididos como a resolução gravada (um com a que chega, outro digitado)', (await rrState()) === 'reviewing' && JSON.stringify(await states()) === '["resolved","edited"]', { s: await rrState(), st: await states() });
t.check('o resultado é o arquivo que o Git deixou e "Marcar como resolvido" já está liberado', (await q(`return [...document.querySelectorAll('[data-testid="mr-scroll"] .ml__code')].map((l) => l.textContent).join('\\n')`)).includes('const y = 2 + 3;') && (await q(`return document.querySelector('[data-testid="mr-resolve"]').disabled`)) === false);
await t.shot('rerere-revisao');

// --- esquecer: volta ao conflito original ----------------------------------------------------------------------------------------------------------------
await clickTid('mr-rr-forget');
await t.until(`/esquecida/.test(document.querySelector('.ok')?.textContent ?? '')`, 20000);
await t.until(`!document.querySelector('[data-testid="mr-rr-forget"]')`, 20000);
await sleep(500);
t.check('"Esquecer" devolve o conflito original: marcadores no disco, aviso some e os dois conflitos pendentes', /<<<<<<</.test(readFileSync(join(repo, FILE), 'utf8')) && !(await rrState()) && JSON.stringify(await states()) === '["pending","pending"]', { st: await states() });
t.check('a resolução gravada foi apagada do Git (nenhum postimage no rr-cache)', postimages().length === 0, postimages());
t.check('e a tela avisa que esqueceu', /esquecida/.test((await t.text('.ok')) ?? ''), await t.text('.ok'));

// --- decidir de novo: com o rerere ligado a decisão é gravada ------------------------------------------------------------------------------------------
await q(`document.querySelectorAll('[data-testid="mr-card"]')[0].querySelector('[data-testid="mr-use-mine"]').click()`);
await q(`document.querySelectorAll('[data-testid="mr-card"]')[1].querySelector('[data-testid="mr-use-mine"]').click()`);
await t.until(`!document.querySelector('[data-testid="mr-resolve"]').disabled`, 20000);
await clickTid('mr-resolve');
await t.until(`/Sua decisão foi gravada/.test(document.querySelector('.ok')?.textContent ?? '')`, 20000).catch(() => {});
await sleep(500);
t.check('"Marcar como resolvido" grava a decisão no rerere e avisa', /Sua decisão foi gravada/.test((await t.text('.ok')) ?? '') && postimages().length === 1 && postimages()[0].includes('const x = 2;'), { ok: await t.text('.ok'), p: postimages() });
await t.shot('rerere-gravada');

// --- aceitar: o Git preenche de novo e o usuário só confere ------------------------------------------------------------------------------------------------
git(repo, 'merge', '--abort');
git(repo, 'reset', '--hard');
tryGit('merge', 'main');
await reload();
t.check('o conflito volta a aparecer já preenchido (agora com a decisão nova) e o aviso reaparece', (await rrState()) === 'banner', await rrState());
await clickTid('mr-rr-accept');
await t.until(`!document.querySelector('[data-testid="mr-rerere"]')`, 20000);
await sleep(800);
const final = readFileSync(join(repo, FILE), 'utf8');
t.check('"Aceitar" marca o arquivo como está: com a decisão gravada, sem marcador, e o índice sem conflito', final === file('const x = 2;', 'const y = 2;') && git(repo, 'ls-files', '--unmerged').trim() === '', JSON.stringify(final));
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|A listener indicated an asynchronous response/.test(String(e)));
t.check('sem erro no console', appErrors.length === 0, appErrors);
t.close();
