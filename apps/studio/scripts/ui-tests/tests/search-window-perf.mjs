// Desempenho da janela de pesquisa (Ctrl+F): 5 mil resultados na lista virtualizada (poucas linhas no DOM, rolagem fluida), a interface sem travar
// enquanto os lotes chegam (tarefas longas medidas na própria página) e um arquivo de 30 mil linhas aberto no editor de baixo com o destaque.
// As medidas vão para um arquivo à parte (search-window-perf-metrics.json), não para o relatório (qualquer valor que não seja "OK" reprova).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
const metrics = {};
process.on('exit', () => {
  console.log(JSON.stringify(report, null, 2));
  try {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'search-window-perf-metrics.json'), JSON.stringify(metrics, null, 2));
  } catch {
    /* sem pasta de saída */
  }
});
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.removeItem('gitnexus.searchWindow')`);

// 600 arquivos x 12 ocorrências = 7200 (a janela pede 5000) e um arquivo de 30 mil linhas com UMA ocorrência de "zzfoo"
const root = tmpRoot('gn-swp-');
const repo = mkRepo(root, 'perf', { files: { 'a.txt': 'um\n' } });
const FILES = 600;
const PER = 12;
for (let i = 0; i < FILES; i++) {
  const dir = join(repo, 'src', 'd' + (i % 20));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `f${i}.ts`), Array.from({ length: PER }, (_, k) => `export const foo${k} = ${i * PER + k}; // foo ${k}`).join('\n') + '\n');
}
const LINES = 30_000;
writeFileSync(join(repo, 'grande.ts'), Array.from({ length: LINES }, (_, i) => (i === 21_000 ? 'const zzfoo = "alvo";' : `const linha${i} = ${i}; // enchimento`)).join('\n') + '\n');
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'feat: base');

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === 'perf')`, 20000);
await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'perf').querySelector('.repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);
await sleep(800);

const W = '[data-testid="search-window"]';
const F = `${W} [data-testid="sf-input"]`;
await t.key('f', 2);
await t.until(`document.querySelector(${lit(W)})`, 5000);
await t.send('Page.bringToFront');

// ---- 5 mil resultados -------------------------------------------------------------------------------------------------------------------------------------
// observa as tarefas longas (> 50 ms) da página desde antes de digitar, e mede o tempo até o 1º resultado e até o fim, dentro da própria página
await t.ev(`(() => {
  window.__long = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); } catch {}
  window.__t = {};
  const t0 = performance.now();
  window.__t.start = t0;
  const iv = setInterval(() => {
    if (!window.__t.first && document.querySelector('[data-testid="sw-row"]')) window.__t.first = Math.round(performance.now() - t0);
    const c = document.querySelector('[data-testid="sw-count"]')?.textContent ?? '';
    if (/ocorrências em/.test(c)) { window.__t.done = Math.round(performance.now() - t0); clearInterval(iv); }
  }, 4);
  return true;
})()`);
await t.ev(`(() => { const e = document.querySelector(${lit(F)}); e.focus(); e.select(); })()`);
await t.send('Input.insertText', { text: 'foo' });
await t.until(`window.__t.done`, 60000);
const times = await t.ev('window.__t');
const longs = await t.ev('window.__long');
metrics.firstResultMs = times.first;
metrics.doneMs = times.done;
metrics.longTasks = longs;
metrics.maxLongTaskMs = longs.length ? Math.max(...longs) : 0;
const counter = await t.ev(`document.querySelector('[data-testid="sw-count"]').textContent.replace(/\\s+/g, ' ').trim()`);
t.check('5 mil ocorrências (o limite da janela), em centenas de arquivos', /^5\.?000 ocorrências em \d+ arquivos/.test(counter), counter);
t.check('avisa que há mais do que foi mostrado', /Mostrando as primeiras 5000 ocorrências.*Carregar mais/.test((await t.text('[data-testid="sw-notes"]')) ?? ''), await t.text('[data-testid="sw-notes"]'));
const totalRows = await t.ev(`Math.round(document.querySelector('.sw__spacer').getBoundingClientRect().height / 24)`);
const mounted = await t.count('.sw__row');
metrics.totalRows = totalRows;
metrics.mountedRows = mounted;
t.check('a lista é virtualizada: milhares de linhas no total e só algumas dezenas no DOM', totalRows > 5000 && mounted < 60, { totalRows, mounted });
t.check('o primeiro resultado aparece em até 1,5 s da digitação (inclui os 250 ms de espera e o Git a frio)', times.first <= 1500, times.first);
t.check('a interface não trava enquanto os lotes chegam: nenhuma tarefa longa acima de 120 ms (meta: 50 ms)', metrics.maxLongTaskMs <= 120, longs);
await t.shot('pesquisa-5mil');

// ---- rolagem: quadros durante 1,5 s de rolagem contínua --------------------------------------------------------------------------------------------------
await t.send('Page.bringToFront');
const scroll = await t.ev(`new Promise((res) => {
  const el = document.querySelector('[data-testid="sw-list"]');
  const frames = [];
  let last = performance.now();
  const end = last + 1500;
  const step = (now) => {
    frames.push(now - last);
    last = now;
    el.scrollTop += 70;
    if (now < end) requestAnimationFrame(step); else res(frames.slice(2));
  };
  requestAnimationFrame(step);
})`);
const sorted = [...scroll].sort((a, b) => a - b);
const fps = scroll.length / (scroll.reduce((a, b) => a + b, 0) / 1000);
metrics.scrollFrames = scroll.length;
metrics.scrollFps = Math.round(fps);
metrics.scrollP95Ms = Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0);
metrics.scrollMaxMs = Math.round(sorted[sorted.length - 1] ?? 0);
t.check('rolar a lista de 5 mil resultados mantém a fluidez (≥ 45 quadros por segundo; meta 60)', fps >= 45, { fps: Math.round(fps), p95: metrics.scrollP95Ms, max: metrics.scrollMaxMs });
t.check('depois de rolar, as linhas visíveis continuam sendo ocorrências com texto (nada em branco)', (await t.ev(`[...document.querySelectorAll('.sw__row')].every((r) => r.textContent.trim().length > 0)`)) === true);

// ---- 30 mil linhas no editor de baixo ---------------------------------------------------------------------------------------------------------------------
await t.ev(`(() => { const e = document.querySelector(${lit(F)}); e.focus(); e.select(); })()`);
await t.send('Input.insertText', { text: 'zzfoo' });
await t.until(`document.querySelector('[data-testid="sw-count"]')?.textContent.startsWith('1 ocorrência')`, 30000);
await sleep(300);
const open = t.ev(`new Promise((res) => {
  const t0 = performance.now();
  const iv = setInterval(() => {
    if (document.querySelector('[data-testid="sw-path"]')?.textContent.trim() === 'grande.ts' && document.querySelector('${W} .cm-gn-find')) { clearInterval(iv); res(Math.round(performance.now() - t0)); }
  }, 4);
})`);
await t.ev(`document.querySelector('[data-testid="sw-row"]').click()`);
metrics.open30kMs = await open;
t.check('arquivo de 30 mil linhas abre no editor de baixo, já com a ocorrência destacada, em até 500 ms', metrics.open30kMs <= 500, metrics.open30kMs);
t.check('o editor está na linha da ocorrência (rolou até ela)', (await t.ev(`document.querySelector('${W} .cm-gn-find')?.textContent`)) === 'zzfoo');
await t.shot('pesquisa-30mil');

// ---- 20 mil arquivos (opcional) -----------------------------------------------------------------------------------------------------------------------------
// GN_SEARCH_BIG=<pasta> aponta para o repositório gerado por `GN_SEARCH_FILES=20000 GN_SEARCH_KEEP=1 npx vitest run packages/git-core/test/search-run.test.ts -t "arquivos numerosos"`
// (fica em <TEMP>/gitnexus-search-big-20000; criá-lo leva minutos, então não roda por padrão nem na CI). Mede a interface inteira sobre ele.
const BIG = process.env.GN_SEARCH_BIG;
if (BIG) {
  const name = BIG.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  await t.key('Escape');
  await sleep(300);
  await t.ev(`window.gitNexus.addRepositoryPath(${lit(BIG)})`);
  await t.ev('location.reload()');
  await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)})`, 30000);
  await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)}).querySelector('.repo__btns button').click()`);
  await t.until(`document.querySelector('.rv__btns')`, 30000);
  await sleep(1500);
  await t.key('f', 2);
  await t.until(`document.querySelector(${lit(W)})`, 5000);
  await t.send('Page.bringToFront');
  // aquece o cache do sistema (a meta vale "com o cache quente") e recomeça do zero
  await t.ev(`(() => { const e = document.querySelector(${lit(F)}); e.focus(); e.select(); })()`);
  await t.send('Input.insertText', { text: 'palha' });
  await t.until(`/ocorrências em/.test(document.querySelector('[data-testid="sw-count"]')?.textContent ?? '')`, 60000);
  // esvazia o campo e espera a lista limpar: a medição seguinte só pode enxergar os resultados da busca nova (senão marcaria 10 ms)
  await t.ev(`(() => { const e = document.querySelector(${lit(F)}); e.focus(); e.select(); })()`);
  await t.key('Delete');
  await t.until(`!document.querySelector('[data-testid="sw-row"]') && !/ocorrências em/.test(document.querySelector('[data-testid="sw-count"]')?.textContent ?? '')`, 10000);
  await t.ev(`(() => {
    window.__long = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); } catch {}
    window.__t = {};
    const t0 = performance.now();
    const iv = setInterval(() => {
      if (!window.__t.first && document.querySelector('[data-testid="sw-row"]')) window.__t.first = Math.round(performance.now() - t0);
      if (/ocorrências em/.test(document.querySelector('[data-testid="sw-count"]')?.textContent ?? '')) { window.__t.done = Math.round(performance.now() - t0); clearInterval(iv); }
    }, 4);
    return true;
  })()`);
  await t.ev(`(() => { const e = document.querySelector(${lit(F)}); e.focus(); e.select(); })()`);
  await t.send('Input.insertText', { text: 'AGULHA' });
  await t.until(`window.__t.done`, 60000);
  const big = await t.ev('window.__t');
  const bigLongs = await t.ev('window.__long');
  metrics.bigFiles = 20000;
  metrics.bigFirstResultMs = big.first;
  metrics.bigDoneMs = big.done;
  metrics.bigMaxLongTaskMs = bigLongs.length ? Math.max(...bigLongs) : 0;
  const bigCount = await t.ev(`document.querySelector('[data-testid="sw-count"]').textContent.replace(/\\s+/g, ' ').trim()`);
  t.check('20 mil arquivos: a busca devolve o limite da janela (5000 ocorrências)', /^5\.?000 ocorrências em \d+ arquivos/.test(bigCount), bigCount);
  t.check('20 mil arquivos: primeiro resultado em até 1,5 s da digitação (inclui os 250 ms de espera) e busca completa em até 3 s', big.first <= 1500 && big.done <= 3000, big);
  t.check('20 mil arquivos: a interface não trava (nenhuma tarefa longa acima de 120 ms; meta 50 ms)', metrics.bigMaxLongTaskMs <= 120, bigLongs);
  // uma busca nova substitui a anterior: digita outra coisa no meio da primeira e só a segunda aparece
  await t.ev(`(() => { const e = document.querySelector(${lit(F)}); e.focus(); e.select(); })()`);
  await t.send('Input.insertText', { text: 'palha' });
  await sleep(320); // passou a espera de 250 ms: a busca de "palha" está rodando
  await t.ev(`(() => { const e = document.querySelector(${lit(F)}); e.focus(); e.select(); })()`);
  await t.send('Input.insertText', { text: 'v7_49 =' });
  await t.until(`/ocorrências? em/.test(document.querySelector('[data-testid="sw-count"]')?.textContent ?? '') && !document.querySelector('[data-testid="sw-stop"]')`, 30000);
  const second = await t.ev(`[...document.querySelectorAll('[data-testid="sw-row"]')].map((r) => r.textContent).join('|')`);
  t.check('20 mil arquivos: uma busca nova no meio da anterior deixa só os resultados da segunda', /v7_49/.test(second) && !/palha/.test(second), second.slice(0, 200));
  await t.shot('pesquisa-20mil');
}

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
