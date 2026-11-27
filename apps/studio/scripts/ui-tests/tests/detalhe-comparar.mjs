// Detalhe do commit fixo (#293) e comparar revisões (#295), com Git de verdade: o detalhe fica ao lado da lista (vazio com a dica, depois o commit), J/K e as setas trocam de commit
// SEM tirar o foco da lista (200+ commits), os arquivos (renomeação, binário, contagem) e os pais conferem com o git, a divisória redimensiona e fica lembrada, Esc fecha o detalhe,
// Alt+← volta, e a comparação (Ctrl+clique em dois commits) bate com `git log a..b` e `git diff`: commits, arquivos, trocar os lados, os dois modos, erro de revisão e copiar a lista.
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.send('Page.bringToFront');
await t.send('Emulation.setFocusEmulationEnabled', { enabled: true });
const theme = process.env.GN_GRAPH_THEME ?? 'dark';
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', ${lit(theme)})`);
for (const k of Object.keys(await t.ev(`Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('gitnexus.graph') || k.startsWith('gitnexus.repoView.')))`))) await t.ev(`localStorage.removeItem(${lit(k)})`);

const root = tmpRoot('gn-detalhe-');
const R = mkRepo(root, 'det-repo', { files: { 'README.md': 'x\n' } });
git(R, 'config', 'core.fsmonitor', 'false');
{
  const N = 210; // mais de 200 commits: a navegação por teclado com a lista virtual
  let s = '';
  for (let i = 1; i <= N; i++) {
    const msg = `p${i}: passo ${i}`;
    const body = Array.from({ length: Math.min(i, 30) }, (_, k) => `linha ${k + 1}`).join('\n') + `\n${i}\n`;
    s += `commit refs/heads/main\nauthor P <p@e.com> ${1700000000 + i * 60} +0000\ncommitter P <p@e.com> ${1700000000 + i * 60} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}\nM 100644 inline lista.txt\ndata ${Buffer.byteLength(body)}\n${body}\n`;
  }
  execFileSync('git', ['fast-import', '--quiet', '--force'], { cwd: R, input: s, encoding: 'utf8' });
  git(R, 'reset', '-q', '--hard');
}
const commit = (msg, files) => {
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(R, f, '..'), { recursive: true });
    writeFileSync(join(R, f), c);
  }
  git(R, 'add', '-A');
  git(R, 'commit', '-qm', msg);
};
git(R, 'tag', 'v1');
git(R, 'checkout', '-qb', 'feat');
renameSync(join(R, 'lista.txt'), join(R, 'lista2.txt'));
git(R, 'add', '-A');
git(R, 'commit', '-qm', 'f1: renomeia a lista');
commit('f2: binário e docs\n\nCorpo da mensagem\nsegunda linha\nterceira\nquarta\nquinta linha do corpo', { 'img.bin': Buffer.from([0, 1, 2, 0, 255, 0]), 'docs/guia.md': 'guia\n', 'docs/outro.md': 'outro\n' });
commit('f3: muda a lista', { 'lista2.txt': Array.from({ length: 30 }, (_, k) => (k === 4 ? 'linha 5 mudou' : `linha ${k + 1}`)).join('\n') + '\n210\n' });
git(R, 'checkout', '-q', 'main');
commit('m1: só na main', { 'principal.txt': 'm\n' });
git(R, 'merge', '--no-ff', '-qm', 'mg: junta a feat', 'feat');
const subj = (...a) => git(R, 'log', '--format=%s', ...a).trim().split('\n').filter(Boolean);
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

await t.ev(`window.gitNexus.addRepositoryPath(${lit(R)})`);
await t.ev('location.reload()');
await t.until(`document.querySelector('li.repo')`, 20000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="repo-views"]')`, 15000);
await sleep(800);
const P = '.core__pane:not([style*="display: none"]) ';
const q = (sel) => `document.querySelector(${lit(P + sel)})`;
const qa = (sel) => `[...document.querySelectorAll(${lit(P + sel)})]`;
await t.ev(`${q('[data-view="graph"]')}.click()`);
await t.until(`${q('[data-testid="gv-row"]')}`, 15000);
await sleep(1200);
const rowsOf = () => t.ev(`${qa('[data-testid="gv-row"]')}.map((r) => r.dataset.hash)`);
const selSubject = () => t.ev(`${q('[data-testid="gv-row"].row--on .row__subject')}?.textContent.trim() ?? null`);
const detailSubject = () => t.text(`${P}[data-testid="cd-subject"]`);
const focusList = () => t.ev(`${q('[data-testid="gv-list"]')}.focus()`);

