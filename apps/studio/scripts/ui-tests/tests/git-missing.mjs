// Git ausente: aviso, bloqueio do app (interface e chamadas), instalação automática com barra de progresso, falha com saída e cancelamento.
// O harness simula o Git pela página (`/fakegit`): `mode=missing` faz o app se comportar como num computador sem Git e `install` percorre as etapas.
import { connect, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);

const fake = (q) => t.ev(`fetch('/fakegit?${q}').then(r => r.json())`);
const gate = '[data-testid="git-gate"]';
/** Mensagem do erro que a chamada devolve (ou "ok"). */
const call = (expr) => t.ev(`(async () => { try { await ${expr}; return 'ok'; } catch (e) { return String(e.message); } })()`);

await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev('location.reload()');
await t.until(`document.querySelector('.core')`, 15000);
await sleep(500);

// --- com Git: nada muda ---
t.check('com o Git instalado não aparece aviso nenhum', (await t.count(gate)) === 0);
t.check('as chamadas funcionam normalmente', (await call(`window.gitNexus.getKnownRepositories()`)) === 'ok');

// --- sem Git: aviso e bloqueio ---
await fake('mode=missing&delay=150');
await t.ev('location.reload()');
await t.until(`document.querySelector('${gate}')`, 15000);
await sleep(300);
const title = (await t.text('[data-testid="git-title"]')) ?? '';
t.check('aparece o aviso "O Git não está instalado"', /não está instalado/i.test(title), title);
t.check('o aviso é um alertdialog acessível', (await t.ev(`document.querySelector('[role="alertdialog"]')?.getAttribute('aria-labelledby')`)) === 'git-title');
t.check('diz o que vai acontecer neste sistema', /Git for Windows/.test((await t.text('[data-testid="git-method"]')) ?? ''));
t.check('tem Instalar agora, Já instalei e Instalar manualmente', (await t.count('[data-testid="git-install"], [data-testid="git-recheck"], [data-testid="git-manual"]')) === 3);
t.check('o fundo do app fica inerte (teclado e leitor de tela)', (await t.ev(`document.getElementById('app').hasAttribute('inert')`)) === true);
await t.shot('git-ausente-aviso');

// o bloqueio não é só visual: as chamadas que dependem do Git são recusadas
const blocked = await call(`window.gitNexus.listBranches('/qualquer')`);
t.check('chamada que depende do Git é recusada com GIT_UNAVAILABLE', /GIT_UNAVAILABLE/.test(blocked), blocked);
t.check('chamada que não precisa de Git continua funcionando (catálogo)', (await call(`window.gitNexus.getKnownRepositories()`)) === 'ok');

// Esc e atalhos não furam o bloqueio
await t.key('Escape');
await sleep(300);
t.check('Esc não fecha o aviso', (await t.count(gate)) === 1);
await t.key('k', 2); // Ctrl+K: paleta de comandos
await sleep(300);
t.check('Ctrl+K não abre a paleta de comandos', (await t.count('.cp__box')) === 0);

// "Já instalei, verificar de novo" sem Git continua avisando
await t.ev(`document.querySelector('[data-testid="git-recheck"]').click()`);
await t.until(`document.querySelector('[data-testid="git-notice"]')`, 5000);
t.check('verificar de novo sem Git avisa que ainda não foi encontrado', /ainda não foi encontrado/i.test((await t.text('[data-testid="git-notice"]')) ?? ''));

// só o idioma continua escolhível
await t.clickBtn('EN');
await t.until(`document.querySelector('[data-testid="git-title"]')?.textContent.includes('Git is not installed')`, 4000);
t.check('trocar o idioma no aviso funciona', /Git is not installed/.test((await t.text('[data-testid="git-title"]')) ?? ''));
await t.clickBtn('PT');
await sleep(300);

// --- instalar manualmente ---
await t.ev(`document.querySelector('[data-testid="git-manual"]').click()`);
await sleep(300);
t.check('"Instalar manualmente" abre a página oficial (pedido ao processo principal)', (await fake('x=1')).manual === 1);

