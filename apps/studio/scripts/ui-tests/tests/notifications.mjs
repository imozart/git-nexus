// Notificações do sistema: com o app em segundo plano, a busca automática que traz commits novos para a branch atual avisa (uma vez, com o nome do
// repositório e a quantidade); com a opção desligada não avisa; os comandos da paleta ligam/desligam e enviam um teste. A notificação em si é do
// processo principal do Electron (simulado aqui): o teste confere O QUE a interface pediu e QUANDO.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '1')`);
await t.ev(`localStorage.removeItem('gitnexus.notifications')`);

// um remoto, dois clones: A (o que o app abre) e B (quem publica commits novos)
const root = tmpRoot('gn-notif-');
const bare = join(root, 'remoto.git');
git(root, 'init', '-q', '--bare', '-b', 'main', bare);
const cfg = (d) => {
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(d, 'config', k, v);
};
const seed = join(root, 'seed');
git(root, 'init', '-q', '-b', 'main', seed);
cfg(seed);
writeFileSync(join(seed, 'a.txt'), 'um\n');
git(seed, 'add', '.');
git(seed, 'commit', '-qm', 'feat: base');
git(seed, 'remote', 'add', 'origin', bare);
git(seed, 'push', '-q', '-u', 'origin', 'main');
const clones = {};
for (const nome of ['alfa', 'beta']) {
  clones[nome] = join(root, nome);
  git(root, 'clone', '-q', bare, clones[nome]);
  cfg(clones[nome]);
}
// o "colega" publica 3 commits depois que os dois clones foram feitos
const outro = join(root, 'colega');
git(root, 'clone', '-q', bare, outro);
cfg(outro);
for (const n of [1, 2, 3]) {
  writeFileSync(join(outro, `n${n}.txt`), `${n}\n`);
  git(outro, 'add', '.');
  git(outro, 'commit', '-qm', `feat: novo ${n}`);
}
git(outro, 'push', '-q', 'origin', 'main');

await t.ev(`window.gitNexus.addRepositoryPath(${lit(clones.alfa)})`);
await t.ev(`window.gitNexus.addRepositoryPath(${lit(clones.beta)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 2`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);

// registra o que a interface pede ao sistema e finge que a janela está em segundo plano
await t.ev(`(() => { window.__notif = []; const o = window.gitNexus.notify; window.gitNexus.notify = (n) => { window.__notif.push(n); return o(n); }; document.hasFocus = () => false; return true; })()`);
const notifs = () => t.ev('window.__notif');
const openRepo = async (name) => {
  await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)})`, 20000);
  await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)}).querySelector('.repo__btns button').click()`);
  await t.until(`document.querySelector('.rv__btns')`, 20000);
};

// 1. janela em segundo plano + opção ligada: a busca do alfa traz 3 commits e avisa
await openRepo('alfa');
await t.until(`window.__notif.length > 0`, 25000);
const n1 = await notifs();
t.check('avisa uma vez', n1.length === 1, n1);
t.check('o título tem o nome do repositório', /alfa/.test(n1[0]?.title ?? ''), n1[0]);
t.check('o texto diz 3 commits novos na branch main', /3 commits novos em main/.test(n1[0]?.body ?? ''), n1[0]);
await sleep(1500);
t.check('não repete o aviso (a próxima busca nem roda dentro do intervalo)', (await notifs()).length === 1);

// 2. opção desligada: o beta também recebe 3 commits, e nada é avisado
await t.ev(`localStorage.setItem('gitnexus.notifications', '0')`);
await t.ev(`(() => { window.__notif = []; return true; })()`);
await t.ev('location.reload()');
await t.until(`document.querySelector('.core')`, 15000);
await sleep(800);
await t.ev(`(() => { window.__notif = []; const o = window.gitNexus.notify; window.gitNexus.notify = (n) => { window.__notif.push(n); return o(n); }; document.hasFocus = () => false; return true; })()`);
await openRepo('beta');
await t.until(`document.querySelector('[data-testid="sync-indicator"], .sync, .rv__id')`, 15000);
// espera a busca automática terminar (o indicador de atrás aparece)
await t.until(`/3/.test(document.querySelector('.rv__id')?.textContent ?? '')`, 25000);
await sleep(1500);
t.check('com as notificações desligadas nada é pedido ao sistema', (await notifs()).length === 0, await notifs());

// 3. paleta: ligar de novo e enviar um teste
const runCommand = async (query, titlePart) => {
  await t.key('k', 2);
  await t.until(`document.querySelector('.cp__input')`, 5000);
  await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = ${lit(query)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(300);
  const titles = await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].map((e) => e.textContent.trim())`);
  await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => e.textContent.includes(${lit(titlePart)}))?.click()`);
  await sleep(500);
  return titles;
};
const t1 = await runCommand('notificacoes', 'Ligar as notificações do sistema');
t.check('com a opção desligada a paleta oferece "Ligar"', t1.some((x) => x.includes('Ligar as notificações do sistema')), t1);
t.check('ligar grava a preferência e avisa', (await t.ev(`localStorage.getItem('gitnexus.notifications')`)) === '1' && /ligadas/.test((await t.text('.upd')) ?? ''), await t.text('.upd'));
const t2 = await runCommand('notificacoes', 'Desligar as notificações do sistema');
t.check('agora a paleta oferece "Desligar"', t2.some((x) => x.includes('Desligar as notificações do sistema')), t2);
await t.ev(`localStorage.setItem('gitnexus.notifications', '0')`);
await t.ev('location.reload()');
await t.until(`document.querySelector('.core')`, 15000);
await sleep(800);
await t.ev(`(() => { window.__notif = []; const o = window.gitNexus.notify; window.gitNexus.notify = (n) => { window.__notif.push(n); return o(n); }; return true; })()`);
await runCommand('notificacao teste', 'Enviar uma notificação de teste');
t.check('o teste é enviado mesmo com a opção desligada e com a janela em foco', (await notifs()).length === 1 && /Teste/.test((await notifs())[0]?.body ?? ''), await notifs());
t.check('e a tela confirma', /Notificação de teste enviada/.test((await t.text('.upd')) ?? ''), await t.text('.upd'));

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
await t.ev(`localStorage.removeItem('gitnexus.notifications')`);
t.close();
