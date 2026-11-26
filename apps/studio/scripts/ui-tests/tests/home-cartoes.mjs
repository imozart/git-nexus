// Tela inicial com cartões ricos (#286): último commit, à frente/atrás, stash, conflito e "última busca" conferidos contra o Git, ordenação, filtros e as três
// densidades (confortável, compacto, tabela) por teclado e por mouse, o menu "mais" e o catálogo vazio com as três formas de começar.
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
const theme = process.env.GN_HOME_THEME ?? 'dark';
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', ${lit(theme)}); localStorage.removeItem('gitnexus.home')`);

// --- catálogo vazio: as três formas de começar (o catálogo do harness começa vazio) -------------------------------------------------------------------
await t.ev('location.reload()');
await t.until(`document.querySelector('[data-testid="home-start"]')`, 25000);
t.check('catálogo vazio: o guia mostra as três formas de começar, cada uma com o botão', (await t.ev(`['home-start-add', 'home-start-clone', 'home-start-scan'].every((id) => !!document.querySelector('[data-testid="' + id + '"]')) && document.querySelectorAll('.start__card').length === 3`)) === true);
t.check('catálogo vazio: não há lista nem cabeçalho de tabela', (await t.count('[data-testid="home-list"], [data-testid="home-thead"]')) === 0);
await t.shot('home-vazio');

