// Central de Configurações (#287), as seções novas: busca (pt-BR e en), abertura direta pela paleta, Git (identidade, assinatura e comportamento gravados com o
// `git config` do repositório), Atalhos (remapear, conflito, restaurar, valer na hora) e Avançado (exportar, importar, redefinir). Git de verdade; o escopo GLOBAL do
// git nunca é tocado aqui (só o do repositório de teste).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', 'dark')`);

const root = tmpRoot('gn-cfg-');
const repo = mkRepo(root, 'configrepo');
git(repo, 'config', 'core.fsmonitor', 'false');
const localCfg = (k) => {
  try {
    return git(repo, 'config', '--local', k).trim();
  } catch {
    return null; // não definida
  }
};
await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelector('li.repo')`, 25000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="repo-views"]')`, 20000);
await sleep(500);

const dlg = `document.querySelector('[role="dialog"][aria-modal="true"]')`;
const openSettings = async () => {
  await t.ev(`document.querySelector('[data-testid="settings-open"]').click()`);
  await t.until(dlg, 5000);
  await sleep(250);
};
const section = () => t.ev(`document.querySelector('.sd [role="tab"][aria-selected="true"]')?.dataset.section`);
const goSection = async (s) => {
  await t.ev(`document.querySelector('.sd [data-section="${s}"]').click()`);
  await sleep(300);
};
const type = async (sel, text) => {
  await t.ev(`(() => { const e = document.querySelector(${lit(sel)}); e.focus(); e.select?.(); })()`);
  await t.send('Input.insertText', { text });
};
const commit = (sel) => t.ev(`document.querySelector(${lit(sel)}).blur()`); // o campo grava ao sair (change)
const text = (sel) => t.text(sel);
const closeDialog = async () => {
  await t.key('Escape');
  await t.until(`!${dlg}`, 4000);
};

// ---- busca nas configurações ------------------------------------------------------------------------------------------------------------------------------------
await openSettings();
await type('[data-testid="settings-search"]', 'assinar');
await sleep(300);
const found = await t.ev(`[...document.querySelectorAll('[data-testid="settings-results"] [data-result]')].map((b) => b.dataset.result)`);
t.check('"assinar" acha as opções de assinatura (sinônimo, sem depender do nome exato)', found.includes('git-sign') && found.includes('git-key'), found);
await t.shot('config-busca');
await t.ev(`document.querySelector('[data-result="git-sign"]').click()`);
await sleep(400);
t.check('clicar no resultado abre a seção Git e põe o foco no campo', (await section()) === 'git' && (await t.ev(`document.activeElement?.getAttribute('data-testid')`)) === 'settings-git-sign');
await type('[data-testid="settings-search"]', 'tema escuro');
await sleep(300);
t.check('"tema escuro" acha o Tema; Esc limpa a busca sem fechar o diálogo', (await t.ev(`!!document.querySelector('[data-result="theme"]')`)) === true);
await t.key('Escape');
await sleep(250);
t.check('Esc na busca só limpa o texto (o diálogo segue aberto)', (await t.ev(`!!${dlg} && document.querySelector('[data-testid="settings-search"]').value === ''`)) === true);
await closeDialog();

// ---- abertura direta pela paleta ---------------------------------------------------------------------------------------------------------------------------------
await t.key('k', 2); // Ctrl+K
await t.until(`document.querySelector('.cp, [role="combobox"], [data-testid="palette-input"]')`, 4000);
await t.send('Input.insertText', { text: 'identidade assinatura git' });
await sleep(400);
await t.key('Enter');
await t.until(dlg, 5000);
await sleep(300);
t.check('o comando da paleta abre as Configurações direto na seção Git', (await section()) === 'git', await section());

