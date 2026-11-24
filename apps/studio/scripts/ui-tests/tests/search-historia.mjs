// Buscar na história (fase 9 da #233), com git de verdade: a pesquisa do repositório entrega texto, opções e máscara ao histórico; o selo entrou/saiu/mudou de cada
// commit confere com `git log -S/-G` direto; o diff do arquivo tem o trecho marcado; o resumo "primeira vez que entrou / última vez que saiu"; modos, escopo (todos,
// intervalo A..B), autor, arquivo e seguir renomeação; "carregar mais" em páginas de 200; erro de expressão; arquivo nesta versão; e, do editor, "Quando isto entrou ou
// saiu?" e "Histórico destas linhas" (botões, menu de contexto e paleta). Tudo é conferido contra o Git.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
for (const k of ['searchWindow', 'searchHistory']) await t.ev(`localStorage.removeItem('gitnexus.${k}')`);

const root = tmpRoot('gn-hs-');
const author = (name) => ({ GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name.toLowerCase()}@e.com` });
const REPO = mkRepo(root, 'hs-main', { files: { 'README.md': 'x\n' } });
git(REPO, 'config', 'core.fsmonitor', 'false'); // sem o daemon do Git segurando a pasta temporária
const commit = (name, msg, files, date) => {
  for (const [f, c] of Object.entries(files)) {
    if (c === null) git(REPO, 'rm', '-q', '-f', f);
    else {
      mkdirSync(join(REPO, f, '..'), { recursive: true });
      writeFileSync(join(REPO, f), c);
      git(REPO, 'add', f);
    }
  }
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd: REPO, env: { ...process.env, ...author(name), GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
};
commit('Ana', 'c1: cria app', { 'src/app.ts': 'const alvo = 1;\nconst outra = 2;\n' }, '2026-01-01T10:00:00');
commit('Beto', 'c2: outro arquivo', { 'notes.txt': 'sem nada\n' }, '2026-01-02T10:00:00');
git(REPO, 'tag', 'v1');
git(REPO, 'checkout', '-q', '-b', 'feat');
commit('Beto', 'f1: alvo no feat', { 'feat.txt': 'alvo\n' }, '2026-01-02T12:00:00');
git(REPO, 'checkout', '-q', 'main');
commit('Ana', 'c3: usa o alvo', { 'src/app.ts': 'const alvo = 1;\nconst outra = 2;\nuse(alvo);\nuse(alvo);\n' }, '2026-01-03T10:00:00');
commit('Beto', 'c4: tira o alvo', { 'src/app.ts': 'const outra = 2;\n' }, '2026-01-04T10:00:00');
git(REPO, 'mv', 'src/app.ts', 'src/main.ts');
execFileSync('git', ['commit', '-q', '-m', 'c5: renomeia'], { cwd: REPO, env: { ...process.env, ...author('Ana'), GIT_COMMITTER_DATE: '2026-01-05T10:00:00', GIT_AUTHOR_DATE: '2026-01-05T10:00:00' } });
commit('Beto', 'c6: volta o alvo', { 'src/main.ts': 'const outra = 2;\nalvo de novo\n' }, '2026-01-06T10:00:00');
commit('Ana', 'c7: alvo vira alvos', { 'src/main.ts': 'const outra = 2;\nalvos de novo\n' }, '2026-01-07T10:00:00');

// mais de 200 commits que mexem no texto: a segunda página ("carregar mais")
const PAGES = mkRepo(root, 'hs-pages', { files: { 'README.md': 'x\n' } });
git(PAGES, 'config', 'core.fsmonitor', 'false');
{
  const N = 450;
  let s = '';
  for (let i = 1; i <= N; i++) {
    const msg = `p${i}: mais um alvo`;
    const body = Array.from({ length: i }, (_, k) => `alvo ${k + 1}`).join('\n') + '\n';
    s += `commit refs/heads/main\nauthor P <p@e.com> ${1700000000 + i * 60} +0000\ncommitter P <p@e.com> ${1700000000 + i * 60} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}\nM 100644 inline lista.txt\ndata ${Buffer.byteLength(body)}\n${body}\n`;
  }
  execFileSync('git', ['fast-import', '--quiet', '--force'], { cwd: PAGES, input: s, encoding: 'utf8' });
  git(PAGES, 'reset', '-q', '--hard');
}

const direct = (...a) => git(REPO, 'log', '--format=%s', ...a).split('\n').filter(Boolean);
for (const p of [REPO, PAGES]) await t.ev(`window.gitNexus.addRepositoryPath(${lit(p)})`);
await t.ev('location.reload()');
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'hs-main')`, 25000);
const openRepoByName = async (name) => {
  await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)}).querySelector('.repo__btns button').click()`);
  await t.until(`document.querySelector('.rv__btns')`, 20000);
  await sleep(700);
};
await openRepoByName('hs-main');

/** Fecha as abas do repositório (Alt+W) e volta ao Início: as abas escondidas continuam montadas e repetiriam os mesmos `data-testid`. */
const closeTabs = async () => {
  for (let i = 0; i < 4; i++) {
    await t.key('w', 1);
    await sleep(250);
  }
  await sleep(400);
};

const W = '[data-testid="search-window"]';
const P = '[data-testid="hs-panel"]';
const wq = (id) => `${W} [data-testid="${id}"]`;
const pq = (id) => `${P} [data-testid="${id}"]`;
const shot = async (n) => {
  await t.ev(`(() => { if (!document.getElementById('gn-nopath')) { const s = document.createElement('style'); s.id = 'gn-nopath'; s.textContent = '.rv__path, .sr__path { visibility: hidden !important; }'; document.head.appendChild(s); } })()`);
  await t.shot(n);
};
const typeInto = async (sel, text) => {
  await t.ev(`(() => { const e = document.querySelector(${lit(sel)}); e.focus(); e.select(); })()`);
  await t.send('Input.insertText', { text });
  await sleep(150);
};
const setInput = async (sel, text) => {
  await t.ev(`(() => { const i = document.querySelector(${lit(sel)}); i.focus(); i.value = ${lit(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(120);
};
const clickP = (id) => t.ev(`document.querySelector(${lit(pq(id))}).click()`);
const clickW = (id) => t.ev(`document.querySelector(${lit(wq(id))}).click()`);
/** Escolhe uma opção de um ComboBox do painel pelo começo do rótulo. */
const pick = async (id, label) => {
  await t.ev(`document.querySelector(${lit(pq(id) + ' .cbx__btn')}).click()`);
  await t.until(`document.querySelector('.cbx__list')`, 3000);
  await t.ev(`[...document.querySelectorAll('.cbx__list .cbx__opt')].find((o) => o.textContent.trim().startsWith(${lit(label)})).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
  await sleep(200);
};
/** Espera a busca acabar: o botão Parar sai e o contador para de dizer "Buscando". */
const idle = async (ms = 30000) => {
  await sleep(250);
  return t.until(`!document.querySelector(${lit(pq('hs-stop'))}) && !/Buscando/.test(document.querySelector(${lit(pq('hs-count'))})?.textContent ?? '')`, ms);
};
const run = async () => {
  await clickP('hs-go');
  await idle();
};
const rows = () =>
  t.ev(`[...document.querySelectorAll('[data-testid="gv-row"]')].map((r) => ({ subject: r.querySelector('.row__subject').textContent.trim(), kind: r.querySelector('[data-testid="gv-kind"]')?.dataset.kind ?? null, badge: r.querySelector('[data-testid="gv-kind"]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, on: r.getAttribute('aria-pressed') === 'true' }))`);
const subjects = async () => (await rows()).map((r) => r.subject);
const countText = () => t.ev(`document.querySelector(${lit(pq('hs-count'))})?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`);
const clickRow = (sub) => t.ev(`[...document.querySelectorAll('[data-testid="gv-row"]')].find((r) => r.querySelector('.row__subject').textContent.includes(${lit(sub)})).click()`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- da pesquisa do repositório para o histórico -----------------------------------------------------------------------------------------------------------------
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 6000);
t.check('"Buscar na história" começa desligado (sem texto)', (await t.ev(`document.querySelector(${lit(wq('sw-history-search'))}).disabled`)) === true);
await typeInto(`${W} [data-testid="sf-input"]`, 'alvo');
await sleep(600);
t.check('com texto o botão liga', (await t.ev(`document.querySelector(${lit(wq('sw-history-search'))}).disabled`)) === false);
await clickW('sw-history-search');
await t.until(`document.querySelector(${lit(P)})`, 10000);
await idle();
t.check('a janela fecha e o histórico abre com o texto da pesquisa já no campo', (await t.count(W)) === 0 && (await t.ev(`document.querySelector(${lit(pq('sf-input'))}).value`)) === 'alvo');
const first = await rows();
const wantS = direct('-i', '-Salvo', 'HEAD');
t.check('os commits achados são os do `git log -S alvo` direto, na mesma ordem', same(first.map((r) => r.subject), wantS) && wantS.length === 4, { got: first.map((r) => r.subject), wantS });
t.check('cada um tem o selo: entrou, saiu, entrou, entrou (com os números)', same(first.map((r) => r.kind), ['added', 'removed', 'added', 'added']) && first[1].badge === 'saiu −3' && first[0].badge === 'entrou +1' && first[2].badge === 'entrou +2', first);
const c = await countText();
t.check('o contador diz quantos commits foram achados e examinados', /^4 commits achados · 7 de 7 commits examinados$/.test(c) || /4 commits achados/.test(c) && /commits examinados/.test(c), c);
t.check('"c7" (alvo vira alvos) não aparece: o -S só lista quando o número de ocorrências muda', !first.some((r) => r.subject.startsWith('c7')));
t.check('sem "Carregar mais" quando cabe numa página', (await t.count(pq('hs-more'))) === 0);
const sum = await t.text(pq('hs-summary'));
t.check('o resumo diz a primeira vez que entrou (c1) e a última que saiu (c4)', /Primeira vez que entrou:\s*\S+ — c1: cria app/.test(sum ?? '') && /Última vez que saiu:\s*\S+ — c4: tira o alvo/.test(sum ?? ''), sum);
await shot('historia-resultados');

// ---- o commit: selo, arquivos com contagem e diff com o trecho marcado ---------------------------------------------------------------------------------------------
await clickRow('c4: tira o alvo');
await t.until(`document.querySelector('[data-testid="gv-file"]')`, 8000);
t.check('o detalhe repete o selo do commit', /saiu −3/.test((await t.text('[data-testid="gv-hit"]')) ?? ''));
const fileRow = await t.ev(`(() => { const li = document.querySelector('[data-testid="gv-file"]'); return { path: li.querySelector('.gv__fpath').textContent.trim(), count: li.querySelector('[data-testid="gv-file-count"]')?.textContent.trim() ?? null, touched: li.classList.contains('touched') }; })()`);
t.check('o arquivo tocado vem com a contagem (−3) e em destaque', fileRow.path.startsWith('src/app.ts') && fileRow.count === '−3' && fileRow.touched, fileRow);
await t.ev(`document.querySelector('[data-testid="gv-file"]').click()`);
await t.until(`document.querySelectorAll('[data-testid="gv-diff"] mark').length >= 3`, 8000);
const marks = await t.ev(`[...document.querySelectorAll('[data-testid="gv-diff"] mark')].map((m) => m.textContent)`);
t.check('o diff do arquivo marca cada "alvo" (3, em minúsculas como no texto)', marks.length === 3 && marks.every((m) => m === 'alvo'), marks);
const markStyle = await t.ev(`(() => { const m = document.querySelector('[data-testid="gv-diff"] mark'); const c = getComputedStyle(m); return { deco: c.textDecorationLine, bg: c.backgroundColor }; })()`);
t.check('a marca não depende só da cor: tem sublinhado e fundo', /underline/.test(markStyle.deco) && markStyle.bg !== 'rgba(0, 0, 0, 0)', markStyle);
await shot('historia-diff');

// resumo: os atalhos selecionam o commit
await clickP('hs-first');
await sleep(400);
t.check('"primeira vez que entrou" seleciona o c1', /^c1: cria app/.test((await t.text('.gv__detail h3')) ?? ''), await t.text('.gv__detail h3'));
await clickP('hs-last');
await sleep(400);
t.check('"última vez que saiu" seleciona o c4', /^c4: tira o alvo/.test((await t.text('.gv__detail h3')) ?? ''));

// ---- arquivo nesta versão ------------------------------------------------------------------------------------------------------------------------------------------------
await clickRow('c3: usa o alvo');
await t.until(`document.querySelector('[data-testid="gv-file-at"]')`, 8000);
await t.ev(`document.querySelector('[data-testid="gv-file-at"]').click()`);
await t.until(`document.querySelector('[data-testid="gv-file-at-dialog"] .cm-content')`, 8000);
await sleep(400);
const atText = await t.ev(`document.querySelector('[data-testid="gv-file-at-dialog"] .cm-content').textContent`);
t.check('"Arquivo nesta versão" mostra o arquivo como estava no commit (com os dois use(alvo))', /use\(alvo\);use\(alvo\);/.test(atText.replace(/\s+/g, '')), atText);
await t.key('Escape');
await sleep(300);
t.check('Esc fecha o arquivo daquela versão', (await t.count('[data-testid="gv-file-at-dialog"]')) === 0);

// ---- modos ---------------------------------------------------------------------------------------------------------------------------------------------------------------
await pick('hs-mode', 'Linhas alteradas');
await run();
const lines = await rows();
t.check('"Linhas alteradas que casam" confere com `git log -G` (e traz o c7, em que a linha mudou)', same(lines.map((r) => r.subject), direct('-i', '-Galvo', 'HEAD')) && lines.some((r) => r.subject.startsWith('c7')), lines.map((r) => r.subject));
await pick('hs-mode', 'Mensagem do commit');
await setInput(pq('sf-input'), 'tira');
await run();
t.check('"Mensagem do commit" confere com `git log --grep` e o selo diz "mensagem"', same(await subjects(), direct('-i', '--grep=tira', 'HEAD')) && (await rows())[0]?.badge === 'mensagem', await rows());
await pick('hs-mode', 'Quando entrou');
await setInput(pq('sf-input'), 'alvo');

// palavra inteira: o c7 tira a palavra "alvo" (vira "alvos")
await clickP('sf-word');
await run();
const word = await rows();
t.check('palavra inteira (ab): o c7 aparece como "saiu" (alvo virou alvos), conferido no diff', word.some((r) => r.subject.startsWith('c7') && r.kind === 'removed'), word);
await clickP('sf-word');

// escopo
await pick('hs-scope', 'Todos os branches');
await run();
t.check('"Todos os branches" acha também o commit do feat (`git log -S --branches --tags --remotes HEAD`)', (await subjects()).includes('f1: alvo no feat') && same(await subjects(), direct('-i', '-Salvo', '--branches', '--tags', '--remotes', 'HEAD')), await subjects());
await pick('hs-scope', 'Intervalo');
await setInput(pq('hs-revision'), 'v1..main');
await run();
t.check('o intervalo v1..main confere com o Git e deixa o c1 de fora', same(await subjects(), direct('-i', '-Salvo', 'v1..main')) && !(await subjects()).some((s) => s.startsWith('c1')), await subjects());
await setInput(pq('hs-revision'), 'nao-existe..main');
await clickP('hs-go');
await t.until(`document.querySelector(${lit(pq('hs-error'))})`, 8000);
t.check('uma ponta que não existe: erro em texto (com o nome dela), sem commits', /nao-existe/.test((await t.text(pq('hs-error'))) ?? '') && (await t.count('[data-testid="gv-row"]')) === 0, await t.text(pq('hs-error')));
await pick('hs-scope', 'Branch atual');

// autor, arquivo e seguir renomeação
await setInput(pq('hs-author'), 'beto');
await run();
t.check('autor "beto" (sem diferenciar maiúsculas): só os commits dele, como o Git', same(await subjects(), direct('-i', '-Salvo', '--author=[bB][eE][tT][oO]', 'HEAD')) && (await subjects()).length === 2, await subjects());
await setInput(pq('hs-author'), '');
await setInput(pq('hs-include'), 'notes.txt');
await run();
t.check('arquivo sem nenhum "alvo": "Nenhum commit corresponde" e nenhuma linha', (await t.count('[data-testid="gv-nomatch"]')) === 1 && (await t.count('[data-testid="gv-row"]')) === 0);
await setInput(pq('hs-include'), 'src/main.ts');
await sleep(200);
t.check('com um arquivo só aparece "Seguir renomeações"; com máscara some', (await t.count(pq('hs-follow'))) === 1);
await clickP('hs-follow');
await run();
const follow = await subjects();
t.check('seguindo a renomeação o histórico atravessa o c5 e chega ao c1 (`git log --follow`)', same(follow, direct('-i', '-Salvo', '--follow', 'HEAD', '--', 'src/main.ts')) && follow.some((s) => s.startsWith('c1')), follow);
t.check('com --follow não há contagem de examinados (o Git não dá a ordem do escopo)', !/examinados/.test(await countText()), await countText());
await setInput(pq('hs-include'), '*.ts, !*.test.ts');
await sleep(200);
t.check('com máscara a opção some e sai marcada', (await t.count(pq('hs-follow'))) === 0);
await run();
t.check('máscara `*.ts, !*.test.ts`: confere com os pathspecs do Git', same(await subjects(), direct('-i', '-Salvo', 'HEAD', '--', ':(glob)**/*.ts', ':(exclude,glob)**/*.test.ts')), await subjects());
await setInput(pq('hs-include'), '');

// expressão inválida
await clickP('sf-regex');
await setInput(pq('sf-input'), '(');
await sleep(250);
t.check('regex inválida: o campo mostra o erro e o botão Buscar fica desligado', (await t.count(`${P} [role="alert"]`)) >= 1 && (await t.ev(`document.querySelector(${lit(pq('hs-go'))}).disabled`)) === true);
await clickP('sf-regex');
await setInput(pq('sf-input'), 'alvo');
await run();

// teclado: as linhas são botões
await t.ev(`document.querySelector('[data-testid="gv-row"]').focus()`);
await t.key('Enter');
await sleep(300);
t.check('a linha do resultado é um botão: Enter a seleciona', (await rows())[0]?.on === true && (await t.ev(`document.querySelector('[data-testid="gv-row"]').getAttribute('role')`)) === 'button');

// ---- páginas de 200 -----------------------------------------------------------------------------------------------------------------------------------------------------
await closeTabs();
await openRepoByName('hs-pages');
await t.ev(`[...document.querySelectorAll('.rv__btns button')].find((b) => /Grafo/.test(b.textContent) && b.offsetParent)?.click()`);
await t.until(`document.querySelector(${lit(P)})`, 15000);
await typeInto(`${P} [data-testid="sf-input"]`, 'alvo');
await pick('hs-mode', 'Linhas alteradas');
await run();
t.check('450 commits mexem no texto: a primeira página traz 200 e oferece "Carregar mais"', (await t.count('[data-testid="gv-row"]')) === 200 && (await t.count(pq('hs-more'))) === 1, { n: await t.count('[data-testid="gv-row"]'), c: await countText() });
const c200 = await countText();
t.check('o contador diz 200 commits achados e quantos foram examinados', /^200 commits achados · \d+ de 450 commits examinados$/.test(c200), c200);
await clickP('hs-more');
await idle();
t.check('"Carregar mais": 400 commits, sem repetir nenhum', (await t.count('[data-testid="gv-row"]')) === 400 && new Set(await subjects()).size === 400, await t.count('[data-testid="gv-row"]'));
await clickP('hs-more');
await idle();
const all = await subjects();
const wantAll = git(PAGES, 'log', '--format=%s', '-i', '-Galvo', 'HEAD').split('\n').filter(Boolean);
t.check('a terceira página fecha em 450, na ordem do Git, e o botão some', all.length === 450 && same(all, wantAll) && (await t.count(pq('hs-more'))) === 0, { n: all.length });
t.check('depois da última página o contador diz 450 de 450 examinados', /^450 commits achados · 450 de 450 commits examinados$/.test(await countText()), await countText());

// ---- do editor: botões, menu de contexto -------------------------------------------------------------------------------------------------------------------------
await closeTabs();
await openRepoByName('hs-main');
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 6000);
await typeInto(`${W} [data-testid="sf-input"]`, 'alvo');
await t.until(`document.querySelector('.sw__row[data-testid="sw-row"]')`, 20000);
await sleep(500);
await t.ev(`document.querySelector('.sw__row[data-testid="sw-row"]').click()`);
await t.until(`document.querySelector(${lit(wq('sw-editor'))} .cm-content')`, 8000).catch(() => undefined);
await t.until(`document.querySelector('[data-testid="sw-editor"] .cm-content')`, 20000);
await sleep(600);
await t.ev(`document.querySelector(${lit(wq('sw-hist-entered'))}).click()`);
await t.until(`document.querySelector(${lit(P)})`, 10000);
await idle();
const ent = await t.ev(`({ text: document.querySelector(${lit(pq('sf-input'))}).value, aa: document.querySelector(${lit(pq('sf-case'))}).getAttribute('aria-pressed') })`);
t.check('"Quando isto entrou ou saiu?" leva o texto selecionado ao histórico, com Aa ligado (a seleção é exata)', ent.text === 'alvo' && ent.aa === 'true', ent);
t.check('e já mostra os commits (os mesmos do `git log -S alvo`, sem diferenciar nada)', same(await subjects(), direct('-Salvo', 'HEAD')), await subjects());

// "Histórico destas linhas"
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 6000);
await t.until(`document.querySelector('.sw__row[data-testid="sw-row"]')`, 20000);
await sleep(400);
const hitText = await t.ev(`document.querySelector('.sw__row[data-testid="sw-row"]').textContent.replace(/\\s+/g, ' ').trim()`);
await t.ev(`document.querySelector('.sw__row[data-testid="sw-row"]').click()`);
await t.until(`document.querySelector('[data-testid="sw-editor"] .cm-content')`, 20000);
await sleep(600);
await t.ev(`document.querySelector(${lit(wq('sw-hist-lines'))}).click()`);
await t.until(`document.querySelector(${lit(pq('hs-range'))})`, 10000);
await idle();
const chip = await t.text(pq('hs-range'));
const m = /Trecho (\S+), linhas (\d+) a (\d+)/.exec(chip ?? '');
t.check('"Histórico destas linhas" mostra o trecho (arquivo e linhas) num chip', !!m, chip);
if (m) {
  const wantL = direct(`-L${m[2]},${m[3]}:${m[1]}`, 'HEAD');
  const gotL = (await subjects()).filter(Boolean);
  const wantSubjects = git(REPO, 'log', '--format=%s', `-L${m[2]},${m[3]}:${m[1]}`, 'HEAD').split('\n').filter((l) => /^[a-z]\d+:/.test(l));
  t.check('os commits do trecho são os do `git log -L` direto (atravessa a renomeação)', same(gotL, wantSubjects) && gotL.length >= 2, { gotL, wantSubjects, wantL, hitText });
}
await clickRow((await subjects())[0].slice(0, 6));
await t.until(`document.querySelector('[data-testid="gv-patch"]')`, 8000);
t.check('o commit do trecho mostra o diff só do trecho', /@@/.test((await t.text('[data-testid="gv-patch"]')) ?? ''));
await shot('historia-trecho');
await t.ev(`document.querySelector(${lit(pq('hs-range-leave'))}).click()`);
await sleep(300);
t.check('sair do trecho volta ao campo de texto', (await t.count(pq('hs-range'))) === 0 && (await t.count(pq('sf-input'))) === 1);

// menu de contexto do editor
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 6000);
await t.until(`document.querySelector('.sw__row[data-testid="sw-row"]')`, 20000);
await sleep(400);
await t.ev(`document.querySelector('.sw__row[data-testid="sw-row"]').click()`);
await t.until(`document.querySelector('[data-testid="sw-editor"] .cm-content')`, 20000);
await sleep(600);
await t.ev(`document.querySelector('[data-testid="sw-editor"] .cm-content').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400 }))`);
await t.until(`document.querySelector('[role="menu"]')`, 4000);
const items = await t.ev(`[...document.querySelectorAll('[role="menu"] button')].map((b) => b.textContent.trim())`);
t.check('o botão direito no editor abre o menu com as duas ações da história', same(items, ['Quando isto entrou ou saiu?', 'Histórico destas linhas']), items);
const menuZ = await t.ev(`Number(getComputedStyle(document.querySelector('[role="menu"]')).zIndex) > Number(getComputedStyle(document.documentElement).getPropertyValue('--gn-z-dialog'))`);
t.check('o menu fica acima do diálogo da pesquisa', menuZ === true);
await sleep(500);
await shot('historia-menu');
await t.ev(`[...document.querySelectorAll('[role="menu"] button')].find((b) => /Histórico destas linhas/.test(b.textContent)).click()`);
await t.until(`document.querySelector(${lit(pq('hs-range'))})`, 10000);
t.check('escolher "Histórico destas linhas" no menu abre o histórico do trecho', (await t.count(W)) === 0 && (await t.count(pq('hs-range'))) === 1);
await idle();

// paleta
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 8000);
await t.send('Input.insertText', { text: 'Buscar na história' });
await sleep(400);
const cmds = await t.ev(`[...document.querySelectorAll('.cp__item')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim())`);
t.check('a paleta tem "Buscar na história"', cmds.some((c) => /^Buscar na história/.test(c)), cmds);
await t.key('Escape');
await sleep(300);

// ---- tema claro e inglês ---------------------------------------------------------------------------------------------------------------------------------------------------
await t.ev(`localStorage.setItem('gitnexus.locale', 'en'); localStorage.setItem('gitnexus.theme', 'light')`);
await t.ev('location.reload()');
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'hs-main')`, 25000);
await openRepoByName('hs-main');
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 6000);
await typeInto(`${W} [data-testid="sf-input"]`, 'alvo');
await sleep(700);
await clickW('sw-history-search');
await t.until(`document.querySelector(${lit(P)})`, 10000);
await idle();
await clickRow('c4: tira o alvo');
await t.until(`document.querySelector('[data-testid="gv-file"]')`, 8000);
await t.ev(`document.querySelector('[data-testid="gv-file"]').click()`);
await t.until(`document.querySelector('[data-testid="gv-diff"] mark')`, 8000);
const en = await rows();
t.check('em inglês: selos "came in / went out" e o contador em inglês', same(en.map((r) => r.kind), ['added', 'removed', 'added', 'added']) && en[1].badge === 'went out −3' && /4 commits found/.test(await countText()), { en, c: await countText() });
t.check('em inglês: o resumo e os modos', /First came in:/.test((await t.text(pq('hs-summary'))) ?? '') && /Last went out:/.test((await t.text(pq('hs-summary'))) ?? ''), await t.text(pq('hs-summary')));
await shot('historia-claro-en');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
