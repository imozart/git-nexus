// REGRAVAÇÃO das imagens e GIFs de docs/media (não é um teste: só roda com GN_MEDIA=1; sem isso sai na hora com sucesso, para o `ui-test` normal não gravar nada).
//
//   cd apps/studio && npx vite build
//   GN_MEDIA=1 GN_MEDIA_OUT=<pasta> node scripts/ui-tests/run.mjs media            # todas as cenas
//   GN_MEDIA=1 GN_MEDIA_ONLY=paleta GN_MEDIA_OUT=<pasta> node scripts/ui-tests/run.mjs media   # uma cena
//
// Cada cena monta um repositório de demonstração em C:\gn-demo (ou /tmp/gn-demo): caminho curto, sem nome de usuário nem dado de cliente, que aparece nas capturas.
// Janela 1320x760, pt-BR, tema escuro, fonte padrão. Cada quadro vira <cena>-<n>.png em GN_MEDIA_OUT; os GIFs são apresentações desses quadros (3 a 5, de 1,5 a 3 s cada),
// montadas com `apps/studio/scripts/ui-tests/montar-gifs.py` (Pillow). Veja docs/DESENVOLVIMENTO.md.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, git, mkRepo, sleep } from '../lib.mjs';

if (process.env.GN_MEDIA !== '1') {
  console.log(JSON.stringify({ 'media: ignorado (defina GN_MEDIA=1 para regravar docs/media)': 'OK' }));
  process.exit(0);
}

const OUT = process.env.GN_MEDIA_OUT ?? process.argv[2];
const ONLY = process.env.GN_MEDIA_ONLY;
const report = {};
process.on('exit', () => console.log(JSON.stringify(report, null, 2)));
const t = await connect(OUT, report);
mkdirSync(OUT, { recursive: true });