// --- repositórios de verdade ----------------------------------------------------------------------------------------------------------------------------
const root = tmpRoot('gn-home-');
const commit = (repo, file, text, msg, author = 'Ana Dev', date) => {
  writeFileSync(join(repo, file), text);
  git(repo, 'add', '.');
  const env = date ? { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : process.env;
  execFileSync('git', ['-c', `user.name=${author}`, '-c', 'user.email=a@e.com', 'commit', '-qm', msg], { cwd: repo, env });
};
const prep = (repo) => {
  git(repo, 'config', 'core.fsmonitor', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
};
/** Repositório com remoto (bare) e um segundo clone, que representa outra pessoa. */
const withRemote = (name) => {
  const bare = join(root, `${name}.git`);
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  const repo = mkRepo(root, name, { files: { 'a.txt': 'um\n' } });
  prep(repo);
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'push', '-qu', 'origin', 'main');
  const other = join(root, `${name}-b`);
  git(root, 'clone', '-q', bare, other);
  for (const [k, v] of [['user.name', 'Bia Remota'], ['user.email', 'b@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(other, 'config', k, v);
  return { repo, other };
};

const atras = withRemote('hc-atras');
commit(atras.other, 'b.txt', 'b\n', 'feat: primeira da outra pessoa', 'Bia Remota');
commit(atras.other, 'c.txt', 'c\n', 'fix: segunda da outra pessoa', 'Bia Remota');
git(atras.other, 'push', '-q');
git(atras.repo, 'fetch', '-q'); // a busca grava o FETCH_HEAD: é dele que vem o "última busca"

const adiante = withRemote('hc-adiante');
commit(adiante.repo, 'l.txt', 'l\n', 'feat: ainda não enviada');
writeFileSync(join(adiante.repo, 'a.txt'), 'um\ndois\n'); // alteração pendente

const limpo = withRemote('hc-limpo');
writeFileSync(join(limpo.repo, 'a.txt'), 'guardado\n');
git(limpo.repo, 'stash', 'push', '-q', '-m', 'guardado');
writeFileSync(join(limpo.repo, 'a.txt'), 'guardado 2\n');
git(limpo.repo, 'stash', 'push', '-q', '-m', 'guardado 2');

const solto = mkRepo(root, 'hc-solto', { files: { 'a.txt': 'um\n' } });
prep(solto);
commit(solto, 's.txt', 's\n', 'chore: só local', 'Caio Solo', new Date(Date.now() - 3 * 86_400_000).toISOString()); // o commit mais antigo de todos: três dias atrás

const conflito = mkRepo(root, 'hc-conflito', { files: { 'a.txt': 'base\n' } });
prep(conflito);
git(conflito, 'checkout', '-qb', 'outra');
commit(conflito, 'a.txt', 'da outra\n', 'feat: lado da outra');
git(conflito, 'checkout', '-q', 'main');
commit(conflito, 'a.txt', 'da main\n', 'feat: lado da main');
try {
  git(conflito, 'merge', 'outra');
} catch {
  /* conflito: é o que se quer */
}

const removivel = mkRepo(root, 'hc-removivel', { files: { 'a.txt': 'um\n' } });
prep(removivel);

const NAMES = ['hc-adiante', 'hc-atras', 'hc-conflito', 'hc-limpo', 'hc-removivel', 'hc-solto'];
for (const r of [atras.repo, adiante.repo, limpo.repo, solto, conflito, removivel]) await t.ev(`window.gitNexus.addRepositoryPath(${lit(r)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 6`, 25000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 40000);
await sleep(300);

const row = (name) => `[...document.querySelectorAll('li.repo')].find((r) => r.querySelector('strong')?.textContent.trim() === ${lit(name)})`;
const order = () => t.ev(`[...document.querySelectorAll('li.repo strong')].map((s) => s.textContent.trim()).join(',')`);
const cell = (name, sel) => t.ev(`${row(name)}.querySelector(${lit(sel)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const gitOut = (repo, ...a) => git(repo, ...a).trim();
const chips = (name) => t.ev(`[...${row(name)}.querySelectorAll('.sync .gn-badge')].map((b) => b.textContent.trim()).join(' ')`);

// --- cartão rico: tudo conferido contra o Git ------------------------------------------------------------------------------------------------------------
for (const [name, repo] of [['hc-atras', atras.repo], ['hc-adiante', adiante.repo], ['hc-limpo', limpo.repo], ['hc-solto', solto], ['hc-conflito', conflito]]) {
  const subject = gitOut(repo, 'log', '-1', '--format=%s');
  const author = gitOut(repo, 'log', '-1', '--format=%an');
  const text = await cell(name, '[data-testid="home-commit"]');
  t.check(`${name}: o último commit (assunto e autor) é o do git log`, !!text && text.includes(subject) && text.includes(author) && /(agora há pouco|há \d+)/.test(text), [text, subject, author]);
}
const lr = (repo) => gitOut(repo, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD').split(/\s+/).map(Number); // [atrás, à frente]
const [atrasBehind, atrasAhead] = lr(atras.repo);
const [adBehind, adAhead] = lr(adiante.repo);
t.check('atrás: as setas batem com o git (↓ atrás, sem ↑)', atrasBehind === 2 && atrasAhead === 0 && (await chips('hc-atras')) === `↓${atrasBehind}`, [atrasBehind, atrasAhead, await chips('hc-atras')]);
t.check('à frente: ↑ bate com o git e a alteração pendente aparece', adAhead === 1 && adBehind === 0 && (await chips('hc-adiante')) === `↑${adAhead}` && /1 alteração/.test(await cell('hc-adiante', '.repo__state')), [await chips('hc-adiante'), await cell('hc-adiante', '.repo__state')]);
t.check('em dia com stash: "em dia" e quantos stashes há (2)', /em dia/.test(await cell('hc-limpo', '.repo__state')) && (await cell('hc-limpo', '[data-testid="home-stash"]')) === '2 stash', await cell('hc-limpo', '.repo__state'));
t.check('sem upstream: a etiqueta "sem upstream" e nenhuma seta', /sem upstream/.test(await cell('hc-solto', '.repo__state')) && (await chips('hc-solto')) === '');
t.check('conflito: o selo de conflito aparece', /⚠ 1 conflito/.test(await cell('hc-conflito', '.repo__state')), await cell('hc-conflito', '.repo__state'));
t.check('sem stash não mostra o selo', (await t.ev(`!${row('hc-atras')}.querySelector('[data-testid="home-stash"]')`)) === true);
t.check('o caminho inteiro está no cartão (copiável) e a linha do pé diz a última busca', /^[A-Za-z]:.*gn-home-.*hc-atras$/.test(await cell('hc-atras', '.repo__path')) && /Última busca no remoto: (agora há pouco|há \d+)/.test(await cell('hc-atras', '.repo__time')), [await cell('hc-atras', '.repo__path'), await cell('hc-atras', '.repo__time')]);
t.check('quem nunca buscou diz isso, em vez de inventar uma hora', /Ainda não buscou/.test(await cell('hc-adiante', '.repo__time')) && !/Última busca|Ainda não buscou/.test(await cell('hc-solto', '.repo__time')), [await cell('hc-adiante', '.repo__time'), await cell('hc-solto', '.repo__time')]);
t.check('a lista é nomeada e o contador diz "Mostrando 6 de 6"', (await t.ev(`document.querySelector('[data-testid="home-list"]')?.getAttribute('aria-label')`)) === 'Repositórios' && (await t.text('[data-testid="home-count"]')) === 'Mostrando 6 de 6', await t.text('[data-testid="home-count"]'));
t.check('a coluna passa de 1100 px em tela larga', (await t.ev(`document.querySelector('.conn').getBoundingClientRect().width`)) > 1100);
await t.shot('home-confortavel');

// --- ordenar ------------------------------------------------------------------------------------------------------------------------------------------------
const pickSort = async (label) => {
  await t.ev(`document.querySelector('[data-testid="home-sort"] .cbx__btn').click()`);
  await t.until(`document.querySelector('.cbx__list')`, 3000);
  await t.ev(`[...document.querySelectorAll('.cbx__opt')].find((o) => o.textContent.trim() === ${lit(label)}).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await sleep(250);
};
t.check('padrão: última abertura (ninguém foi aberto: empate pelo nome)', (await order()) === NAMES.join(','), await order());
await pickSort('Nome');
t.check('por nome: de A a Z', (await order()) === NAMES.join(','), await order());
await t.ev(`document.querySelector('[data-testid="home-dir"]').click()`);
await sleep(200);
t.check('o botão de direção inverte (Z a A) e diz a ordem por extenso', (await order()) === [...NAMES].reverse().join(',') && /decrescente/.test(await t.ev(`document.querySelector('[data-testid="home-dir"]').getAttribute('aria-label')`)), await order());
await pickSort('Mais atrasado');
t.check('mais atrasado: o repositório atrás do remoto vem primeiro', (await order()).startsWith('hc-atras,'), await order());
await pickSort('Mais alterações');
t.check('mais alterações: o que tem alteração pendente vem primeiro', (await order()).startsWith('hc-adiante,'), await order());
await pickSort('Última atividade');
t.check('última atividade: o repositório cujo último commit é de três dias atrás fica por último', (await order()).split(',').at(-1) === 'hc-solto' && /há 3 dias/.test(await cell('hc-solto', '[data-testid="home-commit"]')), await order());

// a escolha fica lembrada (recarregar não a perde)
await pickSort('Mais atrasado');
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 6`, 25000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await sleep(300);
t.check('ordem e filtros ficam lembrados depois de recarregar', (await order()).startsWith('hc-atras,') && /Mais atrasado/.test(await t.text('[data-testid="home-sort"] .cbx__btn')), [await order(), await t.text('[data-testid="home-sort"] .cbx__btn')]);

const errosAntes = t.errors().length; // as requisições em voo quando a página recarrega falham sozinhas: só valem os erros daqui para a frente
// --- filtrar ------------------------------------------------------------------------------------------------------------------------------------------------
const filter = async (f) => {
  await t.ev(`document.querySelector('[data-filter="${f}"]').click()`);
  await sleep(250);
};
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
const sorted = async () => (await order()).split(',').sort().join(',');
await filter('behind');
t.check('"Atrás do remoto" deixa só o repositório atrás e o contador acompanha', (await sorted()) === 'hc-atras' && (await t.text('[data-testid="home-count"]')) === 'Mostrando 1 de 6', [await order(), await t.text('[data-testid="home-count"]')]);
t.check('o filtro ligado tem aria-pressed=true e os outros false', (await t.ev(`[...document.querySelectorAll('[data-filter]')].map((b) => b.getAttribute('aria-pressed')).join()`)) === 'false,true,false,false');
await filter('behind');
await filter('no-upstream');
t.check('"Sem upstream" deixa só os três repositórios sem remoto', (await sorted()) === 'hc-conflito,hc-removivel,hc-solto', await order());
await filter('no-upstream');
await filter('conflict');
t.check('"Com conflito" deixa só o repositório em conflito', (await sorted()) === 'hc-conflito', await order());
await filter('conflict');
await filter('pending');
t.check('"Só com pendências" some com os que estão limpos e em dia', !(await order()).includes('hc-limpo') && (await order()).includes('hc-adiante') && (await order()).includes('hc-atras'), await order());
await filter('behind');
t.check('filtros valem juntos: pendências E atrás do remoto', (await sorted()) === 'hc-atras', await order());
await filter('behind');
await filter('pending');
await t.ev(`document.querySelector('.conn__search').focus()`);
await t.ev(`(() => { const i = document.querySelector('.conn__search'); i.value = 'zzz-nada'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(250);
t.check('busca sem resultado: mensagem própria, não o guia do catálogo vazio', /Nenhum repositório corresponde/.test(await t.text('.empty')) && (await t.count('[data-testid="home-start"]')) === 0);
await t.ev(`(() => { const i = document.querySelector('.conn__search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(250);

// --- teclado: chip de filtro e densidade -----------------------------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector('[data-filter="behind"]').focus()`);
await t.key(' ');
await sleep(250);
t.check('teclado: o chip de filtro liga com a barra de espaço', (await t.ev(`document.querySelector('[data-filter="behind"]').getAttribute('aria-pressed')`)) === 'true' && (await sorted()) === 'hc-atras');
await t.key(' ');
await sleep(250);
const dens = () => t.ev(`document.querySelector('[data-testid="home-density"] [aria-checked="true"]')?.textContent.trim()`);
t.check('a densidade é um grupo de opções nomeado, com "Confortável" marcada', (await dens()) === 'Confortável' && (await t.ev(`document.querySelector('[data-testid="home-density"]').getAttribute('role')`)) === 'radiogroup');
await t.ev(`document.querySelector('[data-testid="home-density"] [aria-checked="true"]').focus()`);
await t.key('ArrowRight');
await sleep(300);
t.check('seta para a direita: modo Compacto (uma linha por repositório, sem a linha do caminho)', (await dens()) === 'Compacto' && (await t.ev(`!!document.querySelector('.conn__list--compact') && getComputedStyle(document.querySelector('li.repo .repo__foot')).display === 'none'`)) === true);
const hCompact = await t.ev(`document.querySelector('li.repo').getBoundingClientRect().height`);
await t.ev('document.activeElement?.blur()'); // sem a dica da densidade na captura
await sleep(300);
await t.shot('home-compacto');
await t.ev(`document.querySelector('[data-testid="home-density"] [aria-checked="true"]').focus()`);
await t.key('ArrowRight');
await sleep(300);
const hTable = await t.ev(`document.querySelector('li.repo').getBoundingClientRect().height`);
t.check('modo Tabela: cabeçalho com as colunas e cada linha mais baixa que o cartão', (await dens()) === 'Tabela' && (await t.count('[data-testid="home-thead"] .th')) === 7 && hTable < 60, [await dens(), hTable]);
t.check('a tabela cabe na tela larga: sem rolagem lateral na página', (await t.ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`)) === true);
await t.ev(`document.querySelector('[data-testid="home-density"] [role=radio]').click()`);
await sleep(300);
const hComfortable = await t.ev(`document.querySelector('li.repo').getBoundingClientRect().height`);
t.check('o cartão confortável tem as três linhas (mais alto que o compacto)', hComfortable > hCompact + 20, [hComfortable, hCompact]);
await t.ev(`document.querySelector('[data-testid="home-density"] [role=radio]:last-child').click()`);
await sleep(300);
await t.ev('document.activeElement?.blur()');
await sleep(300);
await t.shot('home-tabela');
// ordenar pelo cabeçalho da tabela
await t.ev(`document.querySelector('[data-sort-col="name"]').click()`);
await sleep(250);
t.check('tabela: clicar em "Nome" ordena de A a Z e mostra a seta', (await order()) === NAMES.join(',') && /▲/.test(await t.text('[data-sort-col="name"]')), await order());
await t.ev(`document.querySelector('[data-sort-col="name"]').click()`);
await sleep(250);
t.check('tabela: clicar de novo inverte (Z a A, seta para baixo, aria-description descendente)', (await order()) === [...NAMES].reverse().join(',') && /▼/.test(await t.text('[data-sort-col="name"]')) && (await t.ev(`document.querySelector('[data-sort-col="name"]').getAttribute('aria-description')`)) === 'descending', await order());
t.check('o seletor de ordem acima acompanha o cabeçalho (mesma fonte)', /Nome/.test(await t.text('[data-testid="home-sort"] .cbx__btn')));
await t.ev(`document.querySelector('[data-testid="home-density"] [role=radio]').click()`);
await sleep(300);

// --- menu "mais" ----------------------------------------------------------------------------------------------------------------------------------------------
const more = (name) => `${row(name)}.querySelector('[data-testid="home-more"]')`;
await t.ev(`${more('hc-removivel')}.focus()`);
await t.key('Enter');
await t.until(`document.querySelector('.ctx')`, 3000);
t.check('"Mais ações" abre o menu com o foco no primeiro item (teclado)', (await t.ev(`document.activeElement?.textContent.trim()`)) === 'Mostrar a pasta', await t.ev(`document.activeElement?.textContent.trim()`));
await t.key('ArrowDown');
await t.key('ArrowDown');
t.check('as setas percorrem os itens do menu', (await t.ev(`document.activeElement?.textContent.trim()`)) === 'Copiar o caminho');
await t.key('ArrowDown');
t.check('a seta passa pela ação destrutiva e por último a volta ao começo (circular)', (await t.ev(`document.activeElement?.textContent.trim()`)) === 'Remover do catálogo');
await t.key('ArrowDown');
t.check('depois do último item volta ao primeiro', (await t.ev(`document.activeElement?.textContent.trim()`)) === 'Mostrar a pasta');
await t.key('Escape');
await sleep(250);
t.check('Esc fecha o menu e o foco volta ao botão "Mais ações" do cartão', (await t.count('.ctx')) === 0 && (await t.ev(`document.activeElement === ${more('hc-removivel')}`)) === true);
await t.ev(`${more('hc-removivel')}.click()`);
await t.until(`document.querySelector('.ctx')`, 3000);
t.check('o menu tem pasta, terminal, copiar caminho e, separada, a remoção em vermelho', (await t.ev(`[...document.querySelectorAll('.ctx__item')].map((b) => b.textContent.trim()).join('|')`)) === 'Mostrar a pasta|Abrir no terminal|Copiar o caminho|Remover do catálogo' && (await t.count('.ctx__sep')) === 1 && (await t.count('.ctx__item--danger')) === 1);
await t.shot('home-menu-mais');
// a captura traz a janela para a frente e o menu fecha ao perder o foco (como deve): reabre se for o caso
if (!(await t.count('.ctx'))) {
  await t.ev(`${more('hc-removivel')}.click()`);
  await t.until(`document.querySelector('.ctx')`, 3000);
}
await t.ev(`[...document.querySelectorAll('.ctx__item')].find((b) => /Copiar/.test(b.textContent)).click()`);
await t.until(`document.querySelector('.msg--info')`, 4000);
t.check('"Copiar o caminho" avisa que copiou', /Caminho copiado/.test(await t.text('.msg--info')), await t.text('.msg--info'));
await t.ev(`${more('hc-removivel')}.click()`);
await t.until(`document.querySelector('.ctx')`, 3000);
await t.ev(`document.querySelector('.ctx__item--danger').click()`);
await t.until(`!${row('hc-removivel')}`, 6000);
t.check('"Remover do catálogo" tira só do catálogo (a pasta continua no disco)', (await t.count('li.repo')) === 5 && (await t.ev(`window.gitNexus.getKnownRepositories().then((l) => l.some((r) => /hc-removivel/.test(r.path)))`)) === false && existsSync(removivel));
t.check('a lista continua sem erro de página', t.errors().slice(errosAntes).filter((e) => !/favicon/.test(e)).length === 0, t.errors().slice(errosAntes));
t.close();
