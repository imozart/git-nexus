// Codificação do arquivo no rodapé: mostra a detectada (Windows-1252 num arquivo legado), abre a lista completa, relê o arquivo na codificação
// escolhida, avisa e desliga as gravações quando os bytes não conferem, lembra a escolha e NUNCA corrompe os bytes ao gravar. Git de verdade.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.removeItem('gitnexus.fileEncodings')`);

// "ação\nsegunda\n" em Windows-1252: os acentos são os bytes E7 E3, inválidos em UTF-8
const LATIN = Buffer.from([0x61, 0xe7, 0xe3, 0x6f, 0x0a, 0x73, 0x65, 0x67, 0x75, 0x6e, 0x64, 0x61, 0x0a]);
const root = tmpRoot('gn-enc-');
const repo = mkRepo(root, 'encrepo', { files: { 'latin.txt': LATIN, 'utf8.txt': 'ação\n' } });
writeFileSync(join(repo, 'latin.txt'), Buffer.concat([LATIN, Buffer.from('terceira\n')]));
writeFileSync(join(repo, 'utf8.txt'), 'ação\nnova\n');

await t.openRepo(repo, 'encrepo');
await t.until(`document.querySelectorAll('.file').length >= 2`, 15000);
const openFile = (name) => t.ev(`[...document.querySelectorAll('.file')].find((f) => f.querySelector('.file__name')?.textContent.trim() === '${name}')?.click()`);
const btn = () => t.ev(`document.querySelector('[data-testid="encoding-btn"]')?.textContent.trim() ?? null`);
const diffText = () => t.ev(`document.querySelector('.sbs__body')?.innerText ?? ''`);
const diffButtons = () => t.count('.sbs__body button');
const hasWarn = () => t.ev(`!!document.querySelector('[data-testid="encoding-warning"]')`);
const pick = async (id) => {
  await t.ev(`document.querySelector('[data-testid="encoding-btn"]').click()`);
  await t.until(`document.querySelector('[data-testid="encoding-menu"]')`, 5000);
  await t.ev(`document.querySelector('[data-testid="enc-${id}"]').click()`);
  await sleep(500);
};

// --- sem arquivo aberto, sem rodapé ------------------------------------------------------------------------------------------------
t.check('sem arquivo aberto não há rodapé de codificação', (await t.count('[data-testid="encoding-btn"]')) === 0);

// --- arquivo Windows-1252: detectado, legível -----------------------------------------------------------------------------------
await openFile('latin.txt');
await t.until(`document.querySelector('[data-testid="encoding-btn"]')`, 12000);
await t.until(`/segunda/.test(document.querySelector('.sbs__body')?.innerText ?? '')`, 8000);
t.check('o rodapé mostra Windows-1252 para o arquivo legado', (await btn()) === 'Windows-1252', await btn());
t.check('o diff mostra os acentos (antes saía "�")', /ação/.test(await diffText()) && !(await diffText()).includes('�'), await diffText());
t.check('o rodapé mostra o caminho do arquivo', /latin\.txt/.test((await t.text('[data-testid="statusbar"]')) ?? ''));
t.check('o tooltip diz que foi detectada automaticamente', /detectada automaticamente/.test(await t.ev(`document.querySelector('[data-testid="encoding-btn"]').title`)));
t.check('sem aviso quando a codificação confere', (await hasWarn()) === false);
const withActions = await diffButtons();
t.check('com a codificação certa as ações de linha/bloco existem', withActions > 0, withActions);

// --- a lista completa ------------------------------------------------------------------------------------------------------------
await t.ev(`document.querySelector('[data-testid="encoding-btn"]').click()`);
await t.until(`document.querySelector('[data-testid="encoding-menu"]')`, 5000);
const labels = await t.ev(`[...document.querySelectorAll('[data-testid^="enc-"] .enc__name')].map((n) => n.textContent.trim())`);
t.check('a lista tem mais de 60 codificações (conjunto do Notepad++/IntelliJ)', labels.length > 60, labels.length);
for (const want of ['UTF-8', 'UTF-8 BOM', 'UTF-16 LE BOM', 'UTF-32 BE', 'Windows-1252', 'ISO-8859-1', 'ISO-8859-15', 'IBM437 (DOS EUA)', 'IBM850 (DOS Latin-1)', 'KOI8-R', 'Windows-1251', 'Shift_JIS', 'EUC-JP', 'GBK (GB2312)', 'GB18030', 'Big5', 'EUC-KR', 'Mac Roman']) {
  t.check(`a lista oferece ${want}`, labels.includes(want), labels);
}
t.check('"Automática" é a opção marcada (ninguém escolheu nada)', (await t.ev(`document.querySelector('[data-testid="enc-auto"]').getAttribute('aria-selected')`)) === 'true');
t.check('a detectada vem sinalizada na lista', /detectada/.test((await t.text('[data-testid="enc-windows-1252"]')) ?? ''));
t.check('os grupos aparecem com nome', (await t.ev(`[...document.querySelectorAll('.enc__group')].map((g) => g.textContent.trim()).includes('Cirílico')`)) === true);
await t.shot('codificacao-lista');

