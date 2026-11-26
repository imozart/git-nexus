// Resolvedor de conflitos, fase 4 (issue #231, #247), com git de verdade: conflitos que não são "linha contra linha" (apagado × alterado, renomeado nos dois lados,
// binário com prévia de imagem, ponteiro do Git LFS, submódulo) e o texto adicionado nos dois lados. Confere o que a tela mostra de cada lado, a escolha
// de cada um e o que o git e o disco ficam depois.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { connect, git, mkRepo, sleep, tmpRoot, lit } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);
await t.ev(`localStorage.setItem('gitnexus.newConflictResolver', '1')`);

/** PNG de verdade (degradê de uma cor), para a prévia ter o que mostrar. */
function png(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * (w * 3 + 1) + 1 + x * 3;
      const f = 0.35 + 0.65 * (x / w);
      raw[k] = Math.round(r * f);
      raw[k + 1] = Math.round(g * f);
      raw[k + 2] = Math.round(b * f);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const lfs = (c, size) => `version https://git-lfs.github.com/spec/v1\noid sha256:${c.repeat(64)}\nsize ${size}\n`;
const guia = (extra) => ['# Guia do projeto', '', 'Instale as dependências com pnpm install.', 'Rode os testes com pnpm test.', ...extra, ''].join('\n');
const YML = ['nome: app', 'porta: 8080', 'tls: true', 'workers: 4', ''].join('\n');
const SUB = (n) => String(n).repeat(40);

const root = tmpRoot('gn-mc-');
const repo = mkRepo(root, 'escolhas', { files: { 'README.md': 'projeto\n' } });
const put = (f, c) => {
  mkdirSync(dirname(join(repo, f)), { recursive: true });
  writeFileSync(join(repo, f), c);
};
const commit = (m, sub) => {
  git(repo, 'add', '-A'); // o submódulo é só um ponteiro no índice (sem pasta): o add -A o tiraria, então ele é regravado depois
  git(repo, 'update-index', '--add', '--cacheinfo', `160000,${SUB(sub)},vendor/lib`);
  git(repo, 'commit', '-qm', m);
};
put('docs/guia.md', guia(['Veja também o manual.']));
put('assets/logo.png', png(160, 100, [60, 120, 220]));
put('dados/modelo.bin', Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
put('grande.psd', lfs('a', 1048576));
put('config/a.yml', YML);
commit('base', 1);

git(repo, 'checkout', '-q', '-b', 'feat/identidade');
put('docs/guia.md', guia(['Veja também o manual.', 'Contribuições são bem-vindas.']));
put('assets/logo.png', png(160, 100, [230, 90, 70]));
put('dados/modelo.bin', Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
put('grande.psd', lfs('b', 20971520));
git(repo, 'mv', 'config/a.yml', 'config/app.yml');
put('novo.txt', 'titulo: meu\n');
commit('feat: identidade visual', 2);

git(repo, 'checkout', '-q', 'main');
git(repo, 'rm', '-q', 'docs/guia.md');
put('assets/logo.png', png(160, 100, [60, 190, 120]));
put('dados/modelo.bin', Buffer.from([0, 9, 9, 9]));
put('grande.psd', lfs('c', 5242880));
git(repo, 'mv', 'config/a.yml', 'config/base.yml');
put('novo.txt', 'titulo: dele\n');
commit('refactor: reorganiza os arquivos', 3);
git(repo, 'checkout', '-q', 'feat/identidade');
try {
  git(repo, 'merge', 'main');
} catch {
  /* conflitos: é o esperado */
}

await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 1`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);
await t.ev(`document.querySelector('li.repo .repo__btns button').click()`);
await t.until(`document.querySelector('[data-testid="op-banner"]')`, 20000);
await t.ev(`[...document.querySelectorAll('[data-testid="repo-view-tab"]')].find((b) => /Conflitos/.test(b.textContent))?.click()`);
await t.until(`document.querySelectorAll('[data-testid="mv-file"]').length >= 9 && document.querySelector('[data-testid="mv-file-summary"]')`, 20000);
await sleep(300);

const q = (js) => t.ev(`(() => { ${js} })()`);
const files = () => q(`return [...document.querySelectorAll('[data-testid="mv-file"]')].map((e) => ({ name: e.querySelector('.item__name').childNodes[0].textContent.trim(), kind: e.querySelector('[data-testid="mv-file-kind"]')?.textContent.trim() ?? null, summary: e.querySelector('[data-testid="mv-file-summary"]')?.textContent.trim() ?? null }))`);
const openFile = async (name) => {
  await t.ev(`[...document.querySelectorAll('[data-testid="mv-file"]')].find((e) => e.querySelector('.item__name').childNodes[0].textContent.trim() === ${lit(name)}).click()`);
  await sleep(400);
};
const choice = () =>
  q(`const m = document.querySelector('[data-testid="merge-choice"]'); if (!m) return null;
     return { kind: m.dataset.kind, title: m.querySelector('[data-testid="mc-title"]').textContent.trim(), explain: m.querySelector('[data-testid="mc-explain"]').textContent.trim(),
       related: m.querySelector('[data-testid="mc-related"]')?.textContent.trim() ?? null,
       sides: [...m.querySelectorAll('[data-testid="mc-side"]')].map((s) => ({ side: s.dataset.side, text: s.innerText.replace(/\\s+/g, ' ').trim(), gone: !!s.querySelector('[data-testid="mc-gone"]'),
         buttons: [...s.querySelectorAll('button')].map((b) => b.textContent.trim()), images: [...s.querySelectorAll('canvas')].map((i) => ({ ok: i.width > 0 && i.getContext('2d').getImageData(i.width - 1, 0, 1, 1).data[3] === 255, w: i.width })) })),
       single: [...m.querySelectorAll('.mc__single button')].map((b) => b.textContent.trim()) }`);
const press = (testid) => t.ev(`document.querySelector('[data-testid="${testid}"]').click()`);
/** Escolhe e espera o arquivo sair da lista de pendentes (a tela recarrega depois de gravar). */
const decide = async (testid, name) => {
  await t.until(`document.querySelector('[data-testid="${testid}"]') && !document.querySelector('[data-testid="${testid}"]').disabled`, 15000); // a tela ainda grava a escolha anterior
  await press(testid);
  await t.until(`![...document.querySelectorAll('[data-testid="mv-file"]')].some((e) => e.querySelector('.item__name').childNodes[0].textContent.trim() === ${lit(name)})`, 15000);
  await sleep(300);
};
/** Captura de tela com a tela já assentada (sem botão desligado por uma gravação em andamento) e sem foco. */
const snap = async (name) => {
  await t.until(`![...document.querySelectorAll('.mv__main button, .mv__headbtns button')].some((b) => b.disabled)`, 15000);
  await t.ev(`document.activeElement?.blur?.()`);
  await sleep(150);
  await t.shot(name);
};
const disk = (f) => join(repo, f);
const staged = (f) => git(repo, 'ls-files', '-s', '--', f).trim();

// --- lista ----------------------------------------------------------------------------------------------------------------------------------
const list = await files();
const kinds = Object.fromEntries(list.map((x) => [x.name, x.kind]));
t.check('a lista mostra os 9 arquivos em conflito', list.length === 9, list.map((x) => x.name));
t.check(
  'cada arquivo diz o tipo do conflito (apagado, binário, LFS, submódulo...) e o de texto mostra a contagem de conflitos',
  kinds['docs/guia.md'] === 'apagado de um lado' &&
    kinds['assets/logo.png'] === 'binário' &&
    kinds['dados/modelo.bin'] === 'binário' &&
    kinds['grande.psd'] === 'Git LFS' &&
    kinds['vendor/lib'] === 'submódulo' &&
    kinds['config/a.yml'] === 'apagado dos dois lados' &&
    kinds['config/app.yml'] === 'só existe de um lado' &&
    kinds['config/base.yml'] === 'só existe de um lado' &&
    kinds['novo.txt'] === null &&
    /1 conflito/.test(list.find((x) => x.name === 'novo.txt').summary ?? ''),
  list,
);

// --- binário com imagem -----------------------------------------------------------------------------------------------------------------------
await openFile('assets/logo.png');
await t.until(`document.querySelectorAll('canvas[data-testid="mc-image"]').length === 2`, 10000); // a prévia chega depois (o núcleo lê os blobs)
await sleep(300);
let c = await choice();
t.check('binário: a tela explica que não dá para combinar linha a linha', c?.kind === 'binary' && /não dá para combinar/.test(c.explain), c?.explain);
t.check('mostra o tamanho e a data de cada versão', c.sides.every((s) => /Tamanho/.test(s.text) && /Data/.test(s.text) && /\d{4}/.test(s.text)), c.sides.map((s) => s.text));
t.check('e a prévia da imagem de cada lado (decodificada e desenhada num canvas, sem mexer na CSP)', c.sides.every((s) => s.images.length === 1 && s.images[0].ok && s.images[0].w === 160), c.sides.map((s) => s.images));
t.check('as escolhas são "Usar a minha versão" e "Usar a que chega"', c.sides[0].buttons[0] === 'Usar a minha versão' && c.sides[1].buttons[0] === 'Usar a que chega', c.sides.map((s) => s.buttons));
await snap('escolha-binario-imagem');
await decide('mc-use-mine', 'assets/logo.png');
t.check('"Usar a minha versão" grava o conteúdo do estágio 2 e o git considera resolvido', !git(repo, 'ls-files', '-u', '--', 'assets/logo.png').trim() && /^100644 .* 0\tassets\/logo.png/.test(staged('assets/logo.png')));
t.check('o arquivo no disco é a imagem vermelha da minha branch (byte a byte)', readFileSync(disk('assets/logo.png')).equals(png(160, 100, [230, 90, 70])));

// --- renomeado nos dois lados -----------------------------------------------------------------------------------------------------------------
await openFile('config/a.yml');
c = await choice();
t.check('nome antigo (só a base): "apagado dos dois lados", com a ligação aos dois nomes novos', c?.kind === 'both-deleted' && /config\/app\.yml/.test(c.related ?? '') && /config\/base\.yml/.test(c.related ?? ''), c);
t.check('uma única escolha: confirmar a remoção', c.single.length === 1 && c.single[0] === 'Confirmar a remoção', c.single);
await snap('escolha-renomeado-dois-lados');
await openFile('config/app.yml');
c = await choice();
t.check('nome novo do meu lado: só existe aqui, e a tela liga com o nome antigo e com o outro nome novo', c?.kind === 'deleted' && /só existe de um lado/.test(c.title) && /config\/a\.yml/.test(c.related ?? '') && /config\/base\.yml/.test(c.related ?? '') && c.sides[1].gone, c);
t.check('oferece manter o arquivo ou apagar', c.sides[0].buttons[0] === 'Manter o arquivo' && c.sides[1].buttons[0] === 'Apagar o arquivo', c.sides.map((s) => s.buttons));
await snap('escolha-so-de-um-lado');
await decide('mc-use-mine', 'config/app.yml');
await openFile('config/base.yml');
c = await choice();
t.check('nome novo do outro lado: o meu lado não tem o arquivo', c?.kind === 'deleted' && c.sides[0].gone && !c.sides[1].gone, c);
await decide('mc-use-theirs', 'config/base.yml');
await openFile('config/a.yml');
await decide('mc-use-mine', 'config/a.yml');
t.check('manter os dois nomes novos e confirmar a remoção do antigo: os dois novos existem com o conteúdo e o antigo sumiu (índice e disco)', existsSync(disk('config/app.yml')) && readFileSync(disk('config/base.yml'), 'utf8') === YML && !staged('config/a.yml') && !existsSync(disk('config/a.yml')) && !git(repo, 'ls-files', '-u', '--', 'config').trim());

// --- apagado × alterado -----------------------------------------------------------------------------------------------------------------------
await openFile('docs/guia.md');
c = await choice();
t.check('apagado × alterado: a tela diz quem apagou e mostra o texto que sobrou', c?.kind === 'deleted' && /O outro lado apagou este arquivo e você o alterou/.test(c.explain) && c.sides[1].gone && /Contribuições são bem-vindas/.test(c.sides[0].text), c);
t.check('e marca que a versão foi alterada desde a base', /alterado desde a base/.test(c.sides[0].text), c.sides[0].text);
await snap('escolha-apagado-alterado');
await decide('mc-use-theirs', 'docs/guia.md'); // apagar (como a origin)
t.check('"Apagar o arquivo" remove o arquivo do índice e do disco', !staged('docs/guia.md') && !existsSync(disk('docs/guia.md')));

// --- binário simples, LFS e submódulo ---------------------------------------------------------------------------------------------------------
await openFile('dados/modelo.bin');
c = await choice();
t.check('binário sem imagem: tamanho de cada versão e nenhuma prévia', c?.kind === 'binary' && c.sides.every((s) => s.images.length === 0) && /12 B/.test(c.sides[0].text) && /4 B/.test(c.sides[1].text), c?.sides.map((s) => s.text));
await decide('mc-use-theirs', 'dados/modelo.bin');
t.check('"Usar a que chega" grava os bytes da outra versão', readFileSync(disk('dados/modelo.bin')).equals(Buffer.from([0, 9, 9, 9])));

await openFile('grande.psd');
c = await choice();
t.check('ponteiro do LFS: mostra o objeto e o tamanho real do arquivo grande de cada lado', c?.kind === 'lfs' && /20 MB/.test(c.sides[0].text) && /5 MB/.test(c.sides[1].text) && /sha256:bbbbbbbb/.test(c.sides[0].text), c?.sides.map((s) => s.text));
await snap('escolha-lfs');
await decide('mc-use-mine', 'grande.psd');
t.check('fica o ponteiro escolhido, sem marcadores', readFileSync(disk('grande.psd'), 'utf8') === lfs('b', 20971520), [await t.text('.err'), git(repo, 'ls-files', '-s', '--', 'grande.psd'), readFileSync(disk('grande.psd'), 'utf8').slice(0, 200)]);

await openFile('vendor/lib');
c = await choice();
t.check('submódulo: mostra o commit de cada lado (7 caracteres)', c?.kind === 'submodule' && /2222222/.test(c.sides[0].text) && /3333333/.test(c.sides[1].text), c?.sides.map((s) => s.text));
await snap('escolha-submodulo');
await decide('mc-use-theirs', 'vendor/lib');
t.check('o índice aponta para o commit escolhido (modo 160000)', staged('vendor/lib').startsWith(`160000 ${SUB(3)} 0`), staged('vendor/lib'));

// --- adicionado nos dois lados (texto) --------------------------------------------------------------------------------------------------------
await t.until(`document.querySelector('[data-testid="mr-both-added"]')`, 10000);
const note = (await t.text('[data-testid="mr-both-added"]')) ?? '';
t.check('adicionado nos dois lados: abre o resolvedor linha a linha, avisando que não há versão em comum', /Arquivo novo nos dois lados/.test(note) && (await t.count('[data-testid="mr-card"]')) === 1, note);
await snap('escolha-adicionado-dois-lados');
await t.ev(`document.querySelector('[data-testid="mr-use-theirs"]').click()`);
await sleep(300);
await t.ev(`document.querySelector('[data-testid="mr-resolve"]').click()`);
await t.until(`document.querySelector('[data-testid="mv-done"]')`, 15000);
t.check('com tudo decidido o git não tem mais conflito e o novo.txt ficou com a versão escolhida', git(repo, 'ls-files', '-u').trim() === '' && readFileSync(disk('novo.txt'), 'utf8') === 'titulo: dele\n', [git(repo, 'ls-files', '-u'), readFileSync(disk('novo.txt'), 'utf8')]);
await snap('escolha-tudo-resolvido');

// --- reabrir um conflito de apagado e continuar -----------------------------------------------------------------------------------------------
const resolvedNames = await q(`return [...document.querySelectorAll('[data-testid="mv-resolved-file"] .item__name')].map((e) => e.childNodes[0].textContent.trim())`);
t.check('os arquivos resolvidos (de todos os tipos) continuam na lista, para reabrir', resolvedNames.length >= 8 && resolvedNames.includes('docs/guia.md') && resolvedNames.includes('vendor/lib'), resolvedNames);
await t.ev(`[...document.querySelectorAll('[data-testid="mv-resolved-file"]')].find((e) => e.textContent.includes('docs/guia.md')).querySelector('[data-testid="mv-reopen"]').click()`);
await t.until(`document.querySelector('[data-testid="merge-choice"]')`, 15000);
c = await choice();
t.check('"Reabrir conflito" de um apagado recria o conflito original (o arquivo volta a ter as duas situações)', c?.kind === 'deleted' && /Contribuições são bem-vindas/.test(c.sides[0].text) && !!git(repo, 'ls-files', '-u', '--', 'docs/guia.md').trim(), c);
await press('mc-use-theirs');
await t.until(`document.querySelector('[data-testid="mv-done"]')`, 15000);
await t.ev(`document.querySelector('[data-testid="mv-done"] [data-testid="op-continue"]').click()`);
await t.until(`!document.querySelector('[data-testid="op-banner"]')`, 20000);
await sleep(500);
const parents = git(repo, 'log', '-1', '--format=%p').trim().split(' ').filter(Boolean);
t.check('Continuar conclui o merge com dois pais', parents.length === 2, parents);
t.check('o resultado do merge é exatamente o que foi decidido (git status limpo)', git(repo, 'status', '--porcelain').trim() === '', git(repo, 'status', '--porcelain'));

const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|A listener indicated an asynchronous response/.test(String(e)));
t.check('nenhum erro da interface no console (nem violação da CSP)', appErrors.length === 0, appErrors);
t.close();
