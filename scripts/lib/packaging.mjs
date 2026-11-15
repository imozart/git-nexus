import { flatpakFiles } from './flatpak.mjs';

// Gera os manifestos para gerenciadores de pacote (winget, Scoop, Homebrew Cask, Flatpak) a partir de uma release.
// Função pura: recebe a versão, o repositório e o conteúdo do SHA256SUMS.txt; devolve { caminho: conteúdo }.

export const PACKAGE = {
  name: 'GitNexus',
  winget: { id: 'Imozart.GitNexus', publisher: 'GitNexus' },
  description: 'Cliente Git desktop portátil, com linter de Conventional Commits, resolução visual de conflitos e rebase interativo.',
  license: 'GPL-3.0-only',
};

/** Lê o SHA256SUMS.txt ("<sha>  <arquivo>", com ou sem "*" antes do nome) em um Map nome -> sha. */
export function parseSums(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m) map.set(m[2], m[1].toLowerCase());
  }
  return map;
}

function need(sums, name) {
  const sha = sums.get(name);
  if (!sha) throw new Error(`SHA-256 de ${name} não encontrado no SHA256SUMS.txt.`);
  return sha;
}

const url = (repo, version, file) => `https://github.com/${repo}/releases/download/v${version}/${file}`;

export function wingetFiles({ version, repo, sums, date }) {
  const id = PACKAGE.winget.id;
  const [pub, pkg] = id.split('.');
  const dir = `winget/manifests/${pub[0].toLowerCase()}/${pub}/${pkg}/${version}`;
  const file = (arch) => `GitNexus-${version}-win-${arch}-setup.exe`;
  const head = (type) => [`PackageIdentifier: ${id}`, `PackageVersion: ${version}`, ...(type === 'version' ? ['DefaultLocale: pt-BR'] : type === 'installer' ? [] : ['PackageLocale: pt-BR'])];
  const tail = (type) => [`ManifestType: ${type}`, 'ManifestVersion: 1.6.0', ''];
  const schema = (type) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.1.6.0.schema.json`;

  const versionYaml = [schema('version'), ...head('version'), ...tail('version')].join('\n');
  const installer = [
    schema('installer'),
    ...head('installer'),
    'InstallerLocale: pt-BR',
    'InstallerType: nullsoft',
    'Scope: user',
    'UpgradeBehavior: install',
    `ReleaseDate: ${date}`,
    'Installers:',
    ...['x64', 'arm64'].flatMap((arch) => [
      `- Architecture: ${arch}`,
      `  InstallerUrl: ${url(repo, version, file(arch))}`,
      `  InstallerSha256: ${need(sums, file(arch)).toUpperCase()}`,
    ]),
    ...tail('installer'),
  ].join('\n');
  const locale = [
    schema('defaultLocale'),
    ...head('locale'),
    `Publisher: ${PACKAGE.winget.publisher}`,
    `PackageName: ${PACKAGE.name}`,
    `PackageUrl: https://github.com/${repo}`,
    `License: ${PACKAGE.license}`,
    `LicenseUrl: https://github.com/${repo}/blob/main/LICENSE`,
    `ShortDescription: ${PACKAGE.description}`,
    'Tags:',
    '- git',
    '- conventional-commits',
    '- desktop',
    '- electron',
    `ReleaseNotesUrl: https://github.com/${repo}/releases/tag/v${version}`,
    ...tail('defaultLocale'),
  ].join('\n');

  return {
    [`${dir}/${id}.yaml`]: versionYaml,
    [`${dir}/${id}.installer.yaml`]: installer,
    [`${dir}/${id}.locale.pt-BR.yaml`]: locale,
  };
}

export function scoopFile({ version, repo, sums }) {
  const zip = (arch) => `GitNexus-${version}-win-${arch}.zip`;
  const base = `https://github.com/${repo}/releases/download/v$version`;
  const manifest = {
    version,
    description: PACKAGE.description,
    homepage: `https://github.com/${repo}`,
    license: PACKAGE.license,
    architecture: {
      '64bit': { url: url(repo, version, zip('x64')), hash: need(sums, zip('x64')) },
      arm64: { url: url(repo, version, zip('arm64')), hash: need(sums, zip('arm64')) },
    },
    shortcuts: [['GitNexus.exe', 'GitNexus']],
    // os dados do modo portátil ficam em GitNexusData/ ao lado do .exe: persiste entre as atualizações do Scoop
    persist: 'GitNexusData',
    checkver: 'github',
    autoupdate: {
      architecture: {
        '64bit': { url: `${base}/GitNexus-$version-win-x64.zip` },
        arm64: { url: `${base}/GitNexus-$version-win-arm64.zip` },
      },
      hash: { url: `${base}/SHA256SUMS.txt`, regex: '$sha256\\s+$basename' },
    },
  };
  return { 'scoop/gitnexus.json': JSON.stringify(manifest, null, 2) + '\n' };
}

export function caskFile({ version, repo, sums }) {
  const dmg = (arch) => `GitNexus-${version}-mac-${arch}.dmg`;
  const text = `cask "gitnexus" do
  arch arm: "arm64", intel: "x64"

  version "${version}"
  sha256 arm:   "${need(sums, dmg('arm64'))}",
         intel: "${need(sums, dmg('x64'))}"

  url "https://github.com/${repo}/releases/download/v#{version}/GitNexus-#{version}-mac-#{arch}.dmg"
  name "GitNexus"
  desc "${PACKAGE.description}"
  homepage "https://github.com/${repo}"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "GitNexus.app"

  zap trash: [
    "~/Library/Application Support/GitNexus",
    "~/Library/Preferences/dev.gitnexus.studio.plist",
    "~/Library/Saved Application State/dev.gitnexus.studio.savedState",
  ]
end
`;
  return { 'homebrew/Casks/gitnexus.rb': text };
}

/** Todos os manifestos de uma release. `date` no formato AAAA-MM-DD. */
export function buildPackaging({ version, repo, sumsText, date = new Date().toISOString().slice(0, 10) }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Versão inválida: ${version}`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`Repositório inválido: ${repo}`);
  const sums = parseSums(sumsText);
  return {
    ...wingetFiles({ version, repo, sums, date }),
    ...scoopFile({ version, repo, sums }),
    ...caskFile({ version, repo, sums }),
    ...flatpakFiles({ version, repo, sums, date, description: PACKAGE.description }),
  };
}
