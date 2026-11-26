// Lista do Grafo (#291): autor, data, hash e estado de cada linha conferidos contra o Git (merge, branches, tags e commits locais); chips com hierarquia; colunas que
// redimensionam (mouse e teclado), ocultam e ficam lembradas; sem sobreposição em 800, 1100 e 1500 px; densidade; teclado de listbox; menu da linha; criar branch aqui.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.send('Page.bringToFront'); // a rolagem e as medidas só andam com a página na frente
await t.send('Emulation.setFocusEmulationEnabled', { enabled: true });
const theme = process.env.GN_GRAPH_THEME ?? 'dark';
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', ${lit(theme)}); localStorage.removeItem('gitnexus.graphDensity')`);
for (const k of Object.keys(await t.ev(`Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('gitnexus.graphCols.') || k.startsWith('gitnexus.repoView.')))`))) await t.ev(`localStorage.removeItem(${lit(k)})`);

// --- um repositório com remoto, branches, merge, tags, autores diferentes e commits ainda não publicados ---------------------------------------------------------------------
const root = tmpRoot('gn-grafo-');
const bare = join(root, 'o.git');
git(root, 'init', '-q', '--bare', '-b', 'main', bare);
const R = join(root, 'grafo-repo');
git(root, 'init', '-q', '-b', 'main', R);
for (const [k, v] of [['commit.gpgsign', 'false'], ['core.fsmonitor', 'false'], ['core.autocrlf', 'false'], ['user.name', 'Ana Souza'], ['user.email', 'ana@e.com']]) git(R, 'config', k, v);
git(R, 'remote', 'add', 'origin', bare);
let n = 0;
const commit = (who, email, msg, date) => {
  writeFileSync(join(R, `f${++n}.txt`), `${n}\n`); // um arquivo por commit: o merge não tem conflito
  git(R, 'add', '.');
  const env = { ...process.env, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: email, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) };
  execFileSync('git', ['commit', '-qm', msg], { cwd: R, env });
};
const dias = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
commit('Ana Souza', 'ana@e.com', 'feat: primeiro', dias(40));
git(R, 'tag', 'v0.1');
commit('Bruno Lima', 'bruno@e.com', 'fix: segundo', dias(20));
git(R, 'checkout', '-qb', 'feat/lateral');
commit('Carla Dias', 'carla@e.com', 'feat: lateral um', dias(10));
commit('Carla Dias', 'carla@e.com', 'feat: lateral dois', dias(9));
git(R, 'checkout', '-q', 'main');
commit('Bruno Lima', 'bruno@e.com', 'fix: terceiro na main', dias(8));
execFileSync('git', ['merge', '--no-ff', '-m', 'merge: lateral na main', 'feat/lateral'], { cwd: R, env: { ...process.env, GIT_AUTHOR_NAME: 'Ana Souza', GIT_AUTHOR_EMAIL: 'ana@e.com', GIT_COMMITTER_NAME: 'Ana Souza', GIT_COMMITTER_EMAIL: 'ana@e.com', GIT_AUTHOR_DATE: dias(7), GIT_COMMITTER_DATE: dias(7) } });
git(R, 'push', '-qu', 'origin', 'main'); // até aqui está publicado
commit('Ana Souza', 'ana@e.com', 'feat: ainda local um', dias(0.2));
commit('Dani Rocha', 'dani@e.com', 'feat: ainda local dois', dias(0.05));
git(R, 'tag', '-a', 'v0.2', '-m', 'segunda');

const fmt = () => git(R, 'log', '--topo-order', '--all', '--abbrev=7', '--format=%H|%h|%an|%ae|%s|%P').trim().split('\n').map((l) => {
  const [hash, short, author, email, subject, parents] = l.split('|');
  return { hash, short, author, email, subject, parents: parents ? parents.split(' ') : [] };
});
const log = fmt();
const unpublished = new Set(git(R, 'rev-list', '--all', '--not', '--remotes').trim().split('\n').filter(Boolean));

await t.ev(`window.gitNexus.addRepositoryPath(${lit(R)})`);
await t.ev('location.reload()');
await t.until(`document.querySelector('li.repo')`, 20000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="repo-views"]')`, 15000);
await sleep(800);
const P = '.core__pane:not([style*="display: none"]) ';
const q = (sel) => `document.querySelector(${lit(P + sel)})`;
await t.ev(`${q('[data-view="graph"]')}.click()`);
await t.until(`${q('[data-testid="gv-row"]')}`, 15000);
await sleep(1200); // o resumo e a lista de remotos chegam logo depois da primeira página

