// Submódulos (Ferramentas > Submódulos): lista com o estado de cada um, inicializa, detecta o "outro commit" depois de um pull, atualiza e se
// recusa a mexer no que tem alterações locais. O git é o de verdade; o repositório de teste libera o protocolo `file` (o git o bloqueia por padrão).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const root = tmpRoot('gn-sub-');
const cfg = (d) => {
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.fsmonitor', 'false'], ['protocol.file.allow', 'always']]) git(d, 'config', k, v);
};
const commit = (d, file, text, msg) => {
  writeFileSync(join(d, file), text);
  git(d, 'add', '.');
  git(d, 'commit', '-qm', msg);
};
const lib = join(root, 'lib');
git(root, 'init', '-q', '-b', 'main', lib);
cfg(lib);
commit(lib, 'lib.txt', '1\n', 'feat: lib 1');
const pai = join(root, 'pai');
git(root, 'init', '-q', '-b', 'main', pai);
cfg(pai);
git(pai, 'submodule', 'add', '-q', lib, 'vendor/lib');
git(pai, 'commit', '-qm', 'feat: submódulo');
const bare = join(root, 'pai.git');
git(root, 'clone', '-q', '--bare', pai, bare);
const app = join(root, 'app');
git(root, 'clone', '-q', bare, app);
cfg(app);
const semSub = mkRepo(root, 'semsub');

await t.ev(`window.gitNexus.addRepositoryPath(${lit(app)})`);
await t.ev(`window.gitNexus.addRepositoryPath(${lit(semSub)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 2`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
// guarda o texto dos erros do console (sobrevive ao recarregar) para mostrar o que houve, se algo falhar
const hook = () => t.ev(`(() => { const o = console.error; console.error = (...a) => { const l = JSON.parse(sessionStorage.getItem('__errs') ?? '[]'); l.push(a.map((x) => (x && (x.stack || x.message)) || String(x)).join(' | ')); sessionStorage.setItem('__errs', JSON.stringify(l)); o(...a); }; return true; })()`);
await hook();

const openSubmodules = async (name) => {
  await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)})`, 20000);
  await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)}).querySelector('.repo__btns button').click()`);
  await t.until(`document.querySelector('.rv__btns')`, 20000);
  await sleep(500);
  await t.key('k', 2);
  await t.until(`document.querySelector('.cp__input')`, 5000);
  await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = 'submodulos'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(300);
  await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => e.textContent.includes('Abrir os submódulos'))?.click()`);
  await t.until(`document.querySelector('[data-testid="submodules-panel"]')`, 10000);
  // espera a primeira leitura terminar (a lista ou o aviso de vazio)
  await t.until(`document.querySelector('[data-testid="sub-row"], [data-testid="sub-empty"]')`, 30000);
  await sleep(300);
};
const rows = () => t.ev(`[...document.querySelectorAll('[data-testid="sub-row"]')].map((r) => ({ path: r.querySelector('.sm__path').textContent.trim(), state: r.querySelector('[data-testid^="sub-state-"]').getAttribute('data-testid').replace('sub-state-', ''), dirty: /Alterações locais/.test(r.textContent) }))`);
const btn = (label) => t.ev(`[...document.querySelectorAll('[data-testid="submodules-panel"] button')].filter((b) => b.textContent.trim() === ${lit(label)} && !b.disabled).forEach((b) => b.click())`);
/** Recarrega e espera a lista mostrar o que se espera (a lista antiga fica na tela enquanto lê, então só esperar um tempo leria o estado velho). */
const reload = async (untilExpr) => {
  await btn('Recarregar');
  await t.until(untilExpr, 30000);
  await sleep(200);
};

// 1. repositório sem submódulos
await openSubmodules('semsub');
t.check('sem submódulos: mensagem de vazio', /não tem submódulos/.test((await t.text('[data-testid="sub-empty"]')) ?? ''));
t.check('e os botões de ação ficam desligados', (await t.ev(`document.querySelector('[data-testid="sub-init-all"]').disabled && document.querySelector('[data-testid="sub-update-all"]').disabled`)) === true);

// 2. o repositório com submódulo: não inicializado
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 2`, 20000);
await sleep(800);
await hook();
await openSubmodules('app');
let r = await rows();
t.check('um submódulo não inicializado, com o caminho', r.length === 1 && r[0].path === 'vendor/lib' && r[0].state === 'uninitialized', r);
await t.shot('submodulos-nao-inicializado');
await btn('Inicializar');
await t.until(`document.querySelector('[data-testid="sub-done"]')`, 30000);
await sleep(800);
r = await rows();
t.check('depois de inicializar está no commit registrado', r[0]?.state === 'ok', r);
t.check('a mensagem confirma', /Inicializado/.test((await t.text('[data-testid="sub-done"]')) ?? ''), await t.text('[data-testid="sub-done"]'));

// 3. o colega avança o submódulo e registra no pai; depois do pull aparece "em outro commit"
commit(lib, 'lib.txt', '2\n', 'feat: lib 2');
git(join(pai, 'vendor/lib'), 'pull', '-q', 'origin', 'main');
git(pai, 'add', 'vendor/lib');
git(pai, 'commit', '-qm', 'feat: atualiza lib');
git(pai, 'push', '-q', bare, 'main');
git(app, 'pull', '-q');
await reload(`document.querySelector('[data-testid="sub-state-outdated"]')`);
r = await rows();
t.check('depois do pull o submódulo aparece em outro commit', r[0]?.state === 'outdated', r);
t.check('e o botão Atualizar está disponível', (await t.ev(`[...document.querySelectorAll('[data-testid="submodules-panel"] button')].some((b) => b.textContent.trim() === 'Atualizar' && !b.disabled)`)) === true);
await t.shot('submodulos-desatualizado');

// 4. com alterações locais a atualização é recusada
writeFileSync(join(app, 'vendor/lib', 'lib.txt'), 'meu trabalho\n');
await reload(`/Alterações locais/.test(document.querySelector('[data-testid="sub-row"]')?.textContent ?? '')`);
r = await rows();
t.check('mostra "Alterações locais"', r[0]?.dirty === true, r);
await btn('Atualizar');
await t.until(`document.querySelector('[data-testid="sub-error"]')`, 30000);
t.check('atualizar é recusado com a explicação', /alterações locais/.test((await t.text('[data-testid="sub-error"]')) ?? ''), [await t.text('[data-testid="sub-error"]'), await t.text('[data-testid="submodules-panel"]')]);
t.check('o trabalho local continua lá', git(app, '-C', 'vendor/lib', 'status', '--porcelain').includes('lib.txt'));

// 5. sem alterações, atualiza
git(join(app, 'vendor/lib'), 'checkout', '--', 'lib.txt');
await reload(`!/Alterações locais/.test(document.querySelector('[data-testid="sub-row"]')?.textContent ?? 'Alterações locais')`);
await btn('Atualizar');
await t.until(`document.querySelector('[data-testid="sub-done"]')`, 30000);
await sleep(800);
r = await rows();
t.check('sem alterações locais a atualização leva ao commit registrado', r[0]?.state === 'ok', [r, await t.text('[data-testid="sub-error"]'), await t.text('[data-testid="sub-done"]')]);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection|asynchronous response/.test(String(e)));
// recarregar a página interrompe as sondagens do harness ("Failed to fetch"): isso não é erro da interface
const realErrors = JSON.parse((await t.ev("sessionStorage.getItem('__errs')")) ?? '[]').filter((x) => !/Failed to fetch/.test(x));
t.check('nenhum erro da interface no console', realErrors.length === 0, [realErrors, appErrors]);
t.close();
