import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadVerified, replaceAppImage } from '../src/entrypoints/installer';

const NAME = 'GitNexus-1.3.0-win-x64-setup.exe';
const BASE = 'https://github.com/imozart/git-nexus/releases/download/v1.3.0';
const CONTENT = Buffer.from('conteúdo do instalador '.repeat(5000));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function fakeFetch(opts: { sums?: string; body?: Buffer; status?: number } = {}) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    if (url.endsWith('SHA256SUMS.txt')) return new Response(opts.sums ?? `${sha(CONTENT)}  ${NAME}\n`, { status: 200 });
    const body = opts.body ?? CONTENT;
    return new Response(new Uint8Array(body), { status: opts.status ?? 200, headers: { 'content-length': String(body.length) } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const tmp = () => mkdtempSync(join(tmpdir(), 'gn-upd-'));
const base = (dir: string, f: typeof fetch) => ({ url: `${BASE}/${NAME}`, name: NAME, sumsUrl: `${BASE}/SHA256SUMS.txt`, destDir: dir, fetchImpl: f });

describe('downloadVerified', () => {
  it('baixa, confere o SHA-256 e entrega o arquivo; reporta progresso', async () => {
    const dir = tmp();
    const seen: number[] = [];
    const r = await downloadVerified({ ...base(dir, fakeFetch().f), onProgress: (p) => seen.push(p.done) });
    expect(r.sha256).toBe(sha(CONTENT));
    expect(readFileSync(r.file).equals(CONTENT)).toBe(true);
    expect(seen.at(-1)).toBe(CONTENT.length);
    expect(readdirSync(dir)).toEqual([NAME]); // sem sobras .part
  });

  it('hash diferente do publicado: descarta o arquivo e falha', async () => {
    const dir = tmp();
    const adulterado = Buffer.from('outro conteúdo');
    await expect(downloadVerified(base(dir, fakeFetch({ body: adulterado }).f))).rejects.toThrow(/SHA-256/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('o SHA256SUMS.txt não lista o pacote: não baixa nada', async () => {
    const dir = tmp();
    const { f, calls } = fakeFetch({ sums: `${sha(CONTENT)}  outro.exe\n` });
    await expect(downloadVerified(base(dir, f))).rejects.toThrow(/não lista/);
    expect(calls.some((c) => c.endsWith(NAME))).toBe(false);
  });

  it('recusa endereço fora do GitHub do projeto e nome de arquivo perigoso', async () => {
    const dir = tmp();
    const { f, calls } = fakeFetch();
    await expect(downloadVerified({ ...base(dir, f), url: `https://evil.example/${NAME}` })).rejects.toThrow(/não permitido/);
    await expect(downloadVerified({ ...base(dir, f), sumsUrl: 'https://evil.example/SHA256SUMS.txt' })).rejects.toThrow(/não permitido/);
    await expect(downloadVerified({ ...base(dir, f), name: '../x.exe' })).rejects.toThrow(/inválido/);
    expect(calls).toEqual([]); // nenhuma requisição foi feita
  });

  it('erro HTTP no pacote: falha sem deixar arquivo', async () => {
    const dir = tmp();
    await expect(downloadVerified(base(dir, fakeFetch({ status: 502 }).f))).rejects.toThrow(/502/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('limpa baixados de versões anteriores', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'GitNexus-1.0.0-win-x64-setup.exe'), 'velho');
    await downloadVerified(base(dir, fakeFetch().f));
    expect(readdirSync(dir)).toEqual([NAME]);
  });
});

describe('replaceAppImage', () => {
  it('troca o arquivo atual pelo novo, sem deixar o .new', async () => {
    const dir = tmp();
    const atual = join(dir, 'GitNexus.AppImage');
    const novo = join(dir, 'novo.AppImage');
    writeFileSync(atual, 'v1');
    writeFileSync(novo, 'v2');
    await replaceAppImage(novo, atual);
    expect(readFileSync(atual, 'utf8')).toBe('v2');
    expect(existsSync(`${atual}.new`)).toBe(false);
  });
  it('se a cópia falhar, o original continua intacto', async () => {
    const dir = tmp();
    const atual = join(dir, 'GitNexus.AppImage');
    writeFileSync(atual, 'v1');
    await expect(replaceAppImage(join(dir, 'nao-existe'), atual)).rejects.toThrow(/AppImage/);
    expect(readFileSync(atual, 'utf8')).toBe('v1');
    expect(existsSync(`${atual}.new`)).toBe(false);
  });
});
