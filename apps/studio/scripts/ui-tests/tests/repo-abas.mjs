// Uma aba por repositório (#282): abrir três repositórios dá três abas (não doze), as visões trocam por dentro da aba (seletor, Ctrl+Alt+1..4 e paleta) sem abrir
// outra, o estado de cada visão sobrevive à troca, a visão fica lembrada por repositório e fechar a aba fecha o repositório.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', 'dark')`);
for (const k of Object.keys(await t.ev(`Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.startsWith('gitnexus.repoView.')))`))) await t.ev(`localStorage.removeItem(${lit(k)})`);

const root = tmpRoot('gn-abas-');
const names = ['abas-a', 'abas-b', 'abas-c'];
const repos = names.map((n) => {
  const r = mkRepo(root, n, { files: { 'a.txt': 'um\n' } });
  git(r, 'config', 'core.fsmonitor', 'false');
  writeFileSync(join(r, 'a.txt'), 'um\ndois\n'); // alteração pendente: o Staging tem o que mostrar
  return r;
});
for (const r of repos) await t.ev(`window.gitNexus.addRepositoryPath(${lit(r)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 3`, 25000);

const tabs = () => t.ev(`[...document.querySelectorAll('.core__tabs [role="tab"]')].map((x) => x.textContent.replace(/\\s+/g, ' ').replace('×', '').trim())`);
const openRepo = async (name) => {
  await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)}).querySelector('.repo__btns button').click()`);
  await t.until(`document.querySelector('[data-testid="repo-views"]')`, 20000);
  await sleep(500);
};
const switchTo = async (view) => {
  await t.ev(`document.querySelector('.core__pane:not([style*="display: none"]) [data-view="${view}"]').click()`);
  await sleep(500);
};
const viewOf = () => t.ev(`document.querySelector('.core__pane:not([style*="display: none"]) [data-testid="repo-view-tab"][aria-selected="true"]')?.dataset.view ?? ''`);

const goHome = async () => {
  await t.ev(`[...document.querySelectorAll('.gn-tab')].find((x) => /Repositórios/.test(x.textContent))?.click()`);
  await sleep(300);
};
for (const n of names) {
  await openRepo(n);
  await goHome();
}
const afterOpen = await tabs();
t.check('abrir três repositórios dá três abas de repositório (mais a inicial), não uma por visão', afterOpen.length === 4 && names.every((n) => afterOpen.some((x) => x.startsWith(n))), afterOpen);

// A: troca de visão por dentro da aba
await t.ev(`[...document.querySelectorAll('.gn-tab')].find((x) => /abas-a/.test(x.textContent))?.click()`);
await sleep(500);
t.check('o seletor de visão é um tablist nomeado com as três visões (sem operação, "Conflitos" não existe)', (await t.ev(`(() => { const l = document.querySelector('.core__pane:not([style*="display: none"]) [data-testid="repo-views"]'); return l?.getAttribute('role') === 'tablist' && !!l.getAttribute('aria-label') && l.querySelectorAll('[role="tab"]').length === 3; })()`)) === true);
t.check('começa no Staging, com uma só aba selecionada e só ela na ordem do Tab', (await viewOf()) === 'repo' && (await t.ev(`document.querySelectorAll('.core__pane:not([style*="display: none"]) [data-testid="repo-view-tab"][tabindex="0"]').length`)) === 1);

await switchTo('graph');
await t.until(`document.querySelector('[data-testid="gv-row"]')`, 20000);
t.check('trocar para o Grafo não cria aba nova (o subtítulo da aba mostra a visão)', (await tabs()).length === 4 && /abas-a\s*Grafo/.test((await tabs()).find((x) => x.startsWith('abas-a')) ?? ''), await tabs());
await switchTo('tools');
await t.until(`document.querySelector('[role="tablist"][aria-label]')`, 10000);
t.check('Ferramentas também troca dentro da aba', (await viewOf()) === 'tools' && (await tabs()).length === 4, [await viewOf(), await tabs()]);
t.check('Ferramentas idem, e o painel visível é o da visão escolhida', (await viewOf()) === 'tools' && (await t.ev(`document.querySelector('.core__pane:not([style*="display: none"]) [role="tabpanel"]:not([style*="display: none"])')?.id`)) === (await t.ev(`document.querySelector('.core__pane:not([style*="display: none"]) [data-view="tools"]').getAttribute('aria-controls')`)));

// B: estado das visões (o Grafo montado continua montado ao voltar)
await t.ev(`window.__marca = document.querySelector('[data-testid="gv-row"]')`);
await switchTo('graph');
t.check('voltar ao Grafo mantém a visão montada (o estado não é descartado)', (await t.ev(`window.__marca === document.querySelector('[data-testid="gv-row"]')`)) === true);
await t.shot('repo-abas'); // três repositórios abertos: três abas, a visão por dentro

// C: teclado
await t.ev(`document.querySelector('.core__pane:not([style*="display: none"]) [data-view="graph"]').focus()`);
await t.key('ArrowRight');
await sleep(400);
t.check('seta para a direita no seletor troca para a visão seguinte e leva o foco', (await viewOf()) === 'tools' && (await t.ev(`document.activeElement?.dataset?.view`)) === 'tools');
await t.key('1', 3); // Ctrl+Alt+1
await sleep(400);
t.check('Ctrl+Alt+1 volta ao Staging, sem abrir aba', (await viewOf()) === 'repo');
await t.key('2', 3);
await sleep(400);
t.check('Ctrl+Alt+2 vai ao Grafo', (await viewOf()) === 'graph' && (await tabs()).length === 4, [await viewOf(), await tabs()]);

// D: paleta
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 8000);
await t.send('Input.insertText', { text: 'Abrir Ferramentas' });
await sleep(400);
await t.key('Enter');
await sleep(500);
t.check('o comando "Abrir Ferramentas" da paleta troca a visão da aba atual', (await viewOf()) === 'tools' && (await tabs()).length === 4, [await viewOf(), await tabs()]);

// E: visão lembrada por repositório e fechar a aba fecha o repositório
t.check('a visão ficou lembrada para o repositório (localStorage)', (await t.ev(`Object.entries(localStorage).some(([k, v]) => k.startsWith('gitnexus.repoView.') && v === 'tools')`)) === true);
await t.ev(`[...document.querySelectorAll('.gn-tab')].find((x) => /abas-a/.test(x.textContent)).querySelector('.gn-tab__close').click()`);
await sleep(400);
t.check('fechar a aba fecha o repositório inteiro (de uma vez, sem sobrar aba de outra visão)', (await tabs()).length === 3 && !(await tabs()).some((x) => x.startsWith('abas-a')));
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 3`, 25000);
await openRepo('abas-a');
t.check('reabrir o repositório volta na visão lembrada (Ferramentas)', (await viewOf()) === 'tools');
await t.ev(`localStorage.setItem('gitnexus.theme', 'light')`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 3`, 25000);
await openRepo('abas-a');
await t.shot('repo-abas-claro');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
