// "Novidades": botão na página principal → diálogo com o CHANGELOG.md, botão do GitHub, links e teclado.
import { connect, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);

await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev('location.reload()');
await sleep(2500);
await t.until(`document.querySelector('.conn__actions')`, 15000);
await sleep(1500); // deixa terminar as chamadas que o reload abortou
const baseErrors = t.errors().length; // o reload aborta chamadas em andamento; só interessa o que aparece depois

// o que o app mandaria abrir no navegador (o `api` do renderer é o próprio window.gitNexus)
await t.ev(`window.__opened = []; window.gitNexus.openExternal = async (u) => { window.__opened.push(u); }`);

const btn = `[...document.querySelectorAll('.conn__actions button')].find((b) => b.textContent.trim() === 'Novidades')`;
t.check('botão "Novidades" na página principal', await t.ev(`!!(${btn})`));
t.check('sem diálogo antes de clicar', (await t.count('.cl__box')) === 0);
await t.ev(`(${btn}).click()`);
await t.until(`document.querySelector('.cl__box') && document.querySelectorAll('.ver').length > 0`, 10000);
await sleep(300);
await t.shot('changelog-aberto');

t.check('diálogo acessível', await t.ev(`(() => { const b = document.querySelector('.cl__box'); return b.getAttribute('role') === 'dialog' && b.getAttribute('aria-modal') === 'true'; })()`));
t.check('título', (await t.text('.cl__head h3')) === 'Novidades do GitNexus');
t.check('mostra a versão em uso', /Você usa a versão \d+\.\d+\.\d+/.test((await t.text('.cl__head p')) ?? ''));
t.check('lista as versões do CHANGELOG.md', (await t.count('.ver')) >= 2);
t.check('versão mais recente aberta', (await t.ev(`document.querySelector('.ver').open`)) === true);
t.check('versão antiga fechada (recolhível)', (await t.ev(`document.querySelectorAll('.ver')[1].open`)) === false);
t.check('itens renderizados com seções', (await t.count('.ver:first-of-type h4')) >= 1 && (await t.count('.ver:first-of-type li')) >= 1);
t.check('hash do commit é link', (await t.count('.ver a.is-code')) >= 1);
t.check('nada de HTML injetado no changelog', (await t.count('.cl__body img, .cl__body script')) === 0);

// botão do GitHub: marca 16x16 + rótulo, no tamanho do botão padrão
const gh = `document.querySelector('.ghbtn')`;
t.check('botão do GitHub com o rótulo', (await t.ev(`${gh}.textContent.trim()`)) === 'Ver no GitHub');
t.check('marca do GitHub (SVG 16x16)', await t.ev(`(() => { const s = ${gh}.querySelector('svg'); return !!s && s.getAttribute('width') === '16' && s.getAttribute('viewBox') === '0 0 16 16'; })()`));
t.check('altura de 32px e cantos de 6px (botão padrão do GitHub)', await t.ev(`(() => { const c = getComputedStyle(${gh}); return c.height === '32px' && c.borderRadius === '6px'; })()`));
await t.ev(`${gh}.click()`);
await sleep(300);
t.check('abre o CHANGELOG.md no GitHub', (await t.ev(`window.__opened.at(-1)`)) === 'https://github.com/imozart/git-nexus/blob/main/CHANGELOG.md');

// link de commit abre pelo app (não navega a janela)
const before = await t.ev('location.href');
await t.ev(`document.querySelector('.ver a.is-code').click()`);
await sleep(300);
t.check('link de commit abre no navegador', /^https:\/\/github\.com\/imozart\/git-nexus\/commit\/[0-9a-f]+$/.test((await t.ev(`window.__opened.at(-1)`)) ?? ''));
t.check('a janela do app não navegou', (await t.ev('location.href')) === before);

// fechar: Esc e clique fora
await t.key('Escape');
await sleep(300);
t.check('Esc fecha', (await t.count('.cl__box')) === 0);
await t.ev(`(${btn}).click()`);
await t.until(`document.querySelector('.cl__box')`, 5000);
await t.ev(`document.querySelector('.cl').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
await sleep(300);
t.check('clique fora fecha', (await t.count('.cl__box')) === 0);

// o diálogo não gerou nenhum erro de página (o reload abaixo aborta chamadas em andamento e geraria falsos erros)
t.check('sem erros novos no console', t.errors().length === baseErrors);

// inglês
await t.ev(`localStorage.setItem('gitnexus.locale', 'en')`);
await t.ev('location.reload()');
await sleep(2500);
await t.until(`document.querySelector('.conn__actions')`, 15000);
t.check('botão em inglês', await t.ev(`[...document.querySelectorAll('.conn__actions button')].some((b) => b.textContent.trim() === "What's new")`));
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`); // estado compartilhado entre os testes
t.close();