const rows = () => t.ev(`[...document.querySelectorAll(${lit(P + '[data-testid="gv-row"]')})].map((r) => ({ hash: r.dataset.hash, subject: r.querySelector('.row__subject').textContent.trim(), author: r.querySelector('.row__name')?.textContent.trim() ?? null, short: r.querySelector('[data-testid="gv-hash"]')?.textContent.trim() ?? null, when: r.querySelector('[data-testid="gv-date"]')?.textContent.trim() ?? null, local: r.classList.contains('row--local'), merge: !!r.querySelector('.row__merge'), ring: !!r.querySelector('svg circle[fill="var(--gn-surface)"]'), chips: [...r.querySelectorAll('.chip')].map((c) => ({ kind: c.dataset.chip ?? 'more', text: c.textContent.replace(/\\s+/g, ' ').trim() })), aria: r.getAttribute('aria-label'), stateIcon: r.querySelector('.row__st')?.classList.contains('row__st--local') ? 'local' : r.querySelector('.row__st') ? 'published' : null, avatar: r.querySelector('.avatar')?.style.background ?? null }))`);

// --- cada linha confere com o git log ----------------------------------------------------------------------------------------------------------------------------------------
const got = await rows();
t.check('a lista tem os commits do git log, na mesma ordem (topológica)', JSON.stringify(got.map((r) => r.hash)) === JSON.stringify(log.map((l) => l.hash)), [got.length, log.length]);
t.check('assunto, autor e hash curto de cada linha conferem com o git log', got.every((r, i) => r.subject === log[i].subject && r.author === log[i].author && r.short === log[i].short), got.filter((r, i) => r.subject !== log[i].subject || r.author !== log[i].author || r.short !== log[i].short));
t.check('a data é relativa ("há 3 h") ou curta, e o tooltip traz a data inteira com o fuso', got.every((r) => /^(agora há pouco|há \d+ (min|h|dia|dias)|\d{2}[/.-]\d{2}[/.-]\d{2})/.test(r.when ?? '')) && /\d{4}/.test(await t.ev(`document.querySelector('[data-testid="gv-date"]').dataset.tooltip ?? ''`)), got.map((r) => r.when));
t.check('os commits ainda não publicados são marcados como locais, e só eles', got.every((r) => r.local === unpublished.has(r.hash)) && got.filter((r) => r.local).length === 2, got.map((r) => [r.subject, r.local]));
t.check('o estado aparece como ícone: seta (local) ou visto (publicado), e no nome acessível da linha em texto', got.every((r) => (r.local ? r.stateIcon === 'local' && /só local/.test(r.aria) : r.stateIcon === 'published' && /publicado/.test(r.aria))), got.map((r) => [r.stateIcon, r.aria]));
const mergeCommits = log.filter((l) => l.parents.length > 1).map((l) => l.hash);
t.check('o merge (dois pais) tem a marca "merge" e o nó em anel; o commit comum, disco cheio', got.every((r) => r.merge === mergeCommits.includes(r.hash) && r.ring === r.merge) && mergeCommits.length === 1, got.map((r) => [r.subject, r.merge, r.ring]));
t.check('o nome acessível da linha diz assunto, autor, quando e o merge com os pais (tudo em texto)', /merge: lateral na main, Ana Souza, .*merge de [0-9a-f]{7}, [0-9a-f]{7}/.test(got.find((r) => r.merge).aria), got.find((r) => r.merge).aria);
const emails = new Map();
for (const r of got) emails.set(log.find((l) => l.hash === r.hash).email, r.avatar);
t.check('a cor do avatar é estável por e-mail: o mesmo autor, a mesma cor; autores diferentes, cores diferentes', got.every((r) => r.avatar === emails.get(log.find((l) => l.hash === r.hash).email)) && new Set(emails.values()).size === emails.size, [...emails]);

