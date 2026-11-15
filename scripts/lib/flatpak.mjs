// Manifesto do Flathub (Flatpak) de uma release. Função pura: devolve { caminho: conteúdo }.
// O app executa o `git` do sistema e dentro do sandbox do Flatpak ele não existe; por isso o manifesto compila o próprio git
// como um módulo (em /app/bin, que já está no PATH do Flatpak). Veja docs/PACKAGING.md.

export const FLATPAK = {
  appId: 'dev.gitnexus.studio',
  runtime: '24.08',
  // git compilado dentro do Flatpak (hash da lista assinada https://mirrors.edge.kernel.org/pub/software/scm/git/sha256sums.asc)
  git: { version: '2.56.1', sha256: 'f0b0bf89264b9bd2e1c640363e7529643989da76281600473c50745cd34a607f' },
};

const need = (sums, name) => {
  const sha = sums.get(name);
  if (!sha) throw new Error(`SHA-256 de ${name} não encontrado no SHA256SUMS.txt.`);
  return sha;
};

export function flatpakFiles({ version, repo, sums, date, description }) {
  const tgz = (arch) => `GitNexus-${version}-linux-${arch}.tar.gz`;
  const dl = (file) => `https://github.com/${repo}/releases/download/v${version}/${file}`;
  const id = FLATPAK.appId;

  const manifest = `# Manifesto do Flathub para o GitNexus ${version} (gerado por scripts/gen-packaging.mjs; veja docs/PACKAGING.md).
app-id: ${id}
runtime: org.freedesktop.Platform
runtime-version: '${FLATPAK.runtime}'
sdk: org.freedesktop.Sdk
base: org.electronjs.Electron2.BaseApp
base-version: '${FLATPAK.runtime}'
command: gitnexus
separate-locales: false

finish-args:
  - --share=ipc
  - --share=network                 # fetch/pull/push e a API do GitHub/GitLab
  - --socket=x11
  - --socket=wayland
  - --device=dri
  - --filesystem=home               # os repositórios ficam na pasta do usuário
  - --talk-name=org.freedesktop.secrets   # tokens criptografados (safeStorage -> libsecret)
  - --talk-name=org.freedesktop.Notifications
  - --env=ELECTRON_TRASH=gio

modules:
  # git dentro do sandbox (o app chama "git" pelo PATH). Sem Perl/Tcl/gettext para ficar enxuto.
  - name: git
    buildsystem: simple
    build-commands:
      - make -j$FLATPAK_BUILDER_N_JOBS prefix=/app NO_GETTEXT=1 NO_TCLTK=1 NO_PERL=1 NO_PYTHON=1 NO_EXPAT=1 NO_INSTALL_HARDLINKS=1 all
      - make prefix=/app NO_GETTEXT=1 NO_TCLTK=1 NO_PERL=1 NO_PYTHON=1 NO_EXPAT=1 NO_INSTALL_HARDLINKS=1 install
    sources:
      - type: archive
        url: https://mirrors.edge.kernel.org/pub/software/scm/git/git-${FLATPAK.git.version}.tar.xz
        sha256: ${FLATPAK.git.sha256}

  - name: gitnexus
    buildsystem: simple
    build-commands:
      - cp -a gitnexus /app/gitnexus
      - install -Dm755 gitnexus.sh /app/bin/gitnexus
      - install -Dm644 ${id}.desktop /app/share/applications/${id}.desktop
      - install -Dm644 ${id}.metainfo.xml /app/share/metainfo/${id}.metainfo.xml
      - install -Dm644 gitnexus/resources/icon.png /app/share/icons/hicolor/512x512/apps/${id}.png
    sources:
      - type: archive
        only-arches: [x86_64]
        url: ${dl(tgz('x64'))}
        sha256: ${need(sums, tgz('x64'))}
        dest: gitnexus
      - type: archive
        only-arches: [aarch64]
        url: ${dl(tgz('arm64'))}
        sha256: ${need(sums, tgz('arm64'))}
        dest: gitnexus
      - type: script
        dest-filename: gitnexus.sh
        commands:
          - exec zypak-wrapper /app/gitnexus/gitnexus "$@"
      - type: file
        path: ${id}.desktop
      - type: file
        path: ${id}.metainfo.xml
`;

  const desktop = `[Desktop Entry]
Type=Application
Name=GitNexus
GenericName=Git client
Comment=${description}
Exec=gitnexus %U
Icon=${id}
Terminal=false
Categories=Development;RevisionControl;
StartupWMClass=GitNexus
`;

  const metainfo = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${id}</id>
  <name>GitNexus</name>
  <summary>Portable open-source Git client with a commit linter and visual rebase</summary>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>GPL-3.0-only</project_license>
  <developer_name>GitNexus contributors</developer_name>
  <url type="homepage">https://github.com/${repo}</url>
  <url type="bugtracker">https://github.com/${repo}/issues</url>
  <launchable type="desktop-id">${id}.desktop</launchable>
  <description>
    <p>GitNexus is a desktop Git client with a real-time Conventional Commits linter, line- and hunk-level staging, a three-way
    conflict resolver, a visual interactive rebase, an operation history with undo, and GitHub/GitLab integration (including
    self-hosted GitLab).</p>
    <p>It does not collect or send personal data. Interface in English and Brazilian Portuguese.</p>
  </description>
  <screenshots>
    <screenshot type="default">
      <image>https://raw.githubusercontent.com/${repo}/v${version}/docs/media/commit-linter.png</image>
    </screenshot>
  </screenshots>
  <categories>
    <category>Development</category>
  </categories>
  <content_rating type="oars-1.1" />
  <releases>
    <release version="${version}" date="${date}">
      <url>https://github.com/${repo}/releases/tag/v${version}</url>
    </release>
  </releases>
</component>
`;

  return {
    [`flatpak/${id}.yml`]: manifest,
    [`flatpak/${id}.desktop`]: desktop,
    [`flatpak/${id}.metainfo.xml`]: metainfo,
  };
}
