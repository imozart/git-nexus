// Layout com a fonte monoespaçada (JetBrains Mono): percorre as telas em pt-BR e en, nas janelas 1360x860 (padrão) e 960x600 (mínimo), com a fonte
// da interface padrão e em "Sistema", e procura o que a fonte larga costuma quebrar: rolagem horizontal da página, texto cortado em silêncio
// (overflow oculto sem reticências), botão com conteúdo maior que a caixa e textos irmãos que se sobrepõem nas barras.
// Imprime o que falhou (tela, idioma, janela, seletor) para facilitar o ajuste.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);

// ---------- repositório de demonstração: um remoto, vários commits, arquivos alterados e um novo ----------
const root = tmpRoot('gn-layout-');
const remote = join(root, 'remote.git');
git(root, 'init', '--bare', '-b', 'main', remote);
const repo = mkRepo(root, 'layoutrepo', { files: { 'a.txt': 'um\ndois\ntres\nquatro\ncinco\n', 'src-componentes-muito-longos-de-nome.ts': 'export const x = 1;\n' } });
git(repo, 'remote', 'add', 'origin', remote);
git(repo, 'push', '-q', '-u', 'origin', 'main');
git(repo, 'checkout', '-q', '-b', 'feat/uma-branch-com-um-nome-bem-comprido-para-testar');
writeFileSync(join(repo, 'b.txt'), 'b\n');
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'feat(escopo): um commit com uma mensagem razoavelmente comprida para a linha do grafo');
git(repo, 'tag', 'v1.0.0');
writeFileSync(join(repo, 'a.txt'), 'um\nDOIS\ntres\nquatro\ncinco\nseis\n');
writeFileSync(join(repo, 'src-componentes-muito-longos-de-nome.ts'), 'export const x = 2; // alterado\n');
writeFileSync(join(repo, 'novo-arquivo.txt'), 'arquivo novo\n');

// ---------- o detector, executado dentro da página ----------
const AUDIT = `(() => {
  const out = [];
  const name = (el) => (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + ' "' + (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 28) + '"');
  const de = document.documentElement;
  if (de.scrollWidth > window.innerWidth + 1) out.push('rolagem horizontal da página: ' + de.scrollWidth + ' > ' + window.innerWidth);
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('svg')) continue;
    const s = getComputedStyle(el);
    if (['hidden', 'clip'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 1 && s.textOverflow !== 'ellipsis' && el.textContent.trim() && !el.closest('.cm-editor')) {
      if (el.children.length === 0 || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) out.push('texto cortado sem reticências: ' + name(el) + ' (' + el.scrollWidth + ' > ' + el.clientWidth + ')');
    }
    if (el.classList.contains('gn-btn') && el.scrollWidth > el.clientWidth + 1) out.push('botão com conteúdo maior que a caixa: ' + name(el) + ' (' + el.scrollWidth + ' > ' + el.clientWidth + ')');
  }
  // itens das barras (superior e do repositório) que se sobrepõem: compara as folhas (botões, chips, textos), não só os filhos diretos,
  // porque um filho que transborda a própria caixa não aparece na caixa dele
  const leaves = (bar) => [...bar.querySelectorAll('button, .gn-btn, .bp, .rv__path, strong, .gn-badge, .gn-tab, kbd, .upd > *')].filter((e) => visible(e) && !e.parentElement.closest('button, .gn-btn, .bp'));
  for (const bar of document.querySelectorAll('.core > header, .rv__head, .upd')) {
    if (!visible(bar)) continue;
    const kids = leaves(bar);
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      if (kids[i].contains(kids[j]) || kids[j].contains(kids[i])) continue;
      const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 2 && oy > 2) out.push('sobreposição na barra: ' + name(kids[i]) + ' x ' + name(kids[j]));
    }
    const r = bar.getBoundingClientRect();
    for (const k of kids) { const kr = k.getBoundingClientRect(); if (kr.right > window.innerWidth + 1 || kr.right > r.right + 1 && getComputedStyle(bar).overflowX !== 'visible') out.push('item fora da barra: ' + name(k)); }
  }
  // texto espremido: uma coluna tão estreita que a palavra quebra quase letra por letra
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('svg, .cm-editor')) continue;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue;
      const txt = n.textContent.trim();
      if (txt.length < 5) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const lines = new Set([...rg.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size;
      if (lines >= 4 && lines >= txt.length * 0.5) out.push('texto espremido (uma letra por linha): ' + name(el) + ' (' + lines + ' linhas)');
    }
  }
  return out.slice(0, 12);
})()`;

