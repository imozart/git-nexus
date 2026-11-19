// Log do Git: barra recolhida, lista de comandos, filtro "só alterações", falha com saída, copiar e limpar.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.removeItem('gitnexus.showGitLog'); localStorage.removeItem('gitnexus.gitLogOnlyChanges')`);
const root = tmpRoot('gn-log-');
const repo = mkRepo(root, 'logrepo');
writeFileSync(join(repo, 'a.txt'), 'um\ndois\n');
await t.openRepo(repo, 'logrepo');
await t.until(`document.querySelector('.log')`, 15000);
// caminho como o app o guardou (o tmpdir do Windows pode vir no formato curto 8.3)
const tabRepo = await t.text('.rv__path');
t.check('barra do log existe e começa recolhida', (await t.count('.log')) === 1 && (await t.count('.log__body')) === 0);
await t.until(`document.querySelector('.log__last')`, 10000);
t.check('barra mostra o último comando', /^git /.test((await t.text('.log__last')) ?? ''), await t.text('.log__last'));
t.check('barra mostra a contagem', /\d+ comandos?/.test((await t.text('.log__count')) ?? ''), await t.text('.log__count'));
await t.shot('log-recolhido');

await t.ev(`document.querySelector('.log__toggle').click()`);
await sleep(400);
t.check('abre a lista', (await t.count('.log__row')) >= 1);
t.check('lista tem git status', (await t.ev(`[...document.querySelectorAll('.log__cmd')].some(e => e.textContent.startsWith('git status'))`)) === true);
t.check('abertura lembrada', (await t.ev(`localStorage.getItem('gitnexus.showGitLog')`)) === '1');

// um comando que altera (git add) e um que falha (arquivo inexistente)
await t.ev(`window.gitNexus.stageFiles(${lit(tabRepo)}, ['a.txt'])`);
await t.ev(`window.gitNexus.stageFiles(${lit(tabRepo)}, ['nao-existe.txt']).catch(() => null)`);
await t.until(`[...document.querySelectorAll('.log__cmd')].some(e => e.textContent.includes('nao-existe'))`, 8000);
t.check('git add aparece', (await t.ev(`[...document.querySelectorAll('.log__cmd')].some(e => / add /.test(e.textContent))`)) === true);
t.check('falha aparece em vermelho com a saída aberta', (await t.ev(`!!document.querySelector('.log__row--fail .log__out')`)) === true);
t.check('saída explica o motivo', /pathspec|did not match|nao-existe/i.test((await t.text('.log__row--fail .log__out')) ?? ''), await t.text('.log__row--fail .log__out'));
t.check('consulta em cinza (readOnly)', (await t.count('.log__row--read')) >= 1);
await t.shot('log-aberto');

await t.ev(`document.querySelector('.log__opt input').click()`);
await sleep(300);
t.check('filtro só alterações esconde consultas', (await t.count('.log__row--read')) === 0 && (await t.count('.log__row')) >= 2, [await t.count('.log__row--read'), await t.count('.log__row')]);

await t.clickBtn('Copiar', "document.querySelector('.log__bar')");
await sleep(400);
const clip = await (await fetch(`${t.base}/clipboard`)).text();
t.check('copiar leva os comandos visíveis', / add /.test(clip) && !/git status/.test(clip), clip.slice(0, 120));

await t.clickBtn('Limpar', "document.querySelector('.log__bar')");
await sleep(300);
t.check('limpar esvazia', (await t.count('.log__row')) === 0 && /Nenhum comando/.test((await t.text('.log__empty')) ?? ''), await t.text('.log__empty'));
t.check('grip de redimensionar', (await t.count('.log__grip')) === 1);

await t.ev(`document.querySelector('.log__toggle').click()`);
await sleep(300);
t.check('recolhe de novo', (await t.count('.log__body')) === 0 && (await t.ev(`localStorage.getItem('gitnexus.showGitLog')`)) === '0');
t.close();
