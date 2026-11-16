import { describe, expect, it } from 'vitest';
import { checkForUpdate } from '../src/entrypoints/update';
import { compareVersions, findSha256, installPlan, isAllowedUpdateUrl, isSafeAssetName, pickAsset, type ReleaseAsset } from '../src/shared/update';

const A = (name: string): ReleaseAsset => ({ name, browser_download_url: `https://github.com/imozart/git-nexus/releases/download/v1.3.0/${name}` });
const ASSETS = [
  'GitNexus-1.3.0-win-x64-setup.exe', 'GitNexus-1.3.0-win-x64.zip', 'GitNexus-1.3.0-win-arm64-setup.exe', 'GitNexus-1.3.0-win-arm64.zip',
  'GitNexus-1.3.0-mac-x64.dmg', 'GitNexus-1.3.0-mac-arm64.dmg', 'GitNexus-1.3.0-mac-arm64.zip',
  'GitNexus-1.3.0-linux-x86_64.AppImage', 'GitNexus-1.3.0-linux-arm64.AppImage', 'GitNexus-1.3.0-linux-x64.tar.gz', 'GitNexus-1.3.0-linux-amd64.deb', 'SHA256SUMS.txt',
].map(A);

describe('compareVersions', () => {
  it('compara numericamente, não como texto', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0);
  });
  it('devolve null para formatos fora de X.Y.Z', () => {
    expect(compareVersions('2.0.0-beta', '1.0.0')).toBeNull();
    expect(compareVersions('latest', '1.0.0')).toBeNull();
  });
});

describe('pickAsset', () => {
  it('Windows: instalador, ou ZIP quando é portátil; respeita a arquitetura', () => {
    expect(pickAsset(ASSETS, { platform: 'win32', arch: 'x64', portable: false })?.name).toBe('GitNexus-1.3.0-win-x64-setup.exe');
    expect(pickAsset(ASSETS, { platform: 'win32', arch: 'x64', portable: true })?.name).toBe('GitNexus-1.3.0-win-x64.zip');
    expect(pickAsset(ASSETS, { platform: 'win32', arch: 'arm64', portable: false })?.name).toBe('GitNexus-1.3.0-win-arm64-setup.exe');
  });
  it('macOS: DMG da arquitetura certa', () => {
    expect(pickAsset(ASSETS, { platform: 'darwin', arch: 'arm64', portable: false })?.name).toBe('GitNexus-1.3.0-mac-arm64.dmg');
    expect(pickAsset(ASSETS, { platform: 'darwin', arch: 'x64', portable: false })?.name).toBe('GitNexus-1.3.0-mac-x64.dmg');
  });
  it('Linux: AppImage (nomes x86_64 e arm64)', () => {
    expect(pickAsset(ASSETS, { platform: 'linux', arch: 'x64', portable: false })?.name).toBe('GitNexus-1.3.0-linux-x86_64.AppImage');
    expect(pickAsset(ASSETS, { platform: 'linux', arch: 'arm64', portable: false })?.name).toBe('GitNexus-1.3.0-linux-arm64.AppImage');
  });
  it('sem pacote compatível, devolve null (a interface cai para a página da release)', () => {
    expect(pickAsset(ASSETS, { platform: 'freebsd', arch: 'x64', portable: false })).toBeNull();
    expect(pickAsset([A('SHA256SUMS.txt')], { platform: 'win32', arch: 'x64', portable: false })).toBeNull();
  });
});

