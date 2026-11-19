// Seletor de branch do cabeçalho do repositório: mostra a branch, pesquisa nas locais E remotas, abre o menu de cada branch, troca de branch
// e cria uma branch a partir da versão MAIS RECENTE do remoto (busca antes). Usa git de verdade, com um remoto local (bare).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`); // este teste controla quando o clone busca (a busca automática tem teste próprio)
await t.ev(`localStorage.removeItem('gitnexus.branchPicker.expanded')`);

// --- cenário: remoto com a main, uma branch só no remoto, uma local, e o remoto andando sem o clone saber --------------------------
const root = tmpRoot('gn-bp-');
const remote = join(root, 'remote.git');
git(root, 'init', '--bare', '-b', 'main', remote);
const repo = mkRepo(root, 'bprepo');
git(repo, 'remote', 'add', 'origin', remote);
git(repo, 'push', '-q', '-u', 'origin', 'main');
git(repo, 'remote', 'set-head', 'origin', 'main');
git(repo, 'branch', 'feat/local-a');

const other = join(root, 'other');
git(root, 'clone', '-q', remote, other);
for (const [k, v] of [['user.name', 'O'], ['user.email', 'o@e.com'], ['commit.gpgsign', 'false']]) git(other, 'config', k, v);
writeFileSync(join(other, 'r.txt'), 'r\n');
git(other, 'add', '.');
git(other, 'commit', '-qm', 'branch so no remoto');
git(other, 'push', '-q', 'origin', 'HEAD:refs/heads/feat/remote-b');
git(repo, 'fetch', '-q', 'origin'); // o clone conhece origin/feat/remote-b e a main de agora...
git(other, 'checkout', '-q', 'main');
writeFileSync(join(other, 'novo.txt'), 'novo\n');
git(other, 'add', '.');
git(other, 'commit', '-qm', 'novidade na main do remoto');
git(other, 'push', '-q', 'origin', 'main'); // ...e a main do remoto anda depois: o clone NÃO sabe
const remoteMain = git(other, 'rev-parse', 'HEAD').trim();

await t.until(`document.querySelector('.conn__bar')`, 15000);
await t.openRepo(repo, 'bprepo');
await t.until(`document.querySelector('.bp__btn .bp__name')?.textContent.trim() === 'main'`, 15000); // espera o status trazer a branch

