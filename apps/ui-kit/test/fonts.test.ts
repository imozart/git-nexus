import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A fonte JetBrains Mono v2.304 vai dentro do app: arquivos oficiais sem modificação, licença junto, empacotamento e CSP intactos.
const root = join(__dirname, '..', '..', '..');
const styles = join(root, 'apps', 'ui-kit', 'src', 'styles');
const fontsDir = join(styles, 'fonts');
const text = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const FACES = [
  ['JetBrainsMono-Regular.woff2', 400],
  ['JetBrainsMono-Medium.woff2', 500],
  ['JetBrainsMono-SemiBold.woff2', 600],
  ['JetBrainsMono-Bold.woff2', 700],
] as const;

describe('arquivos da fonte', () => {
  it('só as 4 faces do app (nada de itálico, outros pesos, .ttf ou fonte variável)', () => {
    const woff = readdirSync(fontsDir).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f)).sort();
    expect(woff).toEqual(FACES.map(([f]) => f).sort());
  });

  it('cada arquivo é um woff2 de verdade (assinatura wOF2) e o SHA-256 bate com o SOURCES.md', () => {
    const sources = text(join(fontsDir, 'SOURCES.md'));
    for (const [file] of FACES) {
      const buf = readFileSync(join(fontsDir, file));
      expect(buf.subarray(0, 4).toString('latin1'), file).toBe('wOF2');
      const sha = createHash('sha256').update(buf).digest('hex');
      expect(sources, file).toContain(`\`${file}\``);
      expect(sources, file).toContain(sha);
    }
  });

  it('o SOURCES.md aponta o release oficial v2.304', () => {
    const sources = text(join(fontsDir, 'SOURCES.md'));
    expect(sources).toContain('https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304');
    expect(sources).toContain('JetBrainsMono-2.304.zip');
  });
});

describe('licença', () => {
  it('OFL.txt é a licença da JetBrains Mono (SIL OFL 1.1)', () => {
    const ofl = text(join(fontsDir, 'OFL.txt'));
    expect(ofl).toContain('Copyright 2020 The JetBrains Mono Project Authors');
    expect(ofl).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('THIRD_PARTY_NOTICES.md cita a fonte, a versão e a licença', () => {
    const n = text(join(root, 'THIRD_PARTY_NOTICES.md'));
    expect(n).toContain('JetBrains Mono');
    expect(n).toContain('2.304');
    expect(n).toContain('OFL');
  });

  it('o README avisa que o app embute a fonte e aponta para os avisos', () => {
    const readme = text(join(root, 'README.md'));
    expect(readme).toContain('JetBrains Mono');
    expect(readme).toContain('THIRD_PARTY_NOTICES.md');
  });
});

describe('@font-face', () => {
  const scss = text(join(styles, 'fonts.scss'));
  const blocks = scss.match(/@font-face\s*\{[^}]*\}/g) ?? [];

  it('quatro faces da família JetBrains Mono, pesos 400, 500, 600 e 700, normais e em woff2', () => {
    expect(blocks).toHaveLength(4);
    const weights = blocks.map((b) => Number(/font-weight:\s*(\d+)/.exec(b)?.[1])).sort();
    expect(weights).toEqual([400, 500, 600, 700]);
    for (const b of blocks) {
      expect(b).toContain("font-family: 'JetBrains Mono'");
      expect(b).toContain('font-style: normal');
      expect(b).toContain('font-display: block');
      expect(b).toContain("format('woff2')");
    }
  });

  it('cada face aponta para o arquivo do peso certo, que existe', () => {
    for (const [file, weight] of FACES) {
      const b = blocks.find((x) => x.includes(`font-weight: ${weight};`));
      expect(b, String(weight)).toContain(`url('./fonts/${file}')`);
      expect(existsSync(join(fontsDir, file))).toBe(true);
    }
  });

  it('só URLs relativas: nada de http, data: nem @import externo', () => {
    const urls = [...scss.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]!.replace(/['"]/g, ''));
    expect(urls).toHaveLength(4);
    for (const u of urls) expect(u).toMatch(/^\.\/fonts\/[\w-]+\.woff2$/);
    const code = scss.replace(/^\s*\/\/.*$/gm, ''); // sem os comentários (que citam data: e http de propósito)
    expect(code).not.toMatch(/data:|https?:|@import/);
  });

  it('o tokens.scss carrega o fonts.scss (o renderer só importa o tokens)', () => {
    expect(text(join(styles, 'tokens.scss'))).toContain("@use './fonts';");
  });
});

describe('empacotamento, CSP e .gitattributes', () => {
  it('electron-builder leva a licença da fonte e os avisos de terceiros', () => {
    const yml = text(join(root, 'apps', 'studio', 'electron-builder.yml'));
    expect(yml).toContain('from: ../ui-kit/src/styles/fonts/OFL.txt, to: licenses/JetBrainsMono-OFL.txt');
    expect(yml).toContain('from: ../../THIRD_PARTY_NOTICES.md, to: THIRD_PARTY_NOTICES.md');
  });

  it('a CSP do index.html não foi relaxada: nada de data: nem origem externa', () => {
    const html = text(join(root, 'apps', 'studio', 'src', 'entrypoints', 'renderer', 'index.html'));
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/data:|https?:|font-src/);
  });

  it('.gitattributes marca *.woff2 como binário', () => {
    expect(text(join(root, '.gitattributes'))).toMatch(/^\*\.woff2\s+binary$/m);
  });
});