// --- chips com hierarquia ------------------------------------------------------------------------------------------------------------------------------------------------------------
const head = got[0];
t.check('a linha do HEAD tem o chip HEAD (com o nome do branch) em destaque e o ↑ dos commits à frente do remoto', head.chips[0].kind === 'head' && /HEAD\s*main/.test(head.chips[0].text) && (await t.count(`${P}[data-testid="gv-row"].row--head .sync`)) === 1, head.chips);
const tagRow = got.find((r) => r.chips.some((c) => c.kind === 'tag' && /v0\.1/.test(c.text)));
const remoteRow = got.find((r) => r.chips.some((c) => c.kind === 'remote' && /origin\/main/.test(c.text)));
const localRow = got.find((r) => r.chips.some((c) => c.kind === 'local' && /feat\/lateral/.test(c.text)));
t.check('tag, branch local (inclusive "feat/lateral", que tem barra) e branch remota têm chips de tipos diferentes', !!tagRow && !!remoteRow && !!localRow, [!!tagRow, !!remoteRow, !!localRow]);
t.check('a hierarquia não depende só da cor: HEAD é cheio, remoto é tracejado, local tem o sinal ⎇ e a tag tem o ícone de etiqueta', await t.ev(`(() => { const s = (k) => { const e = document.querySelector('[data-chip="' + k + '"]'); return e ? getComputedStyle(e) : null; }; const h = s('head'), r = s('remote'), l = document.querySelector('[data-chip="local"]'), tg = document.querySelector('[data-chip="tag"]'); return !!h && h.backgroundColor !== 'rgba(0, 0, 0, 0)' && r.borderTopStyle === 'dashed' && r.backgroundColor === 'rgba(0, 0, 0, 0)' && /⎇/.test(l.textContent) && !!tg.querySelector('svg'); })()`));
t.check('o chip tem o nome completo no tooltip (e o do tag, "tag v0.2")', (await t.ev(`[...document.querySelectorAll('[data-chip="tag"]')].map((c) => c.dataset.tooltip ?? '').join('|')`)).includes('tag v0.2'));
await t.shot('grafo-lista-1500');

// --- colunas: redimensionar (mouse e teclado), ocultar, lembrar ---------------------------------------------------------------------------------------------------------------
const colW = (id) => t.ev(`(() => { const h = ${q('[data-col="' + id + '"]')}; return h ? Math.round(h.getBoundingClientRect().width) : null; })()`);
// (o arrasto com o mouse usa a mesma conta da seta; só o teclado é conferido aqui, que é o caminho acessível)
const w1 = await colW('author');
await t.ev(`${q('[data-grip="author"]')}.focus()`);
await t.key('ArrowRight');
await sleep(200);
t.check('seta para a direita (com o foco na divisória) estreita em 8 px, e a divisória é um separator com nome e valores', (await colW('author')) === w1 - 8 && (await t.ev(`(() => { const e = ${q('[data-grip="author"]')}; return e.getAttribute('role') === 'separator' && !!e.getAttribute('aria-label') && Number(e.getAttribute('aria-valuenow')) > 0 && !!e.getAttribute('aria-valuemin') && !!e.getAttribute('aria-valuemax'); })()`)) === true);
await t.key('Enter');
await sleep(200);
t.check('Enter na divisória (ou duplo clique) volta à largura padrão', (await colW('author')) === 168, await colW('author'));
await t.key('ArrowLeft', 8);
await sleep(200);
t.check('Shift+seta move de 32 em 32', (await colW('author')) === 168 + 32, await colW('author'));

// ocultar pela coluna "Colunas"
await t.ev(`${q('[data-testid="gv-colmenu"]')}.click()`);
await t.until(`document.querySelector('.ctx')`, 4000);
t.check('o menu das colunas marca as visíveis com ✓ e tem "Restaurar colunas"', /✓\s+Data/.test(await t.text('.ctx')) && /Restaurar colunas/.test(await t.text('.ctx')), await t.text('.ctx'));
await t.ev(`[...document.querySelectorAll('.ctx__item')].find((b) => /Data/.test(b.textContent)).click()`);
await sleep(300);
t.check('desmarcar "Data" tira a coluna do cabeçalho e das linhas', (await colW('date')) === null && (await t.count(`${P}[data-testid="gv-date"]`)) === 0);
const key = await t.ev(`Object.keys(localStorage).find((k) => k.startsWith('gitnexus.graphCols.'))`);
t.check('larguras e colunas ocultas ficam gravadas por repositório', !!key && /"hidden":\["date"\]/.test(await t.ev(`localStorage.getItem(${lit(key)})`)), await t.ev(`localStorage.getItem(${lit(key)})`));
await t.ev(`location.reload()`);
await t.until(`document.querySelector('li.repo')`, 20000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="repo-views"]')`, 15000);
await sleep(800);
await t.ev(`${q('[data-view="graph"]')}.click()`);
await t.until(`${q('[data-testid="gv-row"]')}`, 15000);
await sleep(800);
t.check('depois de recarregar, a coluna continua oculta e a largura do autor, a que ficou', (await colW('date')) === null && (await colW('author')) === 168 + 32, [await colW('date'), await colW('author')]);
await t.ev(`${q('[data-testid="gv-colmenu"]')}.click()`);
await t.until(`document.querySelector('.ctx')`, 4000);
await t.ev(`[...document.querySelectorAll('.ctx__item')].find((b) => /Restaurar/.test(b.textContent)).click()`);
await sleep(300);
t.check('"Restaurar colunas" devolve as três colunas com as larguras padrão', (await colW('date')) === 96 && (await colW('author')) === 168 && (await colW('hash')) === 104);

