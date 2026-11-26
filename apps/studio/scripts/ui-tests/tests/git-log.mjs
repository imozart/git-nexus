// Log do Git: barra recolhida, lista de comandos, "Minhas ações" por padrão e "Tudo" com as consultas, falha com saída, copiar e limpar.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.removeItem('gitnexus.showGitLog'); localStorage.removeItem('gitnexus.gitLogFilter')`);
const root = tmpRoot('gn-log-');
const repo = mkRepo(root, 'logrepo');
writeFileSync(join(repo, 'a.txt'), 'um\ndois\n');
await t.openRepo(repo, 'logrepo');
await t.until(`document.querySelector('.log')`, 15000);
// caminho como o app o guardou (o tmpdir do Windows pode vir no formato curto 8.3)
const tabRepo = await t.text('.rv__path');
const filter = (label) => t.ev(`[...document.querySelectorAll('[data-testid="log-filter"] [role="radio"]')].find((b) => b.textContent.trim().startsWith(${lit(label)}))?.click()`);
t.check('barra do log existe e começa recolhida', (await t.count('.log')) === 1 && (await t.count('.log__body')) === 0);
t.check('barra mostra a contagem em ações', /\d+ aç(ão|ões)/.test((await t.text('.log__count')) ?? ''), await t.text('.log__count'));
await t.shot('log-recolhido');

// uma ação da pessoa (stage) aparece na barra recolhida como "último comando"
await t.ev(`window.gitNexus.stageFiles(${lit(tabRepo)}, ['a.txt'])`);
await t.until(`document.querySelector('.log__last')`, 10000);
t.check('a barra recolhida mostra o último comando DA PESSOA', / add /.test((await t.text('.log__last')) ?? ''), await t.text('.log__last'));

await t.ev(`document.querySelector('.log__toggle').click()`);
await sleep(400);
t.check('abertura lembrada', (await t.ev(`localStorage.getItem('gitnexus.showGitLog')`)) === '1');
t.check('o filtro padrão é "Minhas ações": o git add aparece, o status que o app faz sozinho não', (await t.ev(`[...document.querySelectorAll('.log__cmd')].some(e => / add /.test(e.textContent))`)) === true && (await t.ev(`![...document.querySelectorAll('.log__cmd')].some(e => e.textContent.startsWith('git status'))`)) === true);
await filter('Tudo');
await sleep(300);
t.check('"Tudo" mostra também as consultas (git status)', (await t.ev(`[...document.querySelectorAll('.log__cmd')].some(e => e.textContent.startsWith('git status'))`)) === true);

// um comando que falha (arquivo inexistente)
await t.ev(`window.gitNexus.stageFiles(${lit(tabRepo)}, ['nao-existe.txt']).catch(() => null)`);
await t.until(`[...document.querySelectorAll('.log__cmd')].some(e => e.textContent.includes('nao-existe'))`, 8000);
t.check('falha aparece em vermelho com a saída aberta', (await t.ev(`!!document.querySelector('.log__row--fail .log__out')`)) === true);
t.check('saída explica o motivo', /pathspec|did not match|nao-existe/i.test((await t.text('.log__row--fail .log__out')) ?? ''), await t.text('.log__row--fail .log__out'));
t.check('consulta em cinza (readOnly)', (await t.count('.log__row--read')) >= 1);
await t.shot('log-aberto');

await filter('Minhas ações');
await sleep(300);
t.check('"Minhas ações" esconde as consultas de segundo plano e guarda as ações', (await t.ev(`[...document.querySelectorAll('.log__row')].every((r) => r.dataset.origin === 'user' || !r.classList.contains('log__row--read'))`)) === true && (await t.count('.log__row')) >= 2, await t.count('.log__row'));

await t.clickBtn('Copiar', "document.querySelector('.log__bar')");
await sleep(400);
const clip = await (await fetch(`${t.base}/clipboard`)).text();
t.check('copiar leva os comandos visíveis', / add /.test(clip) && !/git status/.test(clip), clip.slice(0, 160));

await t.clickBtn('Limpar', "document.querySelector('.log__bar')");
await sleep(300);
t.check('limpar esvazia e diz que ainda não há ações suas', (await t.count('.log__row')) === 0 && /Nenhum/.test((await t.text('.log__empty')) ?? ''), await t.text('.log__empty'));
t.check('grip de redimensionar', (await t.count('.log__grip')) === 1);

await t.ev(`document.querySelector('.log__toggle').click()`);
await sleep(300);
t.check('recolhe de novo', (await t.count('.log__body')) === 0 && (await t.ev(`localStorage.getItem('gitnexus.showGitLog')`)) === '0');
t.close();