// Valores entram no código da página em base64 (nunca por JSON.stringify): não há como um valor virar código.
const lit = (s) => `new TextDecoder().decode(Uint8Array.from(atob('${Buffer.from(String(s), 'utf8').toString('base64')}'), (c) => c.charCodeAt(0)))`;
const set = (sel, value) => t.ev(`(() => { const i = document.querySelector(${lit(sel)}); i.value = ${lit(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const clickText = (sel, start) => t.ev(`(() => { const b = [...document.querySelectorAll(${lit(sel)})].find((x) => x.textContent.trim().startsWith(${lit(start)})); b?.click(); return !!b; })()`);
const rows = () => t.ev(`[...document.querySelectorAll('.bp__row')].map((r) => r.querySelector('.bp__label').textContent.replace(/\\s+/g, ' ').trim())`);
const branchLabel = () => t.text('.bp__btn .bp__name');

// --- o botão mostra a branch e abre o painel -------------------------------------------------------------------------------------
t.check('o cabeçalho mostra a branch atual', (await branchLabel()) === 'main', await branchLabel());
t.check('o botão tem ícone de branch e seta', (await t.count('.bp__btn svg.gn-icon')) === 2);
await t.ev(`document.querySelector('.bp__btn').click()`);
await t.until(`document.querySelector('.bp__panel .bp__row') && document.activeElement === document.querySelector('.bp__search input')`, 8000);
t.check('abre o painel com a busca', (await t.count('.bp__panel .bp__search input')) === 1);
t.check('a busca tem o foco ao abrir', (await t.ev(`document.activeElement === document.querySelector('.bp__search input')`)) === true);
t.check('ações do projeto: atualizar, nova branch, ir para tag ou commit', (await t.ev(`[...document.querySelectorAll('.bp__item')].map((b) => b.textContent.trim()).join('|')`)) === 'Atualizar a branch atual|Nova branch…|Ir para tag ou commit…', await t.ev(`[...document.querySelectorAll('.bp__item')].map((b) => b.textContent.trim()).join('|')`));
t.check('as ações têm ícone', (await t.count('.bp__item svg.gn-icon')) === 3);
t.check('seções Locais (aberta) e Remotas (recolhida)', (await t.ev(`[...document.querySelectorAll('.bp__sec')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim().split(' ')[0] + ':' + b.getAttribute('aria-expanded')).join('|')`)) === 'Locais:true|Remotas:false', await t.ev(`[...document.querySelectorAll('.bp__sec')].map((b) => b.textContent.trim()).join('|')`));
t.check('a branch atual vem marcada', (await t.ev(`document.querySelector('.bp__row--cur .bp__label').textContent.trim()`)) === 'main');
await t.shot('branch-painel');

// --- pesquisa nas locais E remotas ----------------------------------------------------------------------------------------------
await set('.bp__search input', 'feat');
await sleep(200);
const both = await rows();
t.check('pesquisar "feat" acha a local e a remota', both.length === 2 && both.some((r) => r === 'feat/local-a') && both.some((r) => r === 'feat/remote-b'), both);
t.check('na pesquisa as seções ficam abertas, inclusive Remotas', (await t.ev(`[...document.querySelectorAll('.bp__sec')].every((b) => b.getAttribute('aria-expanded') === 'true')`)) === true);
t.check('a remota aparece dentro da pasta do remoto (origin)', (await t.text('.bp__remote')) === 'origin');
t.check('o trecho encontrado é realçado', (await t.ev(`document.querySelector('.bp__row mark')?.textContent`)) === 'feat');
await set('.bp__search input', 'remote-b');
await sleep(200);
t.check('só a remota combina com "remote-b"', JSON.stringify(await rows()) === JSON.stringify(['feat/remote-b']), await rows());
await set('.bp__search input', 'zzz-nao-existe');
await sleep(200);
t.check('sem resultado: mensagem', /Nenhuma branch encontrada/.test((await t.text('.bp__muted')) ?? ''));

// --- menu da branch remota ----------------------------------------------------------------------------------------------------------
await set('.bp__search input', 'remote-b');
await sleep(200);
await t.ev(`document.querySelector('.bp__row').click()`);
await t.until(`document.querySelector('.bp__fly')`, 5000);
const items = await t.ev(`[...document.querySelectorAll('.bp__fitem')].map((b) => b.textContent.trim())`);
t.check('menu da remota: checkout, nova branch a partir dela, merge, rebase e pull (rebase e merge)', items.length === 6 && items[0].startsWith('Trocar para esta branch') && /^Nova branch a partir de 'origin\/feat\/remote-b'/.test(items[1]) && /^Merge de 'origin\/feat\/remote-b' em 'main'/.test(items[2]) && /^Rebase de 'main' sobre 'origin\/feat\/remote-b'/.test(items[3]) && items[4] === "Pull em 'main' com rebase" && items[5] === "Pull em 'main' com merge", items);
t.check('a remota não tem "Excluir" (só branch local se exclui)', !items.some((i) => i === 'Excluir'));
await t.shot('branch-menu');

// --- checkout de uma remota: cria a local que a acompanha -------------------------------------------------------------------
await clickText('.bp__fitem', 'Trocar para esta branch');
await t.until(`document.querySelector('.bp__btn .bp__name')?.textContent.trim() === 'feat/remote-b'`, 10000);
t.check('depois do checkout o cabeçalho mostra a nova branch', (await branchLabel()) === 'feat/remote-b', await branchLabel());
t.check('o painel fechou', (await t.count('.bp__panel')) === 0);
t.check('o git está na branch, acompanhando a remota', git(repo, 'branch', '--show-current').trim() === 'feat/remote-b' && git(repo, 'rev-parse', '--abbrev-ref', '@{u}').trim() === 'origin/feat/remote-b');
t.check('avisa o que aconteceu', /Agora em 'feat\/remote-b'/.test((await t.text('.rv__notice')) ?? ''), await t.text('.rv__notice'));

// --- recentes e menu de uma local -----------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector('.bp__btn').click()`);
await t.until(`document.querySelector('.bp__sec')?.textContent.trim().startsWith('Recentes') && document.activeElement === document.querySelector('.bp__search input')`, 8000);
t.check('Recentes lista a branch de onde saí (main)', (await t.ev(`document.querySelector('.bp__sec')?.textContent.trim().startsWith('Recentes')`)) === true);
await t.ev(`[...document.querySelectorAll('.bp__row')].find((r) => r.dataset.branch === 'local:feat/local-a').click()`);
await t.until(`document.querySelector('.bp__fly')`, 5000);
const localItems = await t.ev(`[...document.querySelectorAll('.bp__fitem')].map((b) => b.textContent.trim())`);
t.check('menu da local: tem Excluir (em vermelho) e não tem Pull', localItems.at(-1) === 'Excluir' && !localItems.some((i) => i.startsWith('Pull')), localItems);
t.check('Excluir é o item perigoso', (await t.ev(`!!document.querySelector('.bp__fitem--danger')`)) === true);
await t.key('Escape');
await sleep(200);
t.check('Esc fecha só o menu da branch e mantém o painel', (await t.count('.bp__fly')) === 0 && (await t.count('.bp__panel')) === 1);

