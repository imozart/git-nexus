// Menus e popovers ancorados (menu de contexto, codificação, lista do combo, seletor de branch e sincronização): sombra e raio pelos tokens
// (--gn-shadow-md, --gn-radius-lg) e camadas por token. Os valores esperados são os dos tokens, resolvidos num elemento de teste.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, lit, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0')`);

const root = tmpRoot('gn-pop-');
const remote = join(root, 'remote.git');
git(root, 'init', '--bare', '-b', 'main', remote);
const repo = mkRepo(root, 'poprepo', { files: { 'a.txt': 'a\n' } });
git(repo, 'remote', 'add', 'origin', remote);
git(repo, 'push', '-q', '-u', 'origin', 'main');
git(repo, 'remote', 'set-head', 'origin', 'main');
writeFileSync(join(repo, 'a.txt'), 'a\nmudou\n');

// tokens como o navegador os calcula (sombra, raio) e as camadas (números)
const tok = async () => t.ev(`(() => { const p = document.createElement('span'); document.body.appendChild(p); p.style.boxShadow = 'var(--gn-shadow-md)'; p.style.borderRadius = 'var(--gn-radius-lg)'; const c = getComputedStyle(p); const r = { shadow: c.boxShadow, radius: c.borderTopLeftRadius, popover: Number(getComputedStyle(document.documentElement).getPropertyValue('--gn-z-popover')), dialog: Number(getComputedStyle(document.documentElement).getPropertyValue('--gn-z-dialog')) }; p.remove(); return r; })()`);
const style = (sel) => t.ev(`(() => { const e = document.querySelector(${lit(sel)}); if (!e) return null; const c = getComputedStyle(e); return { shadow: c.boxShadow, radius: c.borderTopLeftRadius, z: c.zIndex, anim: c.animationName, pos: c.position }; })()`);

await t.until(`document.querySelector('.conn__bar')`, 20000);
const T = await tok();
t.check('os tokens existem (sombra média, raio grande, camadas 1000 e 1100)', T.shadow !== 'none' && T.radius === '10px' && T.popover === 1000 && T.dialog === 1100, T);

// 1. lista do combo (seletor de idioma, na tela inicial)
await t.ev(`document.querySelector('.lang .cbx__btn, .lang button').click()`);
await t.until(`document.querySelector('.cbx__list')`, 5000);
const cbx = await style('.cbx__list');
t.check('lista do combo: sombra e raio dos tokens, entrada em fade', cbx.shadow === T.shadow && cbx.radius === T.radius && cbx.anim === 'gn-fade-in', cbx);
t.check('lista do combo: fica acima dos diálogos (--gn-z-dialog + 1), como abre de dentro deles', Number(cbx.z) === T.dialog + 1, cbx.z);
await t.key('Escape');
await sleep(200);

await t.openRepo(repo, 'poprepo');
await t.until(`document.querySelectorAll('.file').length >= 1 && document.querySelector('[data-testid="sync-main"]')`, 20000);
await sleep(600);

// 2. menu de contexto (clique direito num arquivo da árvore de alterações)
await t.ev(`document.querySelector('.file').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }))`);
await t.until(`document.querySelector('.ctx')`, 5000);
const ctx = await style('.ctx');
t.check('menu de contexto: sombra e raio dos tokens, camada de popover, entrada em fade', ctx.shadow === T.shadow && ctx.radius === T.radius && Number(ctx.z) === T.popover && ctx.anim === 'gn-fade-in', { ctx, T });
await t.key('Escape');
await sleep(200);

// 3. seletor de branch (painel e camada de captura)
await t.ev(`document.querySelector('.bp__btn').click()`);
await t.until(`document.querySelector('.bp__panel')`, 5000);
const bp = await style('.bp__panel');
const bpLayer = await style('.bp__layer');
t.check('seletor de branch: painel com sombra e raio dos tokens e entrada em fade', bp.shadow === T.shadow && bp.radius === T.radius && bp.anim === 'gn-fade-in', bp);
t.check('seletor de branch: a camada de captura está na camada de popover', Number(bpLayer.z) === T.popover, bpLayer);
// o submenu (bp__fly) fica uma camada acima, se o primeiro item abrir um
const hasFly = await t.ev(`(() => { const row = document.querySelector('.bp__panel [data-fly]'); if (!row) return false; row.click(); return true; })()`).catch(() => false);
if (hasFly) {
  await sleep(300);
  const fly = await style('.bp__fly');
  if (fly) t.check('seletor de branch: o submenu fica uma camada acima da do painel', Number(fly.z) === T.popover + 1 && fly.shadow === T.shadow && fly.radius === T.radius, fly);
}
await t.key('Escape');
await sleep(200);
await t.until(`!document.querySelector('.bp__panel')`, 4000).catch(() => undefined);

// 4. popover de sincronização
await t.ev(`document.querySelector('[data-testid="sync-details"]').click()`);
await t.until(`document.querySelector('.ss__panel')`, 5000);
const ss = await style('.ss__panel');
const ssLayer = await style('.ss__layer');
t.check('popover de sincronização: sombra e raio dos tokens e entrada em fade', ss.shadow === T.shadow && ss.radius === T.radius && ss.anim === 'gn-fade-in', ss);
t.check('popover de sincronização: a camada de captura está na camada de popover', Number(ssLayer.z) === T.popover, ssLayer);
await t.key('Escape');
await sleep(200);

// 5. menu de codificação (rodapé, com um arquivo aberto)
await t.ev(`document.querySelector('.file').click()`);
await t.until(`document.querySelector('[data-testid="encoding-btn"]')`, 12000);
await t.ev(`document.querySelector('[data-testid="encoding-btn"]').click()`);
await t.until(`document.querySelector('[data-testid="encoding-menu"]')`, 5000);
const enc = await style('[data-testid="encoding-menu"]');
t.check('menu de codificação: sombra e raio dos tokens, camada de popover, entrada em fade', enc.shadow === T.shadow && enc.radius === T.radius && Number(enc.z) === T.popover && enc.anim === 'gn-fade-in', { enc, T });
await t.key('Escape');

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