// --- larguras: nada se sobrepõe nem ganha rolagem lateral em 800, 1100 e 1500 --------------------------------------------------------------------------------------------
const noOverlap = () => t.ev(`(() => { const list = ${q('[data-testid="gv-list"]')}; const rows = [...list.querySelectorAll('[data-testid="gv-row"]')].slice(0, 12); for (const r of rows) { const cells = [...r.children].map((c) => c.getBoundingClientRect()).filter((b) => b.width > 0).sort((a, b) => a.left - b.left); for (let i = 1; i < cells.length; i++) if (cells[i].left < cells[i - 1].right - 1) return 'sobrepõe'; } return list.scrollWidth <= list.clientWidth + 1 ? 'ok' : 'rolagem lateral'; })()`);
const colsAt = () => t.ev(`[...document.querySelectorAll(${lit(P + '[data-col]')})].map((e) => e.dataset.col).join(',')`);
await t.ev(`${q('[data-testid="gv-row"]')}.click()`); // com o detalhe aberto ao lado (420 px), a lista fica mais estreita
await sleep(600);
for (const w of [800, 1500]) { // 800 é o caso apertado (com o detalhe ao lado); 1100 cai entre os dois e é coberto pela conta de fitColumns (unidade)
  await t.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  t.check(`${w} px (com o detalhe aberto): as colunas não se sobrepõem, não há rolagem lateral e a mensagem mantém o mínimo`, (await noOverlap()) === 'ok' && (await t.ev(`${q('.row__text')}.getBoundingClientRect().width`)) >= 219, [await noOverlap(), await colsAt()]);
  if (w === 800) t.check('em 800 px as colunas que não cabem saem da direita para a esquerda (hash e data primeiro)', !(await colsAt()).includes('hash') && !(await colsAt()).includes('date'), await colsAt());
  if (w === 1500) t.check('em 1500 px as três colunas aparecem', (await colsAt()) === 'author,date,hash', await colsAt());
  await t.shot(`grafo-lista-${w}`);
}
await t.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(600);

// --- densidade ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const rowH = () => t.ev(`Math.round(${q('[data-testid="gv-row"]')}.getBoundingClientRect().height)`);
t.check('a densidade padrão é compacta: linhas de 24 px', (await rowH()) === 24, await rowH());
await t.ev(`[...document.querySelectorAll(${lit(P + '[data-testid="gv-density"] [role="radio"]')})].find((b) => /Confortável/.test(b.textContent)).click()`);
await sleep(400);
t.check('"Confortável" dá linhas de 32 px e fica lembrada', (await rowH()) === 32 && (await t.ev(`localStorage.getItem('gitnexus.graphDensity')`)) === 'comfortable', await rowH());
await t.ev(`[...document.querySelectorAll(${lit(P + '[data-testid="gv-density"] [role="radio"]')})].find((b) => /Compacta/.test(b.textContent)).click()`);
await sleep(300);