// --- falha: motivo e saída ---
await fake('fail=1');
await t.ev(`document.querySelector('[data-testid="git-install"]').click()`);
await t.until(`document.querySelector('[data-testid="git-progress"]')`, 5000);
t.check('ao clicar em Instalar agora aparece a barra de progresso', (await t.count('[data-testid="git-progress"]')) === 1);
t.check('a barra é um progressbar com nome acessível', (await t.ev(`document.querySelector('[data-testid="git-progress"]').getAttribute('role')`)) === 'progressbar');
await t.until(`document.querySelector('[data-testid="git-error"]')`, 15000);
const err = (await t.text('[data-testid="git-error"]')) ?? '';
t.check('na falha mostra o motivo', /Falha simulada/.test(err), err);
t.check('na falha oferece Tentar de novo, Instalar manualmente e Copiar detalhes', (await t.count('[data-testid="git-retry"], [data-testid="git-manual"], [data-testid="git-copy"]')) === 3);
t.check('o app continua bloqueado depois da falha', (await t.count(gate)) === 1);
await t.ev(`document.querySelector('[data-testid="git-copy"]').click()`);
await sleep(300);
const clip = await t.ev(`fetch('/clipboard').then(r => r.text())`);
t.check('Copiar detalhes leva o motivo para a área de transferência', /Falha simulada/.test(clip) && /status:/.test(clip), clip);
await t.shot('git-ausente-falha');

// --- sucesso: as etapas, o percentual e a liberação do app ---
await fake('fail=0&delay=250');
await t.ev(`document.querySelector('[data-testid="git-retry"]').click()`);
const seen = new Set();
let pct = null;
let cancelShown = false;
for (let i = 0; i < 80 && (await t.count(gate)) > 0; i++) {
  const step = await t.ev(`document.querySelector('[data-testid="git-step"]')?.dataset.step ?? null`);
  if (step) seen.add(step);
  if (step === 'downloading') {
    pct ??= await t.ev(`document.querySelector('[data-testid="git-progress"]')?.getAttribute('aria-valuenow')`);
    cancelShown ||= (await t.count('[data-testid="git-cancel"]')) === 1;
  }
  if (step === 'installing') t.check('na instalação propriamente dita não há Cancelar', (await t.count('[data-testid="git-cancel"]')) === 0);
  await sleep(150);
}
t.check('passou pelo download e pela conferência', seen.has('downloading') && seen.has('verifying'), [...seen]);
t.check('o download mostra percentual (aria-valuenow)', pct !== null && pct !== '' && !Number.isNaN(Number(pct)), pct);
t.check('durante o download dá para cancelar', cancelShown);
await t.until(`!document.querySelector('${gate}')`, 15000);
t.check('ao terminar o aviso some, sem reiniciar o app', (await t.count(gate)) === 0);
t.check('o app foi liberado: a chamada que dependia do Git deixou de ser recusada', !/GIT_UNAVAILABLE/.test(await call(`window.gitNexus.listBranches('/qualquer')`)));
t.check('o fundo deixou de ser inerte', (await t.ev(`document.getElementById('app').hasAttribute('inert')`)) === false);
const flash = (await t.text('.upd--info')) ?? '';
t.check('aparece o aviso de sucesso', /Git 2\.56\.1 instalado/.test(flash), flash);
await t.shot('git-instalado');

// --- cancelar durante o download ---
await fake('mode=missing&delay=300');
await t.ev('location.reload()');
await t.until(`document.querySelector('${gate}')`, 15000);
await t.ev(`document.querySelector('[data-testid="git-install"]').click()`);
await t.until(`document.querySelector('[data-testid="git-step"]')?.dataset.step === 'downloading' && document.querySelector('[data-testid="git-cancel"]')`, 15000);
await t.ev(`document.querySelector('[data-testid="git-cancel"]').click()`);
await t.until(`document.querySelector('[data-testid="git-error"]')`, 15000);
t.check('cancelar interrompe e volta ao aviso com saída', /cancelada/i.test((await t.text('[data-testid="git-error"]')) ?? '') && (await t.count('[data-testid="git-retry"]')) === 1);

t.close();
