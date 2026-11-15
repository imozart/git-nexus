import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { EMPTY_ENTRY, compareVersions, defaultPreamble, isStableVersion, parseChangelog, previousVersion, renderChangelog, renderEntryBody, stableVersions, upsertEntry } from '../lib/changelog.mjs';
// @ts-expect-error módulo .mjs sem tipos
import { parseCommit } from '../lib/release-core.mjs';

const REPO = 'dono/repo';
const commit = (subject: string, body = '', hash = 'a'.repeat(40)) => parseCommit({ hash, author: 'Ana', subject, body });

describe('versões', () => {
  it('só aceita X.Y.Z como estável', () => {
    expect(isStableVersion('1.2.3')).toBe(true);
    for (const v of ['1.2.3-beta.1', 'v1.2.3', '1.2', '', undefined]) expect(isStableVersion(v), String(v)).toBe(false);
  });

  it('compara numericamente (1.10.0 > 1.9.0)', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('stableVersions ignora beta e tags que não são versão, em ordem crescente', () => {
    expect(stableVersions(['v1.10.0', 'v1.2.0', 'v1.3.0-beta.1', 'latest', 'v1.9.1'])).toEqual(['1.2.0', '1.9.1', '1.10.0']);
  });

  it('previousVersion acha a estável imediatamente anterior', () => {
    const tags = ['v1.0.0', 'v1.1.0', 'v1.2.0-beta.1', 'v1.2.0'];
    expect(previousVersion(tags, '1.2.0')).toBe('1.1.0');
    expect(previousVersion(tags, '1.0.0')).toBeNull();
    expect(previousVersion(tags, '1.1.5')).toBe('1.1.0');
  });
});

describe('renderEntryBody', () => {
  const commits = [
    commit('feat(ui): painel novo (#12)', '', '1'.repeat(40)),
    commit('fix: corrige o crash', '', '2'.repeat(40)),
    commit('feat(api)!: remove a rota', 'BREAKING CHANGE: use /v2', '3'.repeat(40)),
    commit('test: cobre o painel', '', '4'.repeat(40)),
    commit('ci: ajusta o cache', '', '5'.repeat(40)),
    commit('chore: limpa', '', '6'.repeat(40)),
    commit('style: formata', '', '7'.repeat(40)),
    commit('docs: atualiza o README', '', '8'.repeat(40)),
    commit('Mensagem fora do padrão', '', '9'.repeat(40)),
  ];
  const body = renderEntryBody(commits, REPO);

  it('mostra TODOS os tipos, na ordem das notas da release', () => {
    const headings = [...body.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([
      '⚠️ Mudanças que quebram compatibilidade',
      '✨ Novidades',
      '🐛 Correções',
      '📚 Documentação',
      '🧪 Testes',
      '🤖 CI/CD',
      '🎨 Estilo',
      '🧹 Manutenção',
      '🔹 Outras alterações',
    ]);
  });

  it('nenhum commit some: testes, CI, estilo, manutenção e fora do padrão aparecem', () => {
    for (const shown of ['cobre o painel', 'ajusta o cache', 'limpa', 'formata', 'Mensagem fora do padrão']) expect(body).toContain(shown);
    // 9 commits na entrada = 9 linhas de item
    expect(body.split(/\r?\n/).filter((l) => l.startsWith('- '))).toHaveLength(9);
  });

  it('linha com escopo, link do PR e do commit; breaking traz a nota', () => {
    expect(body).toContain(`- **ui:** painel novo ([#12](https://github.com/${REPO}/pull/12)) ([\`1111111\`](https://github.com/${REPO}/commit/${'1'.repeat(40)}))`);
    expect(body).toContain('> use /v2');
    expect(body).toContain('- **api:** remove a rota');
  });

  it('sem repo, os links viram texto simples', () => {
    const plain = renderEntryBody([commit('fix: x (#3)')], undefined);
    expect(plain).toContain('- x (#3) (`aaaaaaa`)');
    expect(plain).not.toContain('http');
  });

  it('versão só com commits internos lista todos eles (não vira aviso vazio)', () => {
    const only = renderEntryBody([commit('ci: x'), commit('test: y')], REPO);
    expect(only).not.toBe(EMPTY_ENTRY);
    expect(only).toContain('### 🧪 Testes');
    expect(only).toContain('### 🤖 CI/CD');
  });

  it('só a versão sem nenhum commit (build manual) usa o aviso', () => {
    expect(renderEntryBody([], REPO)).toBe(EMPTY_ENTRY);
  });
});

describe('upsertEntry / renderChangelog', () => {
  const e = (version: string, date: string, text = `texto ${version}`) => ({ version, date, body: `### ✨ Novidades\n\n- ${text}` });

  it('cria o arquivo com preâmbulo, a versão e o link de releases', () => {
    const t = upsertEntry('', e('1.0.0', '2026-01-01'), REPO);
    expect(t.startsWith('# Changelog')).toBe(true);
    expect(t).toContain('## [1.0.0] - 2026-01-01');
    expect(t).toContain(`[1.0.0]: https://github.com/${REPO}/releases/tag/v1.0.0`);
    expect(t.endsWith('\n')).toBe(true);
  });

  it('a versão nova entra no topo e ganha o link de comparação com a anterior', () => {
    let t = upsertEntry('', e('1.0.0', '2026-01-01'), REPO);
    t = upsertEntry(t, e('1.1.0', '2026-02-01'), REPO);
    expect(t.indexOf('## [1.1.0]')).toBeLessThan(t.indexOf('## [1.0.0]'));
    expect(t).toContain(`[1.1.0]: https://github.com/${REPO}/compare/v1.0.0...v1.1.0`);
    expect(t).toContain(`[1.0.0]: https://github.com/${REPO}/releases/tag/v1.0.0`);
  });

  it('ordena por versão e não por ordem de chegada (1.10.0 antes de 1.9.0)', () => {
    let t = upsertEntry('', e('1.9.0', '2026-01-01'), REPO);
    t = upsertEntry(t, e('1.10.0', '2026-02-01'), REPO);
    t = upsertEntry(t, e('1.2.0', '2025-12-01'), REPO);
    expect([...t.matchAll(/^## \[(.+?)\]/gm)].map((m) => m[1])).toEqual(['1.10.0', '1.9.0', '1.2.0']);
  });

  it('é idempotente: refazer a mesma versão devolve o mesmo texto', () => {
    const once = upsertEntry(upsertEntry('', e('1.0.0', '2026-01-01'), REPO), e('1.1.0', '2026-02-01'), REPO);
    expect(upsertEntry(once, e('1.1.0', '2026-02-01'), REPO)).toBe(once);
  });

  it('refazer uma versão troca só o texto dela e preserva as demais (inclusive edições à mão)', () => {
    let t = upsertEntry('', e('1.0.0', '2026-01-01', 'editado à mão'), REPO);
    t = upsertEntry(t, e('1.1.0', '2026-02-01', 'antigo'), REPO);
    t = upsertEntry(t, e('1.1.0', '2026-02-01', 'novo'), REPO);
    expect(t).toContain('- novo');
    expect(t).not.toContain('- antigo');
    expect(t).toContain('- editado à mão');
  });

  it('preserva o preâmbulo editado e aceita fim de linha CRLF', () => {
    const mine = '# Histórico\n\nTexto meu.\n\n## [1.0.0] - 2026-01-01\n\n### ✨ Novidades\n\n- a\n';
    const t = upsertEntry(mine.replace(/\n/g, '\r\n'), e('1.1.0', '2026-02-01'), REPO);
    expect(t.startsWith('# Histórico\n\nTexto meu.')).toBe(true);
    expect(t).not.toContain('\r');
    expect(t).toContain('- a');
  });

  it('sem repo não escreve links de comparação', () => {
    expect(upsertEntry('', e('1.0.0', '2026-01-01'), undefined)).not.toMatch(/^\[1\.0\.0\]:/m);
  });

  it('parse e render são inversos (nada se perde entre uma leitura e uma gravação)', () => {
    const text = upsertEntry(upsertEntry('', e('1.0.0', '2026-01-01'), REPO), e('1.1.0', '2026-02-01'), REPO);
    expect(renderChangelog(parseChangelog(text), REPO)).toBe(text);
  });

  it('o preâmbulo padrão cita o repositório quando conhecido', () => {
    expect(defaultPreamble(REPO)).toContain(`https://github.com/${REPO}/releases`);
    expect(defaultPreamble(undefined)).not.toContain('http://');
  });
});

describe('CHANGELOG.md do repositório', () => {
  const text = readFileSync(join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const parsed = parseChangelog(text);

  it('começa com o título e explica que é gerado', () => {
    expect(text.startsWith('# Changelog')).toBe(true);
    expect(parsed.preamble).toContain('gerado a partir dos commits');
  });

  it('tem versões estáveis em ordem decrescente, cada uma com data e conteúdo', () => {
    expect(parsed.entries.length).toBeGreaterThanOrEqual(5);
    const versions = parsed.entries.map((e: { version: string }) => e.version);
    expect(versions).toEqual([...versions].sort((a: string, b: string) => compareVersions(b, a)));
    for (const e of parsed.entries) {
      expect(isStableVersion(e.version), e.version).toBe(true);
      expect(e.date, e.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.body.length, e.version).toBeGreaterThan(0);
    }
  });

  it('está no formato que o pipeline escreve: reler e regravar não muda nada', () => {
    expect(renderChangelog(parsed, 'imozart/git-nexus')).toBe(text);
  });
});
