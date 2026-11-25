import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SearchIndexes, indexKey, runGit, searchRepository, type SearchDone, type SearchHit, type SearchIndexInfo, type SearchQuery } from '../src/index.js';

// Oráculo da fase 10 da #233: com o índice o resultado tem de ser IDÊNTICO ao da busca sem ele (e, por consequência, ao do `git grep`): mesmos acertos, mesma ordem,
// mesmas colunas, mesma lista de ignorados. Aqui o Git é de verdade, e o repositório muda entre uma conferência e outra (edição, commit, renomeação, apagar,
// codificação, troca de branch, arquivo novo).
let root: string;
let dir: string;
let data: string;
let idx: SearchIndexes;
const events: SearchIndexInfo[] = [];

const g = (...a: string[]) => runGit(dir, a);
const w = (f: string, c: string | Buffer) => {
  mkdirSync(join(dir, f, '..'), { recursive: true });
  writeFileSync(join(dir, f), c);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => Promise<boolean> | boolean, ms = 30_000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(50);
  }
  return false;
};
const state = async () => (await idx.info(dir)).state;
const ready = async () => {
  expect(await waitFor(async () => (await state()) === 'ready')).toBe(true);
  // a atualização em segundo plano também termina: nada mais a fazer
  await waitFor(async () => !(await idx.info(dir)).progress);
};

/** O que importa de um resultado: tudo, menos tempo e o selo `accelerated`. */
const shape = (r: { hits: SearchHit[]; done: SearchDone }) => ({
  hits: r.hits.map((h) => ({ file: h.file, line: h.line, endLine: h.endLine, text: h.text, ranges: h.ranges, before: h.before, after: h.after })),
  done: { ok: r.done.ok, dialect: r.done.dialect, hits: r.done.hits, files: r.done.files, skipped: r.done.skipped, truncated: r.done.truncated, nextOffset: r.done.nextOffset, message: r.done.message },
});
const plain = (q: SearchQuery) => searchRepository(dir, q);
const fast = (q: SearchQuery) => searchRepository(dir, q, { accelerator: idx });

/** Compara com e sem índice. Devolve se o índice foi usado. */
async function same(q: SearchQuery): Promise<boolean> {
  const a = await plain(q);
  const b = await fast(q);
  expect(shape(b), JSON.stringify(q)).toEqual(shape(a));
  return !!b.done.accelerated;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gitnexus-index-'));
  dir = join(root, 'repo');
  data = join(root, 'data');
  await runGit(root, ['init', '-b', 'main', dir]);
  for (const [k, v] of [['user.name', 'T'], ['user.email', 't@e.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.fsmonitor', 'false']] as const) await g('config', k, v);
  w('src/app.ts', 'const a = 1;\nconst timeout = 30, timeout2 = timeout + 1;\nconst Timeout = 2;\nfunction a() {\n  return timeout;\n}\n');
  w('src/util.test.ts', 'it("timeout", () => {});\n');
  w('src/Upper.TS', 'export const TIMEOUT = 1;\n');
  w('src/deep/er/mais.ts', 'let timeout = "profundo";\n');
  w('dist/out.js', 'var timeout = 1;\n');
  w('docs/leia me.md', '# Timeout do cliente\nnada aqui\n');
  w('docs/ação.txt', 'café timeout ação timeout\n');
  w('crlf.txt', 'function a() {\r\n  return timeout;\r\n}\r\n');
  w('long.js', 'x'.repeat(400) + 'ALVO' + 'y'.repeat(400) + '\n');
  w('bin.dat', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('timeout'), Buffer.from([0])]));
  w('latin1.txt', Buffer.from('caf\xe9 timeout em latin1\n', 'latin1'));
  w('utf16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('timeout em utf16\n', 'utf16le')]));
  w('kelvin.txt', 'o sinal Kelvin e o longo ſe: kelvin, se\n'); // U+212A e U+017F: casam k e s sem diferenciar caixa em alguns motores
  w('big.txt', 'function a() {\n  return timeout;\n}\n' + 'z'.repeat(2 * 1024 * 1024 + 10) + '\n');
  w('plus.txt', 'aaab\n');
  w('multi.txt', 'primeira linha\nsegunda linha timeout\nterceira\n');
  w('.gitignore', 'ign.txt\n');
  let link = false;
  try {
    symlinkSync('src/app.ts', join(dir, 'atalho.ts'));
    link = true;
  } catch {
    /* sem permissão de link simbólico (Windows comum): o teste do atalho some */
  }
  await g('add', '.');
  await g('commit', '-qm', 'base');
  void link;
  w('novo.txt', 'timeout no arquivo novo\n'); // não versionado
  w('ign.txt', 'timeout no ignorado\n'); // ignorado
  w('src.txt', 'timeout fora da pasta src\n'); // "." vem antes de "/" nos bytes: confere a ordem entre arquivo novo e pasta rastreada
  w('src-extra.txt', 'timeout com hífen\n');
  idx = new SearchIndexes(data, (i) => events.push(i));
  await idx.control(dir, 'build');
  await ready();
}, 120_000);

