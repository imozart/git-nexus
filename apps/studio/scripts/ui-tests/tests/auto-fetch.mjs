// Busca automática em segundo plano: com a preferência desligada nada é buscado; ligada pela caixa do painel do seletor, a busca roda sozinha
// (ao voltar o foco para a janela), o indicador ↓N aparece sem ninguém pedir e o tooltip mostra "Última busca". Git de verdade, com remoto local.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`); // começa DESLIGADA (lida na carga da página)

const root = tmpRoot('gn-af-');
const remote = join(root, 'remote.git');
git(root, 'init', '--bare', '-b', 'main', remote);
const repo = mkRepo(root, 'afrepo');
git(repo, 'remote', 'add', 'origin', remote);
git(repo, 'push', '-q', '-u', 'origin', 'main');

const other = join(root, 'other');
git(root, 'clone', '-q', remote, other);
for (const [k, v] of [['user.name', 'O'], ['user.email', 'o@e.com'], ['commit.gpgsign', 'false']]) git(other, 'config', k, v);
writeFileSync(join(other, 'novo.txt'), 'novo\n');
git(other, 'add', '.');
git(other, 'commit', '-qm', 'novidade no remoto');
git(other, 'push', '-q', 'origin', 'main');
const remoteMain = git(other, 'rev-parse', 'HEAD').trim();

await t.ev(`location.reload()`);
await t.until(`document.querySelector('.conn__bar')`, 15000);
await t.openRepo(repo, 'afrepo');
await t.until(`document.querySelector('.bp__btn .bp__name')?.textContent.trim() === 'main'`, 15000);
const tip = () => t.ev(`document.querySelector('.bp__btn').title`);

// --- desligada: o app não fala com o remoto --------------------------------------------------------------------------------------------
await t.until(`document.querySelector('.bp__btn').title.includes('Em dia')`, 10000);
await sleep(2500); // tempo de sobra para uma busca (indevida) acontecer
t.check('desligada: o clone não soube da novidade do remoto', git(repo, 'rev-parse', 'origin/main').trim() !== remoteMain);
t.check('desligada: o tooltip diz que nunca buscou', /Ainda não buscou no remoto/.test(await tip()), await tip());
t.check('desligada: sem indicador no botão', (await t.count('.bp__btn .sync')) === 0);

// --- a preferência aparece no painel e reflete o estado salvo --------------------------------------------------------------------------
await t.ev(`document.querySelector('.bp__btn').click()`);
await t.until(`document.querySelector('.bp__panel [data-testid="auto-fetch"]')`, 8000);
t.check('a caixa "Buscar automaticamente" está no painel, desmarcada', (await t.ev(`document.querySelector('[data-testid="auto-fetch"]').checked`)) === false);
t.check('o rótulo está em português', /Buscar automaticamente/.test((await t.ev(`document.querySelector('[data-testid="auto-fetch"]').closest('label').textContent`)) ?? ''));

// --- liga: a preferência é lembrada e o próximo foco da janela busca sozinho ----------------------------------------------------
await t.ev(`document.querySelector('[data-testid="auto-fetch"]').click()`);
await sleep(200);
t.check('ligar grava a preferência', (await t.ev(`localStorage.getItem('gitnexus.autoFetch')`)) === '1');
await t.key('Escape');
await sleep(200);
await t.ev(`window.dispatchEvent(new Event('focus'))`);
await t.until(`document.querySelector('.bp__btn .sync')?.dataset.sync === 'behind'`, 15000);
t.check('o indicador mostra ↓1 sem ninguém ter clicado em buscar', (await t.ev(`document.querySelector('.bp__btn .sync').textContent.trim()`)) === '↓1');
t.check('o git buscou de verdade: origin/main anda para o commit do remoto', git(repo, 'rev-parse', 'origin/main').trim() === remoteMain);
t.check('o tooltip mostra a última busca como "agora há pouco"', /Última busca no remoto: agora há pouco/.test(await tip()), await tip());
t.check('a busca não mexeu na branch local', git(repo, 'rev-parse', 'main').trim() !== remoteMain);

// --- intervalo mínimo: outro foco logo em seguida não busca de novo -----------------------------------------------------------------
writeFileSync(join(other, 'novo2.txt'), 'novo2\n');
git(other, 'add', '.');
git(other, 'commit', '-qm', 'segunda novidade');
git(other, 'push', '-q', 'origin', 'main');
const second = git(other, 'rev-parse', 'HEAD').trim();
await t.ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(2500);
t.check('dentro do intervalo mínimo (5 min) não busca de novo', git(repo, 'rev-parse', 'origin/main').trim() !== second);

// --- desliga de novo pela caixa ---------------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector('.bp__btn').click()`);
await t.until(`document.querySelector('[data-testid="auto-fetch"]')`, 8000);
t.check('ligada: a caixa aparece marcada', (await t.ev(`document.querySelector('[data-testid="auto-fetch"]').checked`)) === true);
await t.ev(`document.querySelector('[data-testid="auto-fetch"]').click()`);
await sleep(200);
t.check('desligar grava a preferência', (await t.ev(`localStorage.getItem('gitnexus.autoFetch')`)) === '0');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
