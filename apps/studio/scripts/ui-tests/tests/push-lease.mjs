// Envio forçado SEGURO depois de reescrever o histórico: o painel de sincronização oferece "Enviar com segurança" quando a branch divergiu,
// com confirmação que explica o que será substituído; o envio normal continua recusando; na branch principal a opção nem aparece. Git de verdade.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const root = tmpRoot('gn-pl-');
const remote = join(root, 'remote.git');
git(root, 'init', '--bare', '-b', 'main', remote);

// repositório 1: branch de feature publicada e depois reescrita (amend) => divergida
const feat = mkRepo(root, 'featrepo', { files: { 'a.txt': 'a\n' } });
git(feat, 'remote', 'add', 'origin', remote);
git(feat, 'push', '-q', '-u', 'origin', 'main');
git(feat, 'checkout', '-q', '-b', 'feat/x');
writeFileSync(join(feat, 'f.txt'), 'um\n');
git(feat, 'add', '.');
git(feat, 'commit', '-qm', 'feat: um');
git(feat, 'push', '-q', '-u', 'origin', 'feat/x');
git(feat, 'commit', '--amend', '-qm', 'feat: um (reescrito)');
const reescrito = git(feat, 'rev-parse', 'HEAD').trim();

// repositório 2: a principal reescrita (a opção não deve aparecer)
const remote2 = join(root, 'remote2.git');
git(root, 'init', '--bare', '-b', 'main', remote2);
const prin = mkRepo(root, 'mainrepo', { files: { 'a.txt': 'a\n' } });
git(prin, 'remote', 'add', 'origin', remote2);
git(prin, 'push', '-q', '-u', 'origin', 'main');
git(prin, 'commit', '--amend', '-qm', 'init reescrito');

for (const r of [feat, prin]) await t.ev(`window.gitNexus.addRepositoryPath(${lit(r)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 2`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);

const openRow = async (name) => {
  await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === '${name}')`, 20000);
  await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === '${name}').querySelector('.repo__btns button').click()`);
  await t.until(`document.querySelector('[data-testid="sync-main"]')`, 20000);
  await sleep(800);
};
const remoteHead = () => git(remote, 'rev-parse', 'refs/heads/feat/x').trim();

await openRow('featrepo');
t.check('a branch divergida mostra "Sincronizar ↑1 ↓1"', /↑1 ↓1/.test((await t.text('[data-testid="sync-main"]')) ?? ''), await t.text('[data-testid="sync-main"]'));
await t.ev(`document.querySelector('[data-testid="sync-details"]').click()`);
await t.until(`document.querySelector('[data-testid="sync-push-lease"]')`, 8000);
t.check('o painel oferece "Enviar com segurança"', /Enviar com segurança/.test((await t.text('[data-testid="sync-push-lease"]')) ?? ''));
t.check('o remoto ainda tem o commit antigo', remoteHead() !== reescrito);
await t.shot('envio-seguro');

await t.ev(`document.querySelector('[data-testid="sync-push-lease"]').click()`);
await t.until(`document.querySelector('.dlg__box')`, 5000);
const dlg = (await t.text('.dlg__box')) ?? '';
t.check('a confirmação explica o que será substituído', /1 commit que só existe no remoto/.test(dlg) && /feat\/x/.test(dlg) && /rebase ou de um amend/.test(dlg), dlg);
t.check('a confirmação diz que não é um envio forçado comum', /não é um envio forçado comum/.test(dlg));

// cancelar não faz nada
await t.ev(`[...document.querySelectorAll('.dlg__btns button')][0].click()`);
await sleep(500);
t.check('cancelar não envia nada', remoteHead() !== reescrito);

await t.ev(`document.querySelector('[data-testid="sync-details"]').click()`);
await t.until(`document.querySelector('[data-testid="sync-push-lease"]')`, 8000);
await t.ev(`document.querySelector('[data-testid="sync-push-lease"]').click()`);
await t.until(`document.querySelector('.dlg__box')`, 5000);
await t.ev(`[...document.querySelectorAll('.dlg__btns button')].pop().click()`);
for (let i = 0; i < 60 && remoteHead() !== reescrito; i++) await sleep(250); // o envio roda no git: espera chegar
await t.until(`document.querySelector('[data-testid="sync-button"]')?.dataset.busy === 'false' && !/↑1 ↓1/.test(document.querySelector('[data-testid="sync-main"]')?.textContent ?? '')`, 20000);
t.check('confirmando, o remoto passa a ter o histórico reescrito', remoteHead() === reescrito, [remoteHead(), reescrito]);
t.check('a branch volta a ficar em dia (sem ↑↓)', !/↑|↓/.test((await t.text('[data-testid="sync-main"]')) ?? ''), await t.text('[data-testid="sync-main"]'));

// --- a principal: a opção não aparece -------------------------------------------------------------------------------------------------
await t.ev(`[...document.querySelectorAll('.gn-tab')].find((e) => /Repositórios/.test(e.textContent))?.click()`);
await sleep(600);
await openRow('mainrepo');
// há um botão por aba aberta (as ocultas ficam no DOM): vale o da aba visível
const visibleMain = () => t.ev(`[...document.querySelectorAll('[data-testid="sync-main"]')].find((b) => b.offsetParent !== null)?.textContent.trim() ?? ''`);
await t.until(`[...document.querySelectorAll('[data-testid="sync-main"]')].some((b) => b.offsetParent !== null && /↑1 ↓1/.test(b.textContent))`, 20000);
t.check('a principal também está divergida', /↑1 ↓1/.test(await visibleMain()), await visibleMain());
await t.ev(`[...document.querySelectorAll('[data-testid="sync-details"]')].find((b) => b.offsetParent !== null).click()`);
await t.until(`document.querySelector('[data-testid="sync-update-merge"]')`, 8000);
t.check('na branch principal o "Enviar com segurança" NÃO é oferecido', (await t.count('[data-testid="sync-push-lease"]')) === 0);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
