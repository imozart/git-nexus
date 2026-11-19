// Escolha de idioma na primeira abertura: aparece só sem nada guardado (o harness marca como já mostrada, exceto aqui: gitnexus.testNoSeed), lista o catálogo com
// o idioma do sistema já marcado, troca a interface na hora ao escolher, grava a preferência, pode ser pulada (o sistema continua valendo) e não volta.
import { connect, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);

const reload = async () => {
  // espera a página NOVA (a marca some com o recarregamento), não o .core da antiga que ainda está descarregando
  await t.ev('window.__gnMarker = 1; location.reload()');
  await t.until(`window.__gnMarker === undefined && document.querySelector('.core')`, 30000);
  await sleep(800);
};
const clear = () => t.ev(`localStorage.setItem('gitnexus.testNoSeed', '1'); localStorage.removeItem('gitnexus.locale'); localStorage.removeItem('gitnexus.localeAsked')`);
const ls = (k) => t.ev(`localStorage.getItem('${k}')`);
const welcome = () => t.ev(`!!document.querySelector('[data-testid="locale-welcome"]')`);

// 1. sem nada guardado: a escolha aparece, como diálogo modal, com o catálogo e o idioma do sistema marcado
await clear();
await reload();
t.check('sem idioma guardado a escolha aparece antes da primeira tela', await welcome());
t.check('é um diálogo modal acessível, com título', (await t.ev(`(() => { const d = document.querySelector('[role="dialog"][aria-modal="true"]'); return !!d && !!document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim(); })()`)) === true);
const langs = await t.ev(`[...document.querySelectorAll('[data-testid="locale-welcome"] input[type=radio]')].map((r) => r.value + (r.checked ? '*' : ''))`);
t.check('lista todos os idiomas do catálogo (pt-BR e en), nomes nativos', langs.length === 2 && langs.some((x) => x.startsWith('pt-BR')) && langs.some((x) => x.startsWith('en')) && (await t.ev(`[...document.querySelectorAll('[data-testid="locale-welcome"] label')].map((l) => l.textContent.trim()).join('|')`)) === 'Português (Brasil)|English', langs);
t.check('o idioma do sistema já vem marcado (exatamente um) e a interface está nele', langs.filter((x) => x.endsWith('*')).length === 1);
t.check('nenhuma bandeira (só texto)', (await t.ev(`document.querySelectorAll('[data-testid="locale-welcome"] svg').length`)) === 0);
t.check('o fundo (#app) está inerte enquanto a escolha está aberta', await t.ev(`document.getElementById('app').hasAttribute('inert')`));

// 2. escolher troca a interface na hora e grava; Continuar fecha
await t.ev(`document.querySelector('[data-testid="locale-welcome"] input[value="pt-BR"]').click()`);
await sleep(400);
t.check('escolher Português troca a interface na hora (título em português)', (await t.ev(`document.getElementById('welcome-title').textContent.trim()`)) === 'Escolha o idioma');
t.check('e grava o idioma (gitnexus.locale=pt-BR)', (await ls('gitnexus.locale')) === 'pt-BR');
await t.ev(`document.querySelector('[data-testid="locale-welcome-continue"]').click()`);
await sleep(400);
t.check('Continuar fecha a escolha e libera a tela', !(await welcome()) && (await t.ev(`!document.getElementById('app').hasAttribute('inert')`)));
t.check('marca a escolha como mostrada', (await ls('gitnexus.localeAsked')) === '1');
await reload();
t.check('depois de recarregar a escolha não volta', !(await welcome()));

// 3. pular: o sistema continua valendo (nada de idioma guardado) e também não volta
await clear();
await reload();
t.check('apagando as marcas, a escolha volta', await welcome());
await t.ev(`document.querySelector('[data-testid="locale-welcome-skip"]').click()`);
await sleep(400);
t.check('Usar o idioma do sistema fecha, não guarda idioma e marca como mostrada', !(await welcome()) && (await ls('gitnexus.locale')) === null && (await ls('gitnexus.localeAsked')) === '1');
await reload();
t.check('depois de pular, a escolha não volta', !(await welcome()));

// 4. Esc pula
await clear();
await reload();
await t.key('Escape');
await sleep(400);
const esc = { aberta: await welcome(), locale: await ls('gitnexus.locale'), asked: await ls('gitnexus.localeAsked'), foco: await t.ev(`document.activeElement?.tagName + ':' + (document.activeElement?.value ?? '')`) };
t.check('Esc pula (como "Usar o idioma do sistema")', !esc.aberta && esc.locale === null && esc.asked === '1', esc);

// 5. quem atualiza de uma versão anterior (idioma já guardado) não vê a escolha
await clear();
await t.ev(`localStorage.setItem('gitnexus.locale', 'en')`);
await reload();
t.check('com o idioma já guardado a escolha não aparece', !(await welcome()));

await t.ev(`localStorage.removeItem('gitnexus.testNoSeed'); localStorage.removeItem('gitnexus.locale')`);
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
