// Cores semânticas nos botões (prop `tone` do GnButton): sólido = ação principal, accent = navegar/consultar, success = confirmar, warn = atenção,
// danger = destrutivo, neutro = o resto (inclui "Atualizar"). Também confere os componentes do ui-kit usados nas telas: GnIconButton, GnButtonGroup, GnSegmented.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
const root = tmpRoot('gn-tone-');
const repo = mkRepo(root, 'tonerepo');
writeFileSync(join(repo, 'a.txt'), 'um\ndois\n');

/** Cor de um token CSS em `rgb(r, g, b)`, resolvida pelo próprio navegador. */
const token = (name) => t.ev(`(() => { const e = document.createElement('i'); e.style.color = 'var(${name})'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
const css = (sel, prop) => t.ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).${prop}`);
const btn = (text) => `[...document.querySelectorAll('button.gn-btn')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const btnCss = (text, prop) => t.ev(`getComputedStyle(${btn(text)}).${prop}`);
const btnHas = (text, cls) => t.ev(`${btn(text)}.classList.contains(${JSON.stringify(cls)})`);
/** Botão só de ícone: sem texto visível, achado pelo aria-label. */
const ibtn = (label) => `document.querySelector('button.gn-btn[aria-label=${JSON.stringify(label)}]')`;
const ibtnCss = (label, prop) => t.ev(`getComputedStyle(${ibtn(label)}).${prop}`);
const ibtnHas = (label, cls) => t.ev(`${ibtn(label)}.classList.contains(${JSON.stringify(cls)})`);

// abrir o repositório também o cataloga: a linha dele (Abrir / Buscar / Pull / Remover) aparece na lista
await t.until(`document.querySelector('.conn__bar')`, 15000);
await t.openRepo(repo, 'tonerepo');
await t.until(`document.querySelector('.rv__btns')`, 15000);

const accent = await token('--gn-accent');
const accentSolid = await token('--gn-accent-solid');
const success = await token('--gn-success');

// --- tela do repositório ----------------------------------------------------------------------------------------------------
t.check('Atualizar: neutro (recarregar não pede destaque)', await btnHas('Atualizar', 'gn-btn--tone-neutral'));
for (const [label, name] of [['Grafo', 'Grafo'], ['Ferramentas', 'Ferramentas']]) {
  t.check(`${label}: tom accent`, await btnHas(name, 'gn-btn--tone-accent'));
  t.check(`${label}: texto clareado na cor do tom (não é o texto neutro)`, (await btnCss(name, 'color')) !== (await token('--gn-text')));
}
t.check('Conflitos sem conflito: neutro', await btnHas('Conflitos', 'gn-btn--tone-neutral'));
t.check('Commit: tom success sólido', (await t.ev(`!!document.querySelector('button.gn-btn--solid.gn-btn--tone-success')`)) === true);
t.check('Commit: fundo é o verde do tema', (await css('button.gn-btn--solid.gn-btn--tone-success', 'backgroundColor')) === success, [await css('button.gn-btn--solid.gn-btn--tone-success', 'backgroundColor'), success]);
t.check('Commit: texto escuro sobre o verde (contraste)', (await css('button.gn-btn--solid.gn-btn--tone-success', 'color')) !== 'rgb(255, 255, 255)');
t.check('há um único botão de commit verde', (await t.count('button.gn-btn--solid.gn-btn--tone-success')) === 1);
t.check('os botões de navegação têm contorno na cor do accent, não cinza', (await btnCss('Grafo', 'borderTopColor')) !== (await token('--gn-border')));

// --- navegação do diff e seletores (GnButtonGroup, GnIconButton, GnSegmented) ----------------------------------------------------
const groups = await t.ev(`[...document.querySelectorAll('.rv__toolbar .gn-btn-group')].map((g) => g.getAttribute('aria-label'))`);
t.check('barra do diff: grupo de arquivo antes do de diferença', JSON.stringify(groups) === JSON.stringify(['Arquivos', 'Diferenças']), groups);
t.check('os 4 botões de navegação são só ícone, com aria-label e tooltip', (await t.ev(`[...document.querySelectorAll('.rv__toolbar .gn-btn-group button')].every((b) => b.getAttribute('aria-label') && b.title && !b.textContent.trim() && b.querySelector('svg.gn-icon'))`)) === true);
t.check('há 4 botões de navegação', (await t.count('.rv__toolbar .gn-btn-group button')) === 4);
t.check('a navegação continua neutra (sem cor)', (await t.ev(`[...document.querySelectorAll('.rv__toolbar .gn-btn-group button')].every((b) => b.classList.contains('gn-btn--tone-neutral'))`)) === true);
t.check('dois seletores segmentados na barra do diff', (await t.count('.rv__toolbar [role=radiogroup]')) === 2);
const activeSeg = `document.querySelector('.rv__toolbar [role=radiogroup] [aria-checked=true]')`;
t.check('seletor: a opção ativa é azul tingido, não o azul sólido do botão principal', (await t.ev(`getComputedStyle(${activeSeg}).backgroundColor`)) !== accentSolid && (await t.ev(`getComputedStyle(${activeSeg}).backgroundColor`)) !== accent);
t.check('seletor: só a opção ativa entra na ordem do Tab', (await t.ev(`[...document.querySelectorAll('.rv__toolbar [role=radiogroup]')].every((g) => [...g.querySelectorAll('[role=radio]')].filter((r) => r.tabIndex === 0).length === 1)`)) === true);
await t.ev(`[...document.querySelectorAll('.rv__toolbar [role=radio]')].find((r) => r.textContent.trim() === 'Unificado').click()`);
await sleep(200);
t.check('seletor: clicar em Unificado marca a opção', (await t.ev(`[...document.querySelectorAll('.rv__toolbar [role=radio]')].find((r) => r.textContent.trim() === 'Unificado').getAttribute('aria-checked')`)) === 'true');
await t.ev(`[...document.querySelectorAll('.rv__toolbar [role=radio]')].find((r) => r.textContent.trim() === 'Lado a lado').click()`);
t.check('o azul sólido tem o fundo do token acessível (--gn-accent-solid)', accentSolid !== accent, [accentSolid, accent]);
await t.shot('botoes-repositorio');

// --- lista de repositórios ----------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector('.core__tabs [role=tab]').click()`); // volta à lista
await sleep(500);
await t.until(`document.querySelector('.conn__bar')`, 10000);
t.check('Atualizar status: neutro', await btnHas('Atualizar status', 'gn-btn--tone-neutral'));
t.check('Buscar todos: tom accent', await btnHas('Buscar todos', 'gn-btn--tone-accent'));
t.check('Atualizar seguros: primary, fundo no azul sólido acessível', (await btnCss('Atualizar seguros', 'backgroundColor')) === accentSolid, [await btnCss('Atualizar seguros', 'backgroundColor'), accentSolid]);
t.check('Abrir (linha): azul de contorno, não sólido (20 linhas não competem com o botão principal)', (await btnHas('Abrir', 'gn-btn--tone-accent')) && !(await btnHas('Abrir', 'gn-btn--solid')));
t.check('Buscar (linha): neutro', (await t.ev(`[...document.querySelectorAll('button.gn-btn')].find((b) => b.textContent.trim() === 'Buscar').classList.contains('gn-btn--tone-neutral')`)) === true);
t.check('Remover: só ícone, leve e vermelho (GnIconButton ghost + danger)', (await ibtnHas('Remover', 'gn-btn--tone-danger')) && (await ibtnHas('Remover', 'gn-btn--ghost-tone')));
t.check('Remover: sem texto, com aria-label e tooltip', (await t.ev(`(() => { const b = ${ibtn('Remover')}; return !b.textContent.trim() && !!b.title && !!b.querySelector('svg'); })()`)) === true);
t.check('Remover: sem borda em repouso (não enche a lista de vermelho)', (await ibtnCss('Remover', 'borderTopColor')) === 'rgba(0, 0, 0, 0)');
t.check('Remover: ícone na cor do perigo', (await ibtnCss('Remover', 'color')) !== (await token('--gn-text')));
t.check('botão neutro continua neutro (Adicionar caminho)', await btnHas('Adicionar caminho', 'gn-btn--tone-neutral'));
await t.shot('botoes-lista');
t.close();
