// Cores semânticas nos botões (prop `tone` do GnButton): accent = atualizar/navegar, success = commit, warn = conflitos, danger = remover.
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

// abrir o repositório também o cataloga: a linha dele (Abrir / Buscar / Pull / Remover) aparece na lista
await t.until(`document.querySelector('.conn__bar')`, 15000);
await t.openRepo(repo, 'tonerepo');
await t.until(`document.querySelector('.rv__btns')`, 15000);

const accent = await token('--gn-accent');
const accentSolid = await token('--gn-accent-solid'); // fundo do azul sólido: mais escuro que o azul de bordas, para o texto branco passar de 4,5:1
const success = await token('--gn-success');

// --- tela do repositório ----------------------------------------------------------------------------------------------------
for (const [label, name] of [['Atualizar', 'Atualizar'], ['Grafo', 'Grafo'], ['Ferramentas', 'Ferramentas']]) {
  t.check(`${label}: tom accent`, await btnHas(name, 'gn-btn--tone-accent'));
  t.check(`${label}: texto clareado na cor do tom (não é o texto neutro)`, (await btnCss(name, 'color')) !== (await token('--gn-text')));
}
t.check('Conflitos sem conflito: neutro', await btnHas('Conflitos', 'gn-btn--tone-neutral'));
t.check('Commit: tom success sólido', (await t.ev(`!!document.querySelector('button.gn-btn--solid.gn-btn--tone-success')`)) === true);
t.check('Commit: fundo é o verde do tema', (await css('button.gn-btn--solid.gn-btn--tone-success', 'backgroundColor')) === success, [await css('button.gn-btn--solid.gn-btn--tone-success', 'backgroundColor'), success]);
t.check('Commit: texto escuro sobre o verde (contraste)', (await css('button.gn-btn--solid.gn-btn--tone-success', 'color')) !== 'rgb(255, 255, 255)');
t.check('há um único botão de commit verde', (await t.count('button.gn-btn--solid.gn-btn--tone-success')) === 1);
t.check('os botões de navegação têm contorno na cor do accent, não cinza', (await btnCss('Grafo', 'borderTopColor')) !== (await token('--gn-border')));
await t.shot('botoes-repositorio');

// --- lista de repositórios ----------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector('.core__tabs [role=tab]').click()`); // volta à lista
await sleep(500);
await t.until(`document.querySelector('.conn__bar')`, 10000);
t.check('Atualizar status: tom accent', await btnHas('Atualizar status', 'gn-btn--tone-accent'));
t.check('Buscar todos: tom accent', await btnHas('Buscar todos', 'gn-btn--tone-accent'));
t.check('Atualizar seguros: primary azul sólido', (await btnCss('Atualizar seguros', 'backgroundColor')) === accentSolid, [await btnCss('Atualizar seguros', 'backgroundColor'), accentSolid]);
t.check('Abrir: primary azul sólido', (await btnCss('Abrir', 'backgroundColor')) === accentSolid);
t.check('Remover: tom danger', await btnHas('Remover', 'gn-btn--tone-danger'));
t.check('Remover: texto avermelhado', (await btnCss('Remover', 'color')) !== (await token('--gn-text')));
t.check('Remover: contorno na cor do perigo', (await btnCss('Remover', 'borderTopColor')) !== (await token('--gn-border')));
t.check('botão neutro continua neutro (Adicionar caminho)', await btnHas('Adicionar caminho', 'gn-btn--tone-neutral'));
await t.shot('botoes-lista');
t.close();