// --- nova branch a partir da versão mais recente do remoto ------------------------------------------------------------------------
t.check('antes: a main local do clone não conhece a novidade do remoto', git(repo, 'rev-parse', 'origin/main').trim() !== remoteMain);
await clickText('.bp__item', 'Nova branch');
await t.until(`document.querySelector('[role="dialog"]')`, 5000);
t.check('o campo "Criar a partir de" é o ComboBox do app (sem select nativo) e oferece a versão mais recente de origin/main como padrão', (await t.ev(`!!document.querySelector('[role="dialog"] [data-testid="bd-base"].cbx') && !document.querySelector('.bd select')`)) === true && /Mais recente de origin\/main/.test(await t.ev(`document.querySelector('[role="dialog"] [data-testid="bd-base"] .cbx__value').textContent`)));
await t.ev(`(() => { const b = document.querySelector('[role="dialog"] [data-testid="bd-base"] .cbx__btn'); b.focus(); b.click(); })()`); // com foco, como o clique de verdade
await t.until(`document.querySelector('.cbx__list')`, 3000);
// a lista, na ordem em que aparece: 'G:título+' (grupo aberto) ou 'G:título-' (recolhido), 'S' (busca) e 'O:texto' (opção)
const listRows = () => t.ev(`[...document.querySelector('.cbx__list').children].map((li) => li.classList.contains('cbx__group') ? 'G:' + li.querySelector('.cbx__group-name').textContent.trim() + (li.getAttribute('aria-expanded') === 'true' ? '+' : '-') : li.classList.contains('cbx__search') ? 'S' : li.getAttribute('role') === 'option' ? 'O:' + li.textContent.trim() : '?')`);
const clickGroup = async (name) => {
  await t.ev(`[...document.querySelectorAll('.cbx__list .cbx__group')].find((g) => g.querySelector('.cbx__group-name').textContent.trim() === ${lit(name)}).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
  await sleep(250);
};
const baseList = await t.ev(`(() => { const l = document.querySelector('.cbx__list'); const r = l.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + 12); return { radius: parseFloat(getComputedStyle(l).borderRadius), above: !!at && l.contains(at) }; })()`);
t.check('a lista tem cantos arredondados e fica acima do diálogo', baseList.radius >= 6 && baseList.above, baseList);
const bdRows = await listRows();
t.check('a lista traz a busca, depois "Mais recente de origin/main" e a branch atual sem grupo, e então o grupo Local aberto (só locais) e o Remoto recolhido', bdRows[0] === 'S' && /^O:Mais recente de origin\/main/.test(bdRows[1]) && /^O:Branch atual/.test(bdRows[2]) && bdRows[3] === 'G:Local+' && bdRows[bdRows.length - 1] === 'G:Remoto-', bdRows);
const locais = bdRows.slice(4, -1).map((x) => x.slice(2));
t.check('Local tem só branches locais (nenhuma origin/...)', locais.length >= 2 && locais.every((x) => !x.startsWith('origin/')) && locais.includes('feat/local-a'), locais);
const hdr = await t.ev(`(() => { const out = {}; for (const g of document.querySelectorAll('.cbx__list .cbx__group')) { const n = g.querySelector('.cbx__group-name').textContent.trim(); const c = g.querySelector('.cbx__chev'); out[n] = { role: g.getAttribute('role'), cursor: getComputedStyle(g).cursor, border: getComputedStyle(g).borderTopWidth, radius: parseFloat(getComputedStyle(g).borderTopLeftRadius), arrow: !!c, turned: c ? getComputedStyle(c).transform !== 'none' : null, count: g.querySelector('.cbx__group-count')?.textContent.trim() }; } return out; })()`);
t.check('os títulos Local e Remoto são botões em cartão (contorno, cantos, cursor de clique) com seta e contagem; a seta do aberto está girada e a do recolhido não', hdr.Local?.role === 'button' && hdr.Remoto?.role === 'button' && hdr.Local.cursor === 'pointer' && hdr.Local.border === '1px' && hdr.Local.radius >= 6 && hdr.Local.arrow && hdr.Remoto.arrow && hdr.Local.turned === true && hdr.Remoto.turned === false && Number(hdr.Local.count) === locais.length && Number(hdr.Remoto.count) >= 2, hdr);
await clickGroup('Remoto');
const aberto = await listRows();
const iRem = aberto.indexOf('G:Remoto+');
const remotos = aberto.slice(iRem + 1).map((x) => x.slice(2));
t.check('clicar em Remoto expande: aparecem só as branches do remoto (origin/...) e a seta gira', iRem > 0 && remotos.length >= 2 && remotos.every((x) => x.startsWith('origin/')) && remotos.some((x) => x.startsWith('origin/main')) && (await t.ev(`getComputedStyle([...document.querySelectorAll('.cbx__list .cbx__group')].pop().querySelector('.cbx__chev')).transform !== 'none'`)) === true, aberto);
await clickGroup('Local');
const semLocal = await listRows();
t.check('clicar em Local recolhe: os itens locais somem, o título fica (G:Local-) e o Remoto continua aberto', semLocal.includes('G:Local-') && !semLocal.includes('O:feat/local-a') && semLocal.includes('G:Remoto+') && semLocal.some((x) => x.startsWith('O:origin/')), semLocal);
await clickGroup('Local');
await clickGroup('Remoto');
const volta = await listRows();
t.check('clicar de novo reabre o Local e recolhe o Remoto (volta ao início)', volta.includes('G:Local+') && volta.includes('O:feat/local-a') && volta[volta.length - 1] === 'G:Remoto-', volta);
t.check('a lista continua aberta e a busca com o foco depois dos cliques nos títulos', (await t.count('.cbx__list')) === 1 && (await t.ev(`document.activeElement === document.querySelector('.cbx__list .cbx__search input')`)) === true);
// busca: mostra os resultados mesmo de grupo recolhido, filtra e Enter escolhe o primeiro resultado
await t.ev(`(() => { const i = document.querySelector('.cbx__list .cbx__search input'); i.value = 'origin/'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(200);
const buscaRem = await listRows();
t.check('digitar "origin/" mostra as branches do remoto mesmo com o grupo recolhido (G:Remoto+)', buscaRem.includes('G:Remoto+') && buscaRem.some((x) => x.startsWith('O:origin/')), buscaRem);
await t.ev(`(() => { const i = document.querySelector('.cbx__list .cbx__search input'); i.value = 'local-a'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(200);
const filtered = await listRows();
t.check('digitar "local-a" filtra a lista (só o grupo Local com feat/local-a) e esconde o resto', filtered.join('|').startsWith('S|G:Local+|O:feat/local-a') && !filtered.some((x) => x.startsWith('G:Remoto')), filtered);
await t.key('Enter');
await sleep(300);
t.check('Enter escolhe o primeiro resultado, fecha a lista e o campo mostra a branch', (await t.count('.cbx__list')) === 0 && (await t.ev(`document.querySelector('[role="dialog"] [data-testid="bd-base"] .cbx__value').textContent.trim()`)) === 'feat/local-a');
// volta à base padrão ("Mais recente") para os testes seguintes
await t.ev(`document.querySelector('[role="dialog"] [data-testid="bd-base"] .cbx__btn').click()`);
await t.until(`document.querySelector('.cbx__list')`, 3000);
await t.ev(`[...document.querySelectorAll('.cbx__list [role="option"]')].find((o) => /Mais recente/.test(o.textContent))?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
await sleep(300);
t.check('escolher "Mais recente" no clique volta ao padrão', /Mais recente de origin\/main/.test(await t.ev(`document.querySelector('[role="dialog"] [data-testid="bd-base"] .cbx__value').textContent`)));
await t.ev(`document.querySelector('[role="dialog"] [data-testid="bd-base"] .cbx__btn').click()`);
await t.until(`document.querySelector('.cbx__list')`, 3000);
await t.key('Escape');
await sleep(200);
t.check('Esc fecha só a lista, o diálogo continua aberto e o foco volta ao botão', (await t.count('.cbx__list')) === 0 && (await t.count('[role="dialog"]')) === 1 && (await t.ev(`document.activeElement === document.querySelector('[role="dialog"] [data-testid="bd-base"] .cbx__btn')`)) === true);
t.check('o botão Criar só habilita com um nome', (await t.ev(`document.querySelector('[role="dialog"] [type=submit]').disabled`)) === true);
await set('.bd__field input', 'feat/nova-teste');
t.check('com nome, Criar habilita', (await t.ev(`document.querySelector('[role="dialog"] [type=submit]').disabled`)) === false);
await t.shot('branch-nova');
await t.ev(`document.querySelector('[role="dialog"] [type=submit]').click()`);
await t.until(`document.querySelector('.bp__btn .bp__name')?.textContent.trim() === 'feat/nova-teste'`, 15000);
t.check('criou e trocou para a nova branch', (await branchLabel()) === 'feat/nova-teste', await branchLabel());
t.check('a nova branch nasceu da versão MAIS RECENTE do remoto (buscou antes)', git(repo, 'rev-parse', 'HEAD').trim() === remoteMain);
const tracksSomething = (() => {
  try {
    git(repo, 'config', '--get', 'branch.feat/nova-teste.merge');
    return true;
  } catch {
    return false; // o git sai com 1 quando a configuração não existe
  }
})();
t.check('a nova branch não acompanha a main (não dá pull da main nela)', !tracksSomething);
t.check('o diálogo fechou', (await t.count('[role="dialog"]')) === 0);

// --- nome inválido ou repetido mostra o erro no diálogo, sem fechar -------------------------------------------------------------------
await t.ev(`document.querySelector('.bp__btn').click()`);
await t.until(`document.querySelector('.bp__panel')`, 5000);
await clickText('.bp__item', 'Nova branch');
await t.until(`document.querySelector('[role="dialog"]')`, 5000);
await set('.bd__field input', 'feat/local-a');
await t.ev(`document.querySelector('[role="dialog"] [type=submit]').click()`);
await t.until(`document.querySelector('.bd__err')`, 8000);
t.check('nome repetido: o erro aparece no diálogo e ele continua aberto', /Já existe uma branch/.test((await t.text('.bd__err')) ?? '') && (await t.count('[role="dialog"]')) === 1, await t.text('.bd__err'));
await t.key('Escape');
await sleep(200);
t.check('Esc cancela o diálogo', (await t.count('[role="dialog"]')) === 0);

// --- "Ir para tag ou commit": o campo também é o ComboBox (modo busca), não o datalist nativo ---------------------------------------
await t.ev(`document.querySelector('.bp__btn').click()`);
await t.until(`document.querySelector('.bp__panel')`, 5000);
await clickText('.bp__item', 'Ir para tag ou commit');
await t.until(`document.querySelector('[role="dialog"]')`, 5000);
t.check('o campo de tag ou commit é o ComboBox em modo busca (sem datalist nativo) e recebe o foco', (await t.ev(`!!document.querySelector('[role="dialog"] [data-testid="bd-rev"] input.cbx__input') && !document.querySelector('.bd datalist') && document.activeElement === document.querySelector('[role="dialog"] [data-testid="bd-rev"] input.cbx__input')`)) === true);
await t.key('Escape');
await sleep(200);
t.check('Esc cancela também esse diálogo', (await t.count('[role="dialog"]')) === 0);

// o harness e o navegador geram ruído de rede ao encerrar (favicon, polling do log); só conta erro da própria interface
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection/.test(String(e))); // extensões do navegador de teste não são erro do app
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
