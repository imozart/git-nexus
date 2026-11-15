// Seletor de idioma (ComboBox padrão do app): bandeira, lista arredondada, troca de idioma, teclado.
import { connect, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
const BTN = '.lang .cbx__btn';
// um clique de verdade foca o botão; o `.click()` programático não, então focamos antes (é onde o teclado do combobox escuta)
const openList = () => t.ev(`(() => { const b = document.querySelector('${BTN}'); b.focus(); b.click(); })()`);

await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev('location.reload()');
await sleep(2500);
await t.until(`document.querySelector('${BTN}')`, 15000);
t.check('botão com bandeira', (await t.count(`${BTN} svg`)) >= 1);
t.check('é o combobox padrão do app', (await t.count('.lang.cbx.cbx--pill')) === 1);
t.check('sem select nativo', (await t.count('select.core__lang')) === 0);
await t.shot('language-fechado');
await openList();
await sleep(400);
t.check('lista abre com 2 opções', (await t.count('.cbx__opt')) === 2);
t.check('opção atual marcada', (await t.ev(`document.querySelector('.cbx__opt--selected .lang__name').textContent`)) === 'Português (Brasil)');
t.check('cada opção tem a bandeira', (await t.count('.cbx__opt svg')) >= 2);
t.check('cantos arredondados', (await t.ev(`getComputedStyle(document.querySelector('.cbx__list')).borderRadius`)) === '12px');
t.check('item ativo é o idioma atual', (await t.ev(`document.querySelector('.cbx__opt--active .lang__name')?.textContent`)) === 'Português (Brasil)');
t.check('lista alinhada à direita do botão', await t.ev(`(() => { const b = document.querySelector('${BTN}').getBoundingClientRect(), l = document.querySelector('.cbx__list').getBoundingClientRect(); return Math.abs(l.right - b.right) <= 2; })()`));
await t.shot('language-aberto');
await t.key('ArrowDown');
await t.key('Enter');
await sleep(500);
t.check('Enter troca para English', (await t.ev(`localStorage.getItem('gitnexus.locale')`)) === 'en');
t.check('lista fecha', (await t.count('.cbx__list')) === 0);
t.check('botão mostra EN', (await t.text('.lang__code')) === 'EN');
t.check('interface em inglês', /Commands/.test((await t.text('.core__cmd')) ?? ''));
t.check('foco volta ao botão', (await t.ev(`document.activeElement?.classList.contains('cbx__btn')`)) === true);
await openList();
await sleep(300);
await t.key('Escape');
await sleep(300);
t.check('Esc fecha', (await t.count('.cbx__list')) === 0);
await openList();
await sleep(300);
await t.ev(`document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
await sleep(300);
t.check('clique fora fecha', (await t.count('.cbx__list')) === 0);
// voltar ao idioma de partida: o estado é compartilhado entre os testes da mesma execução
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
t.close();