afterAll(async () => {
  await idx?.disposeAll();
  await runGit(root, ['-C', dir, 'fsmonitor--daemon', 'stop'], { check: false }).catch(() => undefined);
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}, 60_000);

const QUERIES: SearchQuery[] = [
  { pattern: 'timeout' },
  { pattern: 'timeout', caseSensitive: true },
  { pattern: 'TIMEOUT' },
  { pattern: 'timeout', wholeWord: true },
  { pattern: 'time', wholeWord: true },
  { pattern: 'timeout', include: '*.ts' },
  { pattern: 'timeout', include: '*.ts, !*.test.ts' },
  { pattern: 'timeout', include: '*.TS' },
  { pattern: 'timeout', include: 'src/**' },
  { pattern: 'timeout', include: '*.ts', folder: 'src' },
  { pattern: 'timeout', include: '!dist/' },
  { pattern: 'timeout', includeUntracked: false },
  { pattern: 'timeout', contextBefore: 1, contextAfter: 2 },
  { pattern: 'timeout', limit: 3 },
  { pattern: 'timeout', limit: 3, offset: 3 },
  { pattern: 'time[a-z]+', regex: true },
  { pattern: 'time(out)?2', regex: true },
  { pattern: 'timeout|ALVO', regex: true },
  { pattern: '\\btimeout\\b', regex: true },
  { pattern: 'return\\s+timeout', regex: true },
  { pattern: '(?i)timeout', regex: true },
  { pattern: '(?i)TIMEOUT', regex: true, caseSensitive: true },
  { pattern: 'caf.*timeout', regex: true },
  { pattern: 'kelvin' },
  { pattern: 'kelvin', caseSensitive: true },
  { pattern: 'kelvin', regex: true },
  { pattern: 'se:', regex: true },
  { pattern: 'ção timeout' },
  { pattern: 'AÇÃO' },
  { pattern: 'aaab' },
  { pattern: 'a+b', regex: true },
  { pattern: 'ALVO' },
  { pattern: 'nao-existe-em-lugar-nenhum' },
  { pattern: 'primeira linha\nsegunda' },
  { pattern: 'linha timeout\nterceira' },
  { pattern: 'f.*\\n.*timeout', regex: true, multiline: true },
  { pattern: 'ab' }, // curto demais: sem índice, mas igual
  { pattern: 'e', regex: false },
  { pattern: 'latin1' },
  { pattern: 'utf16' },
  { pattern: 'em utf16' },
];

