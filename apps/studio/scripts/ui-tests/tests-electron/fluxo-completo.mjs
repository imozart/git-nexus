// Fluxo de ponta a ponta NA JANELA REAL do Electron (app empacotado): abrir um repositório, ver o status, incluir um arquivo no commit,
// fazer o commit pelo formulário, conferir o resultado no git de verdade, abrir o log e trocar de idioma. Tudo atravessa a ponte real
// (preload -> processo principal -> UtilityProcess -> git), que os testes com harness não exercitam.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);

// --- é a janela real, não um navegador ------------------------------------------------------------------------------------
t.check('é o Electron (e não um navegador)', /Electron\//.test(await t.ev('navigator.userAgent')), await t.ev('navigator.userAgent'));
t.check('a interface foi carregada do pacote (file://)', (await t.ev('location.protocol')) === 'file:', await t.ev('location.href'));
t.check('a ponte do preload existe', (await t.ev(`typeof window.gitNexus?.getKnownRepositories`)) === 'function');
t.check('a lista de repositórios vem do processo principal', Array.isArray(await t.ev('window.gitNexus.getKnownRepositories()')));
t.check('o teclado atravessa o app: Ctrl+K abre a paleta', await (async () => {
  await t.ev(`document.body.focus()`);
  await t.key('K', 2);
  const open = await t.until(`document.querySelector('.cp__box')`, 4000);
  await t.key('Escape');
  return !!open;
})());

// --- repositório de teste: política do time sem ticket obrigatório, um arquivo alterado e um novo ---------------------------
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.removeItem('gitnexus.showGitLog')`);
const root = tmpRoot('gn-e2e-repo-');
const repo = mkRepo(root, 'e2erepo', { files: { 'a.txt': 'um\n', '.gitnexus.json': JSON.stringify({ commit: { ticketRequired: false, scopeRequired: false } }) } });
writeFileSync(join(repo, 'a.txt'), 'um\ndois\n');
writeFileSync(join(repo, 'novo.txt'), 'arquivo novo\n');

t.check('abre o repositório pela ponte real', await t.openRepo(repo, 'e2erepo'));
await t.until(`document.querySelector('.file__name')`, 20000);
const names = async () => t.ev(`[...document.querySelectorAll('.file__name')].map((e) => e.textContent.trim()).sort()`);
t.check('o git real listou os dois arquivos', JSON.stringify(await names()) === JSON.stringify(['a.txt', 'novo.txt']), await names());
t.check('o ramo vem do git (main)', /main/.test((await t.text('.rv__id')) ?? ''), await t.text('.rv__id'));
await t.shot('e2e-status');

// --- incluir no commit (stage) -----------------------------------------------------------------------------------------------
const checkbox = (name) => `(() => { const n = [...document.querySelectorAll('.file__name')].find((e) => e.textContent.trim() === ${JSON.stringify(name)}); return n?.parentElement.querySelector('input.cb'); })()`;
await t.ev(`${checkbox('a.txt')}.click()`);
const staged = await (async () => {
  for (let i = 0; i < 40; i++) {
    if (git(repo, 'diff', '--cached', '--name-only').trim() === 'a.txt') return true;
    await sleep(250);
  }
  return false;
})();
t.check('marcar o arquivo faz o stage de verdade no git', staged, git(repo, 'status', '--porcelain'));
t.check('a tela mostra 1 arquivo no commit', await t.until(`/1 no commit/.test(document.querySelector('.rv__files')?.innerText ?? '')`, 8000));

// --- commit pelo formulário -----------------------------------------------------------------------------------------------
await t.ev(`[...document.querySelectorAll('.cf__types .chip')].find((b) => b.textContent.trim() === 'fix').click()`);
await t.ev(`(() => { const i = document.querySelector('input[data-focus="commit-subject"]'); i.focus(); i.value = 'corrige o conteúdo do a.txt'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
t.check('o formulário valida a mensagem (política do time sem ticket)', await t.until(`document.querySelector('.cf__lint.ok')`, 8000));
t.check('o botão de commit fica habilitado', (await t.ev(`!document.querySelector('form.cf button[type=submit]').disabled`)) === true);
await t.shot('e2e-formulario');
await t.ev(`document.querySelector('form.cf button[type=submit]').click()`);
const committed = await (async () => {
  for (let i = 0; i < 40; i++) {
    if (git(repo, 'log', '-1', '--format=%s').trim() === 'fix: corrige o conteúdo do a.txt') return true;
    await sleep(250);
  }
  return false;
})();
t.check('o commit existe no git real, com a mensagem montada pelo app', committed, git(repo, 'log', '-1', '--format=%s'));
t.check('o commit trouxe só o arquivo incluído', git(repo, 'show', '--name-only', '--format=', 'HEAD').trim() === 'a.txt');
t.check('o arquivo novo continua fora (não versionado)', git(repo, 'status', '--porcelain').trim() === '?? novo.txt', git(repo, 'status', '--porcelain'));
t.check('a tela atualiza sozinha: sobra só o arquivo novo', await t.until(`document.querySelectorAll('.file__name').length === 1 && document.querySelector('.file__name').textContent.trim() === 'novo.txt'`, 10000), await names());
await t.shot('e2e-depois-do-commit');

// --- log do Git: mostra o que o app executou -----------------------------------------------------------------------------
await t.ev(`document.body.focus()`);
await t.key('L', 2 | 8); // Ctrl+Shift+L
t.check('Ctrl+Shift+L abre o log do Git', await t.until(`document.querySelector('.log__body')`, 6000));
t.check('o log registra o commit que acabou de acontecer', await t.until(`[...document.querySelectorAll('.log__cmd')].some((e) => /^git commit/.test(e.textContent))`, 6000));
await t.shot('e2e-log');

// --- idioma: troca e persiste depois de recarregar ----------------------------------------------------------------------
await t.ev(`(() => { const b = document.querySelector('.lang .cbx__btn, .lang__btn'); b.focus(); b.click(); })()`);
await sleep(400);
await t.key('ArrowDown');
await t.key('Enter');
await sleep(500);
t.check('trocar para English muda a interface', await t.until(`/Commands/.test(document.querySelector('.core__cmd')?.innerText ?? '')`, 6000));
await t.ev('location.reload()');
await sleep(2500);
t.check('o idioma escolhido persiste depois de recarregar', await t.until(`/Commands/.test(document.querySelector('.core__cmd')?.innerText ?? '')`, 15000));

// --- saúde: nada quebrou no caminho ------------------------------------------------------------------------------------------
t.check('nenhum erro no console da janela durante o fluxo', t.errors().length === 0, t.errors().slice(0, 3));
t.close();
