# Componentes de terceiros distribuídos com o GitNexus

O GitNexus é distribuído sob a GPL-3.0 (arquivo `LICENSE`). Os componentes abaixo acompanham o programa com a licença própria de cada um; são usados sem modificação.

## JetBrains Mono

- **Versão:** 2.304
- **Licença:** SIL Open Font License 1.1 (OFL)
- **Copyright:** 2020 The JetBrains Mono Project Authors
- **Projeto:** https://github.com/JetBrains/JetBrainsMono
- **Release usado:** https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304

Quatro faces (400, 500, 600 e 700, sem itálico) em `.woff2`, **distribuídas sem modificação**. A licença acompanha o programa em `licenses/JetBrainsMono-OFL.txt` (na pasta de recursos do app instalado) e no repositório em `apps/ui-kit/src/styles/fonts/OFL.txt`. A origem e o SHA-256 de cada arquivo estão em `apps/ui-kit/src/styles/fonts/SOURCES.md`.

## Como acrescentar outro componente

Um item por componente, com nome, versão, licença, copyright e endereço do projeto. Se a licença exigir que o texto acompanhe o programa, copie o texto para o repositório e inclua-o em `extraResources` no `apps/studio/electron-builder.yml`, como foi feito com a JetBrains Mono. Dependências de código (npm) não entram aqui: a lista delas fica no SBOM de cada release.