// pesquisa: por nome e pelo grupo
const search = (q) => t.ev(`(() => { const i = document.querySelector('.enc__search'); i.value = ${lit(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await search('koi8');
await sleep(200);
t.check('pesquisar "koi8" deixa só KOI8-R e KOI8-U', (await t.ev(`[...document.querySelectorAll('[data-testid^="enc-"] .enc__name')].map((n) => n.textContent.trim()).join(',')`)) === 'KOI8-R,KOI8-U');
await search('cirílico');
await sleep(200);
t.check('pesquisar pelo grupo ("cirílico") traz as codificações dele', (await t.count('[data-testid^="enc-"]')) >= 6);
await search('zzzz');
await sleep(200);
t.check('sem resultado mostra a mensagem', /Nenhuma codificação/.test((await t.text('.enc__none')) ?? ''));
await search('');
await t.key('Escape');
await sleep(300);
t.check('Esc fecha a lista', (await t.count('[data-testid="encoding-menu"]')) === 0);

// --- escolher UTF-8 num arquivo que NÃO é UTF-8: aviso e gravações desligadas -------------------------------------------------
await pick('utf-8');
t.check('o rodapé passa a UTF-8', (await btn()) === 'UTF-8', await btn());
t.check('o arquivo foi relido: aparece o "�" (os bytes não existem em UTF-8)', (await diffText()).includes('�'));
t.check('o aviso aparece', (await hasWarn()) === true);
t.check('descartar e incluir linhas ficam desligados (nada seria gravado)', (await diffButtons()) === 0, await diffButtons());
t.check('a escolha foi lembrada', /utf-8/.test((await t.ev(`localStorage.getItem('gitnexus.fileEncodings')`)) ?? ''));
t.check('o tooltip diz que foi escolhida e qual é a detectada', /escolhida por você/.test(await t.ev(`document.querySelector('[data-testid="encoding-btn"]').title`)) || /não existem/.test(await t.ev(`document.querySelector('[data-testid="encoding-btn"]').title`)));
await t.shot('codificacao-invalida');

// --- a escolha vale por arquivo ---------------------------------------------------------------------------------------------------
await openFile('utf8.txt');
await t.until(`/nova/.test(document.querySelector('.sbs__body')?.innerText ?? '')`, 8000);
t.check('outro arquivo continua automático (UTF-8) e sem aviso', (await btn()) === 'UTF-8' && (await hasWarn()) === false, [await btn(), await hasWarn()]);
await openFile('latin.txt');
await t.until(`document.querySelector('[data-testid="encoding-warning"]')`, 8000);
t.check('voltando ao primeiro arquivo, a escolha dele continua valendo', (await btn()) === 'UTF-8' && (await hasWarn()) === true);

// --- ISO-8859-1 também lê os acentos; Automática volta ao detectado ------------------------------------------------------------
await pick('iso-8859-1');
t.check('ISO-8859-1 lê os acentos e sem aviso', (await btn()) === 'ISO-8859-1' && /ação/.test(await diffText()) && (await hasWarn()) === false);
await pick('auto');
t.check('Automática volta para Windows-1252', (await btn()) === 'Windows-1252' && (await hasWarn()) === false && (await diffButtons()) > 0);
t.check('Automática apaga a escolha lembrada', !/latin\.txt/.test((await t.ev(`localStorage.getItem('gitnexus.fileEncodings')`)) ?? ''));

// --- integridade: gravar mantém os bytes ------------------------------------------------------------------------------------------
await t.ev(`window.gitNexus.writeWorkingFile(${lit(repo)}, 'latin.txt', 'ação\\nsegunda\\n')`);
const after = readFileSync(join(repo, 'latin.txt'));
t.check('gravar o arquivo Windows-1252 mantém os bytes dos acentos (E7 E3), não vira UTF-8', after.equals(LATIN), [...after]);
const refused = await t.ev(`window.gitNexus.writeWorkingFile(${lit(repo)}, 'latin.txt', 'japonês 日本\\n').then(() => 'gravou', (e) => String(e.message))`);
t.check('caractere que a codificação não tem é recusado, sem alterar o arquivo', /não existe/.test(refused) && readFileSync(join(repo, 'latin.txt')).equals(LATIN), refused);

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
