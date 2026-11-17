import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos
import { buildPackaging, parseSums } from '../lib/packaging.mjs';

const V = '1.3.0';
const sha = (c: string) => c.repeat(64);
const SUMS = [
  [`GitNexus-${V}-win-x64-setup.exe`, sha('a')],
  [`GitNexus-${V}-win-arm64-setup.exe`, sha('b')],
  [`GitNexus-${V}-win-x64-portable.zip`, sha('c')],
  [`GitNexus-${V}-win-arm64-portable.zip`, sha('d')],
  [`GitNexus-${V}-mac-x64.dmg`, sha('e')],
  [`GitNexus-${V}-mac-arm64.dmg`, sha('f')],
  [`GitNexus-${V}-linux-x64.tar.gz`, sha('1')],
  [`GitNexus-${V}-linux-arm64.tar.gz`, sha('2')],
]
  .map(([n, h]) => `${h}  ${n}`)
  .join('\n');

const gen = () => buildPackaging({ version: V, repo: 'imozart/git-nexus', sumsText: SUMS, date: '2026-11-14' }) as Record<string, string>;

describe('parseSums', () => {
  it('lê "<sha>  <arquivo>", com asterisco de modo binário e CRLF', () => {
    const m = parseSums(`${sha('A')} *a.zip\r\n${sha('b')}  b dois.zip\r\nlixo\r\n`);
    expect(m.get('a.zip')).toBe(sha('a')); // minúsculas
    expect(m.get('b dois.zip')).toBe(sha('b'));
    expect(m.size).toBe(2);
  });
});

describe('manifestos', () => {
  it('gera os arquivos esperados', () => {
    expect(Object.keys(gen()).sort()).toEqual([
      'flatpak/dev.gitnexus.studio.desktop',
      'flatpak/dev.gitnexus.studio.metainfo.xml',
      'flatpak/dev.gitnexus.studio.yml',
      'homebrew/Casks/gitnexus.rb',
      'scoop/gitnexus.json',
      `winget/manifests/i/Imozart/GitNexus/${V}/Imozart.GitNexus.installer.yaml`,
      `winget/manifests/i/Imozart/GitNexus/${V}/Imozart.GitNexus.locale.pt-BR.yaml`,
      `winget/manifests/i/Imozart/GitNexus/${V}/Imozart.GitNexus.yaml`,
    ]);
  });

  it('winget: instalador por arquitetura com URL e SHA-256 em maiúsculas', () => {
    const f = gen();
    const inst = f[`winget/manifests/i/Imozart/GitNexus/${V}/Imozart.GitNexus.installer.yaml`]!;
    expect(inst).toContain('PackageIdentifier: Imozart.GitNexus');
    expect(inst).toContain(`PackageVersion: ${V}`);
    expect(inst).toContain('InstallerType: nullsoft');
    expect(inst).toContain('Scope: user'); // o instalador é por usuário (sem administrador)
    expect(inst).toContain('ReleaseDate: 2026-11-14');
    expect(inst).toContain(`InstallerUrl: https://github.com/imozart/git-nexus/releases/download/v${V}/GitNexus-${V}-win-x64-setup.exe`);
    expect(inst).toContain(`InstallerSha256: ${sha('A')}`);
    expect(inst).toContain(`InstallerSha256: ${sha('B')}`);
    expect(inst).toContain('ManifestType: installer');
    expect(f[`winget/manifests/i/Imozart/GitNexus/${V}/Imozart.GitNexus.locale.pt-BR.yaml`]).toContain('License: GPL-3.0-only');
  });

  it('scoop: JSON válido com hash por arquitetura, persistência dos dados e autoupdate', () => {
    const j = JSON.parse(gen()['scoop/gitnexus.json']!);
    expect(j.version).toBe(V);
    expect(j.license).toBe('GPL-3.0-only');
    expect(j.architecture['64bit']).toEqual({ url: `https://github.com/imozart/git-nexus/releases/download/v${V}/GitNexus-${V}-win-x64-portable.zip`, hash: sha('c') });
    expect(j.architecture.arm64.hash).toBe(sha('d'));
    expect(j.persist).toBe('GitNexusData');
    expect(j.shortcuts).toEqual([['GitNexus.exe', 'GitNexus']]);
    expect(j.autoupdate.architecture['64bit'].url).toContain('v$version/GitNexus-$version-win-x64-portable.zip');
    expect(j.autoupdate.hash.url).toContain('SHA256SUMS.txt');
  });

  it('homebrew: cask com sha por arquitetura e livecheck', () => {
    const c = gen()['homebrew/Casks/gitnexus.rb']!;
    expect(c).toContain(`version "${V}"`);
    expect(c).toContain(`arm:   "${sha('f')}"`);
    expect(c).toContain(`intel: "${sha('e')}"`);
    expect(c).toContain('GitNexus-#{version}-mac-#{arch}.dmg');
    expect(c).toContain('strategy :github_latest');
    expect(c).toContain('app "GitNexus.app"');
  });

  it('flatpak: git compilado no sandbox, pacotes por arquitetura e metainfo da versão', () => {
    const f = gen();
    const m = f['flatpak/dev.gitnexus.studio.yml']!;
    expect(m).toContain('app-id: dev.gitnexus.studio');
    expect(m).toContain('base: org.electronjs.Electron2.BaseApp');
    expect(m).toContain('name: git'); // o app chama "git" pelo PATH: sem ele o sandbox não funciona
    expect(m).toMatch(/git-\d+\.\d+\.\d+\.tar\.xz\n\s+sha256: [0-9a-f]{64}/);
    expect(m).toContain(`url: https://github.com/imozart/git-nexus/releases/download/v${V}/GitNexus-${V}-linux-x64.tar.gz`);
    expect(m).toContain(`sha256: ${sha('1')}`);
    expect(m).toContain(`sha256: ${sha('2')}`);
    expect(m).toContain('only-arches: [aarch64]');
    expect(m).toContain('zypak-wrapper');
    expect(m).toContain('--talk-name=org.freedesktop.secrets');
    const x = f['flatpak/dev.gitnexus.studio.metainfo.xml']!;
    expect(x).toContain('<id>dev.gitnexus.studio</id>');
    expect(x).toContain(`<release version="${V}" date="2026-11-14">`);
    expect(x).toContain('<project_license>GPL-3.0-only</project_license>');
    expect(f['flatpak/dev.gitnexus.studio.desktop']).toContain('Exec=gitnexus %U');
  });

  it('recusa SHA ausente, versão e repositório inválidos', () => {
    const semMac = SUMS.split('\n').filter((l) => !l.includes('mac-arm64')).join('\n');
    expect(() => buildPackaging({ version: V, repo: 'imozart/git-nexus', sumsText: semMac })).toThrow('mac-arm64.dmg');
    expect(() => buildPackaging({ version: '1.3', repo: 'imozart/git-nexus', sumsText: SUMS })).toThrow('Versão inválida');
    expect(() => buildPackaging({ version: V, repo: 'a b/c', sumsText: SUMS })).toThrow('Repositório inválido');
    expect(() => buildPackaging({ version: V, repo: 'imozart/git-nexus', sumsText: '' })).toThrow('não encontrado');
  });
});
