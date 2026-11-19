// Barra de título integrada às abas: a moldura da janela vem do processo principal (aqui, simulada pela URL: ?titlebar=overlay|inset) e a interface
// marca o <html> (data-titlebar), faz da faixa de abas a região de arrasto (abas e botões ficam fora dela), deixa margem para os botões nativos
// e informa ao processo principal as cores do tema (escuro/claro) para o overlay acompanhá-lo. Sem moldura integrada (padrão), nada muda.
import { connect, lit, sleep } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);

const open = async (query) => {
  await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0')`);
  await t.ev(`window.__gnMarker = 1; location.assign(location.pathname + ${lit(query)})`);
  await t.until(`window.__gnMarker === undefined && document.querySelector('.core__top')`, 30000);
  await sleep(700);
};
const style = (sel, prop) => t.ev(`getComputedStyle(document.querySelector(${lit(sel)})).getPropertyValue(${lit(prop)}).trim()`);
const region = (sel) => style(sel, '-webkit-app-region');
const calls = () => t.ev(`window.__titleBarCalls`);
const emulate = (scheme) => t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });

// 1. padrão: moldura nativa, nada de arrasto nem margem
await t.ev(`localStorage.removeItem('gitnexus.theme')`);
await open('');
t.check('sem moldura integrada: data-titlebar="native"', (await t.ev(`document.documentElement.dataset.titlebar`)) === 'native');
t.check('a faixa de abas não é região de arrasto e não tem margem para botões', (await region('.core__top')) !== 'drag' && (await style('.core__top', 'padding-right')) === '0px' && (await style('.core__top', 'padding-left')) === '0px');
t.check('nenhuma cor é enviada ao overlay', (await calls()).length === 0, await calls());

// 2. overlay (Windows e Linux)
await open('?titlebar=overlay');
t.check('overlay: data-titlebar="overlay"', (await t.ev(`document.documentElement.dataset.titlebar`)) === 'overlay');
t.check('overlay: a faixa de abas é a região de arrasto', (await region('.core__top')) === 'drag');
const regions = { aba: await region('.gn-tab'), comandos: await region('.core__cmd'), engrenagem: await region('[data-testid="settings-open"]'), tema: await region('[data-testid="theme-picker"]'), idioma: await region('.lang') };
t.check('overlay: as abas, o botão Comandos e a engrenagem e os seletores de tema e idioma ficam fora da região de arrasto (no-drag)', regions.aba === 'no-drag' && regions.comandos === 'no-drag' && regions.engrenagem === 'no-drag' && regions.tema === 'no-drag' && regions.idioma === 'no-drag', regions);
t.check('overlay: sem os botões nativos (navegador comum) não sobra margem à direita, nem à esquerda', (await style('.core__top', 'padding-right')) === '0px' && (await style('.core__top', 'padding-left')) === '0px');
t.check('overlay: a faixa mantém os 43 px que o overlay dos botões usa', Math.round(await t.ev(`document.querySelector('.core__top').getBoundingClientRect().height`)) === 43);
const first = await calls();
t.check('overlay: as cores do tema escuro foram enviadas ao abrir (#17181b e #e3e5e8)', first.length >= 1 && first.at(-1).color === '#17181b' && first.at(-1).symbolColor === '#e3e5e8', first);

// 3. o overlay acompanha a troca de tema, na hora e sem recarregar
await t.ev(`localStorage.setItem('gitnexus.theme', 'system')`);
await emulate('dark');
await open('?titlebar=overlay');
const before = (await calls()).length;
await emulate('light');
await t.until(`window.__titleBarCalls.length > ${before}`, 8000).catch(() => undefined);
const light = (await calls()).at(-1);
t.check('overlay: ao ir para o tema claro enviam-se as cores do claro (#f4f5f7 e #1f2328), sem recarregar', light?.color === '#f4f5f7' && light?.symbolColor === '#1f2328', await calls());
await emulate('dark');
await t.until(`window.__titleBarCalls.at(-1).color === '#17181b'`, 8000).catch(() => undefined);
t.check('overlay: e de volta ao escuro', (await calls()).at(-1)?.color === '#17181b', await calls());
await t.ev(`localStorage.removeItem('gitnexus.theme')`);
await emulate('no-preference');

// 4. macOS: semáforo à esquerda
await open('?titlebar=inset');
t.check('inset: data-titlebar="inset", região de arrasto e margem de 78 px à esquerda para o semáforo', (await t.ev(`document.documentElement.dataset.titlebar`)) === 'inset' && (await region('.core__top')) === 'drag' && (await style('.core__top', 'padding-left')) === '78px', await style('.core__top', 'padding-left'));
t.check('inset: as abas continuam clicáveis (fora do arrasto) e nenhuma cor é enviada (só o overlay usa)', (await region('.gn-tab')) === 'no-drag' && (await calls()).length === 0, await calls());

// 5. a interface segue funcionando: a aba do início abre e o botão Comandos abre a paleta
await t.ev(`document.querySelector('.core__cmd').click()`);
await t.until(`document.querySelector('[role="dialog"], .cp')`, 5000).catch(() => undefined);
t.check('com a barra integrada o botão Comandos ainda abre a paleta', (await t.count('[role="dialog"], .cp')) >= 1);
await t.key('Escape');

await open('');
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
