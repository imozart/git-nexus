import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { bumpVersion, computeNext, decideBump, latestTag, parseCommit, renderDownloads, renderNotes } from '../release-info.mjs';

const c = (subject: string, body = '', author = 'Ana') => parseCommit({ hash: 'a'.repeat(40), author, subject, body });

describe('parseCommit', () => {
  it('lê tipo, escopo, PR e ticket', () => {
    const r = c('feat(auth): adiciona login (#42)', 'corpo\n\nRefs: ABC-123');
    expect(r).toMatchObject({ type: 'feat', scope: 'auth', title: 'adiciona login', pr: '42', ticket: 'ABC-123', breaking: false });
  });
  it('detecta breaking por ! e por rodapé', () => {
    expect(c('fix!: remove rota').breaking).toBe(true);
    const r = c('feat: x', 'BREAKING CHANGE: muda contrato');
    expect(r.breaking).toBe(true);
    expect(r.breakingNote).toBe('muda contrato');
  });
  it('mensagem fora do padrão vira "other"', () => {
    expect(c('Atualiza coisas')).toMatchObject({ type: 'other', title: 'Atualiza coisas' });
    expect(c('wip: algo').type).toBe('other');
  });
});

describe('versão', () => {
  it('escolhe o maior bump', () => {
    expect(decideBump([c('fix: a'), c('docs: b')])).toBe('patch');
    expect(decideBump([c('fix: a'), c('feat: b')])).toBe('minor');
    expect(decideBump([c('feat!: a'), c('feat: b')])).toBe('major');
  });
  it('aplica bump semver', () => {
    expect(bumpVersion('1.4.9', 'patch')).toBe('1.4.10');
    expect(bumpVersion('1.4.9', 'minor')).toBe('1.5.0');
    expect(bumpVersion('1.4.9', 'major')).toBe('2.0.0');
  });
  it('acha a maior tag (ordem numérica, não lexical) e ignora tags estranhas', () => {
    expect(latestTag(['v1.2.0', 'v1.10.0', 'v1.9.9', 'nightly', 'v2.0.0-rc1'])).toBe('v1.10.0');
    expect(latestTag([])).toBeNull();
  });
  it('primeira release usa a versão do package.json', () => {
    expect(computeNext({ tags: [], commits: [], initialVersion: '1.0.0' })).toEqual({ previous: null, version: '1.0.0', bump: 'initial' });
    expect(computeNext({ tags: ['v1.0.0'], commits: [c('feat: x')], initialVersion: '1.0.0' })).toMatchObject({ version: '1.1.0', bump: 'minor' });
    expect(computeNext({ tags: ['v1.0.0'], commits: [c('feat: x')], bumpOverride: 'major', initialVersion: '1.0.0' }).version).toBe('2.0.0');
  });
});

describe('notas', () => {
  const assets = [
    { name: 'GitNexus-1.1.0-win-x64-setup.exe', size: 90_000_000 },
    { name: 'GitNexus-1.1.0-win-x64-portable.zip', size: 105_000_000 },
    { name: 'GitNexus-1.1.0-mac-arm64.dmg', size: 120_000_000 },
    { name: 'GitNexus-1.1.0-linux-amd64.deb', size: 80_000_000 },
    { name: 'GitNexus-1.1.0-linux-x86_64.rpm', size: 80_000_000 },
    { name: 'SHA256SUMS.txt', size: 900 },
  ];

  it('agrupa por tipo e inclui links, contribuidores e comparação', () => {
    const md = renderNotes({
      version: '1.1.0',
      previous: 'v1.0.0',
      repo: 'o/r',
      commits: [c('feat(ui): nova tela (#7)', 'Refs: ABC-1'), c('fix: corrige bug', '', 'Bia'), c('chore: limpa'), c('Texto livre')],
      assets,
    });
    expect(md).toContain('## ✨ Novidades');
    expect(md).toContain('## 🐛 Correções');
    expect(md).toContain('## 🧹 Manutenção');
    expect(md).toContain('## 🔹 Outras alterações');
    expect(md).toContain('https://github.com/o/r/pull/7');
    expect(md).toContain('compare/v1.0.0...v1.1.0');
    expect(md).toContain('Ana, Bia');
    expect(md).not.toContain('## ⚠️');
  });

  it('seção de breaking vem primeiro', () => {
    const md = renderNotes({ version: '2.0.0', previous: 'v1.0.0', repo: 'o/r', commits: [c('feat!: x', 'BREAKING CHANGE: quebra'), c('feat: y')] });
    expect(md.indexOf('Mudanças que quebram')).toBeLessThan(md.indexOf('Novidades'));
    expect(md).toContain('> quebra');
    expect(md.split('- x — ').length - 1).toBe(1); // aparece só na seção de breaking, sem duplicar em Novidades
  });

  it('tabela de downloads classifica por sistema e ignora arquivos auxiliares', () => {
    const t = renderDownloads({ assets, repo: 'o/r', tag: 'v1.1.0' });
    expect(t).toContain('| Windows | Instalador | x64 |');
    expect(t).toContain('| Windows | ZIP (portátil, sem instalar) | x64 |');
    expect(t).toContain('| macOS | DMG | ARM64 |');
    expect(t).toContain('| Linux | Debian/Ubuntu (.deb) | x64 |');
    expect(t).toContain('| Linux | Fedora/RHEL (.rpm) | x64 |');
    expect(t).not.toContain('SHA256SUMS.txt`](');
    expect(t).toContain('releases/download/v1.1.0/GitNexus-1.1.0-win-x64-setup.exe');
  });
});
