# Assinatura de código do Windows (SignPath Foundation)

Sem assinatura, o Windows (SmartScreen) mostra "o Windows protegeu o computador" ao abrir o instalador ou o `GitNexus.exe`.
O [SignPath Foundation](https://signpath.org/) assina **gratuitamente** projetos de código aberto. O pipeline já está pronto para
isso; falta só a sua conta e a configuração abaixo. Enquanto elas não existirem, as etapas de assinatura são **ignoradas** e o
build continua gerando binários sem assinatura.

## O que é assinado

Para cada arquitetura do Windows (x64 e ARM64), o workflow `release.yml`:

1. envia ao SignPath o instalador (`GitNexus-<versão>-win-<arq>-setup.exe`) e o `GitNexus.exe` do pacote portátil;
2. recebe os arquivos assinados, substitui os originais e **refaz o ZIP portátil** com o `GitNexus.exe` assinado;
3. confere com `Get-AuthenticodeSignature` que ambos ficaram com assinatura **Valid** (senão o build falha).

> Limitação conhecida: o `GitNexus.exe` que fica **dentro** do instalador é copiado antes da assinatura, então ele continua sem
> assinatura (o instalador em si é assinado, que é o que o SmartScreen avalia primeiro). Para assinar também esse, seria preciso
> assinar durante o empacotamento (hook de assinatura do electron-builder).

## Passo a passo

### 1. Pré-requisitos do projeto (SignPath Foundation)

- Repositório **público** no GitHub (Settings → General → Danger zone → *Change visibility*).
- Licença de código aberto aprovada pela OSI: o projeto usa **GPL-3.0** (arquivo `LICENSE`). ✔
- Página com a **política de assinatura** do projeto: [`CODE_SIGNING_POLICY.md`](CODE_SIGNING_POLICY.md), linkada no README. ✔
- Não incluir binários de terceiros sem origem verificável nem malware/PUA.

### 2. Pedir a assinatura gratuita

Preencha o formulário em <https://signpath.org/apply> informando o repositório, a licença e o link da política de assinatura.
A aprovação é manual e pode levar alguns dias. Quando aprovado, você recebe acesso a uma organização no SignPath.

### 3. Configurar o projeto no SignPath

No painel do SignPath (organização recebida):

1. **Projeto** com o slug `git-nexus` (ou outro; ajuste a variável abaixo).
2. **Trusted Build System**: adicione o conector **GitHub.com** e confie neste repositório.
3. **Artifact configuration** (a padrão) para o ZIP enviado pelo workflow:

   ```xml
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file-set>
         <include path="*.exe" />
         <authenticode-sign />
       </pe-file-set>
     </zip-file>
   </artifact-configuration>
   ```

4. **Signing policy** com o slug `release-signing` (ou outro; ajuste a variável abaixo), com a origem do build restrita ao
   repositório e à branch `main`.
5. Gere um **API token** de um usuário com permissão de submeter para essa policy.

### 4. Configurar o GitHub

Em *Settings → Secrets and variables → Actions*:

| Tipo | Nome | Valor |
|---|---|---|
| Secret | `SIGNPATH_API_TOKEN` | o token do passo 3.5 |
| Variável | `SIGNPATH_ORGANIZATION_ID` | o ID da organização (painel do SignPath) |
| Variável (opcional) | `SIGNPATH_PROJECT_SLUG` | padrão `git-nexus` |
| Variável (opcional) | `SIGNPATH_SIGNING_POLICY_SLUG` | padrão `release-signing` |

A partir do próximo merge na `main`, os jobs do Windows passam a assinar sozinhos.

## Outras opções (se não quiser o SignPath Foundation)

- **Azure Trusted Signing** (pago, cerca de US$ 10/mês): troque as etapas de assinatura pela ação `azure/trusted-signing-action`.
- **Certificado próprio (OV/EV)**: o electron-builder assina sozinho quando recebe `CSC_LINK` (o `.pfx` em base64) e
  `CSC_KEY_PASSWORD` no passo *Empacotar*.
- **macOS**: exige conta Apple Developer (US$ 99/ano) para assinar e notarizar (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Sem isso, o Gatekeeper avisa e a nota da release explica como abrir.

## Reputação do SmartScreen

Mesmo assinado, um programa novo pode ainda mostrar o aviso por algum tempo: a reputação se constrói com downloads. Com o
certificado do SignPath Foundation (de uma entidade conhecida), isso costuma melhorar bem mais rápido do que sem assinatura.
