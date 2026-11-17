// Clonar e criar repositório pela tela inicial: o diálogo mostra onde o repositório ficará, clona de um remoto de verdade, abre o repositório,
// recusa branch/nome inválidos, mostra o erro do git sem fechar, cria um repositório novo com branch e .gitignore e abre o diálogo pela paleta.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const root = tmpRoot('gn-clone-');
const origem = mkRepo(root, 'origem', { files: { 'a.txt': 'um\n' } });
const bare = join(root, 'projeto-remoto.git');
git(root, 'clone', '-q', '--bare', origem, bare);
const destino = join(root, 'destino');
mkdirSync(destino);

await t.ev('location.reload()');
await t.until(`document.querySelector('[data-testid="home-clone"]')`, 20000);
await sleep(500);

const fill = (testid, v) => t.ev(`(() => { const i = document.querySelector('[data-testid="${testid}"]'); i.value = ${lit(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const submitState = () => t.ev(`(() => { const b = document.querySelector('[data-testid="create-submit"]'); return { text: b.textContent.trim(), disabled: b.disabled }; })()`);
const target = () => t.text('[data-testid="create-target"]');
const dialogOpen = () => t.ev(`!!document.querySelector('[data-testid="create-clone"], [data-testid="create-init"]')`);

// --- clonar ------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector('[data-testid="home-clone"]').click()`);
await t.until(`document.querySelector('[data-testid="create-clone"]')`, 5000);
t.check('o diálogo de clonar abre', await dialogOpen());
t.check('sem endereço e sem pasta o botão Clonar fica desligado', (await submitState()).disabled === true);
await fill('create-url', bare);
t.check('com só o endereço ainda falta a pasta de destino', (await submitState()).disabled === true);
await fill('create-parent', destino);
await sleep(200);
t.check('o botão liga com endereço e pasta', (await submitState()).disabled === false);
const alvo = (await target()) ?? '';
t.check('mostra onde ficará: pasta + nome tirado do endereço', alvo.includes('projeto-remoto') && alvo.includes('destino'), alvo);
await fill('create-branch', 'a b');
await sleep(200);
t.check('branch inválida desliga o botão e avisa', (await submitState()).disabled === true && /inválido/.test((await t.text('.rc__bad')) ?? ''));
await fill('create-branch', '');
await fill('create-name', '../fora');
await sleep(200);
t.check('nome de pasta inválido desliga o botão', (await submitState()).disabled === true);
await fill('create-name', '');
await sleep(200);

// erro: endereço que não existe (o diálogo continua aberto, com a mensagem)
await fill('create-url', join(root, 'nao-existe.git'));
await sleep(200);
await t.ev(`document.querySelector('[data-testid="create-submit"]').click()`);
await t.until(`document.querySelector('[data-testid="create-error"]')`, 20000);
t.check('endereço inexistente: mostra "não encontrado" e o diálogo fica aberto', /não encontrado/i.test((await t.text('[data-testid="create-error"]')) ?? '') && (await dialogOpen()), await t.text('[data-testid="create-error"]'));
t.check('nada foi criado no destino', !existsSync(join(destino, 'nao-existe')));

// sucesso
await fill('create-url', bare);
await sleep(200);
await t.ev(`document.querySelector('[data-testid="create-submit"]').click()`);
await t.until(`!document.querySelector('[data-testid="create-clone"]')`, 30000);
t.check('depois de clonar o diálogo fecha', !(await dialogOpen()));
t.check('a pasta clonada existe com os arquivos', existsSync(join(destino, 'projeto-remoto', 'a.txt')));
t.check('o remoto "origin" aponta para o endereço', git(join(destino, 'projeto-remoto'), 'remote', 'get-url', 'origin').trim() === bare);
await t.until(`[...document.querySelectorAll('[role="tab"], .tab, .core__tabs *')].some((e) => /projeto-remoto/.test(e.textContent))`, 15000);
t.check('o repositório foi aberto numa aba', !!(await t.ev(`[...document.querySelectorAll('.core__top *')].some((e) => e.children.length === 0 && /projeto-remoto/.test(e.textContent))`)));

// --- novo repositório ---------------------------------------------------------------------------------------
await t.ev(`document.querySelector('.core__tabs button, .core__tabs [role="tab"]')?.click()`);
await t.ev('location.reload()');
await t.until(`document.querySelector('[data-testid="home-new"]')`, 20000);
await sleep(500);
await t.ev(`document.querySelector('[data-testid="home-new"]').click()`);
await t.until(`document.querySelector('[data-testid="create-init"]')`, 5000);
t.check('o diálogo de novo repositório abre com a branch padrão main', (await t.ev(`document.querySelector('[data-testid="create-branch"]').value`)) === 'main');
t.check('sem pasta o botão Criar fica desligado', (await submitState()).disabled === true);
await fill('create-parent', destino);
await fill('create-name', 'novinho');
await fill('create-branch', 'develop');
await t.ev(`(() => { const s = document.querySelector('[data-testid="create-gitignore"]'); s.value = 'node'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await sleep(300);
t.check('mostra onde ficará (pasta + subpasta)', ((await target()) ?? '').includes('novinho'), await target());
await t.shot('novo-repositorio');
await t.ev(`document.querySelector('[data-testid="create-submit"]').click()`);
await t.until(`!document.querySelector('[data-testid="create-init"]')`, 30000);
const novo = join(destino, 'novinho');
t.check('o repositório foi criado', existsSync(join(novo, '.git')));
t.check('na branch inicial pedida', git(novo, 'symbolic-ref', '--short', 'HEAD').trim() === 'develop');
t.check('com o .gitignore do modelo', existsSync(join(novo, '.gitignore')) && /node_modules/.test(readFileSync(join(novo, '.gitignore'), 'utf8')));
await sleep(800);
t.check('aparece na lista de repositórios', !!(await t.until(`document.body.textContent.includes('novinho')`, 8000)));

// --- paleta -------------------------------------------------------------------------------------------------
await t.ev('location.reload()');
await t.until(`document.querySelector('.core')`, 15000);
await sleep(600);
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 5000);
await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = 'clonar'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => e.textContent.includes('Clonar um repositório'))?.click()`);
await t.until(`document.querySelector('[data-testid="create-clone"]')`, 5000);
t.check('a paleta abre o diálogo de clonar', await dialogOpen());
await t.key('Escape');
await sleep(300);
t.check('Esc fecha o diálogo', !(await dialogOpen()));

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
