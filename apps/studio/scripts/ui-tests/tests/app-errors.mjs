// Erros inesperados da interface: viram uma linha no log do app (gitnexus-app.log) e um aviso discreto com o caminho do arquivo; o app segue aberto.
import { readFileSync } from 'node:fs';
import { connect, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev('location.reload()');
await t.until(`document.querySelector('.core')`, 15000);
await sleep(500);

t.check('sem erro, sem aviso', (await t.count('[data-testid="app-error"]')) === 0);

// uma exceção que ninguém trata, como um bug de verdade
await t.ev(`setTimeout(() => { throw new Error('boom-teste-1'); }, 0); true`);
await t.until(`document.querySelector('[data-testid="app-error"]')`, 8000);
const msg = (await t.text('[data-testid="app-error"]')) ?? '';
t.check('aparece o aviso discreto', /erro inesperado/i.test(msg), msg);
t.check('o aviso diz onde está o log', /gitnexus-app\.log/.test(msg), msg);
t.check('o aviso é um alerta acessível', (await t.ev(`document.querySelector('[data-testid="app-error"]').getAttribute('role')`)) === 'alert');

const file = /([^\s]*gitnexus-app\.log)/.exec(msg)?.[1];
let log = '';
try {
  log = file ? readFileSync(file, 'utf8') : '';
} catch {
  /* o check abaixo acusa */
}
t.check('o erro foi gravado no log, com data e a origem', /\d{4}-\d{2}-\d{2}T.* interface: janela: boom-teste-1/.test(log), log.slice(0, 300));
t.check('o log tem a pilha', /boom-teste-1[\s\S]*at /.test(log));

// promessa rejeitada sem tratamento
await t.ev(`Promise.reject(new Error('boom-promessa')); true`);
await sleep(800);
log = readFileSync(file, 'utf8');
t.check('promessa rejeitada também é registrada', /promessa rejeitada: boom-promessa/.test(log));

// o mesmo erro em sequência não inunda o log
await t.ev(`for (let i = 0; i < 5; i++) setTimeout(() => { throw new Error('boom-repetido'); }, i * 20); true`);
await sleep(800);
log = readFileSync(file, 'utf8');
t.check('o mesmo erro repetido é registrado uma vez só', (log.match(/boom-repetido/g) ?? []).length >= 1 && (log.match(/janela: boom-repetido/g) ?? []).length === 1, (log.match(/janela: boom-repetido/g) ?? []).length);

// fechar o aviso; o app continua funcionando
await t.ev(`document.querySelector('[data-testid="app-error-close"]').click()`);
await sleep(300);
t.check('Fechar tira o aviso', (await t.count('[data-testid="app-error"]')) === 0);
t.check('o app continua aberto e usável', (await t.count('.core__tabs')) >= 1);
await t.shot('erro-inesperado');
t.close();
