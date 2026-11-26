// Primeiro uso guiado (#288): numa instalação limpa o passeio de cinco passos começa sozinho, destaca o controle de verdade, anda por teclado e por mouse, é pulável,
// retomável (continua do passo em que o app foi fechado), não volta depois de pulado e pode ser revisto (Configurações e paleta). Só para quem chega.
import { git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';
import { connect } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
const theme = process.env.GN_TOUR_THEME ?? 'dark';
// `testTour`: o harness NÃO marca o passeio como visto (nos outros testes ele é pulado de antemão)
await t.ev(`localStorage.setItem('gitnexus.testTour', '1'); localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.theme', ${lit(theme)}); localStorage.removeItem('gitnexus.tour')`);

const tourState = () => t.ev(`JSON.parse(localStorage.getItem('gitnexus.tour') ?? 'null')`);
const title = () => t.text('[data-testid="tour-title"]');
const progress = () => t.text('[data-testid="tour-progress"]');
const reload = async () => {
  await t.ev('location.reload()');
  await t.until(`document.querySelector('.core') && typeof window.gitNexus?.getKnownRepositories === 'function'`, 20000);
  await sleep(500);
};
const spot = () => t.ev(`(() => { const s = document.querySelector('[data-testid="tour-spot"]'); if (!s) return null; const r = s.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
const rectOf = (sel) => t.ev(`(() => { const e = [...document.querySelectorAll(${lit(sel)})].find((x) => x.offsetParent !== null); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
/** O destaque cobre o controle (com o respiro de 6 px de cada lado, e uma folga de 3). */
const covers = async (sel) => {
  const s = await spot();
  const r = await rectOf(sel);
  return !!s && !!r && Math.abs(s.l - (r.l - 6)) <= 3 && Math.abs(s.t - (r.t - 6)) <= 3 && Math.abs(s.w - (r.w + 12)) <= 3 && Math.abs(s.h - (r.h + 12)) <= 3;
};

// --- instalação limpa: começa sozinho ------------------------------------------------------------------------------------------------------------------------------
await reload();
await t.until(`document.querySelector('[data-testid="tour"]')`, 8000);
t.check('numa instalação limpa (sem repositórios) o passeio começa sozinho no passo 1 de 5', (await progress()) === 'Passo 1 de 5' && /Comece por um repositório/.test(await title()), [await progress(), await title()]);
t.check('o cartão é um diálogo NÃO modal, com nome (não bloqueia a tela)', (await t.ev(`(() => { const c = document.querySelector('[data-testid="tour-card"]'); return c.getAttribute('role') === 'dialog' && c.getAttribute('aria-modal') === 'false' && !!c.getAttribute('aria-label'); })()`)) === true);
t.check('o passo 1 destaca os botões de verdade (Adicionar, Clonar, Novo, Varrer)', await covers('[data-tour="repos"]'), [await spot(), await rectOf('[data-tour="repos"]')]);
t.check('o foco já está em "Próximo" (Enter avança)', (await t.ev(`document.activeElement?.dataset?.testid`)) === 'tour-next');
t.check('o fundo não captura cliques (o controle destacado continua utilizável)', (await t.ev(`getComputedStyle(document.querySelector('[data-testid="tour"]')).pointerEvents`)) === 'none' && (await t.ev(`getComputedStyle(document.querySelector('[data-testid="tour-card"]')).pointerEvents`)) === 'auto');
t.check('no passo 1 não há "Voltar"', (await t.count('[data-testid="tour-back"]')) === 0);
await t.shot('passeio-1');

// teclado: Enter avança; Tab fica no cartão; Voltar volta
await t.key('Enter');
await sleep(500);
t.check('Enter em "Próximo" vai ao passo 2 (as visões), e o foco continua no "Próximo"', (await progress()) === 'Passo 2 de 5' && /Uma aba por repositório/.test(await title()) && (await t.ev(`document.activeElement?.dataset?.testid`)) === 'tour-next', [await progress(), await title()]);
t.check('as visões só existem com um repositório aberto: o passo explica e avisa, sem destaque', (await spot()) === null && (await t.count('[data-testid="tour-notarget"]')) === 1);
const seen = [];
for (let i = 0; i < 3; i++) {
  await t.key('Tab');
  seen.push(await t.ev(`document.activeElement?.dataset?.testid`));
}
t.check('o Tab circula só entre os botões do cartão (Pular, Voltar, Próximo)', new Set(seen).size === 3 && seen.every((x) => ['tour-skip', 'tour-back', 'tour-next'].includes(x)), seen);
await t.ev(`document.querySelector('[data-testid="tour-back"]').click()`);
await sleep(400);
t.check('Voltar leva ao passo 1 e o destaque volta', (await progress()) === 'Passo 1 de 5' && (await covers('[data-tour="repos"]')));
await t.ev(`document.querySelector('[data-testid="tour-next"]').click()`);
await sleep(300);
await t.ev(`document.querySelector('[data-testid="tour-next"]').click()`);
await sleep(400);
t.check('o passo 3 (commit) sem repositório também só explica', (await progress()) === 'Passo 3 de 5' && /Commit com o linter/.test(await title()) && (await spot()) === null);
await t.ev(`document.querySelector('[data-testid="tour-next"]').click()`);
await sleep(500);
t.check('o passo 4 destaca o botão da paleta, no alto da tela', (await progress()) === 'Passo 4 de 5' && (await covers('[data-tour="palette"]')), [await spot(), await rectOf('[data-tour="palette"]')]);
t.check('o texto usa a tecla do sistema (Ctrl, aqui)', /Ctrl\+K/.test((await t.text('.tour__body')) ?? ''), await t.text('.tour__body'));
await t.shot('passeio-4');

// retomável: o app fecha no meio e continua do passo em que parou
const midway = await tourState();
t.check('o passo fica gravado a cada avanço (não terminou)', midway?.done === false && midway?.step === 3, midway);
await reload();
await t.until(`document.querySelector('[data-testid="tour"]')`, 8000);
t.check('depois de recarregar, o passeio CONTINUA do passo 4 (retomável)', (await progress()) === 'Passo 4 de 5', await progress());

// último passo e conclusão
await t.ev(`document.querySelector('[data-testid="tour-next"]').click()`);
await sleep(500);
t.check('o passo 5 destaca as Configurações e o botão vira "Concluir"', (await progress()) === 'Passo 5 de 5' && (await covers('[data-tour="settings"]')) && /Concluir/.test((await t.text('[data-testid="tour-next"]')) ?? ''));
await t.shot('passeio-5');
await t.ev(`document.querySelector('[data-testid="tour-next"]').click()`);
await sleep(400);
t.check('concluir fecha o passeio e o grava como terminado', (await t.count('[data-testid="tour"]')) === 0 && (await tourState())?.done === true);
await reload();
await sleep(1500);
t.check('terminado, não reaparece ao reabrir o app', (await t.count('[data-testid="tour"]')) === 0);

// --- rever: Configurações e paleta -----------------------------------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector('[data-testid="settings-open"]').click()`);
await t.until(`document.querySelector('[data-testid="settings-tour"]')`, 5000);
await t.ev(`document.querySelector('[data-testid="settings-tour"]').click()`);
await t.until(`document.querySelector('[data-testid="tour"]')`, 4000);
t.check('"Rever o passeio" nas Configurações fecha o diálogo e recomeça do passo 1', (await t.count('[data-testid="settings-nav"]')) === 0 && (await progress()) === 'Passo 1 de 5');
await t.key('Escape');
await sleep(400);
t.check('Esc pula o passeio (some na hora)', (await t.count('[data-testid="tour"]')) === 0);
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 4000);
await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = 'passeio'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(400);
await t.key('Enter');
await t.until(`document.querySelector('[data-testid="tour"]')`, 4000);
t.check('"Rever o passeio de boas-vindas" na paleta também recomeça', (await progress()) === 'Passo 1 de 5');
await t.ev(`document.querySelector('[data-testid="tour-skip"]').click()`);
await sleep(300);
t.check('"Pular" fecha o passeio', (await t.count('[data-testid="tour"]')) === 0);

// --- com um repositório aberto, os passos destacam as telas de verdade ---------------------------------------------------------------------------------
const root = tmpRoot('gn-uso-');
const repo = mkRepo(root, 'passeio-repo', { files: { 'a.txt': 'um\n' } });
git(repo, 'config', 'core.fsmonitor', 'false');
await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await reload();
await t.until(`document.querySelector('li.repo')`, 15000);
await sleep(1500);
t.check('quem já tem repositórios não é interrompido: o passeio não começa sozinho', (await t.count('[data-testid="tour"]')) === 0);
await t.ev(`localStorage.setItem('gitnexus.tour', JSON.stringify({ done: false, step: 0 }))`);
await reload();
await sleep(1500);
t.check('mesmo sem ter terminado o passeio, com repositórios catalogados ele não começa sozinho', (await t.count('[data-testid="tour"]')) === 0);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="repo-views"]')`, 15000);
await sleep(800);
await t.key('k', 2);
await t.until(`document.querySelector('.cp__input')`, 4000);
await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = 'passeio'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(400);
await t.key('Enter');
await t.until(`document.querySelector('[data-testid="tour"]')`, 4000);
t.check('dentro de um repositório, o passo 1 só explica (a lista está em outra aba)', (await spot()) === null && (await progress()) === 'Passo 1 de 5');
await t.ev(`document.querySelector('[data-testid="tour-next"]').click()`);
await sleep(600);
t.check('o passo 2 destaca o seletor de visões de verdade', (await progress()) === 'Passo 2 de 5' && (await covers('[data-tour="views"]')), [await spot(), await rectOf('[data-tour="views"]')]);
await t.shot('passeio-2-visoes');
await t.ev(`document.querySelector('[data-testid="tour-next"]').click()`);
await sleep(600);
t.check('o passo 3 destaca o formulário de commit', (await progress()) === 'Passo 3 de 5' && (await covers('[data-tour="commit"]')), [await spot(), await rectOf('[data-tour="commit"]')]);
await t.shot('passeio-3-commit');
await t.key('Escape');
await sleep(300);
t.check('sem erro de página', t.errors().filter((e) => !/favicon|Failed to fetch/.test(e)).length === 0, t.errors());
t.close();