// ---- Git: grava com `git config` no escopo do repositório -------------------------------------------------------------------------------------------------------
await t.ev(`[...document.querySelectorAll('.sd .gn-seg__opt')].find((b) => /Só este repositório/.test(b.textContent)).click()`);
await sleep(400);
t.check('o escopo "Só este repositório: configrepo" fica selecionado (nada vai para o global)', (await t.ev(`document.querySelector('.sd .gn-seg__opt[aria-checked="true"], .sd .gn-seg__opt[aria-pressed="true"], .sd .gn-seg__opt--on')?.textContent.trim()`)) === 'Só este repositório: configrepo');
const emailBefore = localCfg('user.email'); // o mkRepo já define um e-mail de teste no repositório
await type('[data-testid="settings-git-email"]', 'sem-arroba');
await commit('[data-testid="settings-git-email"]');
await sleep(500);
t.check('e-mail inválido: o aviso vem em role="alert" e nada é gravado', /E-mail inválido/.test((await text('[data-testid="settings-git-error"]')) ?? '') && localCfg('user.email') === emailBefore, [await text('[data-testid="settings-git-error"]'), localCfg('user.email'), emailBefore]);
await type('[data-testid="settings-git-name"]', 'Fulana Local');
await commit('[data-testid="settings-git-name"]');
await type('[data-testid="settings-git-email"]', 'fulana@exemplo.com');
await commit('[data-testid="settings-git-email"]');
await sleep(700);
t.check('nome e e-mail válidos são gravados no `git config --local` e o aviso "Salvo." é anunciado', localCfg('user.name') === 'Fulana Local' && localCfg('user.email') === 'fulana@exemplo.com' && (await text('[data-testid="settings-git-status"]')) === 'Salvo.', [localCfg('user.name'), localCfg('user.email'), await text('[data-testid="settings-git-status"]'), await text('[data-testid="settings-git-error"]')]);
await t.ev(`document.querySelector('[data-testid="settings-git-sign"]').click()`);
await sleep(600);
t.check('"Assinar todos os commits" grava commit.gpgsign=true no repositório', localCfg('commit.gpgsign') === 'true');
await t.ev(`document.querySelector('[data-setting="git-pull"] .cbx__btn').click()`);
await t.until(`document.querySelector('.cbx__list')`, 3000);
await t.ev(`[...document.querySelectorAll('.cbx__opt')].find((o) => o.textContent.trim() === 'Rebase').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
await sleep(600);
t.check('Ao puxar: Rebase grava pull.rebase=true', localCfg('pull.rebase') === 'true');
await t.ev(`document.querySelector('#sd-panel').scrollTop = 0`);
await t.shot('config-git');
await t.ev(`[...document.querySelectorAll('[data-setting="git-name"] button')].find((b) => /Remover/.test(b.textContent)).click()`);
await sleep(600);
t.check('Remover tira o valor do escopo do repositório (volta a valer o herdado)', localCfg('user.name') === null);
await closeDialog();

// ---- Atalhos: remapear, conflito, valer na hora, restaurar -----------------------------------------------------------------------------------------------------
await openSettings();
await goSection('shortcuts');
await type('[data-testid="settings-sc-filter"]', 'Grafo');
await sleep(300);
await t.ev(`document.querySelector('[data-command="view.graph"] [data-testid="settings-sc-change"]').click()`);
await sleep(200);
t.check('Alterar põe o comando em captura ("Pressione o novo atalho…")', /Pressione o novo atalho/.test((await text('[data-command="view.graph"] .ss__key')) ?? ''));
await t.key('3', 3); // Ctrl+Alt+3 já é de Ferramentas
await sleep(300);
t.check('uma combinação já usada é recusada e diz quem a usa', /Já é usado por/.test((await text('[data-testid="settings-sc-warn"]')) ?? ''), await text('[data-testid="settings-sc-warn"]'));
await t.key('k', 2); // Ctrl+K é da paleta
await sleep(300);
t.check('a combinação da paleta é reservada', /paleta de comandos/.test((await text('[data-testid="settings-sc-warn"]')) ?? ''), await text('[data-testid="settings-sc-warn"]'));
await t.key('9', 3); // Ctrl+Alt+9
await sleep(300);
t.check('uma combinação livre é aceita e anunciada', /Atalho de .*Grafo.*Ctrl\+Alt\+9/.test((await text('[data-testid="settings-sc-status"]')) ?? '') && (await t.ev(`JSON.parse(localStorage.getItem('gitnexus.shortcuts') ?? '{}')['view.graph']`)) === 'Mod+Alt+9');
await t.shot('config-atalhos');
await closeDialog();
await t.key('1', 3); // Ctrl+Alt+1: Staging
await sleep(400);
await t.key('9', 3);
await sleep(500);
t.check('o atalho novo vale na hora (Ctrl+Alt+9 abre o Grafo) e o antigo (Ctrl+Alt+2) deixou de valer', (await t.ev(`document.querySelector('.core__pane:not([style*="display: none"]) [data-testid="repo-view-tab"][aria-selected="true"]')?.dataset.view`)) === 'graph');
await t.key('1', 3);
await sleep(300);
await t.key('2', 3);
await sleep(400);
t.check('Ctrl+Alt+2 não abre mais o Grafo', (await t.ev(`document.querySelector('.core__pane:not([style*="display: none"]) [data-testid="repo-view-tab"][aria-selected="true"]')?.dataset.view`)) === 'repo');
await openSettings();
await goSection('shortcuts');
await t.ev(`document.querySelector('[data-testid="settings-sc-reset-all"]').click()`);
await sleep(300);
t.check('Restaurar todos os atalhos apaga os remapeamentos', (await t.ev(`localStorage.getItem('gitnexus.shortcuts')`)) === null);
await closeDialog();

// ---- Avançado: exportar, importar, redefinir -----------------------------------------------------------------------------------------------------------------------
await t.ev(`localStorage.setItem('gitnexus.mergeDraft', 'rascunho'); localStorage.setItem('gitnexus.theme', 'dark')`);
await openSettings();
await goSection('advanced');
await t.ev(`(() => { window.__exp = null; HTMLAnchorElement.prototype.click = function () { /* não baixa de verdade */ }; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { b.text().then((x) => (window.__exp = x)); return o(b); }; })()`);
await t.ev(`document.querySelector('[data-testid="settings-export"]').click()`);
await sleep(500);
const exp = JSON.parse((await t.ev(`window.__exp`)) ?? '{}');
t.check('exportar gera o JSON versionado, só com preferências (o rascunho não vai)', exp.app === 'gitnexus' && exp.version === 1 && exp.prefs['gitnexus.theme'] === 'dark' && !('gitnexus.mergeDraft' in exp.prefs), exp);
// importar um arquivo de verdade pelo seletor de arquivo (DOM.setFileInputFiles)
const good = join(root, 'ok.json');
writeFileSync(good, JSON.stringify({ app: 'gitnexus', version: 1, exportedAt: 'x', prefs: { 'gitnexus.theme': 'light', 'gitnexus.locale': 'en' } }));
const bad = join(root, 'ruim.json');
writeFileSync(bad, JSON.stringify({ app: 'outro', version: 1, prefs: {} }));
const setFile = async (path) => {
  const doc = (await t.send('DOM.getDocument', {})).result.root.nodeId;
  const node = (await t.send('DOM.querySelector', { nodeId: doc, selector: '[data-testid="settings-import-file"]' })).result.nodeId;
  await t.send('DOM.setFileInputFiles', { nodeId: node, files: [path] });
};
await setFile(bad);
await sleep(500);
t.check('importar um arquivo que não é do GitNexus mostra o erro e não muda nada', /não é uma exportação/.test((await text('[data-testid="settings-adv-error"]')) ?? '') && (await t.ev(`localStorage.getItem('gitnexus.theme')`)) === 'dark');
await setFile(good);
await t.until(`document.documentElement.dataset.theme === 'light' || localStorage.getItem('gitnexus.theme') === 'light'`, 8000);
await sleep(2200); // o app recarrega para aplicar
await t.until(`document.querySelector('li.repo, [data-testid="settings-open"]')`, 25000);
t.check('importar restaura as preferências do arquivo (tema claro, inglês) e o app recarrega', (await t.ev(`localStorage.getItem('gitnexus.theme')`)) === 'light' && (await t.ev(`document.documentElement.lang`)) === 'en', await t.ev(`document.documentElement.lang`));
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev('location.reload()');
await t.until(`document.querySelector('[data-testid="settings-open"]')`, 25000);
await openSettings();
await goSection('advanced');
await t.ev(`document.querySelector('[data-testid="settings-reset-all"]').click()`);
await t.until(`document.querySelector('[role="alertdialog"]')`, 4000);
await t.ev(`[...document.querySelectorAll('.dlg__btns button')].pop().click()`);
await sleep(2500);
await t.until(`document.querySelector('[data-testid="settings-open"]')`, 25000);
t.check('Redefinir tudo apaga as preferências (volta ao padrão) e não toca na configuração do Git', (await t.ev(`localStorage.getItem('gitnexus.theme')`)) === null && localCfg('pull.rebase') === 'true');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