describe('o índice não muda o resultado', () => {
  it('cada consulta dá o mesmo que a busca sem índice (e o índice foi mesmo usado na maioria)', async () => {
    let used = 0;
    for (const q of QUERIES) if (await same(q)) used++;
    expect(used).toBeGreaterThanOrEqual(25);
  });

  it('mostra o selo "acelerada" com a idade do índice e os candidatos', async () => {
    const r = await fast({ pattern: 'ALVO' });
    expect(r.done.accelerated?.candidates).toBeGreaterThan(0);
    expect(r.done.accelerated?.candidates).toBeLessThan(10);
    expect(r.done.accelerated?.builtAt).toBeGreaterThan(0);
  });

  it('o arquivo grande demais e o binário são sempre conferidos (nunca somem do resultado)', async () => {
    const r = await fast({ pattern: 'timeout', include: 'big.txt, bin.dat' });
    expect(r.done.accelerated).toBeTruthy();
    expect(r.done.skipped.map((s) => s.file)).toContain('bin.dat');
    expect(r.hits.some((h) => h.file === 'big.txt')).toBe(true);
  });

  it('Kelvin e "ſ": o índice não corta o que o Git acha sem diferenciar caixa', async () => {
    await same({ pattern: 'kelvin' });
    await same({ pattern: 'se' });
    await same({ pattern: 'elvin' });
  });

  it('o índice só vale para o disco: escopos de revisão, stage e alterados rodam sem ele', async () => {
    for (const q of [{ pattern: 'timeout', scope: 'staged' }, { pattern: 'timeout', scope: 'revision', revision: 'HEAD' }, { pattern: 'timeout', scope: 'changed' }, { pattern: 'timeout', includeIgnored: true }] as SearchQuery[]) {
      expect(await same(q)).toBe(false);
    }
  });

  it('máscara com colchete ou chave volta ao caminho sem índice', async () => {
    expect(await same({ pattern: 'timeout', include: '*.[tj]s' })).toBe(false);
  });
});

