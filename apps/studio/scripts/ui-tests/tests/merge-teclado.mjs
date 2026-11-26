// Resolvedor de conflitos (issue #231, fase 7), com git de verdade: acessibilidade. Cada conflito é uma região nomeada ("Conflito 3 de 7, linhas 42 a 58"), a escolha
// é anunciada por uma região viva, o foco é visível e o fluxo inteiro (decidir, desfazer, gravar) se completa só com o teclado, com teclas de verdade.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.setItem('gitnexus.newConflictResolver', '1')`);
for (const k of ['sideBySide', 'ignoreSpace', 'invisibles']) await t.ev(`localStorage.removeItem('gitnexus.mergeView.${k}')`);

const FILE = 'config.js';
const file = (a, b, c) => ['// configuração', 'const nome = 1;', a, 'const um = 1;', 'const dois = 2;', 'const tres = 3;', 'const quatro = 4;', b, 'const cinco = 5;', 'const seis = 6;', 'const sete = 7;', 'const oito = 8;', c, 'export { nome };', ''].join('\n');
const BASE = file('const timeout = 10;', 'const retries = 1;', 'const modo = "a";');
const MINE = file('const timeout = 20;', 'const retries = 2;', 'const modo = "b";');
const THEIRS = file('const timeout = 30;', 'const retries = 3;', 'const modo = "c";');

const root = tmpRoot('gn-kb-');
const repo = mkRepo(root, 'teclado', { files: { [FILE]: BASE } });
const put = (c, m) => {
  writeFileSync(join(repo, FILE), c);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', m);
};
git(repo, 'checkout', '-q', '-b', 'feat/config');
put(MINE, 'feat: configuração da feature');
git(repo, 'checkout', '-q', 'main');
put(THEIRS, 'feat: configuração da main');
git(repo, 'checkout', '-q', 'feat/config');
try {
  git(repo, 'merge', 'main');
} catch {
  /* conflito: é o esperado */
}

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="op-banner"]')`, 20000);
await t.ev(`[...document.querySelectorAll('[data-testid="repo-view-tab"]')].find((b) => /Conflitos/.test(b.textContent))?.click()`);
await t.until(`document.querySelectorAll('[data-testid="mr-card"]').length === 3`, 15000);
await sleep(500);

const q = (js) => t.ev(`(() => { ${js} })()`);
const states = () => q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => c.dataset.state)`);
const live = () => q(`return document.querySelector('[data-testid="mr-live"]')?.textContent ?? ''`);

// --- regiões nomeadas e região viva ----------------------------------------------------------------------------------------------------------------
const regions = await q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => ({ role: c.getAttribute('role'), name: c.getAttribute('aria-label') }))`);
t.check('cada conflito é uma região nomeada: "Conflito N de 3, linhas A a B"', regions.length === 3 && regions.every((r, i) => r.role === 'region' && new RegExp(`^Conflito ${i + 1} de 3, linhas? \\d+`).test(r.name ?? '')), regions);
const liveAttrs = await q(`const l = document.querySelector('[data-testid="mr-live"]'); return { role: l?.getAttribute('role'), live: l?.getAttribute('aria-live') }`);
t.check('existe uma região viva educada para os anúncios (role=status ou aria-live=polite)', liveAttrs.role === 'status' || liveAttrs.live === 'polite', liveAttrs);

// --- decidir só com o teclado ------------------------------------------------------------------------------------------------------------------------
await t.key('1', 1); // Alt+1: a minha, no conflito atual (o primeiro pendente)
await sleep(300);
t.check('Alt+1 decide o conflito atual com a minha e a região viva anuncia o resultado por conflito', JSON.stringify(await states()) === '["resolved","pending","pending"]' && /Conflito 1 resolvido/.test(await live()), { s: await states(), l: await live() });
const activeSeg = () => q(`return document.querySelector('.card--active')?.dataset.seg ?? null`);
const segs = await q(`return [...document.querySelectorAll('[data-testid="mr-card"]')].map((c) => c.dataset.seg)`);
t.check('depois de decidir, o foco de trabalho já passa ao próximo conflito pendente', (await activeSeg()) === segs[1], { a: await activeSeg(), segs });
await t.key('2', 1); // Alt+2: a da origin, no segundo
await sleep(300);
await t.key('3', 1); // Alt+3: as duas, no terceiro
await sleep(300);
t.check('Alt+2 (da origin) e Alt+3 (as duas) decidem os outros dois, cada um anunciado', JSON.stringify(await states()) === '["resolved","resolved","resolved"]' && /Conflito 3 resolvido/.test(await live()), { s: await states(), l: await live() });
await t.key('F7', 8); // Shift+F7: conflito anterior
await sleep(300);
t.check('Shift+F7 volta ao conflito anterior (o segundo)', (await activeSeg()) === segs[1], await activeSeg());
await t.key('z', 2); // Ctrl+Z
await sleep(300);
t.check('Ctrl+Z desfaz a última escolha e Ctrl+Y refaz', JSON.stringify(await states()) === '["resolved","resolved","pending"]');
await t.key('y', 2);
await sleep(300);
t.check('e Ctrl+Y refaz', JSON.stringify(await states()) === '["resolved","resolved","resolved"]');
await t.shot('teclado-decidido');

// --- ordem de tabulação e foco visível até "Marcar como resolvido" -----------------------------------------------------------------------------------
await q(`document.activeElement?.blur?.(); document.querySelector('[data-testid="mr-scroll"]').scrollTop = 0; return true`);
await q(`document.querySelector('[data-testid="mr-view"]')?.focus?.(); return true`);
const stops = [];
let reached = false;
for (let i = 0; i < 160 && !reached; i++) {
  await t.key('Tab');
  const s = await q(`const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { id: e.dataset.testid ?? e.tagName.toLowerCase(), ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none', top: Math.round(e.getBoundingClientRect().top) }`);
  if (s) stops.push(s);
  reached = s?.id === 'mr-resolve';
}
const noRing = stops.filter((s) => !s.ring).map((s) => s.id);
t.check('só com Tab o foco chega a "Marcar como resolvido"', reached, stops.map((s) => s.id).slice(-12));
t.check('todo elemento que recebe o foco por Tab tem foco visível (contorno ou sombra)', noRing.length === 0, [...new Set(noRing)]);
await t.shot('teclado-foco');
await t.key('Enter');
await t.until(`/foi marcado|resolvido/i.test(document.querySelector('.ok')?.textContent ?? '')`, 15000).catch(() => {});
await sleep(800);
const onDisk = readFileSync(join(repo, FILE), 'utf8');
t.check('Enter em "Marcar como resolvido" grava o arquivo: a minha, a da origin e as duas, sem marcador', onDisk === file('const timeout = 20;', 'const retries = 3;', 'const modo = "b";\nconst modo = "c";'), JSON.stringify(onDisk));
t.check('e o índice não tem mais conflito', git(repo, 'ls-files', '--unmerged').trim() === '');
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|A listener indicated an asynchronous response/.test(String(e)));
t.check('sem erro no console', appErrors.length === 0, appErrors);
t.close();
