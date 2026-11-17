// Emendar o último commit: a caixa carrega a mensagem do commit no formulário, troca só a mensagem quando não há stage, inclui o stage
// sem criar outro commit, devolve o rascunho ao desligar e, se o commit já foi enviado, exige a confirmação de que o histórico será reescrito.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const root = tmpRoot('gn-amend-');
const repo = mkRepo(root, 'amendrepo', { files: { 'a.txt': 'a\n' } });
// o formulário exige ticket por padrão: o commit original já traz o dele ("Refs:"), que a caixa carrega junto
git(repo, 'commit', '--amend', '-qm', 'feat(api): primeiro commit', '-m', 'Refs: ABC-1');

await t.ev(`window.gitNexus.addRepositoryPath(${JSON.stringify(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
// abre o repositório pelo botão Abrir da linha (esperando a linha existir: a máquina pode estar lenta)
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'amendrepo')`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'amendrepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
t.check('o repositório abriu', !!(await t.until(`document.querySelector('[data-testid="amend-toggle"]')`, 15000)));
await t.until(`!document.querySelector('.rv__btns button')?.disabled`, 15000);
await t.until(`document.querySelector('[data-focus="commit-subject"]')`, 15000);
await sleep(800);

const subject = () => t.ev(`document.querySelector('[data-focus="commit-subject"]').value`);
const setSubject = (v) => t.ev(`(() => { const i = document.querySelector('[data-focus="commit-subject"]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const submit = () => t.ev(`document.querySelector('[data-testid="commit-submit"]')`).then(() => t.ev(`(() => { const b = document.querySelector('[data-testid="commit-submit"]'); return { text: b.textContent.trim(), disabled: b.disabled }; })()`));
const toggle = async () => {
  await t.ev(`document.querySelector('[data-testid="amend-toggle"]').click()`);
  await sleep(700);
};
const count = () => Number(git(repo, 'rev-list', '--count', 'HEAD').trim());
const subjectOfHead = () => git(repo, 'log', '-1', '--format=%s').trim();

// --- estado inicial: sem stage, o commit normal fica desligado ----------------------------------------------------------------
await setSubject('rascunho meu');
let b = await submit();
t.check('sem stage o botão de commit normal está desligado', b.disabled === true && /Commit/.test(b.text), b);
t.check('a caixa "Emendar o último commit" existe, desmarcada', (await t.ev(`document.querySelector('[data-testid="amend-toggle"]').checked`)) === false);

// --- ligar: carrega a mensagem do último commit -----------------------------------------------------------------------------------
await toggle();
t.check('ligar carrega o título do último commit no formulário', (await subject()) === 'primeiro commit', await subject());
t.check('ligar carrega o ticket do rodapé (Refs)', (await t.ev(`[...document.querySelectorAll('.cf input')].some((i) => i.value === 'ABC-1')`)) === true);
t.check('ligar carrega o tipo (feat)', (await t.ev(`document.querySelector('.chip--on')?.textContent.trim()`)) === 'feat');
b = await submit();
t.check('o botão vira "Emendar commit" e fica habilitado mesmo sem stage (só troca a mensagem)', /Emendar commit/.test(b.text) && b.disabled === false, b);
t.check('avisa que nada está no stage e só a mensagem muda', /só a mensagem/i.test((await t.text('.cf')) ?? ''));
t.check('sem upstream não há aviso de histórico reescrito', (await t.count('[data-testid="amend-pushed"]')) === 0);

// --- desligar devolve o rascunho --------------------------------------------------------------------------------------------------
await toggle();
t.check('desligar devolve o rascunho que estava no formulário', (await subject()) === 'rascunho meu', await subject());

// --- só a mensagem --------------------------------------------------------------------------------------------------------------------
await toggle();
await setSubject('primeiro commit (corrigido)');
const before = count();
const treeBefore = git(repo, 'rev-parse', 'HEAD^{tree}').trim();
await t.ev(`document.querySelector('[data-testid="commit-submit"]').click()`);
await t.until(`/emendado/i.test(document.querySelector('.cf__out')?.textContent ?? '')`, 12000);
t.check('emendou: o commit tem a mensagem nova', subjectOfHead() === 'feat(api): primeiro commit (corrigido)', subjectOfHead());
t.check('continua o MESMO número de commits (não criou outro)', count() === before, [before, count()]);
t.check('a árvore não mudou (só a mensagem)', git(repo, 'rev-parse', 'HEAD^{tree}').trim() === treeBefore);
t.check('a caixa desmarca sozinha depois de emendar', (await t.ev(`document.querySelector('[data-testid="amend-toggle"]').checked`)) === false);

// --- incluindo o que está no stage ----------------------------------------------------------------------------------------------------
writeFileSync(join(repo, 'esquecido.txt'), 'esqueci\n');
git(repo, 'add', 'esquecido.txt');
await t.ev(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Recarregar')?.click()`);
await sleep(1500);
await toggle();
b = await submit();
t.check('com stage não aparece o aviso "só a mensagem"', !/só a mensagem/i.test((await t.text('.cf')) ?? ''));
const n2 = count();
await t.ev(`document.querySelector('[data-testid="commit-submit"]').click()`);
await t.until(`/emendado/i.test(document.querySelector('.cf__out')?.textContent ?? '')`, 12000);
t.check('o arquivo esquecido entrou no último commit', git(repo, 'show', '--stat', '--format=', 'HEAD').includes('esquecido.txt'));
t.check('sem criar outro commit', count() === n2, [n2, count()]);

// --- commit já enviado: pede confirmação ---------------------------------------------------------------------------------------------
const remote = join(root, 'remote.git');
git(root, 'init', '--bare', '-b', 'main', remote);
git(repo, 'remote', 'add', 'origin', remote);
git(repo, 'push', '-q', '-u', 'origin', 'main');
await t.ev(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Recarregar')?.click()`);
await sleep(1500);
await toggle();
await t.until(`document.querySelector('[data-testid="amend-pushed"]')`, 8000);
t.check('commit já enviado: aparece o aviso de histórico reescrito', (await t.count('[data-testid="amend-pushed"]')) === 1);
b = await submit();
t.check('o botão fica desligado até confirmar', b.disabled === true, b);
await t.shot('amend-ja-enviado');
await t.ev(`document.querySelector('[data-testid="amend-confirm"]').click()`);
await sleep(300);
b = await submit();
t.check('confirmando, o botão liga', b.disabled === false, b);
await setSubject('primeiro commit (reescrito)');
await t.ev(`document.querySelector('[data-testid="commit-submit"]').click()`);
await t.until(`/emendado/i.test(document.querySelector('.cf__out')?.textContent ?? '')`, 12000);
const ab = git(repo, 'rev-list', '--left-right', '--count', 'origin/main...HEAD').trim().split(/\s+/).map(Number);
t.check('o histórico divergiu do remoto (1 atrás, 1 à frente): o envio exigirá forçar', ab[0] === 1 && ab[1] === 1, ab);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