// 1. o detalhe é fixo: vazio com a dica, depois o commit
t.check('sem commit escolhido o detalhe mostra "Selecione um commit" e a dica de teclado', (await t.text(`${P}[data-testid="cd-empty"]`))?.includes('Selecione um commit') && (await t.text(`${P}[data-testid="cd-empty"]`)).includes('Alt+'));
await focusList();
await t.key('Home');
await sleep(500);
const head = git(R, 'log', '-1', '--format=%H|%an|%s|%P').trim().split('|');
await t.until(`${q('[data-testid="cd-subject"]')}`, 8000);
t.check('o primeiro commit (o merge) abre no detalhe: assunto, autor, hash completo e os dois pais conferem com o git', (await detailSubject()) === head[2] && (await t.text(`${P}[data-testid="gv-author"]`)) === head[1] && (await t.text(`${P}[data-testid="cd-hash"]`)).startsWith(head[0]) && (await t.count(`${P}[data-testid="cd-parent"]`)) === 2, { s: await detailSubject() });
await t.until(`${q('[data-testid="gv-file"]')}`, 8000);
const mergeFiles = lines(git(R, 'show', '--format=', '--name-only', '-m', '--first-parent', head[0]));
t.check('os arquivos do merge (contra o primeiro pai) conferem com `git show -m --first-parent`', JSON.stringify((await t.ev(`${qa('[data-testid="gv-file"]')}.map((e) => e.dataset.path)`)).sort()) === JSON.stringify([...mergeFiles].sort()), mergeFiles);
await t.shot('detalhe-fixo');

// 2. J/K e as setas trocam de commit mantendo o foco na lista, e o detalhe acompanha
await focusList();
await t.key('Home');
for (let i = 0; i < 12; i++) await t.key('j');
await sleep(900);
const want12 = subj('--topo-order', 'HEAD')[12];
t.check('12 vezes J andam 12 commits, o detalhe acompanha e o foco continua na lista', (await selSubject()) === want12 && (await detailSubject()) === want12 && (await t.ev(`document.activeElement === ${q('[data-testid="gv-list"]')}`)), { sel: await selSubject(), det: await detailSubject(), want: want12 });
await t.key('k');
await t.key('k');
await sleep(700);
t.check('K volta e o detalhe acompanha', (await detailSubject()) === subj('--topo-order', 'HEAD')[10]);
await t.key('End');
await sleep(1800); // a primeira End vai ao último carregado (200) e a lista pede a próxima página
await t.key('End');
await sleep(1500);
t.check('End vai ao último commit da lista (210 commits, lista virtual) e o detalhe também', (await detailSubject()) === subj('--topo-order', 'HEAD').slice(-1)[0], await detailSubject());
t.check('a mudança de commit é anunciada em região educada (aria-live=polite)', (await t.ev(`${q('[data-testid="cd-announce"]')}.getAttribute('aria-live')`)) === 'polite' && /Commit [0-9a-f]{7}:/.test((await t.text(`${P}[data-testid="cd-announce"]`)) ?? ''));

