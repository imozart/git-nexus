// Dicas contextuais (#288): a faixa do stash esquecido (30 dias ou mais) aparece uma vez por sessão, com a ação sugerida, "Não mostrar mais" e fechar; nunca depois de
// dispensada; nenhum aviso para stash recente; e "Novidades" marca com "novo" o que veio depois da última versão vista.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
const theme = process.env.GN_TIP_THEME ?? 'dark';
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', ${lit(theme)}); localStorage.removeItem('gitnexus.tipsDismissed'); localStorage.removeItem('gitnexus.changelogSeen')`);

const root = tmpRoot('gn-dica-');
const dias = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const guardar = (repo, texto, quando) => {
  writeFileSync(join(repo, 'a.txt'), texto);
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.com', 'stash', 'push', '-q', '-m', texto], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: quando, GIT_AUTHOR_DATE: quando } });
};
// A: stash de 45 dias (esquecido) · B: stash de ontem · C: sem stash · D: outro stash esquecido (60 dias)
const A = mkRepo(root, 'dica-velho', { files: { 'a.txt': 'um\n' } });
const B = mkRepo(root, 'dica-novo', { files: { 'a.txt': 'um\n' } });
const C = mkRepo(root, 'dica-limpo', { files: { 'a.txt': 'um\n' } });
const D = mkRepo(root, 'dica-velho2', { files: { 'a.txt': 'um\n' } });
for (const r of [A, B, C, D]) git(r, 'config', 'core.fsmonitor', 'false');
guardar(A, 'esquecido', dias(45));
guardar(B, 'recente', dias(1));
guardar(D, 'esquecido2', dias(60));
for (const r of [A, B, C, D]) await t.ev(`window.gitNexus.addRepositoryPath(${lit(r)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 4`, 25000);

const home = async () => {
  await t.ev(`[...document.querySelectorAll('.gn-tab')].find((x) => /Repositórios/.test(x.textContent))?.click()`);
  await sleep(300);
};
const openRepo = async (name) => {
  await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)}).querySelector('.repo__btns button').click()`);
  await t.until(`document.querySelector('[data-testid="repo-views"]')`, 15000);
  await sleep(1500);
};
const tip = () => t.ev(`(() => { const e = [...document.querySelectorAll('[data-testid="tip"]')].find((x) => x.offsetParent !== null); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : null; })()`);
const dismissed = () => t.ev(`localStorage.getItem('gitnexus.tipsDismissed')`);
const newSession = async () => {
  await t.ev('location.reload()');
  await t.until(`document.querySelectorAll('li.repo').length >= 4`, 25000);
};

// --- nada de dica para stash recente nem sem stash ---------------------------------------------------------------------------------------------------------------
await openRepo('dica-limpo');
t.check('repositório sem stash: nenhuma dica', (await tip()) === null);
await home();
await openRepo('dica-novo');
t.check('stash de ontem não é "esquecido": nenhuma dica', (await tip()) === null);
await home();

// --- o stash esquecido: uma faixa discreta, com a ação ---------------------------------------------------------------------------------------------------------
await openRepo('dica-velho');
await t.until(`document.querySelector('[data-testid="tip"]')`, 8000);
const text = await tip();
t.check('stash de 45 dias: a dica aparece, diz há quantos dias e é uma nota (role="note") com nome', /Há um stash guardado há 45 dias/.test(text ?? '') && (await t.ev(`document.querySelector('[data-testid="tip"]').getAttribute('role')`)) === 'note' && !!(await t.ev(`document.querySelector('[data-testid="tip"]').getAttribute('aria-label')`)), text);
t.check('a dica não bloqueia nada (não é diálogo) e tem as três saídas: ver o stash, Não mostrar mais e fechar', (await t.count('[data-testid="tip-action"], [data-testid="tip-never"], [data-testid="tip-close"]')) === 3 && (await t.count('[role="dialog"]')) === 0);
await t.shot('dica-stash');

// fechar: some agora e não volta nesta sessão (a UMA dica da sessão já foi gasta), mas volta na próxima: fechar não é "nunca mais"
await t.ev(`document.querySelector('[data-testid="tip-close"]').click()`);
await sleep(300);
t.check('fechar a dica a esconde, sem gravar nada', (await tip()) === null && (await dismissed()) === null, await dismissed());
await home();
await openRepo('dica-velho2');
await sleep(2500);
t.check('uma por sessão: o outro repositório, com stash de 60 dias, não ganha uma segunda dica', (await tip()) === null);
await home();
await newSession();
await openRepo('dica-velho');
await t.until(`document.querySelector('[data-testid="tip"]')`, 8000);
t.check('na próxima sessão ela volta (só fechar não é "nunca mais")', /45 dias/.test((await tip()) ?? ''));

// a ação sugerida: leva ao Stash
await t.ev(`document.querySelector('[data-testid="tip-action"]').click()`);
await sleep(900);
t.check('"Ver o stash" abre Ferramentas > Stash', (await t.ev(`document.querySelector('.core__pane:not([style*="display: none"]) [data-testid="tools-nav"] [role="tab"][aria-selected="true"]')?.dataset.tool`)) === 'stash');

// "Não mostrar mais": para sempre
await t.ev(`document.querySelector('.core__pane:not([style*="display: none"]) [data-view="repo"]').click()`);
await sleep(500);
await t.ev(`document.querySelector('[data-testid="tip-never"]').click()`);
await sleep(300);
t.check('"Não mostrar mais" esconde e grava (nunca mais esta dica)', (await tip()) === null && /stash-forgotten/.test((await dismissed()) ?? ''), await dismissed());
await newSession();
await openRepo('dica-velho');
await sleep(2500);
t.check('depois de dispensada, não volta nem na próxima sessão', (await tip()) === null);

// --- Novidades: o selo "novo" -----------------------------------------------------------------------------------------------------------------------------------------
await home();
await t.ev(`localStorage.setItem('gitnexus.changelogSeen', '0.0.1')`);
await t.ev(`[...document.querySelectorAll('.conn__actions button')].find((b) => /Novidades/.test(b.textContent)).click()`);
await t.until(`document.querySelector('.ver')`, 8000);
const nNew = await t.count('[data-testid="changelog-new"]');
t.check('"Novidades" marca com "novo" as versões que vieram depois da última vista (e as abre)', nNew >= 1 && (await t.ev(`[...document.querySelectorAll('.ver[data-new]')].every((d) => d.open)`)) === true, nNew);
await t.shot('novidades-novo');
await t.key('Escape');
await sleep(400);
t.check('ao fechar, a versão em uso fica gravada como vista', /^\d+\.\d+\.\d+/.test((await t.ev(`localStorage.getItem('gitnexus.changelogSeen')`)) ?? ''), await t.ev(`localStorage.getItem('gitnexus.changelogSeen')`));
await t.ev(`[...document.querySelectorAll('.conn__actions button')].find((b) => /Novidades/.test(b.textContent)).click()`);
await t.until(`document.querySelector('.ver')`, 8000);
t.check('abrindo de novo, nada é "novo" (já foi visto)', (await t.count('[data-testid="changelog-new"]')) === 0);
await t.key('Escape');
await sleep(300);
t.check('sem erro de página', t.errors().filter((e) => !/favicon|Failed to fetch/.test(e)).length === 0, t.errors());
t.close();
