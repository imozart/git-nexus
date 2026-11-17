// Assinatura de commits: a caixa "Assinar o commit" aparece no formulário, começa no que o git está configurado para fazer (commit.gpgsign),
// assina de verdade com uma chave SSH quando marcada, não assina quando desmarcada mesmo com commit.gpgsign ligado, e uma chave que não existe
// vira a mensagem de assinatura (não "commit rejeitado").
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const root = tmpRoot('gn-sign-');
const key = join(root, 'key');
let hasKeygen = true;
try {
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'teste', '-f', key]);
} catch {
  hasKeygen = false;
}
if (!hasKeygen) {
  t.check('sem ssh-keygen neste computador: teste de assinatura não se aplica', true);
  t.close();
}

const repo = mkRepo(root, 'signrepo', { files: { 'a.txt': 'um\n' } });
git(repo, 'config', 'core.fsmonitor', 'false');
git(repo, 'config', 'gpg.format', 'ssh');
git(repo, 'config', 'user.signingkey', key + '.pub');
git(repo, 'config', 'commit.gpgsign', 'false');
const head = () => git(repo, 'cat-file', 'commit', 'HEAD');

await t.ev(`window.gitNexus.addRepositoryPath(${JSON.stringify(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'signrepo')`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'signrepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="sign-toggle"]')`, 25000);
await sleep(800);

const setField = (sel, v) => t.ev(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const signChecked = () => t.ev(`document.querySelector('[data-testid="sign-toggle"]').checked`);
const setSign = (on) => t.ev(`(() => { const c = document.querySelector('[data-testid="sign-toggle"]'); if (c.checked !== ${on}) c.click(); return c.checked; })()`);
/** Faz stage de um arquivo novo e commita pelo formulário. */
async function commitViaForm(file, text, subject) {
  writeFileSync(join(repo, file), text);
  await t.ev(`window.gitNexus.stageFiles(${JSON.stringify(repo)}, [${JSON.stringify(file)}])`);
  await t.ev(`document.querySelector('.rv__btns button')?.click()`); // Recarregar
  await sleep(1200);
  await t.until(`!document.querySelector('[data-testid="commit-submit"]')?.disabled || true`, 2000);
  await setField('[data-focus="commit-subject"]', subject);
  await setField('input[placeholder*="ABC"]', 'ABC-1');
  await sleep(300);
  await t.until(`!document.querySelector('[data-testid="commit-submit"]').disabled`, 15000);
  await t.ev(`document.querySelector('[data-testid="commit-submit"]').click()`);
  await sleep(2500);
}

t.check('a caixa "Assinar o commit" existe', (await t.count('[data-testid="sign-toggle"]')) === 1);
t.check('começa desmarcada (commit.gpgsign desligado)', (await signChecked()) === false);
t.check('a nota diz que há uma chave configurada', /há uma chave configurada/.test((await t.text('[data-testid="sign-note"]')) ?? ''), await t.text('[data-testid="sign-note"]'));

// 1. marcada: assina
await setSign(true);
await commitViaForm('b.txt', 'b\n', 'assinado pelo formulario');
t.check('com a caixa marcada o commit sai assinado (SSH)', /BEGIN SSH SIGNATURE/.test(head()), head().slice(0, 300));
t.check('o commit foi criado', /assinado pelo formulario/.test(git(repo, 'log', '-1', '--format=%s')));

// 2. commit.gpgsign ligado: começa marcada; desmarcar não assina
git(repo, 'config', 'commit.gpgsign', 'true');
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await sleep(800);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'signrepo').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="sign-toggle"]')`, 25000);
await sleep(800);
t.check('com commit.gpgsign ligado a caixa já vem marcada', (await signChecked()) === true);
t.check('e a nota explica que está ligado no git', /ligado no git/.test((await t.text('[data-testid="sign-note"]')) ?? ''), await t.text('[data-testid="sign-note"]'));
await setSign(false);
await commitViaForm('c.txt', 'c\n', 'sem assinar de proposito');
t.check('desmarcada, o commit NÃO é assinado (mesmo com commit.gpgsign ligado)', !/gpgsig/.test(head()), head().slice(0, 300));
t.check('o commit foi criado', /sem assinar de proposito/.test(git(repo, 'log', '-1', '--format=%s')));

// 3. chave que não existe: mensagem de assinatura
git(repo, 'config', 'user.signingkey', join(root, 'nao-existe.pub'));
await setSign(true);
const before = git(repo, 'rev-list', '--count', 'HEAD').trim();
await commitViaForm('d.txt', 'd\n', 'chave inexistente');
const out = (await t.text('.cf__out')) ?? '';
t.check('chave inexistente: a mensagem fala de assinatura', /assinar o commit/i.test(out), out.slice(-400));
t.check('e nenhum commit foi criado', git(repo, 'rev-list', '--count', 'HEAD').trim() === before);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection|asynchronous response/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