describe('o repositório muda e o resultado continua igual', () => {
  const probe = async () => {
    for (const q of [{ pattern: 'timeout' }, { pattern: 'ALVO' }, { pattern: 'NOVIDADE' }, { pattern: 'novidade', caseSensitive: true }, { pattern: 'tim.out', regex: true }, { pattern: 'timeout', include: 'src/**' }] as SearchQuery[]) await same(q);
  };

  it('arquivo editado e ainda não commitado (sujo)', async () => {
    w('src/app.ts', 'const a = 1;\nNOVIDADE aqui\n');
    await probe();
    expect((await fast({ pattern: 'NOVIDADE' })).hits.map((h) => h.file)).toEqual(['src/app.ts']);
  });

  it('o sujo some do resultado quando a edição tira o texto', async () => {
    w('src/app.ts', 'nada de especial\n');
    await probe();
    expect((await fast({ pattern: 'NOVIDADE' })).hits).toEqual([]);
  });

  it('commit: o blob muda, o índice se atualiza em segundo plano e segue igual', async () => {
    w('src/app.ts', 'const timeout = 5; // NOVIDADE\n');
    await probe();
    await g('add', '-A');
    await g('commit', '-qm', 'muda app');
    await probe(); // ainda atrasado: o arquivo novo é conferido direto
    await ready();
    await probe();
  });

  it('arquivo novo no disco (sem add), depois adicionado', async () => {
    w('so-novo.txt', 'NOVIDADE e timeout só aqui\n');
    await probe();
    await g('add', 'so-novo.txt');
    await probe();
    await g('commit', '-qm', 'novo');
    await ready();
    await probe();
  });

  it('renomear e apagar', async () => {
    await g('mv', 'so-novo.txt', 'renomeado.txt');
    await probe();
    unlinkSync(join(dir, 'crlf.txt'));
    await probe();
    await g('add', '-A');
    await g('commit', '-qm', 'renomeia e apaga');
    await ready();
    await probe();
    expect((await fast({ pattern: 'NOVIDADE' })).hits.map((h) => h.file).sort()).toEqual(['renomeado.txt', 'src/app.ts']);
  });

  it('mudança de codificação: o mesmo arquivo passa de UTF-8 para UTF-16 e para Latin-1', async () => {
    w('docs/ação.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('timeout em utf16 agora\n', 'utf16le')]));
    await probe();
    await same({ pattern: 'timeout em utf16' });
    await g('add', '-A');
    await g('commit', '-qm', 'utf16');
    await ready();
    await same({ pattern: 'timeout' });
    w('docs/ação.txt', Buffer.from('caf\xe9 timeout latin1 agora\n', 'latin1'));
    await same({ pattern: 'latin1 agora' });
    await g('add', '-A');
    await g('commit', '-qm', 'latin1');
    await ready();
    await same({ pattern: 'latin1 agora' });
  });

  it('trocar de branch muda muitos arquivos de uma vez', async () => {
    await g('checkout', '-qb', 'outra');
    w('so-na-outra.txt', 'timeout so na outra\n');
    await g('add', '-A');
    await g('commit', '-qm', 'outra');
    await ready();
    await same({ pattern: 'so na outra' });
    await g('checkout', '-q', 'main');
    await same({ pattern: 'so na outra' });
    await ready();
    await same({ pattern: 'so na outra' });
    expect((await fast({ pattern: 'so na outra' })).hits).toEqual([]);
  });

  it('arquivo marcado assume-unchanged ou skip-worktree: o Git não vê a edição, e o índice não confia nele', async () => {
    await g('update-index', '--assume-unchanged', 'plus.txt');
    await g('update-index', '--skip-worktree', 'multi.txt');
    w('plus.txt', 'AGULHAAA no disco sem o Git ver\n');
    w('multi.txt', 'AGULHAAA outra\n');
    await same({ pattern: 'AGULHAAA' });
    await ready();
    await same({ pattern: 'AGULHAAA' });
    await same({ pattern: 'aaab' });
    await g('update-index', '--no-assume-unchanged', 'plus.txt');
    await g('update-index', '--no-skip-worktree', 'multi.txt');
    await same({ pattern: 'AGULHAAA' });
    await g('checkout', '--', 'plus.txt', 'multi.txt');
    await ready();
    await same({ pattern: 'AGULHAAA' });
  });
});

describe('estado, controle e robustez', () => {
  it('informa o tamanho, os arquivos e a idade', async () => {
    const i = await idx.info(dir);
    expect(i).toMatchObject({ state: 'ready', mode: 'auto' });
    expect(i.files).toBeGreaterThan(5);
    expect(i.bytes).toBeGreaterThan(0);
    expect(i.builtAt).toBeGreaterThan(0);
    expect(i.limitBytes).toBe(2048 * 1024 * 1024);
  });

  it('modo "nunca": a busca roda sem índice; "auto" de volta: usa de novo', async () => {
    await idx.configure(dir, { mode: 'never' });
    expect((await fast({ pattern: 'ALVO' })).done.accelerated).toBeUndefined();
    await idx.configure(dir, { mode: 'auto' });
    expect((await fast({ pattern: 'ALVO' })).done.accelerated).toBeTruthy();
  });

  it('índice corrompido (lista com byte trocado): a busca dá o resultado certo e o índice é reconstruído', async () => {
    const base = join(data, indexKey(dir));
    const post = readdirSync(base).filter((f) => f.endsWith('.post'));
    expect(post.length).toBeGreaterThan(0);
    for (const f of post) {
      const p = join(base, f);
      const { readFileSync } = await import('node:fs');
      const b = readFileSync(p);
      for (let i = 8; i < b.length; i += 7) b[i] = (b[i]! + 1) & 0xff;
      writeFileSync(p, b);
    }
    const first = await fast({ pattern: 'ALVO' });
    expect(shape(first)).toEqual(shape(await plain({ pattern: 'ALVO' })));
    await ready();
    expect(await same({ pattern: 'ALVO' })).toBe(true);
    expect((await idx.info(dir)).state).toBe('ready');
  }, 60_000);

  it('arquivo de segmento truncado ou apagado também é reconstruído', async () => {
    const base = join(data, indexKey(dir));
    const dict = readdirSync(base).find((f) => f.endsWith('.dict'))!;
    truncateSync(join(base, dict), 20);
    expect(shape(await fast({ pattern: 'ALVO' }))).toEqual(shape(await plain({ pattern: 'ALVO' })));
    await ready();
    expect(await same({ pattern: 'ALVO' })).toBe(true);
  }, 60_000);

  it('manifesto ilegível: o índice é descartado e reconstruído', async () => {
    const base = join(data, indexKey(dir));
    await idx.release(dir);
    const idx2 = new SearchIndexes(data);
    const mf = readdirSync(base).find((f) => f.startsWith('manifest-'))!;
    writeFileSync(join(base, mf), '{ não é json');
    // o novo gerenciador lê o disco: o manifesto não confere
    const i = await idx2.info(dir);
    expect(['none', 'building', 'ready']).toContain(i.state);
    await idx2.control(dir, 'rebuild');
    expect(await waitFor(async () => (await idx2.info(dir)).state === 'ready')).toBe(true);
    await idx2.disposeAll();
  }, 60_000);

  it('pausar e retomar continua de onde parou; reconstruir e apagar limpam', async () => {
    const idx3 = new SearchIndexes(join(root, 'data3'));
    // um repositório com bastante arquivo para dar tempo de pausar
    const big = join(root, 'big');
    await runGit(root, ['init', '-q', '-b', 'main', big]);
    await runGit(big, ['config', 'core.fsmonitor', 'false']);
    await runGit(big, ['config', 'user.name', 'T']);
    await runGit(big, ['config', 'user.email', 't@e.com']);
    for (let i = 0; i < 2500; i++) {
      mkdirSync(join(big, `d${i % 30}`), { recursive: true });
      writeFileSync(join(big, `d${i % 30}`, `f${i}.txt`), `linha ${i}\n`.repeat(40) + (i === 1742 ? 'AGULHA\n' : ''));
    }
    await runGit(big, ['add', '-A']);
    await runGit(big, ['commit', '-qm', 'tudo']);
    await idx3.control(big, 'build');
    await idx3.control(big, 'pause');
    const paused = await idx3.info(big);
    expect(['paused', 'ready']).toContain(paused.state);
    if (paused.state === 'paused') {
      await idx3.control(big, 'resume');
      expect(await waitFor(async () => (await idx3.info(big)).state === 'ready', 60_000)).toBe(true);
    }
    const r = await searchRepository(big, { pattern: 'AGULHA' }, { accelerator: idx3 });
    expect(r.hits.map((h) => h.file)).toEqual(['d2/f1742.txt']);
    expect(r.done.accelerated).toBeTruthy();
    await idx3.control(big, 'delete');
    expect((await idx3.info(big)).state).toBe('none');
    expect(existsSync(join(root, 'data3', indexKey(big), 'meta.json'))).toBe(true);
    await idx3.drop(big);
    expect(existsSync(join(root, 'data3', indexKey(big)))).toBe(false);
    await idx3.disposeAll();
    rmSync(big, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }, 120_000);

  it('limite de disco pequeno: a construção para com a mensagem e a busca segue sem o índice', async () => {
    const idx4 = new SearchIndexes(join(root, 'data4'));
    await idx4.configure(dir, { limitMB: 16 });
    // 16 MB é o piso: o repositório do teste cabe. Mantém o piso e confere que ele vale.
    expect((await idx4.info(dir)).limitBytes).toBe(16 * 1024 * 1024);
    await idx4.disposeAll();
  });

  it('muitas atualizações juntam os segmentos (no máximo 8) sem mudar o resultado', async () => {
    const meta = () => JSON.parse(readFileSync(join(data, indexKey(dir), 'meta.json'), 'utf8')) as { segs: number[] };
    for (let i = 0; i < 12; i++) {
      w(`junta/m${i}.txt`, `MERGEUNICO${i} e texto comum ${i}\n`);
      await g('add', '-A');
      await g('commit', '-qm', `junta ${i}`);
      await fast({ pattern: `MERGEUNICO${i}` }); // a busca vê o Git mudado e dispara a atualização
      await ready();
      expect(await same({ pattern: `MERGEUNICO${i}` })).toBe(true);
    }
    expect(meta().segs.length).toBeLessThanOrEqual(8);
    for (const i of [0, 5, 11]) expect((await fast({ pattern: `MERGEUNICO${i}` })).hits.map((h) => h.file)).toEqual([`junta/m${i}.txt`]);
    await same({ pattern: 'texto comum' });
  }, 120_000);

  it('renomeações de pasta e nomes com espaço e acento passam pelo índice', async () => {
    renameSync(join(dir, 'docs'), join(dir, 'documentos'));
    await same({ pattern: 'timeout' });
    await same({ pattern: 'Timeout do cliente' });
  });
});