describe('isAllowedUpdateUrl', () => {
  it('só aceita https do GitHub do projeto', () => {
    expect(isAllowedUpdateUrl('https://github.com/imozart/git-nexus/releases/tag/v1.3.0')).toBe(true);
    expect(isAllowedUpdateUrl('https://github.com/imozart/git-nexus/releases/download/v1.3.0/a.zip')).toBe(true);
    expect(isAllowedUpdateUrl('http://github.com/imozart/git-nexus/releases')).toBe(false);
    expect(isAllowedUpdateUrl('https://github.com/outro/repo/releases')).toBe(false);
    expect(isAllowedUpdateUrl('https://github.com.evil.com/imozart/git-nexus/x')).toBe(false);
    expect(isAllowedUpdateUrl('https://evil.com/github.com/imozart/git-nexus/x')).toBe(false);
    expect(isAllowedUpdateUrl('file:///c:/windows/system32/calc.exe')).toBe(false);
    expect(isAllowedUpdateUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedUpdateUrl('lixo')).toBe(false);
  });
});

describe('installPlan', () => {
  const win = { platform: 'win32', portable: false, appImage: false };
  it('Windows instalado: instalador; portátil, macOS e pacotes de distro ficam manuais', () => {
    expect(installPlan('GitNexus-1.3.0-win-x64-setup.exe', win)).toBe('installer');
    expect(installPlan('GitNexus-1.3.0-win-x64-setup.exe', { ...win, portable: true })).toBe('manual');
    expect(installPlan('GitNexus-1.3.0-win-x64.zip', win)).toBe('manual');
    // ZIP portátil: só se atualiza sozinho com a pasta do app gravável
    const zip = 'GitNexus-1.3.0-win-x64.zip';
    expect(installPlan(zip, { ...win, portable: true, writable: true })).toBe('portable');
    expect(installPlan(zip, { ...win, portable: true, writable: false })).toBe('manual');
    expect(installPlan(zip, { ...win, portable: true })).toBe('manual');
    expect(installPlan(zip, { platform: 'linux', portable: true, appImage: false, writable: true })).toBe('manual');
    expect(installPlan('GitNexus-1.3.0-mac-arm64.dmg', { platform: 'darwin', portable: false, appImage: false })).toBe('manual');
    expect(installPlan('GitNexus-1.3.0-linux-amd64.deb', { platform: 'linux', portable: false, appImage: false })).toBe('manual');
  });
  it('Linux: só troca o AppImage quando o app realmente roda de um AppImage', () => {
    expect(installPlan('GitNexus-1.3.0-linux-x86_64.AppImage', { platform: 'linux', portable: false, appImage: true })).toBe('appimage');
    expect(installPlan('GitNexus-1.3.0-linux-x86_64.AppImage', { platform: 'linux', portable: false, appImage: false })).toBe('manual');
    expect(installPlan(undefined, win)).toBe('manual');
  });
});

describe('findSha256 / isSafeAssetName', () => {
  const H1 = 'a'.repeat(64);
  const H2 = 'B'.repeat(64);
  const sums = H1 + '  GitNexus-1.3.0-win-x64-setup.exe\r\n' + H2 + ' *GitNexus-1.3.0-win-x64.zip\nlixo\n';
  it('lê o formato do sha256sum (texto e binário, CRLF) e devolve em minúsculas', () => {
    expect(findSha256(sums, 'GitNexus-1.3.0-win-x64-setup.exe')).toBe(H1);
    expect(findSha256(sums, 'GitNexus-1.3.0-win-x64.zip')).toBe(H2.toLowerCase());
    expect(findSha256(sums, 'outro.exe')).toBeNull();
    expect(findSha256(sums, 'GitNexus-1.3.0-win-x64')).toBeNull(); // casa o nome inteiro, não prefixo
  });
  it('só aceita nomes de arquivo simples', () => {
    expect(isSafeAssetName('GitNexus-1.3.0-win-x64-setup.exe')).toBe(true);
    for (const bad of ['..\\x.exe', '../x.exe', 'a/b.exe', 'a b.exe', '', '.hidden', 'a..b/../c']) expect(isSafeAssetName(bad)).toBe(false);
  });
});

