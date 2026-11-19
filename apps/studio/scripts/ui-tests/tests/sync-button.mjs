// Botão de sincronização do cabeçalho (estilo "Fetch/Pull/Push origin" do GitHub Desktop): o rótulo e a ação mudam com o estado da branch
// (Buscar, Atualizar ↓N, Enviar ↑N, Publicar branch, Sincronizar ↑N ↓M), o painel lista os commits que chegam e os que saem, atualizar guarda e
// devolve alterações locais e, enquanto a operação roda, o botão fica ocupado com uma barra de andamento. Git de verdade, com remoto local.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`); // o teste controla quando o clone busca

const root = tmpRoot('gn-sb-');
const remote = join(root, 'remote.git');
git(root, 'init', '--bare', '-b', 'main', remote);
const repo = mkRepo(root, 'sbrepo');
git(repo, 'remote', 'add', 'origin', remote);
git(repo, 'push', '-q', '-u', 'origin', 'main');
git(repo, 'remote', 'set-head', 'origin', 'main');

const other = join(root, 'other');
git(root, 'clone', '-q', '-c', 'core.autocrlf=false', remote, other);
for (const [k, v] of [['user.name', 'O'], ['user.email', 'o@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(other, 'config', k, v);
git(repo, 'config', 'core.autocrlf', 'false');
const commitIn = (dir, file, msg) => {
  writeFileSync(join(dir, file), `${msg}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', msg);
};
const pushOther = (file, msg) => {
  commitIn(other, file, msg);
  git(other, 'push', '-q', 'origin', 'HEAD');
  git(repo, 'fetch', '-q', 'origin');
};

await t.until(`document.querySelector('.conn__bar')`, 15000);
await t.openRepo(repo, 'sbrepo');
await t.until(`document.querySelector('[data-testid="sync-main"]') && document.querySelector('.rv__path')`, 15000);
const repoPath = await t.ev(`document.querySelector('.rv__path').textContent.trim()`);
// o andamento do git chega por onGitProgress, assinado na primeira operação: aqui a ponte é trocada ANTES dela para o teste enviar porcentagens
await t.ev(`(() => { window.__progressCb = null; window.gitNexus.onGitProgress = (cb) => { window.__progressCb = cb; return () => {}; }; return true; })()`);

const main = () => t.ev(`document.querySelector('[data-testid="sync-main"]').textContent.trim()`);
const tone = () => t.ev(`[...document.querySelector('[data-testid="sync-main"]').classList].find((c) => c.startsWith('gn-btn--tone-'))`);
const disabled = () => t.ev(`document.querySelector('[data-testid="sync-main"]').disabled`);
const notice = () => t.text('.rv__notice');
const reload = async () => {
  await t.ev(`document.querySelector('.rv__btns button').click()`);
  await sleep(600);
};
const waitLabel = (label, ms = 10000) => t.until(`document.querySelector('[data-testid="sync-main"]')?.textContent.trim() === ${lit(label)}`, ms);
const click = (id) => t.ev(`document.querySelector('[data-testid="${id}"]').click()`);
/** O app relê o repositório (status, resumo) depois de cada operação; mexer no repositório por fora nesse meio tempo esbarra no `index.lock`. */
const settled = async () => {
  await t.until(`!document.querySelector('.rv__btns button').disabled && !document.querySelector('[data-testid="sync-progress"]')`, 10000);
  await sleep(1200);
};
const openPanel = async () => {
  await click('sync-details');
  await t.until(`document.querySelector('[data-testid="sync-panel"]')`, 8000);
  await t.until(`!document.querySelector('.ss__muted')?.textContent.includes('Carregando')`, 8000);
};

// --- o botão antigo "Atualizar" (só relê o status) agora se chama "Recarregar" ------------------------------------------------------------
t.check('o botão que só relê o status local se chama "Recarregar"', (await t.ev(`document.querySelector('.rv__btns button').textContent.trim()`)) === 'Recarregar');

// --- em dia: Buscar origin ------------------------------------------------------------------------------------------------------------------
await waitLabel('Buscar origin');
t.check('em dia: "Buscar origin", neutro', (await main()) === 'Buscar origin' && (await tone()) === 'gn-btn--tone-neutral', [await main(), await tone()]);
t.check('o botão tem o grupo acessível e a seta de detalhes', (await t.count('.gn-btn-group[aria-label="Sincronizar com o remoto"] button')) === 2);
await click('sync-main');
await t.until(`document.querySelector('.rv__notice')?.textContent.includes('Buscado de origin')`, 10000);
t.check('buscar avisa o resultado', /Buscado de origin\./.test((await notice()) ?? ''), await notice());
t.check('terminou: o botão volta a ficar disponível e sem barra', !(await disabled()) && (await t.count('[data-testid="sync-progress"]')) === 0);

// --- atrás: Atualizar origin ↓1, painel com o commit que chega ---------------------------------------------------------------------------
await settled();
pushOther('o1.txt', 'novidade 1');
await reload();
await waitLabel('Atualizar origin ↓1');
t.check('atrás: "Atualizar origin ↓1" em tom accent', (await tone()) === 'gn-btn--tone-accent', await tone());
await openPanel();
t.check('o painel lista o commit que chega', /novidade 1/.test((await t.text('[data-testid="sync-incoming"]')) ?? '') && /chegando \(1\)/i.test((await t.text('[data-testid="sync-incoming"] h4')) ?? ''), await t.text('[data-testid="sync-incoming"]'));
t.check('sem commits saindo, não há lista "Saindo"', (await t.count('[data-testid="sync-outgoing"]')) === 0);
t.check('o painel tem "Buscar agora" e "Atualizar (fast-forward)"', (await t.count('[data-testid="sync-fetch"]')) === 1 && (await t.count('[data-testid="sync-update-ff"]')) === 1);
await t.shot('sync-painel-atras');
await t.key('Escape');
await sleep(250);
t.check('Esc fecha o painel', (await t.count('[data-testid="sync-panel"]')) === 0);

// --- andamento: operação lenta (simulada na ponte) com a porcentagem que o git informaria -----------------------------------------------------
await t.ev(`(() => {
  const api = window.gitNexus;
  const real = api.updateRepo;
  api.updateRepo = async (...a) => { await new Promise((r) => setTimeout(r, 2500)); return real(...a); };
  return true;
})()`);
await click('sync-main');
await t.until(`document.querySelector('[data-testid="sync-main"]').disabled`, 5000);
t.check('durante a atualização o botão fica ocupado: desabilitado e "Atualizando…"', (await main()) === 'Atualizando…' && (await disabled()) === true, await main());
t.check('há uma barra de andamento (indeterminada enquanto o git não informa número)', (await t.count('[data-testid="sync-progress"].ss__bar--indeterminate')) === 1);
t.check('a barra é um progressbar acessível', (await t.ev(`document.querySelector('[data-testid="sync-progress"]').getAttribute('role')`)) === 'progressbar');
await t.ev(`window.__progressCb({ repoPath: ${lit(repoPath)}, op: 'pull', phase: 'Receiving objects', percent: 45 })`);
await t.until(`document.querySelector('[data-testid="sync-main"]').textContent.includes('45%')`, 5000);
t.check('com a porcentagem: "Atualizando… 45%"', (await main()) === 'Atualizando… 45%', await main());
t.check('a barra passa a mostrar 45%', (await t.ev(`document.querySelector('[data-testid="sync-progress"]').getAttribute('aria-valuenow')`)) === '45' && (await t.count('[data-testid="sync-progress"].ss__bar--indeterminate')) === 0);
t.check('a etapa do git aparece em português no tooltip da barra', /Recebendo objetos/.test(await t.ev(`document.querySelector('[data-testid="sync-progress"]').dataset.tooltip`)), await t.ev(`document.querySelector('[data-testid="sync-progress"]').dataset.tooltip`));
await t.shot('sync-andamento');
await click('sync-main'); // clique num botão desabilitado não faz nada
t.check('um segundo clique é impossível (botão desabilitado)', (await disabled()) === true);
await t.until(`!document.querySelector('[data-testid="sync-main"]').disabled`, 15000);
t.check('terminou: avisa o fast-forward e a barra some', /fast-forward/.test((await notice()) ?? '') && (await t.count('[data-testid="sync-progress"]')) === 0, await notice());
t.check('o git trouxe o commit', git(repo, 'log', '-1', '--format=%s').trim() === 'novidade 1');
await waitLabel('Buscar origin');

// --- atualizar com alterações locais: guarda, atualiza e devolve ----------------------------------------------------------------------------------
await settled();
pushOther('o2.txt', 'novidade 2');
writeFileSync(join(repo, 'a.txt'), 'um\nminha alteração local\n');
await reload();
await waitLabel('Atualizar origin ↓1');
await openPanel();
t.check('com alterações locais o painel avisa que serão guardadas e devolvidas', (await t.count('[data-testid="sync-stash-note"]')) === 1);
await click('sync-update-ff');
await t.until(`document.querySelector('.rv__notice')?.textContent.includes('guardadas e devolvidas')`, 15000);
t.check('a alteração local continua lá depois de atualizar', git(repo, 'diff', '--stat').includes('a.txt') && git(repo, 'log', '-1', '--format=%s').trim() === 'novidade 2');
t.check('nada ficou esquecido no stash', git(repo, 'stash', 'list').trim() === '');
await settled();
git(repo, 'checkout', '--', 'a.txt');

// --- à frente: Enviar origin ↑1 ----------------------------------------------------------------------------------------------------------------
await settled();
commitIn(repo, 'l1.txt', 'meu commit');
await reload();
await waitLabel('Enviar origin ↑1');
t.check('à frente: "Enviar origin ↑1" em tom success', (await tone()) === 'gn-btn--tone-success', await tone());
await openPanel();
t.check('o painel lista o commit que sai', /meu commit/.test((await t.text('[data-testid="sync-outgoing"]')) ?? ''), await t.text('[data-testid="sync-outgoing"]'));
t.check('o painel tem o botão Enviar', (await t.count('[data-testid="sync-push"]')) === 1);
await t.key('Escape');
await sleep(250);
await click('sync-main');
await t.until(`document.querySelector('.rv__notice')?.textContent.includes('Enviado para')`, 20000);
t.check('o commit chegou ao remoto', git(remote, 'log', '-1', '--format=%s', 'main').trim() === 'meu commit');
await waitLabel('Buscar origin');

// --- sem upstream: Publicar branch --------------------------------------------------------------------------------------------------------------
await settled();
git(repo, 'checkout', '-q', '-b', 'feat/publicar', '--no-track', 'origin/main');
commitIn(repo, 'p1.txt', 'so na feature');
await reload();
await waitLabel('Publicar branch');
t.check('sem upstream: "Publicar branch"', (await main()) === 'Publicar branch');
await openPanel();
t.check('o painel lista o que ainda não foi publicado', /ainda não publicados \(1\)/i.test((await t.text('[data-testid="sync-outgoing"] h4')) ?? ''), await t.text('[data-testid="sync-outgoing"] h4'));
await t.key('Escape');
await sleep(250);
await click('sync-main');
await t.until(`document.querySelector('.rv__notice')?.textContent.includes('publicada')`, 20000);
t.check('a branch foi publicada e passou a ter upstream', git(repo, 'rev-parse', '--abbrev-ref', '@{u}').trim() === 'origin/feat/publicar');
await waitLabel('Buscar origin');

// --- divergida: o clique abre o painel; merge funciona, rebase pede confirmação ---------------------------------------------------------------------
await settled();
git(other, 'fetch', '-q', 'origin');
git(other, 'checkout', '-q', '-B', 'feat/publicar', 'origin/feat/publicar');
pushOther('d1.txt', 'remoto da feature');
commitIn(repo, 'd2.txt', 'local da feature');
await reload();
await waitLabel('Sincronizar ↑1 ↓1');
t.check('divergida: "Sincronizar ↑1 ↓1" em tom warn', (await tone()) === 'gn-btn--tone-warn', await tone());
await click('sync-main');
await t.until(`document.querySelector('[data-testid="sync-panel"]')`, 8000);
await t.until(`document.querySelector('[data-testid="sync-diverged"]')`, 8000);
t.check('divergida: o clique no botão abre o painel com a explicação', (await t.count('[data-testid="sync-diverged"]')) === 1);
t.check('o painel oferece merge e rebase, e não o fast-forward', (await t.count('[data-testid="sync-update-merge"]')) === 1 && (await t.count('[data-testid="sync-update-rebase"]')) === 1 && (await t.count('[data-testid="sync-update-ff"]')) === 0);
await t.shot('sync-divergida-painel');
await click('sync-update-rebase');
await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
t.check('o rebase pede confirmação (reescreve a história)', /Rebase/.test((await t.text('[role="alertdialog"]')) ?? ''), await t.text('[role="alertdialog"]'));
await t.ev(`document.querySelector('.dlg__btns button').click()`); // Cancelar
await sleep(300);
t.check('cancelar não muda nada', git(repo, 'log', '--merges', '--format=%s', '-1').trim() === '' && (await t.count('[role="alertdialog"]')) === 0);
await openPanel();
await click('sync-update-merge');
await t.until(`document.querySelector('.rv__notice')?.textContent.includes('Atualizado com merge')`, 20000);
t.check('o merge juntou os dois lados', git(repo, 'log', '--merges', '--format=%s', '-1').includes('Merge'));
await waitLabel('Enviar origin ↑2');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
