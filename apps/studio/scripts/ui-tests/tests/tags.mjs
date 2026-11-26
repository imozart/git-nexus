// Tags: criar (leve e anotada), nome inválido, enviar ao remoto, apagar local e remota, ir para a tag e "Criar tag aqui" a partir do grafo. Git de verdade, com remoto local.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.setItem('gitnexus.toolsSection', 'tags')`);

const root = tmpRoot('gn-tg-');
const remote = join(root, 'remote.git');
git(root, 'init', '--bare', '-b', 'main', remote);
const repo = mkRepo(root, 'tagrepo', { files: { 'a.txt': 'a\n' } });
git(repo, 'remote', 'add', 'origin', remote);
git(repo, 'push', '-q', '-u', 'origin', 'main');
writeFileSync(join(repo, 'b.txt'), 'b\n');
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'feat: segundo commit');
git(repo, 'push', '-q', 'origin', 'main');
const first = git(repo, 'rev-parse', 'HEAD~1').trim();

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('.rv__btns')`, 20000);

const set = (sel, v) => t.ev(`(() => { const i = document.querySelector('${sel}'); i.value = ${lit(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const remoteTags = () => git(repo, 'ls-remote', '--tags', '--refs', 'origin').split('\n').map((l) => /refs\/tags\/(.+)$/.exec(l)?.[1]).filter(Boolean).sort();
const localTags = () => git(repo, 'tag').split('\n').filter(Boolean).sort();
const row = (n) => `document.querySelector('[data-tag="${n}"]')`;
const rowText = async (n) => (await t.ev(`${row(n)}?.innerText.replace(/\\s+/g, ' ') ?? ''`)) ?? '';
const confirmDialog = async () => {
  await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
  await t.ev(`[...document.querySelectorAll('.dlg__btns button')].pop().click()`);
  await sleep(1200);
};

// abre Ferramentas (a seção Tags já vem escolhida)
await t.ev(`[...document.querySelectorAll('[data-testid="repo-view-tab"]')].find((b) => /Ferramentas/.test(b.textContent))?.click()`);
await t.until(`document.querySelector('[data-testid="tag-form"]')`, 15000);
await t.until(`/ainda não tem tags/.test(document.body.innerText)`, 10000);
t.check('sem tags: mostra o estado vazio', (await t.ev(`/ainda não tem tags/.test(document.body.innerText)`)) === true);
t.check('sem mensagem o botão é "Criar tag" (leve)', /^Criar tag$/.test((await t.text('[data-testid="tag-create"]')) ?? ''));

// --- tag leve --------------------------------------------------------------------------------------------------------------------------
await set('[data-testid="tag-name"]', 'v0.1');
await t.ev(`document.querySelector('[data-testid="tag-create"]').click()`);
await t.until(`${row('v0.1')}`, 8000);
t.check('a tag leve foi criada no git', localTags().join() === 'v0.1');
t.check('a linha mostra "leve" e "só local"', /leve/.test(await rowText('v0.1')) && /só local/.test(await rowText('v0.1')), await rowText('v0.1'));
t.check('o formulário limpou', (await t.ev(`document.querySelector('[data-testid="tag-name"]').value`)) === '');

// --- tag anotada, em um commit anterior ------------------------------------------------------------------------------------------------
await set('[data-testid="tag-name"]', 'v1.0.0');
await set('[data-testid="tag-target"]', first);
await set('[data-testid="tag-message"]', 'Primeira versão\n\nNotas da versão.');
t.check('com mensagem o botão vira "Criar tag anotada"', /anotada/.test((await t.text('[data-testid="tag-create"]')) ?? ''));
await t.ev(`document.querySelector('[data-testid="tag-create"]').click()`);
await t.until(`${row('v1.0.0')}`, 8000);
t.check('é anotada no git (objeto tag) e aponta para o commit pedido', git(repo, 'cat-file', '-t', 'v1.0.0').trim() === 'tag' && git(repo, 'rev-parse', 'v1.0.0^{commit}').trim() === first);
t.check('a linha mostra "anotada" e a mensagem', /anotada/.test(await rowText('v1.0.0')) && /Notas da versão/.test(await rowText('v1.0.0')), await rowText('v1.0.0'));

// --- nome inválido -----------------------------------------------------------------------------------------------------------------------
await set('[data-testid="tag-name"]', 'com espaço');
await t.ev(`document.querySelector('[data-testid="tag-create"]').click()`);
await t.until(`document.querySelector('[data-testid="tag-error"]')`, 8000);
t.check('nome inválido: o erro explica e nada foi criado', /não é um nome de tag válido/.test((await t.text('[data-testid="tag-error"]')) ?? '') && localTags().length === 2, [await t.text('[data-testid="tag-error"]'), localTags()]);
await set('[data-testid="tag-name"]', '');

// --- enviar ----------------------------------------------------------------------------------------------------------------------------------
await t.ev(`${row('v0.1')}.querySelector('[data-testid="tag-push"]').click()`);
await t.until(`/no remoto/.test(${row('v0.1')}?.innerText ?? '')`, 12000);
t.check('Enviar põe a tag no remoto e a linha passa a "no remoto"', remoteTags().join() === 'v0.1', remoteTags());
t.check('"Enviar as que faltam" conta a que falta (1)', /\(1\)/.test((await t.text('[data-testid="tag-push-all"]')) ?? ''), await t.text('[data-testid="tag-push-all"]'));
await t.ev(`document.querySelector('[data-testid="tag-push-all"]').click()`);
await t.until(`/no remoto/.test(${row('v1.0.0')}?.innerText ?? '')`, 12000);
t.check('Enviar as que faltam leva a outra', remoteTags().join() === 'v0.1,v1.0.0', remoteTags());
await t.shot('tags');

// --- apagar ---------------------------------------------------------------------------------------------------------------------------------
await t.ev(`${row('v0.1')}.querySelector('[data-testid="tag-delete"]').click()`);
await t.until(`document.querySelector('[role="alertdialog"]')`, 5000);
t.check('apagar pede confirmação e explica que é só a local', /Só a tag local/.test((await t.text('[role="alertdialog"]')) ?? ''));
await confirmDialog();
await t.until(`!${row('v0.1')}`, 8000);
t.check('Apagar tira só a local: o remoto continua com a tag', localTags().join() === 'v1.0.0' && remoteTags().includes('v0.1'));

await t.ev(`${row('v1.0.0')}.querySelector('[data-testid="tag-delete-remote"]').click()`);
await confirmDialog();
await t.until(`/só local/.test(${row('v1.0.0')}?.innerText ?? '')`, 12000);
t.check('Apagar no remoto tira do remoto e mantém a local (que volta a "só local")', !remoteTags().includes('v1.0.0') && localTags().includes('v1.0.0'), [remoteTags(), localTags()]);

// --- ir para a tag --------------------------------------------------------------------------------------------------------------------------
await t.ev(`${row('v1.0.0')}.querySelector('[data-testid="tag-go"]').click()`);
await confirmDialog();
await sleep(500);
t.check('Ir para deixa o HEAD desanexado no commit da tag', git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim() === 'HEAD' && git(repo, 'rev-parse', 'HEAD').trim() === first);
git(repo, 'checkout', '-q', 'main');

// --- Criar tag aqui (grafo) ------------------------------------------------------------------------------------------------------------
await t.ev(`[...document.querySelectorAll('.gn-tab')].find((e) => /Staging/.test(e.textContent))?.click()`);
await sleep(500);
await t.ev(`[...document.querySelectorAll('[data-testid="repo-view-tab"]')].find((b) => /Grafo/.test(b.textContent))?.click()`);
await t.until(`document.querySelector('.row')`, 15000);
await t.ev(`[...document.querySelectorAll('.row')].find((r) => r.textContent.includes('feat: segundo commit')).click()`);
await t.until(`document.querySelector('[data-testid="tag-here"]')`, 8000);
await t.ev(`document.querySelector('[data-testid="tag-here"]').click()`);
await t.until(`document.querySelector('[data-testid="tag-target"]')`, 10000);
const head = git(repo, 'rev-parse', 'HEAD').trim();
t.check('"Criar tag aqui" abre as Tags com o commit como destino', (await t.ev(`document.querySelector('[data-testid="tag-target"]').value`)) === head);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