describe('checkForUpdate (fetch simulado)', () => {
  const ctx = { current: '1.2.0', platform: 'win32', arch: 'x64', portable: false };
  const reply = (status: number, body?: unknown) => (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;
  const release = (over: object = {}) => ({
    tag_name: 'v1.3.0',
    html_url: 'https://github.com/imozart/git-nexus/releases/tag/v1.3.0',
    body: '## ✨ Novidades\n- algo',
    published_at: '2026-11-14T12:00:00Z',
    assets: ASSETS,
    ...over,
  });

  it('nova versão: devolve página, pacote sugerido e notas', async () => {
    const r = await checkForUpdate({ ...ctx, fetchImpl: reply(200, release()) });
    expect(r).toMatchObject({
      status: 'available',
      current: '1.2.0',
      latest: '1.3.0',
      url: 'https://github.com/imozart/git-nexus/releases/tag/v1.3.0',
      assetName: 'GitNexus-1.3.0-win-x64-setup.exe',
    });
    expect(r.downloadUrl).toContain('/releases/download/v1.3.0/');
    expect(r.notes).toContain('Novidades');
  });

  it('oferece instalar dentro do app só quando a release publica o SHA256SUMS.txt', async () => {
    const r = await checkForUpdate({ ...ctx, fetchImpl: reply(200, release()) });
    expect(r.install).toBe('installer');
    expect(r.sumsUrl).toContain('/SHA256SUMS.txt');
    const semHash = await checkForUpdate({ ...ctx, fetchImpl: reply(200, release({ assets: ASSETS.filter((a) => a.name !== 'SHA256SUMS.txt') })) });
    expect(semHash.install).toBe('manual');
  });

  it('portátil recebe o ZIP', async () => {
    const r = await checkForUpdate({ ...ctx, portable: true, fetchImpl: reply(200, release()) });
    expect(r.assetName).toBe('GitNexus-1.3.0-win-x64.zip');
  });

  it('em dia: mesma versão ou mais nova que a publicada', async () => {
    expect((await checkForUpdate({ ...ctx, current: '1.3.0', fetchImpl: reply(200, release()) })).status).toBe('up-to-date');
    expect((await checkForUpdate({ ...ctx, current: '2.0.0', fetchImpl: reply(200, release()) })).status).toBe('up-to-date');
  });

  it('ignora rascunho e pré-lançamento', async () => {
    expect((await checkForUpdate({ ...ctx, fetchImpl: reply(200, release({ draft: true })) })).status).toBe('up-to-date');
    expect((await checkForUpdate({ ...ctx, fetchImpl: reply(200, release({ prerelease: true })) })).status).toBe('up-to-date');
  });

  it('erros viram "unavailable" com explicação, sem lançar', async () => {
    const r404 = await checkForUpdate({ ...ctx, fetchImpl: reply(404) });
    expect(r404).toMatchObject({ status: 'unavailable' });
    expect(r404.message).toContain('privado');
    expect((await checkForUpdate({ ...ctx, fetchImpl: reply(500) })).message).toContain('500');
    const down = await checkForUpdate({ ...ctx, fetchImpl: (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch });
    expect(down).toMatchObject({ status: 'unavailable', message: expect.stringContaining('conexão') });
    expect((await checkForUpdate({ ...ctx, fetchImpl: reply(200, release({ tag_name: 'nightly' })) })).status).toBe('unavailable');
  });

  it('consulta só a API do repositório do projeto, sem enviar dados do usuário', async () => {
    let url = '';
    let headers: Record<string, string> = {};
    const spy = (async (u: string, init?: { headers?: Record<string, string> }) => {
      url = u;
      headers = init?.headers ?? {};
      return { ok: true, status: 200, json: async () => release() };
    }) as unknown as typeof fetch;
    await checkForUpdate({ ...ctx, fetchImpl: spy });
    expect(url).toBe('https://api.github.com/repos/imozart/git-nexus/releases/latest');
    expect(headers['User-Agent']).toBe('GitNexus-update-check');
    expect(Object.keys(headers).sort()).toEqual(['Accept', 'User-Agent', 'X-GitHub-Api-Version']); // nada além disso
  });
});
