// Log do Git por origem (#289): aberto o repositório e deixado o app ocioso, "Minhas ações" fica vazio; cada comando tem a origem certa (status, busca, commit,
// fetch automático); filtros, busca, copiar comando e saída, exportar (com e sem máscara), ponto de erro novo, segredos que nunca entram, limite configurável.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
const theme = process.env.GN_LOG_THEME ?? 'dark';
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', ${lit(theme)}); for (const k of ['gitnexus.showGitLog', 'gitnexus.gitLogFilter', 'gitnexus.gitLogMax', 'gitnexus.gitLogMask']) localStorage.removeItem(k)`);

const root = tmpRoot('gn-logo-');
const repo = mkRepo(root, 'origem', { files: { 'a.txt': 'um\n' } });
git(repo, 'config', 'core.fsmonitor', 'false');
// um remoto de verdade para o fetch (e um segundo, com token na URL, que nunca responde)
const bare = join(root, 'origem.git');
git(root, 'init', '-q', '--bare', '-b', 'main', bare);
git(repo, 'remote', 'add', 'origin', bare);
git(repo, 'push', '-qu', 'origin', 'main');
writeFileSync(join(repo, 'a.txt'), 'um\ndois\n');

await t.openRepo(repo, 'origem');
await t.until(`document.querySelector('.log')`, 15000);
const tabRepo = await t.text('.rv__path');
const rows = () => t.ev(`[...document.querySelectorAll('.log__row')].map((r) => ({ cmd: r.querySelector('.log__cmd').textContent, origin: r.dataset.origin, fail: r.classList.contains('log__row--fail') }))`);
const filter = async (label) => {
  await t.ev(`[...document.querySelectorAll('[data-testid="log-filter"] [role="radio"]')].find((b) => b.textContent.trim().startsWith(${lit(label)}))?.click()`);
  await sleep(300);
};
const openLog = async () => {
  if (!(await t.count('.log__body'))) await t.ev(`document.querySelector('.log__toggle').click()`);
  await t.until(`document.querySelector('.log__body')`, 5000);
};

// --- ocioso: nada é "meu" ------------------------------------------------------------------------------------------------------------------------------------
await sleep(3000); // o app lê status, ramos, resumo... sozinho ao abrir
await openLog();
t.check('ocioso: "Minhas ações" continua vazio, com a mensagem própria (não o "nenhum comando" geral)', (await t.count('.log__row')) === 0 && /Nenhuma ação sua/.test((await t.text('[data-testid="log-empty"]')) ?? ''), [await t.text('[data-testid="log-empty"]'), await rows()]);
t.check('o rodapé mostra 0 ações e quantos comandos o app fez em segundo plano', /^0 aç(ão|ões)/.test((await t.text('[data-testid="log-count"]')) ?? '') && /\d+ em segundo plano/.test((await t.text('[data-testid="log-bg"]')) ?? ''), [await t.text('[data-testid="log-count"]'), await t.text('[data-testid="log-bg"]')]);
await filter('Tudo');
await t.until(`document.querySelectorAll('.log__row').length > 3`, 10000);
const idle = await rows();
t.check('em "Tudo" aparecem as consultas, todas de segundo plano', idle.length > 3 && idle.every((r) => r.origin === 'background'), idle.filter((r) => r.origin !== 'background'));
t.check('as consultas de segundo plano levam a marca "segundo plano"', (await t.count('.log__origin')) === idle.length);

// --- origem de cada comando -----------------------------------------------------------------------------------------------------------------------------------
const mark = async () => (await rows()).length;
const since = async (n) => (await rows()).slice(n);
/** Espera (até 8 s) um comando com este texto chegar ao log depois da linha `n`: o lote do worker e a sondagem levam um instante. */
const seen = (text, n) => t.until(`[...document.querySelectorAll('.log__row .log__cmd')].slice(${n}).some((e) => e.textContent.includes(${lit(text)}))`, 8000);
let n0 = await mark();
await t.ev(`window.gitNexus.getGitStatus(${lit(tabRepo)})`);
await seen('git status', n0);
const st = (await since(n0)).filter((r) => /git status/.test(r.cmd));
t.check('getGitStatus (o app mantendo a tela em dia) é segundo plano', st.length >= 1 && st.every((r) => r.origin === 'background'), st);

n0 = await mark();
await t.ev(`window.gitNexus.stageFiles(${lit(tabRepo)}, ['a.txt'])`);
await seen(' add ', n0);
const add = (await since(n0)).filter((r) => / add /.test(r.cmd));
t.check('stage (um clique) é da pessoa', add.length === 1 && add[0].origin === 'user', add);

n0 = await mark();
const commitResult = await t.ev(`window.gitNexus.executeCommit(${lit(tabRepo)}, { type: 'feat', ticketNumber: 'GN-1', subject: 'duas linhas' }).then((r) => 'ok ' + JSON.stringify(r), (e) => 'erro ' + String(e))`);
await seen('git commit', n0);
const cm = (await since(n0)).filter((r) => /git commit/.test(r.cmd));
t.check('commit é da pessoa', cm.length >= 1 && cm.every((r) => r.origin === 'user'), [commitResult, await since(n0)]);