const WINDOWS = [[1360, 860], [960, 600]];
const setWindow = (w, h) => t.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
const reload = async () => {
  await t.ev('location.reload()');
  await t.until(`document.querySelector('.core')`, 15000);
  await sleep(700);
};
const audit = async (screen, locale, w, h, fontUi) => {
  await sleep(500);
  const found = await t.ev(AUDIT);
  const key = `${screen} | ${locale} | ${w}x${h} | ${fontUi}`;
  t.check(`sem quebra de layout: ${key}`, Array.isArray(found) && found.length === 0, found);
  if (process.env.GN_LAYOUT_SHOTS) await t.shot(`layout-${screen}-${locale}-${w}-${fontUi}`.replace(/[^\w-]+/g, '_'));
};
const clickText = (sel, text) => t.ev(`(() => { const b = [...document.querySelectorAll(${lit(sel)})].find((e) => e.textContent.trim().startsWith(${lit(text)})); if (!b) return false; b.click(); return true; })()`);
const closeFloating = async () => {
  await t.key('Escape');
  await sleep(250);
};

async function pass(locale, fontUi) {
  await t.ev(`localStorage.setItem('gitnexus.locale', ${lit(locale)}); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.fontUi', ${lit(fontUi)}); localStorage.setItem('gitnexus.showGitLog', '0')`);
  await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
  for (const [w, h] of WINDOWS) {
    await setWindow(w, h);
    await reload();
    // início
    await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
    await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando|loading/i.test(r.textContent))`, 30000);
    await audit('inicio', locale, w, h, fontUi);
    // paleta de comandos
    await t.key('k', 2);
    await t.until(`document.querySelector('.cp__input')`, 5000);
    await audit('paleta', locale, w, h, fontUi);
    await closeFloating();
    // repositório (com um arquivo aberto no diff)
    await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === 'layoutrepo').querySelector('.repo__btns button').click()`);
    await t.until(`document.querySelector('.rv__btns')`, 20000);
    await t.until(`document.querySelector('.file__name')`, 20000);
    await sleep(800);
    await audit('repositorio', locale, w, h, fontUi);
    await t.ev(`document.querySelector('.file__name').click()`);
    await sleep(1200);
    await audit('repositorio-diff', locale, w, h, fontUi);
    // seletor de branch
    await t.ev(`document.querySelector('.bp__btn')?.click()`);
    await sleep(500);
    await audit('seletor-de-branch', locale, w, h, fontUi);
    await closeFloating();
    // abas: grafo, ferramentas (algumas seções) e conflitos
    for (const [screen, sel, text] of [['grafo', '.rv__btns button', null], ['ferramentas', '.rv__btns button', null], ['conflitos', '.rv__btns button', null]]) {
      const idx = { grafo: 3, ferramentas: 4, conflitos: 5 }[screen];
      await t.ev(`document.querySelectorAll('.rv__btns button')[${idx}]?.click()`);
      await sleep(1200);
      await audit(screen, locale, w, h, fontUi);
      if (screen === 'ferramentas') {
        await t.ev(`document.querySelector('[data-testid="tools-more-toggle"][aria-expanded="false"]')?.click()`); // as ferramentas que o repositório não usa ficam recolhidas
        const sections = await t.ev(`[...document.querySelectorAll('.tools__nav [role="tab"]')].map((b) => b.textContent.trim())`);
        for (let i = 0; i < (sections?.length ?? 0); i++) {
          await t.ev(`[...document.querySelectorAll('.tools__nav [role="tab"]')][${i}]?.click()`);
          await sleep(700);
          await audit(`ferramentas-${i}`, locale, w, h, fontUi);
        }
      }
      // volta para a aba do repositório
      await t.ev(`[...document.querySelectorAll('.gn-tab')].find((x) => x.textContent.includes('layoutrepo'))?.click()`);
      await sleep(500);
    }
  }
}

for (const fontUi of ['jetbrains', 'system']) for (const locale of ['pt-BR', 'en']) await pass(locale, fontUi);

await t.ev(`localStorage.removeItem('gitnexus.fontUi')`);
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
