# Code signing policy (Política de assinatura de código)

Esta página descreve como os executáveis do **GitNexus** para Windows são assinados.
*This page describes how the Windows executables of **GitNexus** are code-signed.*

## Atribuição / Attribution

> Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

Os binários para Windows do GitNexus são assinados por meio do SignPath.io, com certificado fornecido pela SignPath Foundation.

## Papéis / Team roles

| Papel (role) | Quem | O que faz |
|---|---|---|
| **Autores** (authors) | [@imozart](https://github.com/imozart) e quem tiver permissão de escrita em <https://github.com/imozart/git-nexus> | Alteram o código-fonte |
| **Revisores** (reviewers) | [@imozart](https://github.com/imozart) | Revisam **todo** pull request de quem não é mantenedor antes do merge na `main` |
| **Aprovadores** (approvers) | [@imozart](https://github.com/imozart) | Aprovam cada pedido de assinatura de release no SignPath |

Lista atual de mantenedores: <https://github.com/imozart/git-nexus/graphs/contributors>. **Todos os membros da equipe usam
autenticação em dois fatores (MFA)** no GitHub e no SignPath.

## O que é assinado / What is signed

- O instalador do Windows e o `GitNexus.exe` do pacote portátil (x64 e ARM64), **compilados pelo GitHub Actions** a partir do
  código-fonte público deste repositório (workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml)).
- Somente builds originados da branch `main` deste repositório são aceitos pela política de assinatura.
- Nenhum binário compilado em máquina local é assinado. Os pacotes de macOS e Linux não são assinados por esta política.
- O GitNexus inclui o runtime do Electron (software livre, licenças MIT/BSD) sem modificações; não há código proprietário.

## Privacidade / Privacy policy

O GitNexus **não coleta nem envia dados pessoais**. Todo o processamento de Git acontece localmente. O programa **não envia
informações a outros sistemas em rede, exceto quando você pede**:

- *Verificação de atualização* (pode ser desligada na paleta de comandos): uma consulta anônima à API pública de releases do
  GitHub; nenhum dado do usuário nem identificador é enviado.
- *Instalar e reiniciar / Baixar*: baixa o pacote da release (e o `SHA256SUMS.txt`) do GitHub do projeto, só quando você clica.
- *Integração com GitHub/GitLab* (opcional): o app fala com a API do host que você conectar, usando o token que você informou
  (guardado criptografado pelo sistema).
- *fetch/pull/push*: executados pelo `git` instalado na máquina, com as credenciais do próprio usuário.

*The program will not transfer any information to other networked systems unless specifically requested by the user or the
person installing or operating it.*

## Verificação / Verifying

Os hashes SHA-256 de cada release estão em `SHA256SUMS.txt`. Veja também a [política de segurança](../SECURITY.md).

## Reportar problemas / Reporting

Suspeita de binário adulterado ou de abuso do certificado: use o relato privado do GitHub (aba *Security* →
*Report a vulnerability*), ou abra uma issue em <https://github.com/imozart/git-nexus/issues> se não for sensível.
