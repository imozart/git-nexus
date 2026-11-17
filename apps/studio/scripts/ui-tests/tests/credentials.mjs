// Credenciais: um servidor HTTP de verdade exige usuário e senha; ao clicar em "Buscar" o app mostra o diálogo (usuário, depois senha), a busca
// funciona com a resposta certa, a senha errada e o cancelamento viram a mensagem de autenticação, e o lote ("Buscar todos") nunca abre diálogo.
// O git, a ponte e o script de senha são os de verdade (só o Electron é simulado).
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const USER = 'maria';
const PASS = 'segredo-123';
const root = tmpRoot('gn-cred-');
const bare = join(root, 'r.git');
git(root, 'init', '-q', '--bare', '-b', 'main', bare);
const origem = mkRepo(root, 'origem', { files: { 'a.txt': 'um\n' } });
git(origem, 'push', '-q', bare, 'main');

const server = http.createServer((req, res) => {
  const ok = req.headers.authorization === 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
  if (!ok) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="gitnexus"' });
    return void res.end('auth');
  }
  if (req.url?.startsWith('/r.git/info/refs')) {
    const out = execFileSync('git', ['upload-pack', '--stateless-rpc', '--advertise-refs', bare]);
    res.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement' });
    res.write('001e# service=git-upload-pack\n0000');
    return void res.end(out);
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/r.git`;

// o repositório do app aponta para o servidor protegido; `credential.helper` vazio: o helper do computador não pode responder no lugar do teste
const repo = mkRepo(root, 'protegido', { files: { 'a.txt': 'um\n' } });
git(repo, 'config', 'credential.helper', '');
git(repo, 'remote', 'add', 'origin', url);

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await sleep(500);

const row = `[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'protegido')`;
const clickRowBtn = (label) => t.ev(`${row}.querySelectorAll('.repo__btns button')` + `.forEach((b) => { if (b.textContent.trim() === ${lit(label)}) b.click(); })`);
const dlg = () => t.ev(`(() => { const d = document.querySelector('[data-testid="askpass"]'); return d ? { title: d.querySelector('h3').textContent.trim(), prompt: d.querySelector('[data-testid="askpass-prompt"]').textContent.trim(), type: d.querySelector('[data-testid="askpass-input"]')?.type ?? null } : null; })()`);
const typeAnswer = (v) => t.ev(`(() => { const i = document.querySelector('[data-testid="askpass-input"]'); i.value = ${lit(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const press = (testid) => t.ev(`document.querySelector('[data-testid="${testid}"]').click()`);
const message = () => t.ev(`document.body.textContent`);

// 1. clicar em "Buscar": diálogo do usuário, depois da senha (campo escondido), e a busca funciona
await clickRowBtn('Buscar');
await t.until(`document.querySelector('[data-testid="askpass"]')`, 20000);
const d1 = await dlg();
t.check('o diálogo do usuário aparece, com o servidor no título', d1 && /Usuário para 127\.0\.0\.1/.test(d1.title), d1);
t.check('mostra o texto exato que o git perguntou', /Username for/.test(d1?.prompt ?? ''), d1);
t.check('o usuário aparece em texto comum', d1?.type === 'text');
await t.shot('credencial-usuario');
await typeAnswer(USER);
await press('askpass-ok');
await t.until(`/Senha ou token/.test(document.querySelector('[data-testid="askpass"] h3')?.textContent ?? '')`, 15000);
const d2 = await dlg();
t.check('em seguida pede a senha, com o campo escondido', d2 && /Senha ou token de 127\.0\.0\.1/.test(d2.title) && d2.type === 'password', d2);
t.check('o campo da senha começa em branco (não sobra o usuário)', (await t.ev(`document.querySelector('[data-testid="askpass-input"]').value`)) === '');
await typeAnswer(PASS);
await t.shot('credencial-senha');
await press('askpass-ok');
await t.until(`!document.querySelector('[data-testid="askpass"]')`, 15000);
await sleep(1500);
t.check('com a resposta certa a busca termina sem erro de autenticação', !/recusou o acesso/.test((await message()) ?? ''));
t.check('a senha não ficou escrita em lugar nenhum da página', !((await message()) ?? '').includes(PASS) && (await t.ev(`JSON.stringify(localStorage)`)).indexOf(PASS) < 0);

// 2. senha errada: a mensagem explica
await clickRowBtn('Buscar');
await t.until(`document.querySelector('[data-testid="askpass"]')`, 20000);
await typeAnswer(USER);
await press('askpass-ok');
await t.until(`/Senha ou token/.test(document.querySelector('[data-testid="askpass"] h3')?.textContent ?? '')`, 15000);
await typeAnswer('errada');
await press('askpass-ok');
await t.until(`/recusou o acesso/.test(document.body.textContent)`, 20000);
t.check('senha errada: a tela diz que o servidor recusou o acesso', /recusou o acesso/.test((await message()) ?? ''));

// 3. cancelar
await t.ev(`location.reload()`);
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await sleep(800);
await clickRowBtn('Buscar');
await t.until(`document.querySelector('[data-testid="askpass"]')`, 20000);
await press('askpass-cancel');
await t.until(`!document.querySelector('[data-testid="askpass"]')`, 10000);
await t.until(`/recusou o acesso/.test(document.body.textContent)`, 20000);
t.check('cancelar fecha o diálogo e mostra a mensagem de autenticação', /recusou o acesso/.test((await message()) ?? ''));

// 4. lote ("Buscar todos"): nunca abre diálogo
await t.ev(`location.reload()`);
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await sleep(800);
await t.ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Buscar todos').click()`);
await t.until(`document.querySelector('.report')`, 30000);
await sleep(500);
t.check('o lote não abre diálogo de credencial', (await t.count('[data-testid="askpass"]')) === 0);
t.check('e o relatório explica a falha de autenticação', /recusou o acesso/.test((await t.text('.report')) ?? ''), await t.text('.report'));

// 5. Esc cancela
await clickRowBtn('Buscar');
await t.until(`document.querySelector('[data-testid="askpass"]')`, 20000);
await t.key('Escape');
await t.until(`!document.querySelector('[data-testid="askpass"]')`, 10000);
t.check('Esc cancela o diálogo', (await t.count('[data-testid="askpass"]')) === 0);

server.close();
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
