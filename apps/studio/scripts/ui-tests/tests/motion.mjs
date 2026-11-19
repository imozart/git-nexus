// Movimento reduzido: o atributo data-reduced-motion do <html> (opção do app) e o prefers-reduced-motion do sistema mexem nos tokens de duração
// (--gn-motion-*), que os componentes usam; "Normal" vale mesmo com o sistema pedindo menos; a opção está nas Configurações, vale na hora e fica guardada.
import { connect, sleep, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);

const reload = async () => {
  await t.ev('window.__gnMarker = 1; location.reload()');
  await t.until(`window.__gnMarker === undefined && document.querySelector('.core')`, 30000);
  await sleep(600);
};
const token = (n) => t.ev(`getComputedStyle(document.documentElement).getPropertyValue('${n}').trim()`);
/** Duração de um token em milissegundos (o CSS compilado escreve .14s no lugar de 140ms). */
const ms = (n) => t.ev(`(() => { const v = getComputedStyle(document.documentElement).getPropertyValue('${n}').trim(); return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000; })()`);
const attr = () => t.ev(`document.documentElement.dataset.reducedMotion ?? null`);
const stored = () => t.ev(`localStorage.getItem('gitnexus.motion')`);
/** Duração da transição de um botão (em segundos) com os tokens do momento. */
const btnMs = () => t.ev(`parseFloat(getComputedStyle(document.querySelector('.gn-btn')).transitionDuration) * 1000`);
const emulate = (reduce) => t.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });

await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.removeItem('gitnexus.motion')`);

// 1. padrão ("Sistema") sem o sistema pedir nada: movimento normal
await emulate(false);
await reload();
const d1 = { attr: await attr(), base: await token('--gn-motion-base'), enter: await token('--gn-enter'), loop: await token('--gn-motion-loop') };
t.check('sem nada guardado e sem pedido do sistema: sem atributo e durações normais', (await attr()) === null && (await ms('--gn-motion-base')) === 140 && (await ms('--gn-enter')) === 140 && (await ms('--gn-motion-loop')) === 1100, d1);
t.check('o botão anima (≈120 ms)', Math.abs((await btnMs()) - 120) < 1);

// 2. o sistema pede menos movimento: "Sistema" acompanha
await emulate(true);
await sleep(300);
t.check('com o sistema pedindo menos, "Sistema" zera as durações e para o indicador sem fim (cheio e esmaecido)', (await ms('--gn-motion-base')) === 0.01 && (await ms('--gn-motion-loop')) === 0 && (await token('--gn-ind-width')) === '100%' && parseFloat(await token('--gn-ind-opacity')) === 0.6);
t.check('o botão deixa de animar (< 0,1 ms)', (await btnMs()) < 0.1);

// 3. "Normal" vale mesmo com o sistema pedindo menos
await t.ev(`localStorage.setItem('gitnexus.motion', 'normal')`);
await reload();
t.check('"Normal" (data-reduced-motion=false) mantém as durações normais mesmo com o sistema pedindo menos', (await attr()) === 'false' && (await ms('--gn-motion-base')) === 140 && Math.abs((await btnMs()) - 120) < 1);

// 4. "Reduzido" vale mesmo sem o sistema pedir
await emulate(false);
await t.ev(`localStorage.setItem('gitnexus.motion', 'reduced')`);
await reload();
t.check('"Reduzido" (data-reduced-motion=true) zera as durações sem o sistema pedir', (await attr()) === 'true' && (await ms('--gn-motion-base')) === 0.01 && (await ms('--gn-motion-slow')) === 0.01 && (await ms('--gn-enter')) === 0.01 && (await btnMs()) < 0.1);

// 5. valor inválido guardado cai em "Sistema"
await t.ev(`localStorage.setItem('gitnexus.motion', 'xyz')`);
await reload();
await sleep(400);
t.check('valor guardado inválido cai em "Sistema" (sem atributo) e a chave inválida some', (await attr()) === null && (await stored()) === null);

// 6. nas Configurações: Aparência > Movimento, vale na hora e fica guardado
await t.key(',', 2);
await t.until(`document.querySelector('[role="dialog"][aria-modal="true"]')`, 5000);
await sleep(300);
await t.ev(`[...document.querySelectorAll('.sd [role="tab"]')].find((x) => x.textContent.trim() === 'Aparência').click()`);
await sleep(300);
const seg = (opt) => t.ev(`(() => { const f = [...document.querySelectorAll('.sd__field')].find((x) => x.querySelector(':scope > span')?.textContent.trim() === 'Movimento'); const b = [...f.querySelectorAll('.gn-seg__opt')].find((o) => o.textContent.trim() === ${lit(opt)}); b?.click(); })()`).then(async () => { await sleep(250); return t.ev(`(() => { const f = [...document.querySelectorAll('.sd__field')].find((x) => x.querySelector(':scope > span')?.textContent.trim() === 'Movimento'); return [...f.querySelectorAll('.gn-seg__opt')].find((o) => o.getAttribute('aria-checked') === 'true')?.textContent.trim(); })()`); });
t.check('o campo Movimento existe nas Configurações, em Sistema por padrão', (await seg('Sistema')) === 'Sistema');
t.check('Reduzido: o atributo muda na hora, as durações zeram e a escolha fica guardada', (await seg('Reduzido')) === 'Reduzido' && (await attr()) === 'true' && (await ms('--gn-motion-base')) === 0.01 && (await stored()) === 'reduced');
t.check('Normal: atributo "false", durações normais e guardado', (await seg('Normal')) === 'Normal' && (await attr()) === 'false' && (await ms('--gn-motion-base')) === 140 && (await stored()) === 'normal');
t.check('Sistema: sem atributo e a chave some (o padrão não guarda)', (await seg('Sistema')) === 'Sistema' && (await attr()) === null && (await stored()) === null);
await t.key('Escape');
await sleep(300);

// 7. reduzido guardado vale ao abrir
await seg('Reduzido').catch(() => undefined);
await t.ev(`localStorage.setItem('gitnexus.motion', 'reduced')`);
await reload();
t.check('guardado "Reduzido" já vem aplicado na abertura', (await attr()) === 'true');

await t.ev(`localStorage.removeItem('gitnexus.motion')`);
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
