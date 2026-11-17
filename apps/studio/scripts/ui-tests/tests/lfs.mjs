// Git LFS (Ferramentas > Git LFS): repositório sem LFS, lista dos arquivos com o estado (ponteiro, baixado, fora da pasta), filtro e o download
// (um arquivo e todos) a partir de um servidor LFS de verdade (mínimo, local). Sem o git-lfs instalado o painel avisa e o download é pulado.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep, tmpRoot } from '../lib.mjs';

const OUT = process.argv[2];
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
await t.ev(`localStorage.setItem('gitnexus.locale', 'pt-BR')`);
await t.ev(`localStorage.setItem('gitnexus.autoFetch', '0')`);

const sha = (s) => createHash('sha256').update(s).digest('hex');
const pointer = (c) => `version https://git-lfs.github.com/spec/v1\noid sha256:${sha(c)}\nsize ${Buffer.byteLength(c)}\n`;
const objects = new Map();
const server = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  if (req.method === 'POST' && req.url?.endsWith('/objects/batch')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const out = body.objects.map((o) => (objects.has(o.oid) ? { oid: o.oid, size: o.size, actions: { download: { href: `${base}/obj/${o.oid}` } } } : { oid: o.oid, size: o.size, error: { code: 404, message: 'não existe' } }));
      res.writeHead(200, { 'Content-Type': 'application/vnd.git-lfs+json' });
      res.end(JSON.stringify({ transfer: 'basic', objects: out }));
    });
    return;
  }
  const m = /^\/obj\/([0-9a-f]{64})$/.exec(req.url ?? '');
  if (m && objects.has(m[1])) {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    return void res.end(objects.get(m[1]));
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const root = tmpRoot('gn-lfs-');
const repo = mkRepo(root, 'lfsrepo', { files: { 'leia.txt': 'comum\n' } });
git(repo, 'config', 'core.fsmonitor', 'false');
git(repo, 'config', 'lfs.url', `http://127.0.0.1:${server.address().port}/lfs`);
mkdirSync(join(repo, 'assets'));
writeFileSync(join(repo, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\nassets/*.psd filter=lfs diff=lfs merge=lfs -text\n');
const contents = { 'a.bin': 'conteudo-a\n'.repeat(100), 'b.bin': 'conteudo-b\n'.repeat(200), 'assets/c.psd': 'psd\n'.repeat(500) };
for (const [f, c] of Object.entries(contents)) {
  writeFileSync(join(repo, f), pointer(c));
  objects.set(sha(c), c);
}
git(repo, 'add', '-A');
git(repo, 'commit', '-qm', 'feat: lfs');
writeFileSync(join(repo, 'a.bin'), contents['a.bin']); // baixado
rmSync(join(repo, 'assets', 'c.psd')); // fora da pasta
const plain = mkRepo(root, 'semlfs');

await t.ev(`window.gitNexus.addRepositoryPath(${JSON.stringify(repo)})`);
await t.ev(`window.gitNexus.addRepositoryPath(${JSON.stringify(plain)})`);
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 2`, 20000);
await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando/i.test(r.textContent))`, 30000);

const openLfs = async (name) => {
  await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === ${JSON.stringify(name)})`, 20000);
  await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === ${JSON.stringify(name)}).querySelector('.repo__btns button').click()`);
  await t.until(`document.querySelector('.rv__btns')`, 20000);
  await sleep(500);
  await t.key('k', 2);
  await t.until(`document.querySelector('.cp__input')`, 5000);
  await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = 'lfs'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(300);
  await t.ev(`[...document.querySelectorAll('.cp__list [role="option"], .cp__list .cp__item')].find((e) => e.textContent.includes('Ver os arquivos do Git LFS'))?.click()`);
  await t.until(`document.querySelector('[data-testid="lfs-panel"]')`, 10000);
  await t.until(`document.querySelector('[data-testid="lfs-off"], [data-testid="lfs-summary"]')`, 30000);
  await sleep(300);
};
const rows = () => t.ev(`[...document.querySelectorAll('[data-testid="lfs-row"]')].map((r) => ({ path: r.querySelector('.lf__path').textContent.trim(), state: r.querySelector('[data-testid^="lfs-state-"]').getAttribute('data-testid').replace('lfs-state-', '') }))`);
const rowBtn = (path, label) => t.ev(`[...document.querySelectorAll('[data-testid="lfs-row"]')].filter((r) => r.querySelector('.lf__path').textContent.trim() === ${JSON.stringify(path)}).forEach((r) => [...r.querySelectorAll('button')].filter((b) => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled).forEach((b) => b.click()))`);

// 1. sem LFS
await openLfs('semlfs');
t.check('repositório sem LFS: diz que não usa', /não usa Git LFS/.test((await t.text('[data-testid="lfs-off"]')) ?? ''));
t.check('e o botão de baixar fica desligado', (await t.ev(`document.querySelector('[data-testid="lfs-pull-all"]').disabled`)) === true);

// 2. com LFS
await t.ev('location.reload()');
await t.until(`document.querySelectorAll('li.repo').length >= 2`, 20000);
await sleep(800);
await openLfs('lfsrepo');
const sum = (await t.text('[data-testid="lfs-summary"]')) ?? '';
t.check('o resumo conta 3 arquivos, 1 ponteiro e 1 baixado', /3 arquivos no LFS: 1 só como ponteiro, 1 baixados/.test(sum), sum);
t.check('os padrões do .gitattributes aparecem', JSON.stringify(await t.ev(`[...document.querySelectorAll('[data-testid="lfs-pattern"]')].map((e) => e.textContent.trim())`)) === JSON.stringify(['*.bin', 'assets/*.psd']));
let r = await rows();
const by = Object.fromEntries(r.map((x) => [x.path, x.state]));
t.check('cada arquivo no seu estado', by['a.bin'] === 'downloaded' && by['b.bin'] === 'pointer' && by['assets/c.psd'] === 'missing' && r.length === 3, by);
t.check('o arquivo comum não aparece', !r.some((x) => x.path === 'leia.txt'));
await t.shot('lfs-lista');

// 3. filtro
await t.ev(`(() => { const i = document.querySelector('.lf__filter'); i.value = 'psd'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
t.check('o filtro deixa só o .psd', (await rows()).length === 1);
await t.ev(`(() => { const i = document.querySelector('.lf__filter'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);

// 4. download (se o git-lfs estiver instalado)
const missing = (await t.count('[data-testid="lfs-missing"]')) > 0;
if (missing) {
  t.check('sem o git-lfs o painel avisa e não oferece baixar', (await t.count('[data-testid="lfs-row"] button')) === 0);
} else {
  await rowBtn('b.bin', 'Baixar');
  await t.until(`document.querySelector('[data-testid="lfs-done"]')`, 60000);
  await sleep(500);
  r = await rows();
  t.check('baixar um arquivo o deixa como "Baixado"', r.find((x) => x.path === 'b.bin')?.state === 'downloaded', r);
  t.check('o conteúdo na pasta é o de verdade', readFileSync(join(repo, 'b.bin'), 'utf8') === contents['b.bin']);
  t.check('os outros não foram tocados', r.find((x) => x.path === 'assets/c.psd')?.state === 'missing', r);
}

server.close();
const appErrors = t.errors().filter((e) => !/favicon|Failed to fetch|ERR_CONNECTION|Failed to load resource|chrome-extension|Could not establish connection|asynchronous response/.test(String(e)));
t.check('nenhum erro da interface no console', appErrors.length === 0, appErrors);
t.close();