// --- teclado: listbox ------------------------------------------------------------------------------------------------------------------------------------------------------------------
const sel = () => t.ev(`${q('[data-testid="gv-row"][aria-selected="true"] .row__subject')}?.textContent.trim() ?? null`);
t.check('a lista é um listbox com nome, as linhas são opções e a ativa é apontada por aria-activedescendant', (await t.ev(`(() => { const l = ${q('[data-testid="gv-list"]')}; return l.getAttribute('role') === 'listbox' && !!l.getAttribute('aria-label') && l.getAttribute('aria-activedescendant')?.startsWith('gv-opt-') && !!document.getElementById(l.getAttribute('aria-activedescendant')); })()`)) === true);
await t.ev(`${q('[data-testid="gv-list"]')}.focus()`);
await t.key('Home');
await sleep(300);
t.check('Home vai ao primeiro commit', (await sel()) === log[0].subject, await sel());
await t.key('ArrowDown');
await t.key('ArrowDown');
await sleep(300);
t.check('seta para baixo move a seleção (duas vezes: o terceiro commit)', (await sel()) === log[2].subject, await sel());
await t.key('ArrowUp');
await sleep(200);
t.check('seta para cima volta um', (await sel()) === log[1].subject);
await t.key('End');
await sleep(300);
t.check('End vai ao último commit', (await sel()) === log.at(-1).subject, await sel());
await t.key('Home');
await t.key('ArrowDown');
await sleep(500);
t.check('o detalhe do commit selecionado acompanha (assunto no painel ao lado)', (await t.text(`${P}[data-testid="gv-detail"] h3`)) === log[1].subject, await t.text(`${P}[data-testid="gv-detail"] h3`));
await t.key('Enter');
await sleep(200);
t.check('Enter leva o foco ao detalhe', (await t.ev(`document.activeElement?.dataset?.testid`)) === 'gv-detail');
await t.ev(`${q('[data-testid="gv-list"]')}.focus()`);
await t.key('c', 2);
await sleep(400);
t.check('Ctrl+C copia o hash do commit selecionado', (await (await fetch(`${t.base}/clipboard`)).text()) === log[1].hash, await (await fetch(`${t.base}/clipboard`)).text());
await t.ev(`${q('[data-testid="gv-row"][aria-selected="true"] [data-testid="gv-hash"]')}.click()`);
await sleep(300);
t.check('clicar no hash também copia, com aviso curto', (await t.text(`${P}.gv__note`)) === 'Hash copiado ✓');

// --- menu da linha: teclado e criar branch aqui ---------------------------------------------------------------------------------------------------------------------------------
await t.ev(`${q('[data-testid="gv-list"]')}.focus()`);
await t.key('F10', 8);
await t.until(`document.querySelector('.ctx')`, 4000);
const items = await t.ev(`[...document.querySelectorAll('.ctx__item')].map((b) => b.textContent.trim())`);
t.check('Shift+F10 abre o menu da linha, com o foco no primeiro item', JSON.stringify(items) === JSON.stringify(['Copiar hash', 'Copiar a mensagem', 'Criar branch aqui…', 'Criar tag aqui', 'Rebase interativo a partir daqui', 'Cherry-pick', 'Reverter']) && (await t.ev(`document.activeElement?.textContent.trim()`)) === 'Copiar hash', [items, await t.ev(`document.activeElement?.textContent.trim()`)]);
await t.key('ArrowDown');
await t.key('Enter');
await sleep(400);
t.check('"Copiar a mensagem" copia o assunto do commit', (await (await fetch(`${t.base}/clipboard`)).text()) === log[1].subject, await (await fetch(`${t.base}/clipboard`)).text());
const alvo = log[3];
await t.ev(`${q(`[data-testid="gv-row"][data-hash="${alvo.hash}"]`)}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300 }))`);
await t.until(`document.querySelector('.ctx')`, 4000);
await t.ev(`[...document.querySelectorAll('.ctx__item')].find((b) => /Criar branch aqui/.test(b.textContent)).click()`);
await t.until(`document.querySelector('[data-testid="gv-branch-dialog"]')`, 4000);
t.check('o botão direito numa linha abre o menu daquela linha, e "Criar branch aqui…" abre o diálogo com o commit', /[0-9a-f]{7}/.test(await t.text('[data-testid="gv-branch-dialog"]')) && (await t.text('[data-testid="gv-branch-dialog"]')).includes(alvo.subject));
await t.ev(`(() => { const i = document.querySelector('[data-testid="gv-branch-name"]'); i.value = 'nova-aqui'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await t.ev(`document.querySelector('[data-testid="gv-branch-create"]').click()`);
await sleep(1500);
t.check('a branch nasce no commit escolhido (conferido no git), sem trocar a branch atual', git(R, 'rev-parse', 'nova-aqui').trim() === alvo.hash && git(R, 'branch', '--show-current').trim() === 'main');
t.check('o diálogo fecha e a lista ganha o chip da nova branch', (await t.count('[data-testid="gv-branch-dialog"]')) === 0 && (await t.until(`[...document.querySelectorAll(${lit(P + '[data-testid="gv-row"][data-hash="' + alvo.hash + '"] [data-chip="local"]')})].some((c) => /nova-aqui/.test(c.textContent))`, 8000)));
await t.shot('grafo-lista-menu');
t.check('sem erro de página', t.errors().filter((e) => !/favicon|Failed to fetch/.test(e)).length === 0, t.errors());
t.close();