// 3. renomeação, binário, pastas e contagem (contra o git)
const pick = async (subject) => {
  await t.ev(`${q(`[data-testid="gv-list"]`)}.focus()`);
  await t.key('Home');
  const idx = subj('--topo-order', 'HEAD').indexOf(subject);
  for (let i = 0; i < idx; i++) await t.key('ArrowDown');
  await sleep(900);
};
await pick('f1: renomeia a lista');
await t.until(`${q('[data-status="R"]')}`, 6000);
t.check('a renomeação aparece como "Renomeado" com o nome antigo', !!(await t.ev(`${q('[data-testid="cf-old"]')}`)) && (await t.text(`${P}[data-testid="cf-old"]`)).includes('lista.txt'));
await pick('f2: binário e docs');
await t.until(`${q('[data-testid="gv-file"]')}`, 6000);
const numstat = Object.fromEntries(lines(git(R, 'show', '--format=', '--numstat', 'HEAD^2~1')).map((l) => l.split('\t')).map(([a, , p]) => [p, a]));
const got = await t.ev(`Object.fromEntries(${qa('[data-testid="gv-file"]')}.map((e) => [e.dataset.path, e.querySelector('[data-testid="cf-count"]')?.textContent.trim() ?? '']))`);
t.check('a contagem por arquivo confere com `git show --numstat` e o binário diz "binário"', got['docs/guia.md'] === `+${numstat['docs/guia.md']}` && got['img.bin'] === 'binário', { got, numstat });
await t.ev(`${q('[data-testid="cf-group"]')}.click()`);
await sleep(300);
t.check('"Agrupar por pasta" mostra a pasta docs', (await t.text(`${P}[data-testid="cf-list"]`)).includes('docs'));
await t.ev(`(() => { const i = ${q('[data-testid="cf-filter"]')}; i.value = 'guia'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(300);
t.check('o filtro por nome deixa só os arquivos que casam', (await t.count(`${P}[data-testid="gv-file"]`)) === 1);

// 4. mensagem com corpo expansível, diff, trechos e pais clicáveis
await pick('f3: muda a lista');
await t.until(`${q('[data-testid="gv-file"]')}`, 6000);
await t.ev(`${q('[data-testid="gv-file"]')}.click()`);
await t.until(`${q('[data-testid="gv-diff"]')}`, 6000);
t.check('escolher o arquivo mostra o diff com a mudança', (await t.text(`${P}[data-testid="gv-diff"]`)).includes('linha 5 mudou'));
await pick('f2: binário e docs');
await t.until(`${q('[data-testid="cd-body"]')}`, 6000);
t.check('o corpo da mensagem longo vem recolhido e "Mostrar a mensagem inteira" o abre', !(await t.text(`${P}[data-testid="cd-body"]`)).includes('quinta linha') && (await t.ev(`${q('[data-testid="cd-body-toggle"]')}.click(), true`)) && (await sleep(200), (await t.text(`${P}[data-testid="cd-body"]`)).includes('quinta linha')));
await t.ev(`${q('[data-testid="cd-refs-btn"]')}.click()`);
await t.until(`${q('[data-testid="cd-refs"]')}`, 6000);
t.check('"Onde está este commit?" lista os branches que o contêm (conferido no git)', (await t.text(`${P}[data-testid="cd-refs"]`)).includes('feat') && git(R, 'branch', '--contains', 'HEAD^2').includes('feat'));
await t.ev(`${q('[data-testid="cd-parent"]')}.click()`);
await sleep(900);
t.check('clicar no pai pula para ele (o commit anterior da feat)', (await selSubject()) === 'f1: renomeia a lista' && (await detailSubject()) === 'f1: renomeia a lista');
await focusList();
await t.key('ArrowLeft', 1);
await sleep(800);
t.check('Alt+← volta ao commit visitado antes', (await selSubject()) === 'f2: binário e docs');

// 5. divisória: setas, limites, memória e a posição embaixo
const w0 = Number(await t.ev(`${q('[data-testid="gv-sep"]')}.getAttribute('aria-valuenow')`));
await t.ev(`${q('[data-testid="gv-sep"]')}.focus()`);
await t.key('ArrowLeft');
await t.key('ArrowLeft', 8);
await sleep(200);
const w1 = Number(await t.ev(`${q('[data-testid="gv-sep"]')}.getAttribute('aria-valuenow')`));
t.check('as setas movem a divisória (16 px, Shift 32) e a largura do detalhe acompanha', w1 === w0 + 48 && (await t.ev(`Math.round(${q('[data-testid="gv-detail"]')}.getBoundingClientRect().width)`)) === w1, { w0, w1 });
await t.key('Enter');
await sleep(150);
t.check('Enter volta ao padrão', Number(await t.ev(`${q('[data-testid="gv-sep"]')}.getAttribute('aria-valuenow')`)) === w0);
await t.key('ArrowLeft');
await sleep(150);
await t.ev('location.reload()');
await t.until(`document.querySelector('li.repo')`, 20000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="repo-views"]')`, 15000);
await sleep(800);
await t.ev(`${q('[data-view="graph"]')}.click()`);
await t.until(`${q('[data-testid="gv-sep"]')}`, 15000);
t.check('a largura fica lembrada ao reabrir', Number(await t.ev(`${q('[data-testid="gv-sep"]')}.getAttribute('aria-valuenow')`)) === w0 + 16);
await t.ev(`[...${q('[data-testid="gv-split"]')}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Embaixo').click()`);
await sleep(400);
t.check('"Embaixo" põe o detalhe sob a lista (a altura vira a medida da divisória)', (await t.ev(`getComputedStyle(${q('.gv__body')}).flexDirection`)) === 'column' && (await t.ev(`${q('[data-testid="gv-sep"]')}.getAttribute('aria-orientation')`)) === 'horizontal');
await t.ev(`[...${q('[data-testid="gv-split"]')}.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ao lado').click()`);
await sleep(300);

