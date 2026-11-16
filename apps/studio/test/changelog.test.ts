import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGELOG_URL, parseChangelog, parseInline, releaseUrl, withCurrentVersion } from '../src/shared/changelog';
import { isAllowedUpdateUrl } from '../src/shared/update';

describe('parseInline', () => {
  it('reconhece negrito, código e links (inclusive com o texto em código)', () => {
    expect(parseInline('**ui:** botões `GnButton` ([`a869e1b`](https://github.com/imozart/git-nexus/commit/a869e1b))')).toEqual([
      { kind: 'bold', text: 'ui:' },
      { kind: 'text', text: ' botões ' },
      { kind: 'code', text: 'GnButton' },
      { kind: 'text', text: ' (' },
      { kind: 'link', text: 'a869e1b', href: 'https://github.com/imozart/git-nexus/commit/a869e1b', code: true },
      { kind: 'text', text: ')' },
    ]);
    expect(parseInline('veja [as notas](https://x.example/n)')).toContainEqual({ kind: 'link', text: 'as notas', href: 'https://x.example/n', code: false });
  });
  it('HTML no texto fica como texto (a interface nunca usa v-html)', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'text', text: '<img src=x onerror=alert(1)>' }]);
  });
});

describe('parseChangelog', () => {
  const MD = `# Changelog

Texto de apresentação que deve ser ignorado ([semver](https://semver.org)).

## [1.6.0] - 2026-11-15

### ✨ Novidades

- **ui:** botão novo ([\`abc1234\`](https://github.com/imozart/git-nexus/commit/abc1234))
- outra coisa
  que continua na linha de baixo

### 🐛 Correções

- conserta algo

## [1.5.0] - 2026-11-01

- item solto, sem seção

## [Unreleased]
`;
  const v = parseChangelog(MD);

  it('lista as versões na ordem do arquivo, ignorando o texto de apresentação', () => {
    expect(v.map((x) => x.version)).toEqual(['1.6.0', '1.5.0', 'Unreleased']);
    expect(v[0]?.date).toBe('2026-11-15');
    expect(v[2]?.date).toBeUndefined();
  });
  it('agrupa os itens por seção e junta linhas de continuação', () => {
    expect(v[0]?.sections.map((s) => [s.title, s.items.length])).toEqual([['✨ Novidades', 2], ['🐛 Correções', 1]]);
    const second = v[0]?.sections[0]?.items[1];
    expect(second).toEqual([{ kind: 'text', text: 'outra coisa que continua na linha de baixo' }]);
  });
  it('item sem seção vai para uma seção sem título', () => {
    expect(v[1]?.sections).toEqual([{ title: '', items: [[{ kind: 'text', text: 'item solto, sem seção' }]] }]);
  });
  it('entrada vazia ou sem versões não lança', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('# só um título\n\ntexto')).toEqual([]);
  });
});

describe('CHANGELOG.md real do repositório', () => {
  const md = readFileSync(join(__dirname, '..', '..', '..', 'CHANGELOG.md'), 'utf8');
  const versions = parseChangelog(md);
  it('é lido por inteiro: todas as versões do arquivo, com itens', () => {
    const headings = md.match(/^## \[/gm)?.length ?? 0;
    expect(headings).toBeGreaterThan(0);
    expect(versions).toHaveLength(headings);
    expect(versions.every((x) => /^\d+\.\d+\.\d+$/.test(x.version) && x.sections.some((s) => s.items.length > 0))).toBe(true);
  });
  it('os links dos commits são do GitHub do projeto (abrem pelo app)', () => {
    const links = versions.flatMap((x) => x.sections.flatMap((s) => s.items.flat())).filter((p) => p.kind === 'link');
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((p) => p.kind === 'link' && isAllowedUpdateUrl(p.href))).toBe(true);
  });
});

describe('withCurrentVersion', () => {
  const v = (...ids: string[]) => ids.map((version) => ({ version, sections: [] }));
  it('a versão em uso já está na lista: não muda nada', () => {
    const list = v('1.8.0', '1.7.0');
    expect(withCurrentVersion(list, '1.7.0')).toBe(list);
    expect(withCurrentVersion(list, 'v1.7.0')).toBe(list);
  });
  it('versão mais nova que o arquivo (a entrada só sai depois da release): entra no topo, como provisória', () => {
    const r = withCurrentVersion(v('1.7.0', '1.6.0'), '1.8.0');
    expect(r.map((x) => x.version)).toEqual(['1.8.0', '1.7.0', '1.6.0']);
    expect(r[0]?.pending).toBe(true);
    expect(r[1]?.pending).toBeUndefined();
  });
  it('entra na posição certa quando há lacuna, e no fim se for a mais antiga', () => {
    expect(withCurrentVersion(v('1.8.0', '1.6.0'), '1.7.0').map((x) => x.version)).toEqual(['1.8.0', '1.7.0', '1.6.0']);
    expect(withCurrentVersion(v('1.8.0'), '1.2.0').map((x) => x.version)).toEqual(['1.8.0', '1.2.0']);
  });
  it('sem versão informada ou com lista vazia não quebra', () => {
    expect(withCurrentVersion(v('1.8.0'), '')).toEqual(v('1.8.0'));
    expect(withCurrentVersion([], '1.8.0')).toEqual([{ version: '1.8.0', sections: [], pending: true }]);
  });
  it('o link das notas da release é do GitHub do projeto', () => {
    expect(releaseUrl('1.8.0')).toBe('https://github.com/imozart/git-nexus/releases/tag/v1.8.0');
    expect(isAllowedUpdateUrl(releaseUrl('v1.8.0'))).toBe(true);
  });
});

describe('CHANGELOG_URL', () => {
  it('aponta para o CHANGELOG.md do repositório e o app aceita abri-lo', () => {
    expect(CHANGELOG_URL).toBe('https://github.com/imozart/git-nexus/blob/main/CHANGELOG.md');
    expect(isAllowedUpdateUrl(CHANGELOG_URL)).toBe(true);
  });
});
