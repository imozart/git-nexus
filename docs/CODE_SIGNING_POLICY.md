# Política de assinatura de código

Esta página descreve como os executáveis do **GitNexus** para Windows são assinados.

## Atribuição

Os binários para Windows do GitNexus são assinados por meio do SignPath.io, com certificado fornecido pela SignPath Foundation.

> Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## Papéis

| Papel | Quem |
|---|---|
| **Autores e mantenedores** | os contribuidores do repositório <https://github.com/imozart/git-nexus> |
| **Revisores** | os mantenedores; todo código entra na `main` por pull request com o CI aprovado |
| **Aprovadores** | os mantenedores do projeto, que aprovam cada assinatura de release no SignPath |

## O que é assinado

- O instalador do Windows e o `GitNexus.exe` do pacote portátil (x64 e ARM64), **compilados pelo GitHub Actions** a partir do
  código-fonte público deste repositório (workflow `.github/workflows/release.yml`).
- Somente builds originados da branch `main` deste repositório são aceitos pela política de assinatura.
- Nenhum binário compilado em máquina local é assinado.

## Privacidade

O GitNexus **não coleta nem envia dados pessoais**. Todo o processamento de Git acontece localmente. A única comunicação de rede
própria do programa é, opcionalmente, uma consulta anônima à API pública de releases do GitHub para avisar sobre novas versões
(pode ser desligada na paleta de comandos); nenhum dado do usuário nem identificador é enviado. As operações de rede dos
repositórios (fetch, pull) são executadas pelo `git` instalado na máquina, com as credenciais do próprio usuário.

## Reportar problemas

Suspeita de binário adulterado ou de abuso do certificado: abra uma issue em <https://github.com/imozart/git-nexus/issues> ou use
o aviso de segurança privado do GitHub (aba *Security*). Os hashes SHA-256 de cada release estão em `SHA256SUMS.txt`.
