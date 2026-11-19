import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { BEGIN, END, isAllowed, isBuildTool, licenseOf, mergeGenerated, renderGenerated, sortUnique } from '../lib/notices.mjs';

describe('licenseOf', () => {
  it('lê string SPDX, objeto {type} e a lista antiga', () => {
    expect(licenseOf({ license: 'MIT' })).toBe('MIT');
    expect(licenseOf({ license: { type: 'ISC' } })).toBe('ISC');
    expect(licenseOf({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('MIT OR Apache-2.0');
    expect(licenseOf({})).toBeNull();
    expect(licenseOf({ license: '  ' })).toBeNull();
  });
});

describe('isAllowed', () => {
  it('aceita as permissivas e as combinações válidas', () => {
    expect(isAllowed('MIT')).toBe(true);
    expect(isAllowed('(MIT OR GPL-3.0-only)')).toBe(true); // basta uma alternativa permitida
    expect(isAllowed('(BSD-2-Clause AND MIT)')).toBe(true);
  });
  it('reprova copyleft forte/rede, desconhecida e ausente', () => {
    expect(isAllowed('AGPL-3.0-only')).toBe(false);
    expect(isAllowed('GPL-2.0-only')).toBe(false); // incompatível com GPL-3.0-only
    expect(isAllowed('MIT AND AGPL-3.0-only')).toBe(false); // AND exige todas
    expect(isAllowed('SEE LICENSE IN LICENSE.md')).toBe(false);
    expect(isAllowed(null)).toBe(false);
    expect(isAllowed('')).toBe(false);
  });
});

describe('isBuildTool', () => {
  it('ferramentas de build/teste e @types não entram', () => {
    for (const n of ['electron', 'electron-builder', 'vite', 'sass', 'typescript', 'vitest', '@types/node', '@vitejs/plugin-vue']) expect(isBuildTool(n)).toBe(true);
    for (const n of ['vue', 'pinia', 'iconv-lite', '@codemirror/view']) expect(isBuildTool(n)).toBe(false);
  });
});

describe('sortUnique e renderGenerated', () => {
  const items = [
    { name: 'b', version: '1.10.0', license: 'MIT', text: 'Texto B' },
    { name: 'a', version: '2.0.0', license: 'ISC', text: '', homepage: 'https://a.example' },
    { name: 'b', version: '1.2.0', license: 'MIT', text: 'Texto B antigo' },
    { name: 'a', version: '2.0.0', license: 'ISC', text: '' },
  ];
  it('ordena por nome e versão (numérica) e tira repetidos', () => {
    expect(sortUnique(items).map((i: { name: string; version: string }) => `${i.name}@${i.version}`)).toEqual(['a@2.0.0', 'b@1.2.0', 'b@1.10.0']);
  });
  it('lista cada pacote com a licença e o texto; sem arquivo de licença, avisa', () => {
    const md = renderGenerated(items);
    expect(md).toContain('| b | 1.10.0 | MIT |');
    expect(md).toContain('### b 1.10.0');
    expect(md).toContain('Texto B');
    expect(md).toContain('https://a.example');
    expect(md).toContain('não traz arquivo de licença');
  });
  it('é determinística (mesma entrada, mesma saída)', () => {
    expect(renderGenerated(items)).toBe(renderGenerated([...items].reverse()));
  });
  it('o texto com crases não quebra a cerca do bloco', () => {
    const md = renderGenerated([{ name: 'x', version: '1', license: 'MIT', text: 'use ``` aqui' }]);
    expect(md).toContain('````text');
  });
});

describe('mergeGenerated', () => {
  it('sem região, acrescenta no fim e mantém o texto à mão', () => {
    const out = mergeGenerated('# Título\n\nà mão\n', 'GERADO 1');
    expect(out.startsWith('# Título\n\nà mão\n\n' + BEGIN)).toBe(true);
    expect(out).toContain('GERADO 1');
    expect(out.endsWith(END + '\n')).toBe(true);
  });
  it('com região, troca só ela e é idempotente', () => {
    const once = mergeGenerated('antes\n', 'V1');
    const twice = mergeGenerated(once, 'V2');
    expect(twice).toContain('V2');
    expect(twice).not.toContain('V1');
    expect(twice.startsWith('antes\n')).toBe(true);
    expect(mergeGenerated(twice, 'V2')).toBe(twice);
  });
  it('aceita CRLF na entrada e devolve LF', () => {
    expect(mergeGenerated('a\r\nb\r\n', 'G')).not.toContain('\r');
  });
});

describe('THIRD_PARTY_NOTICES.md do repositório', () => {
  const script = join(__dirname, '..', 'third-party-notices.mjs');
  it('está em dia com as dependências instaladas e só tem licenças permitidas (rode o script sem --check para atualizar)', () => {
    const out = execFileSync('node', [script, '--check'], { encoding: 'utf8' });
    expect(out).toContain('em dia');
  }, 60000);
  it('mantém a parte escrita à mão (JetBrains Mono) e a região gerada', () => {
    const text = readFileSync(join(__dirname, '..', '..', 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(text).toContain('## JetBrains Mono');
    expect(text).toContain(BEGIN);
    expect(text).toContain(END);
  });
});