// 6. Esc fecha o detalhe; escolher outro commit o reabre
await focusList();
await t.key('Home');
await sleep(500);
await t.key('Escape');
await sleep(300);
t.check('Esc fecha o detalhe e a lista fica inteira', (await t.count(`${P}[data-testid="gv-detail"]`)) === 0);
await t.key('ArrowDown');
await sleep(500);
t.check('escolher outro commit reabre o detalhe', (await t.count(`${P}[data-testid="gv-detail"]`)) === 1);

// 7. comparar: Ctrl+clique em dois commits (feat × main) e conferir contra o git
const ctrlClick = (hash) => t.ev(`${q(`[data-testid="gv-row"][data-hash="${hash}"]`)}.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))`);
const f3 = git(R, 'rev-parse', 'feat').trim();
const m1 = git(R, 'rev-parse', 'HEAD^1').trim(); // m1: só na main
await focusList();
await t.key('Home');
for (let i = 0; i < 4; i++) await t.key('j'); // anda até a região do merge para que as duas linhas estejam na janela
await ctrlClick(m1);
t.check('o primeiro Ctrl+clique marca o commit e avisa', (await t.count(`${P}.row--mark`)) === 1 && /marcado/.test((await t.text(`${P}.gv__note`)) ?? ''));
await ctrlClick(f3);
await t.until(`${q('[data-testid="cmp"]')}`, 6000);
await t.until(`${q('[data-testid="cmp-summary"]')}`, 15000);
const ahead = subj(`${m1}..${f3}`);
const behind = subj(`${f3}..${m1}`);
t.check('o segundo Ctrl+clique abre a comparação e o resumo diz "↑ a · ↓ b" como o git', (await t.text(`${P}[data-testid="cmp-summary"]`)).includes(`↑ ${ahead.length} · ↓ ${behind.length}`), await t.text(`${P}[data-testid="cmp-summary"]`));
t.check('os commits a mais e a menos são os de `git log a..b` e `b..a`', JSON.stringify(await t.ev(`${qa('[data-testid="cmp-ahead-row"] .cmp__sub')}.map((e) => e.textContent.trim())`)) === JSON.stringify(ahead) && JSON.stringify(await t.ev(`${qa('[data-testid="cmp-behind-row"] .cmp__sub')}.map((e) => e.textContent.trim())`)) === JSON.stringify(behind), { ahead, behind });
await t.shot('comparar-commits');
await t.ev(`${q('[data-testid="cmp-ahead-row"]')}.click()`);
await t.until(`${q('.cmp__detail [data-testid="cd-subject"]')}`, 6000);
t.check('escolher um commit da comparação abre o detalhe dele ao lado (sem as ações que alteram o repositório)', (await t.text(`${P}.cmp__detail [data-testid="cd-subject"]`)) === ahead[0] && (await t.count(`${P}.cmp__detail [data-testid="cherry-pick"]`)) === 1);
await t.ev(`[...${qa('[role="tab"]')}].find((e) => /^Arquivos/.test(e.textContent.trim())).click()`);
await t.until(`${q('.cmp [data-testid="cf-list"]')}`, 6000);
const wantFiles = lines(git(R, 'diff', '--name-only', '--find-renames', `${m1}...${f3}`)).sort();
t.check('a aba Arquivos (desde o ancestral comum) lista o que `git diff a...b` lista', JSON.stringify((await t.ev(`${qa('.cmp [data-testid="gv-file"]')}.map((e) => e.dataset.path)`)).sort()) === JSON.stringify(wantFiles), wantFiles);
await t.ev(`[...${q('[data-testid="cmp-mode"]')}.querySelectorAll('button')].find((b) => /Entre os dois/.test(b.textContent)).click()`);
await sleep(1500);
const wantTwo = lines(git(R, 'diff', '--name-only', '--find-renames', m1, f3)).sort();
t.check('"Entre os dois estados" lista o que `git diff a b` lista (inclui o que só a main mudou)', JSON.stringify((await t.ev(`${qa('.cmp [data-testid="gv-file"]')}.map((e) => e.dataset.path)`)).sort()) === JSON.stringify(wantTwo) && wantTwo.length > wantFiles.length, { wantTwo });
await t.ev(`${q('.cmp [data-testid="gv-file"]')}.click()`);
await t.until(`(${q('[data-testid="cmp-diff"]')}?.textContent ?? '').length > 10`, 8000);
t.check('escolher um arquivo abre o diff dele na aba Diff', ((await t.text(`${P}[data-testid="cmp-diff"]`)) ?? '').length > 10);
await t.shot('comparar-diff');
await t.ev(`${q('[data-testid="cmp-swap"]')}.click()`);
await sleep(1500);
t.check('"Trocar" inverte os lados: agora o que era a mais é a menos', (await t.text(`${P}[data-testid="cmp-summary"]`)).includes(`↑ ${behind.length} · ↓ ${ahead.length}`));
await t.ev(`(() => { const i = ${q('[data-testid="cmp-target"] input')}; i.focus(); i.value = 'nao-existe-x'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await t.ev(`${q('[data-testid="cmp-go"]')}.click()`);
await t.until(`${q('[data-testid="cmp-error"]')}`, 6000);
t.check('revisão inexistente vira erro em texto (role=alert), sem quebrar a tela', (await t.text(`${P}[data-testid="cmp-error"]`)) === 'A revisão "nao-existe-x" não existe.' && (await t.ev(`${q('[data-testid="cmp-error"]')}.getAttribute('role')`)) === 'alert');
for (const [id, v] of [['cmp-base', 'v1'], ['cmp-target', 'feat']]) await t.ev(`(() => { const i = ${q(`[data-testid="${id}"] input`)}; i.focus(); i.value = ${lit(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(1500); // sair do campo já compara (como Enter); o botão só vale quando nada está carregando
await t.ev(`(() => { const b = ${q('[data-testid="cmp-go"]')}; if (!b.disabled) b.click(); })()`);
const again = await t.until(`${q('[data-testid="cmp-copy"]')}`, 10000);
t.check('depois do erro, corrigir as revisões e comparar de novo mostra o resultado', !!again, await t.text(`${P}[data-testid="cmp"]`));
await t.ev(`${q('[data-testid="cmp-copy"]')}.click()`);
await sleep(400);
const clip = await (await fetch(`${t.base}/clipboard`)).text();
const wantList = git(R, 'log', '--format=- %h %s', 'v1..feat').trim();
t.check('"Copiar a lista" copia hash e assunto dos commits a mais (v1..feat), em Markdown, como o git os lista', clip.trim() === wantList && clip.trim().split('\n').length === 3, { clip, wantList });
await t.ev(`${q('[data-testid="cmp-close"]')}.click()`);
await sleep(400);
t.check('"Voltar ao grafo" fecha a comparação e a lista continua onde estava', (await t.count(`${P}[data-testid="cmp"]`)) === 0 && (await t.count(`${P}[data-testid="gv-row"]`)) > 0);

t.check('sem erro de página', t.errors().filter((e) => !/favicon|Failed to fetch/.test(e)).length === 0, t.errors());
t.close();