n0 = await mark();
await t.ev(`window.gitNexus.fetchRepo(${lit(tabRepo)}, true)`);
await seen('git fetch', n0);
const bf = (await since(n0)).filter((r) => /git fetch/.test(r.cmd));
t.check('a busca automática (silenciosa) é de segundo plano, mas altera o repositório: aparece em "Minhas ações"', bf.length === 1 && bf[0].origin === 'background', bf);
await filter('Minhas ações');
t.check('"Minhas ações" tem o commit, o stage e o fetch automático (altera o repositório), e nenhuma consulta de segundo plano', (await t.ev(`(() => { const c = [...document.querySelectorAll('.log__row')].map((r) => r.querySelector('.log__cmd').textContent); return c.some((x) => / add /.test(x)) && c.some((x) => /git commit/.test(x)) && c.some((x) => /git fetch/.test(x)) && !c.some((x) => /git status/.test(x)); })()`)) === true, await rows());

await t.shot('log-origem-minhas');
n0 = await mark();
await t.ev(`window.gitNexus.fetchRepo(${lit(tabRepo)}, false)`);
await seen('git fetch', n0);
await filter('Tudo');
const uf = (await rows()).filter((r) => /git fetch/.test(r.cmd)).at(-1);
t.check('a busca pelo botão (não silenciosa) é da pessoa', uf?.origin === 'user', uf);
await t.shot('log-origem-tudo');

// busca no repositório (digitada) e o índice: segundo plano
n0 = await mark();
await t.ev(`window.gitNexus.startSearch(${lit(tabRepo)}, { pattern: 'dois' }, 'so1').catch(() => null)`);
await sleep(1500);
const grep = (await since(n0)).filter((r) => /git grep|ls-files/.test(r.cmd));
t.check('a busca digitada (git grep, ls-files do índice) é de segundo plano', grep.length >= 1 && grep.every((r) => r.origin === 'background'), [await since(n0)]);