const DEMO = process.platform === 'win32' ? 'C:\\gn-demo' : '/tmp/gn-demo';
const lit = (s) => `new TextDecoder().decode(Uint8Array.from(atob('${Buffer.from(String(s), 'utf8').toString('base64')}'), (c) => c.charCodeAt(0)))`;
const frame = async (scene, n) => {
  await sleep(500);
  await t.send('Page.captureScreenshot', { format: 'png' }).then((x) => writeFileSync(join(OUT, `${scene}-${n}.png`), Buffer.from(x.result.data, 'base64')));
};
const setWindow = () => t.send('Emulation.setDeviceMetricsOverride', { width: 1320, height: 760, deviceScaleFactor: 1, mobile: false });
const reload = async () => {
  await t.ev('location.reload()');
  await t.until(`document.querySelector('.core')`, 15000);
  await sleep(700);
};
const prefs = () => t.ev(`['gitnexus.fontUi', 'gitnexus.fontCode', 'gitnexus.ligatures', 'gitnexus.theme'].forEach((k) => localStorage.removeItem(k)); localStorage.setItem('gitnexus.locale', 'pt-BR'); localStorage.setItem('gitnexus.autoFetch', '0'); localStorage.setItem('gitnexus.showGitLog', '0')`);
/** Cena nova: pasta limpa de demonstração, repositório criado pela função e aberto na aba. */
const openDemo = async (name, build) => {
  const dir = join(DEMO, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(DEMO, { recursive: true });
  const repo = build(dir);
  await t.ev(`window.gitNexus.addRepositoryPath(${lit(repo)})`);
  await reload();
  await t.until(`[...document.querySelectorAll('li.repo')].some((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)})`, 20000);
  await t.until(`[...document.querySelectorAll('li.repo')].every((r) => !/carregando|loading/i.test(r.textContent))`, 30000);
  await t.ev(`[...document.querySelectorAll('li.repo')].find((x) => x.querySelector('strong')?.textContent.trim() === ${lit(name)}).querySelector('.repo__btns button').click()`);
  await t.until(`document.querySelector('.rv__btns')`, 20000);
  await sleep(1200);
  return repo;
};
/** Cria o repositório em DEMO/<name> (mkRepo cria em root/<name>). */
const mk = (name, files, branch = 'main') => (dir) => mkRepo(DEMO, name, { files, branch });
const pal = async (text) => {
  if (!(await t.ev(`!!document.querySelector('.cp__input')`))) {
    await t.key('k', 2);
    await t.until(`document.querySelector('.cp__input')`, 5000);
  }
  await t.ev(`(() => { const i = document.querySelector('.cp__input'); i.value = ${lit(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(350);
};
const palRun = async () => {
  await t.key('Enter');
  await sleep(900);
};

const scenes = {};

// ---------- paleta de comandos: aberta, "rebase", "stash", "blame" ----------
scenes.paleta = async () => {
  await openDemo('reescrever', mk('reescrever', { 'README.md': '# reescrever\n' }));
  await t.key('k', 2);
  await t.until(`document.querySelector('.cp__input')`, 5000);
  await frame('paleta', 1);
  for (const [n, q] of [[2, 'rebase'], [3, 'stash'], [4, 'blame']]) {
    await pal(q);
    await frame('paleta', n);
  }
  await t.key('Escape');
};

const setField = (placeholder, value) => t.ev(`(() => { const i = [...document.querySelectorAll('.cf input, .cf textarea')].find((x) => x.placeholder === ${lit(placeholder)}); i.value = ${lit(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); return !!i; })()`);
const clickFile = (name) => t.ev(`[...document.querySelectorAll('.file__name')].find((x) => x.textContent.trim() === ${lit(name)})?.click()`);
/** Marca a caixa de seleção (stage) do arquivo na árvore de alterações. */
const stageFile = (name) => t.ev(`(() => { const n = [...document.querySelectorAll('.file__name')].find((x) => x.textContent.trim() === ${lit(name)}); let e = n; for (let k = 0; k < 4 && e; k++, e = e.parentElement) { const c = e.querySelector('input[type=checkbox]'); if (c) { c.click(); return true; } } return false; })()`);

// ---------- commit com linter: erros, mensagem inválida, aprovada e commit concluído (+ commit-linter.png) ----------
scenes['commit-linter'] = async () => {
  const login = [
    "import { hash } from './crypto';",
    '',
    'export async function login(email: string, password: string) {',
    '  const user = await findUser(email);',
    "  if (!user) throw new Error('Usuário não encontrado');",
    "  if (hash(password) !== user.hash) throw new Error('Senha inválida');",
    '  return createSession(user);',
    '}',
    '',
  ].join('\n');
  const repo = await openDemo('meu-app', (dir) => {
    const r = mkRepo(DEMO, 'meu-app', { files: { 'src/auth/login.ts': login, 'src/crypto.ts': 'export const hash = (s: string) => s;\n' }, branch: 'feature/PROJ-42-login' });
    const changed = login.replace("import { hash } from './crypto';", "import { hash } from './crypto';\nimport { validateEmail } from './validators';").replace('  const user = await findUser(email);', "  if (!validateEmail(email)) throw new Error('E-mail inválido');\n  const user = await findUser(email);").replace('  return createSession(user);', "  await auditLog('login', user.id);\n  return createSession(user);");
    writeFileSync(join(r, 'src/auth/login.ts'), changed);
    writeFileSync(join(r, 'src/auth/validators.ts'), "export const validateEmail = (e: string) => /^[^@\\s]+@[^@\\s]+$/.test(e);\n");
    return r;
  });
  await clickFile('login.ts');
  await sleep(1200);
  await frame('commit-linter', 1); // diff aberto, formulário vazio
  await stageFile('login.ts');
  await sleep(600);
  await setField('ex.: auth', 'auth');
  await sleep(500);
  await frame('commit-linter', 2); // arquivo no stage e escopo preenchido: falta o título
  await setField('resumo imperativo e curto', 'Adiciona a validação de e-mail no login e registra a auditoria do acesso.');
  await sleep(500);
  await frame('commit-linter', 3); // mensagem fora da política: título longo e com ponto final
  await setField('resumo imperativo e curto', 'valida o e-mail no login');
  await sleep(500);
  await frame('commit-linter', 4); // aprovada (é também o commit-linter.png)
  await t.ev(`document.querySelector('[data-testid="commit-submit"]').click()`);
  await t.until(`document.querySelector('.cf__out, [role="status"]')`, 15000).catch(() => {});
  await sleep(1200);
  // o resultado do commit fica abaixo do botão: rola o formulário até o fim
  await t.ev(`[...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY) && e.querySelector('.cf, [data-testid="commit-submit"]')).forEach((e) => (e.scrollTop = e.scrollHeight))`);
  await sleep(400);
  await frame('commit-linter', 5); // commit concluído
};

const clickText = (selector, text) => t.ev(`(() => { const b = [...document.querySelectorAll(${lit(selector)})].find((x) => x.textContent.trim().startsWith(${lit(text)}) && !x.disabled); b?.click(); return !!b; })()`);
const cm = (repo, file, content, msg) => {
  mkdirSync(join(repo, file, '..'), { recursive: true });
  writeFileSync(join(repo, file), content);
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', msg);
};
/** Abre uma seção de Ferramentas pela paleta (o que a pessoa faz com Ctrl+K). */
const tool = async (query) => {
  await pal(query);
  await palRun();
  await t.until(`document.querySelector('.tools')`, 10000);
  await sleep(800);
};

// ---------- desfazer de verdade: histórico de operações, confirmação e resultado ----------
scenes.desfazer = async () => {
  await openDemo('desfazer', (dir) => {
    const r = mkRepo(DEMO, 'desfazer', { files: { 'README.md': '# desfazer\n' } });
    cm(r, 'src/ajustes.ts', 'export const ajustes = {};\n', 'feat(ui): nova tela de ajustes');
    cm(r, 'src/busca.ts', 'export const foco = true;\n', 'fix: corrige o foco do campo de busca');
    return r;
  });
  await tool('histórico de operações');
  await frame('desfazer', 1);
  await clickText('.op--first button', 'Desfazer');
  await t.until(`document.querySelector('.dlg__box')`, 5000);
  await frame('desfazer', 2);
  await clickText('.dlg__box button', 'Desfazer');
  await sleep(1500);
  await frame('desfazer', 3);
};

// ---------- rebase interativo visual: lista, ações, confirmação e resultado ----------
scenes.rebase = async () => {
  await openDemo('reescrever', (dir) => {
    const r = mkRepo(DEMO, 'reescrever', { files: { 'README.md': '# reescrever\n' } });
    cm(r, 'src/login.ts', 'export const login = () => true;\n', 'feat(auth): tela de login');
    cm(r, 'src/botao.ts', 'export const botao = 1;\n', 'fix: ajusta o botão');
    cm(r, 'src/teste.ts', 'export const teste = 0;\n', 'wip: teste rápido');
    cm(r, 'docs/login.md', '# login\n', 'docs: explica o login');
    return r;
  });
  await tool('rebase interativo');
  await t.ev(`(() => { const i = document.querySelector('.rb input[type=number]'); if (i) { i.value = '4'; i.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await clickText('.rb button', 'Carregar commits');
  await t.until(`document.querySelectorAll('.rb .cbx').length >= 4`, 10000);
  await sleep(600);
  await frame('rebase', 1);
  const pick = async (row, option) => {
    await t.ev(`document.querySelectorAll('.rb .cbx')[${row}].querySelector('.cbx__btn').click()`);
    await t.until(`document.querySelector('.cbx__list')`, 3000);
    await t.ev(`[...document.querySelectorAll('.cbx__list [role="option"]')].find((o) => o.textContent.trim().startsWith(${lit(option)}))?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
    await sleep(300);
  };
  await pick(1, 'Juntar (fixup)');
  await pick(2, 'Descartar');
  await frame('rebase', 2);
  await clickText('.rb button', 'Executar rebase');
  await t.until(`document.querySelector('.dlg__box')`, 5000);
  await frame('rebase', 3);
  await clickText('.dlg__box button', 'Executar rebase');
  await t.until(`document.body.textContent.includes('Rebase concluído')`, 30000);
  await sleep(800);
  await frame('rebase', 4);
};

// ---------- stage por linha: diff, modo pendente, uma linha incluída e o modo "no commit" ----------
scenes['stage-por-linha'] = async () => {
  const num = (n, alt = {}) => Array.from({ length: 21 }, (_, i) => `const linha${i + 1} = ${alt[i + 1] ?? i + 1};`).join('\n') + '\n';
  const repo = await openDemo('linhas', (dir) => {
    const r = mkRepo(DEMO, 'linhas', { files: { 'src/config.ts': num(0) } });
    writeFileSync(join(r, 'src/config.ts'), num(0, { 4: '40; // timeout maior', 5: 50, 18: '180; // limite de itens' }));
    return r;
  });
  await clickFile('config.ts');
  await sleep(1200);
  await frame('stage-por-linha', 1);
  await clickText('.gn-seg__opt', 'Pendente');
  await sleep(600);
  await frame('stage-por-linha', 2);
  await t.ev(`document.querySelector('[title="Incluir esta linha no commit"]')?.click()`);
  await t.until(`document.body.textContent.includes('Linha incluída')`, 10000);
  await sleep(600);
  await frame('stage-por-linha', 3);
  await clickText('.gn-seg__opt', 'No commit');
  await sleep(900);
  await frame('stage-por-linha', 4);
};

// ---------- conflito: lista, três painéis com marcadores, resolvido e confirmação ----------
scenes.conflito = async () => {
  const cfg = (timeout) => `export const config = {\n  retries: 3,\n  timeout: ${timeout},\n  baseUrl: 'https://api.exemplo.com',\n};\n`;
  await openDemo('api-cliente', (dir) => {
    const r = mkRepo(DEMO, 'api-cliente', { files: { 'src/config.ts': cfg(5000) } });
    git(r, 'checkout', '-qb', 'feature/PROJ-7-timeout');
    cm(r, 'src/config.ts', cfg(10000), 'feat(config): aumenta o timeout para 10 s');
    git(r, 'checkout', '-q', 'main');
    cm(r, 'src/config.ts', cfg(8000), 'fix(config): timeout de 8 s');
    try {
      git(r, 'merge', 'feature/PROJ-7-timeout');
    } catch {
      /* o conflito é o ponto da cena */
    }
    return r;
  });
  await sleep(800);
  await frame('conflito', 1);
  await clickText('button', 'Resolver');
  await t.until(`document.querySelector('.merge, [class*="merge"]')`, 10000).catch(() => {});
  await sleep(1500);
  await frame('conflito', 2);
  await clickText('button', 'Ambos');
  await sleep(900);
  await frame('conflito', 3);
  await clickText('button', 'Marcar como Resolvido');
  await t.until(`document.body.textContent.includes('Nenhum conflito pendente')`, 15000);
  await sleep(600);
  await frame('conflito', 4);
};

for (const [name, run] of Object.entries(scenes)) {
  if (ONLY && ONLY !== name) continue;
  await setWindow();
  await prefs();
  await reload();
  await run();
  report[`cena ${name}`] = 'OK';
}
t.close();
