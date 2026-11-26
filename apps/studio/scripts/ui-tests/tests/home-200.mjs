// Tela inicial com 200 repositórios (#286): o primeiro cartão aparece logo, os resumos chegam em lotes sem travar a tela e a rolagem acompanha a taxa de quadros.
// As metas (primeiro cartão em 500 ms, rolagem a 60 quadros por segundo) são medidas e gravadas em medidas-home-200.json, ao lado das capturas; as verificações
// têm folga para máquina lenta e CI (o relatório do teste só leva OK ou falha).
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.send('Page.bringToFront'); // sem a janela na frente o navegador sem tela pausa os quadros (requestAnimationFrame) e não há o que medir
await t.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', 'dark'); localStorage.removeItem('gitnexus.home')`);

// um repositório de verdade copiado 200 vezes (a pasta .git copiada é um repositório independente): criar 200 pelo git levaria minutos
const N = 200;
const root = tmpRoot('gn-h200-');
const modelo = mkRepo(root, 'modelo', { files: { 'a.txt': 'um\n' } });
const pasta = join(root, 'todos');
mkdirSync(pasta);
for (let i = 0; i < N; i++) cpSync(modelo, join(pasta, `repo-${String(i).padStart(3, '0')}`), { recursive: true });
t.check('a varredura da pasta raiz cataloga os 200', (await t.ev(`window.gitNexus.scanDirectories([${lit(pasta)}]).then((l) => l.length)`)) === N);

// instrumentos dentro da página: quando o primeiro cartão aparece (desde a navegação) e o tempo entre quadros
await t.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__m = { conn: 0, first: 0, gaps: [], last: 0 };
    const mo = new MutationObserver(() => { if (!window.__m.conn && document.querySelector('.conn')) window.__m.conn = performance.now(); if (!window.__m.first && document.querySelector('li.repo')) { window.__m.first = performance.now(); mo.disconnect(); } });
    document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { childList: true, subtree: true }));
    const loop = (now) => { if (window.__m.last) window.__m.gaps.push(now - window.__m.last); window.__m.last = now; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);`,
});
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length === ${N}`, 30000);
const first = await t.ev('window.__m.first');
const conn = await t.ev('window.__m.conn');
await t.ev('window.__m.gaps = []'); // daqui em diante só o trabalho dos lotes (a partida do app, com o JavaScript carregando, já ficou para trás)
const t0 = Date.now();
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 120000);
const statusMs = Date.now() - t0;
const gaps = await t.ev('window.__m.gaps.slice(5)');
const worst = Math.max(0, ...gaps);
const p95 = (g) => [...g].sort((a, b) => a - b)[Math.floor(g.length * 0.95)] ?? 0;
const medidas = { primeiroCartaoDesdeANavegacaoMs: Math.round(first), primeiroCartaoDesdeATelaInicialMs: Math.round(first - conn), resumosDosDuzentosMs: statusMs, duranteOsLotes: { piorQuadroMs: Math.round(worst), p95QuadroMs: Math.round(p95(gaps)) } };
t.check('o primeiro cartão aparece em até 500 ms depois da tela inicial montar (e em até 1,5 s da navegação, folga para a partida a frio e o CI)', first > 0 && conn > 0 && first - conn < 500 && first < 1500, [first, conn]);
t.check('os resumos dos 200 chegam em lotes e a tela não congela (há quadros medidos e nenhum passa de 250 ms)', gaps.length > 20 && worst < 250, [gaps.length, Math.round(worst), statusMs]);
t.check('o contador diz "Mostrando 200 de 200"', (await t.text('[data-testid="home-count"]')) === 'Mostrando 200 de 200');
t.check('cada cartão trouxe o último commit (os 200 resumos chegaram)', (await t.count('[data-testid="home-commit"] .repo__msg')) === N);

// rolagem: um passeio de 2 s pela lista, medindo o tempo entre quadros
const scroller = `(() => { let e = document.querySelector('.conn'); while (e && !(e.scrollHeight > e.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(e).overflowY))) e = e.parentElement; return e || document.scrollingElement; })()`;
const scrollRun = async (label) => {
  await t.ev(`${scroller}.scrollTo(0, 0)`);
  await sleep(500);
  const r = await t.ev(`new Promise((res) => {
    const el = ${scroller}; const max = el.scrollHeight - el.clientHeight; const g = []; let last = 0; let t0 = 0;
    const f = (n) => { if (!t0) t0 = n; if (last) g.push(n - last); last = n; const k = Math.min(1, (n - t0) / 2000); el.scrollTop = max * k; if (k < 1) requestAnimationFrame(f); else res({ g, max }); };
    requestAnimationFrame(f);
  })`);
  const g = r.g.slice(2);
  const fps = g.length ? Math.round(1000 / (g.reduce((a, b) => a + b, 0) / g.length)) : 0;
  medidas[label] = { quadrosPorSegundo: fps, p95QuadroMs: Math.round(p95(g)), piorQuadroMs: Math.round(Math.max(0, ...g)), quadros: g.length, alturaRolada: Math.round(r.max) };
  return { fps, frames: g.length, max: r.max };
};
const conf = await scrollRun('rolagemConfortavel');
t.check('a lista de 200 cartões rola (há o que rolar) e acompanha a taxa de quadros: mais de 30 por segundo, mesmo sem placa de vídeo', conf.max > 2000 && conf.frames > 20 && conf.fps >= 30, conf);
await t.ev(`document.querySelector('[data-testid="home-density"] [role=radio]:last-child').click()`);
await sleep(500);
const tab = await scrollRun('rolagemTabela');
t.check('a tabela de 200 linhas também rola sem engasgar', tab.frames > 20 && tab.fps >= 30, tab);
await t.shot('home-200');
writeFileSync(join(OUT, 'medidas-home-200.json'), JSON.stringify(medidas, null, 2));
t.check('sem erro de página', t.errors().filter((e) => !/favicon|Failed to fetch/.test(e)).length === 0, t.errors());
t.close();