// --- filtros, busca, erros --------------------------------------------------------------------------------------------------------------------------------------
await t.ev(`window.gitNexus.stageFiles(${lit(tabRepo)}, ['nao-existe.txt']).catch(() => null)`);
await t.until(`[...document.querySelectorAll('.log__cmd')].some(e => e.textContent.includes('nao-existe'))`, 8000);
await filter('Erros');
t.check('"Erros" mostra só o que falhou e importa (o stage do arquivo que não existe)', (await t.count('.log__row')) === 1 && /nao-existe/.test((await rows())[0].cmd), await rows());
t.check('o botão "Erros" mostra quantos há', /Erros\s*1/.test((await t.text('[data-testid="log-filter"]')) ?? ''), await t.text('[data-testid="log-filter"]'));
await filter('Só leitura');
t.check('"Só leitura" mostra só consultas', (await rows()).length > 3 && (await t.count('.log__row:not(.log__row--read)')) === 0);
await filter('Tudo');
await t.ev(`(() => { const i = document.querySelector('[data-testid="log-search"]'); i.value = 'nao-existe'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(300);
t.check('a busca por texto filtra por comando e vale junto com o filtro', (await t.count('.log__row')) === 1);
await t.ev(`(() => { const i = document.querySelector('[data-testid="log-search"]'); i.value = 'did not match'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(300);
t.check('a busca olha também a saída do comando', (await t.count('.log__row')) === 1);

// copiar comando e saída de uma linha
await t.ev(`document.querySelector('[data-testid="log-copy-cmd"]').click()`);
await sleep(300);
t.check('copiar o comando de uma linha', /add -- nao-existe/.test(await (await fetch(`${t.base}/clipboard`)).text()));
await t.ev(`document.querySelector('[data-testid="log-copy-out"]').click()`);
await sleep(300);
t.check('copiar a saída de uma linha', /pathspec|did not match/i.test(await (await fetch(`${t.base}/clipboard`)).text()));
await t.ev(`(() => { const i = document.querySelector('[data-testid="log-search"]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(300);

// --- ponto de erro novo no rodapé -----------------------------------------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector('.log__toggle').click()`);
await sleep(300);
t.check('recolhido e sem erro novo, não há ponto', (await t.count('[data-testid="log-dot"]')) === 0);
await t.ev(`window.gitNexus.stageFiles(${lit(tabRepo)}, ['outro-inexistente.txt']).catch(() => null)`);
await t.until(`document.querySelector('[data-testid="log-dot"]')`, 6000);
t.check('um erro novo acende o ponto vermelho no rodapé, com texto para leitor de tela', /1 erro novo/.test((await t.ev(`document.querySelector('[data-testid="log-dot"]').getAttribute('aria-label')`)) ?? ''));
await t.shot('log-origem-ponto');
await t.ev(`document.querySelector('.log__toggle').click()`);
await sleep(400);
await t.ev(`document.querySelector('.log__toggle').click()`);
await sleep(300);
t.check('abrir o log apaga o ponto (os erros foram vistos)', (await t.count('[data-testid="log-dot"]')) === 0);
await openLog();

// --- segredo: token na URL do remoto nunca entra no log ---------------------------------------------------------------------------------------------------
git(repo, 'remote', 'add', 'quebrado', 'https://usuario:SEGREDO-TOKEN-987@127.0.0.1:1/x.git');
await t.ev(`window.gitNexus.fetchRepo(${lit(tabRepo)}, false)`);
await sleep(1500);
await filter('Tudo');
const screen = await t.ev(`document.querySelector('.log').innerText`);
t.check('o fetch falhou de verdade (o remoto quebrado)', /fetch/.test(screen) && /127\.0\.0\.1|unable|fatal|could not/i.test(screen), screen.slice(-300));
t.check('o token da URL não aparece na tela do log', !screen.includes('SEGREDO-TOKEN-987'));

// um erro da pessoa cuja saída leva o caminho do repositório (o git diz onde ele fica): material para a máscara
await t.ev(`window.gitNexus.stageFiles(${lit(tabRepo)}, ['../fora.txt']).catch(() => null)`);
await sleep(800);

// --- exportar ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// a CSP do app não deixa o teste ler o blob por fetch: guarda o Blob na criação e o nome no clique do link de download
await t.ev(`window.__dl = []; window.__blob = null; const mk = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blob = b; return mk.call(URL, b); }; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { const n = this.download; window.__blob.text().then((tx) => window.__dl.push({ name: n, text: tx })); return; } return orig.call(this); };`);
await t.ev(`document.querySelector('[data-testid="log-export"]').click()`);
await t.until(`window.__dl.length === 1`, 5000);
const dl = await t.ev(`window.__dl[0]`);
t.check('exportar baixa um .txt com data no nome', /^gitnexus-log-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/.test(dl.name), dl.name);
t.check('o arquivo leva o cabeçalho, os comandos com origem e resultado, e a saída recuada', /^# Log do Git do GitNexus/.test(dl.text) && /usuário ok \d+ms\s+git commit/.test(dl.text) && /segundo plano ok/.test(dl.text) && /usuário exit \d+ .*nao-existe/.test(dl.text) && /\n {4}\S/.test(dl.text), dl.text.slice(0, 400));
t.check('o arquivo exportado não leva o token', !dl.text.includes('SEGREDO-TOKEN-987'));
t.check('sem máscara, o caminho do repositório aparece na saída do git', /gn-logo-/.test(dl.text), dl.text.slice(-500));
await t.ev(`document.querySelector('[data-testid="log-mask"]').click()`);
await t.ev(`document.querySelector('[data-testid="log-export"]').click()`);
await t.until(`window.__dl.length === 2`, 5000);
const masked = await t.ev(`window.__dl[1].text`);
t.check('com "Mascarar caminhos", a pasta do repositório e a pessoal somem do arquivo', !/iago/i.test(masked) && !/gn-logo-/.test(masked) && /<repo>/.test(masked), masked.slice(-500));
await t.ev(`document.querySelector('[data-testid="log-mask"]').click()`);
await t.shot('log-origem-erro');

// --- limite configurável (Configurações > Avançado) -------------------------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector('[data-testid="settings-open"]').click()`);
await t.until(`document.querySelector('[data-testid="settings-nav"]')`, 5000);
await t.ev(`document.querySelector('[data-section="advanced"]').click()`);
await t.until(`document.querySelector('[data-testid="settings-log-max"]')`, 5000);
t.check('o limite aparece em Configurações > Avançado, com 500 como padrão', /500/.test((await t.text('[data-setting="gitlog-max"] .cbx__btn')) ?? ''), await t.text('[data-setting="gitlog-max"] .cbx__btn'));
await t.ev(`document.querySelector('[data-setting="gitlog-max"] .cbx__btn').click()`);
await t.until(`document.querySelector('.cbx__list')`, 3000);
await t.ev(`[...document.querySelectorAll('.cbx__opt')].find((o) => o.textContent.trim() === '200').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
await sleep(300);
t.check('escolher 200 guarda o limite', (await t.ev(`localStorage.getItem('gitnexus.gitLogMax')`)) === '200');
await t.key('Escape');
await sleep(300);
await t.key('Escape');
await sleep(300);
// 260 consultas: o log não passa de 200 linhas e o contador de segundo plano passa
for (let i = 0; i < 26; i++) await t.ev(`Promise.all(Array.from({ length: 10 }, () => window.gitNexus.getGitStatus(${lit(tabRepo)})))`);
await sleep(800);
const total = (await rows()).length;
t.check('o log guarda no máximo 200 comandos (os mais antigos saem) e o contador de segundo plano segue contando', total <= 200 && total > 150 && Number(/(\d+)/.exec((await t.text('[data-testid="log-bg"]')) ?? '')?.[1]) > 260, [total, await t.text('[data-testid="log-bg"]'), await t.text('[data-testid="log-count"]'), await t.ev(`localStorage.getItem('gitnexus.gitLogMax')`), (await rows()).slice(0, 3), (await rows()).slice(-3)]);
t.check('sem erro de página', t.errors().filter((e) => !/favicon|Failed to fetch/.test(e)).length === 0, t.errors());
t.close();
