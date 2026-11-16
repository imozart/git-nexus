# Política de segurança

## Versões que recebem correção

Só a **última versão publicada** em [Releases](https://github.com/imozart/git-nexus/releases/latest) recebe correções de segurança.
O app avisa quando há versão nova (e atualiza em *Atualizar agora*), então manter-se nela é o caminho recomendado.

## Como reportar uma vulnerabilidade

**Não abra uma issue pública** para falhas de segurança. Use o relato privado do GitHub:

1. Abra a aba **Security** do repositório → **Report a vulnerability** (<https://github.com/imozart/git-nexus/security/advisories/new>).
2. Descreva o problema, os passos para reproduzir, a versão e o sistema operacional. Se puder, diga o impacto que você enxerga.

O que você pode esperar: confirmação em até **7 dias**, uma avaliação do impacto e, quando for procedente, a correção numa release nova com
crédito a você no aviso (se quiser). Peço que não divulgue o problema antes da correção estar publicada.

## O que está no escopo

- Execução de código ou leitura/escrita de arquivos fora do que o app faz de propósito (por exemplo, a interface conseguir pedir um comando
  ou um endereço arbitrário ao processo principal).
- Vazamento ou armazenamento inseguro de tokens do GitHub/GitLab (eles ficam criptografados pelo sistema, via `safeStorage`).
- Falhas no fluxo de atualização (download de pacote sem conferir o SHA-256, endereço fora do repositório oficial).
- Falhas na cadeia de build/release (workflows do GitHub Actions, assinatura de código).

Fora do escopo: problemas que exigem acesso físico ou que já tenham o controle total da conta do usuário; vulnerabilidades em dependências
sem um caminho de exploração no GitNexus.

## Como verificar o que você baixou

- Cada release traz o **`SHA256SUMS.txt`**. Confira o hash do pacote antes de executar:
  - Windows (PowerShell): `Get-FileHash .\GitNexus-<versão>-win-x64-setup.exe -Algorithm SHA256`
  - Linux/macOS: `sha256sum -c SHA256SUMS.txt --ignore-missing`
- Cada release traz também a lista de componentes (**SBOM**, CycloneDX) e, nas publicadas com o repositório público, a **proveniência assinada**
  (`gh attestation verify <arquivo> --repo imozart/git-nexus`).
- Hoje os executáveis do **Windows e do macOS não são assinados**: o SmartScreen e o Gatekeeper avisam na primeira abertura. O pipeline já está pronto
  para assinar o Windows pelo SignPath Foundation (veja [`docs/CODE_SIGNING.md`](docs/CODE_SIGNING.md)); enquanto isso, a conferência do SHA-256 é o que garante o arquivo.
- O app **não coleta nem envia dados pessoais**; a única comunicação de rede própria é a consulta anônima de novas versões (pode ser desligada na paleta de comandos).

## Práticas do projeto

- O Electron roda com `contextIsolation` e `sandbox` ligados e sem `nodeIntegration`; a interface só chama as funções expostas pela ponte do `preload`
  (contratos em `apps/studio/src/shared/channels.ts`), e o Git pesado roda em um processo separado.
- Tokens do GitHub/GitLab ficam criptografados pelo sistema (`safeStorage`) e nunca voltam para a interface.
- A atualização dentro do app confere o **SHA-256** do pacote contra o `SHA256SUMS.txt` da mesma release e só baixa de `github.com/imozart/git-nexus`.
- Todo PR passa por varredura de segredos (gitleaks, em todo o histórico), auditoria de dependências (`pnpm audit`: alta e crítica reprovam) e lint dos
  workflows; os workflows declaram `permissions` mínimas e os que escrevem em PRs não executam o código do PR.
